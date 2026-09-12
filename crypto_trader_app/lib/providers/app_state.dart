import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/errors.dart';
import '../core/labels.dart';
import '../models/ai.dart';
import '../models/app_user.dart';
import '../models/models.dart';
import '../models/trading.dart';
import '../services/auth_service.dart';
import '../services/websocket_service.dart';
import 'providers.dart';

/// ---------------------------------------------------------------------------
/// Screen-level state. Reads go through BackendApi, live updates through the
/// shared socket. Refresh-on-resume + pull-on-subscribe keeps the UI honest even
/// when the stream dropped for a while.
/// ---------------------------------------------------------------------------

final authStateProvider = StreamProvider<AuthState>((ref) async* {
  final auth = ref.watch(authServiceProvider);
  yield await auth.restore();
  yield* auth.changes;
});

final serverConfigProvider = FutureProvider<ServerConfig>((ref) async {
  try {
    return await ref.watch(backendApiProvider).authConfig();
  } on AppException {
    return ServerConfig.fallback;
  }
});

final connectionStateProvider = StreamProvider<ConnectionState>((ref) async* {
  final service = ref.watch(realtimeProvider);
  yield service.currentState;
  yield* service.state;
});

/// Theme + locale, mirrored to the backend so a reinstall keeps preferences.
class ThemeModeNotifier extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    final saved = ref.watch(localStoreProvider).theme;
    return switch (saved) {
      'light' => ThemeMode.light,
      'system' => ThemeMode.system,
      _ => ThemeMode.dark,
    };
  }

  Future<void> set(ThemeMode mode) async {
    state = mode;
    await ref.read(localStoreProvider).setTheme(mode.name.replaceAll('ThemeMode.', ''));
    final name = switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    };
    await ref.read(localStoreProvider).setTheme(name);
    try {
      await ref.read(backendApiProvider).saveSettings(theme: name);
    } on Exception {
      // offline: the local preference still applies
    }
  }
}

final themeModeProvider = NotifierProvider<ThemeModeNotifier, ThemeMode>(ThemeModeNotifier.new);

class LocaleNotifier extends Notifier<Locale> {
  @override
  Locale build() {
    final saved = ref.watch(localStoreProvider).locale ?? 'en';
    return L.supported.contains(saved) ? Locale(saved) : const Locale('en');
  }

  Future<void> set(String code) async {
    state = Locale(code);
    await ref.read(localStoreProvider).setLocale(code);
    try {
      await ref.read(backendApiProvider).saveSettings(locale: code);
    } on Exception {
      // ignore
    }
  }
}

final appLocaleProvider = NotifierProvider<LocaleNotifier, Locale>(LocaleNotifier.new);

/// Convenience for widgets that only need the string table.
final labelsProvider = Provider<L>((ref) => L(ref.watch(appLocaleProvider).languageCode));

/// The symbol the Trade + AI screens focus on.
final selectedSymbolProvider = StateProvider<String>((ref) => ref.watch(localStoreProvider).defaultSymbol);
final selectedIntervalProvider = StateProvider<String>((ref) => ref.watch(localStoreProvider).defaultInterval);

// ------------------------------------------------------------------- market --

/// Dashboard ticker table. A REST snapshot is merged with WS `tickers` events;
/// `flush()` is throttled so a busy stream does not rebuild 60x/second.
class TickerTableNotifier extends Notifier<AsyncValue<Map<String, Ticker>>> {
  Map<String, Ticker> _rows = {};
  Timer? _flush;
  StreamSubscription<Map<String, dynamic>>? _sub;

  @override
  AsyncValue<Map<String, Ticker>> build() {
    _sub?.cancel();
    _sub = ref.watch(realtimeProvider).events.listen(_onEvent);
    ref.onDispose(() {
      _flush?.cancel();
      _sub?.cancel();
    });
    Future.microtask(load);
    final cached = ref.read(localStoreProvider).cachedPrices;
    if (cached.isNotEmpty && _rows.isEmpty) {
      _rows = {
        for (final entry in cached.entries)
          if (entry.value is Map) entry.key: Ticker.fromJson((entry.value as Map).cast<String, dynamic>()),
      };
    }
    return _rows.isEmpty ? const AsyncLoading<Map<String, Ticker>>() : AsyncData<Map<String, Ticker>>(_rows);
  }

  void _onEvent(Map<String, dynamic> event) {
    final type = event['type'];
    if (type != 'tickers' && type != 'snapshot') return;
    var changed = false;
    if (type == 'snapshot') {
      for (final row in ((event['tickers'] ?? const []) as List)) {
        final ticker = Ticker.fromJson((row as Map).cast<String, dynamic>());
        _rows[ticker.symbol] = ticker;
        changed = true;
      }
    } else {
      for (final row in ((event['data'] ?? const []) as List)) {
        final map = (row as Map).cast<String, dynamic>();
        final symbol = '${map['s'] ?? map['symbol'] ?? ''}';
        if (symbol.isEmpty) continue;
        final existing = _rows[symbol];
        final price = double.tryParse('${map['c'] ?? map['price'] ?? 0}') ?? 0;
        final open = double.tryParse('${map['o'] ?? map['open_24h'] ?? 0}') ?? 0;
        _rows[symbol] = existing == null
            ? Ticker.fromJson({...map, 'symbol': symbol, 'price': price, 'open_24h': open})
            : existing.applyTick(
                close: price,
                open: open == 0 ? existing.open24h : open,
                high: double.tryParse('${map['h'] ?? map['high_24h'] ?? 0}') ?? existing.high,
                low: double.tryParse('${map['l'] ?? map['low_24h'] ?? 0}') ?? existing.low,
                volume: double.tryParse('${map['v'] ?? map['volume_24h'] ?? 0}') ?? existing.volume,
                trades: int.tryParse('${map['n'] ?? map['trades_24h'] ?? 0}') ?? existing.trades,
              );
        changed = true;
      }
    }
    if (!changed) return;
    // Coalesce bursts into one rebuild per 200ms.
    _flush ??= Timer(const Duration(milliseconds: 200), () {
      _flush = null;
      state = AsyncData<Map<String, Ticker>>(Map.of(_rows));
      if (_rows.length <= 60) {
        ref.read(localStoreProvider).saveCachedPrices({
          for (final entry in _rows.entries) entry.key: {
            'symbol': entry.key,
            'price': entry.value.price,
            'change_percent_24h': entry.value.changePct,
            'high_24h': entry.value.high,
            'low_24h': entry.value.low,
            'volume_24h': entry.value.volume,
            'quote_volume_24h': entry.value.quoteVolume,
            'trades_24h': entry.value.trades,
            'bid': entry.value.bid,
            'ask': entry.value.ask,
            'open_24h': entry.value.open24h,
            'updated_at_ms': entry.value.updatedAtMs,
          },
        });
      }
    });
  }

  Future<void> load() async {
    try {
      final rows = await ref.read(backendApiProvider).prices();
      for (final row in rows) {
        _rows[row.symbol] = row;
      }
      state = AsyncData<Map<String, Ticker>>(Map.of(_rows));
    } on AppException catch (e) {
      state = _rows.isEmpty ? AsyncError<Map<String, Ticker>>(e, StackTrace.current) : AsyncData<Map<String, Ticker>>(Map.of(_rows));
    }
  }

  void sortByQuoteVolume() {
    final entries = _rows.entries.toList()
      ..sort((a, b) => b.value.quoteVolume.compareTo(a.value.quoteVolume));
    _rows = {for (final e in entries) e.key: e.value};
    state = AsyncData<Map<String, Ticker>>(Map.of(_rows));
  }
}

final tickerTableProvider =
    NotifierProvider<TickerTableNotifier, AsyncValue<Map<String, Ticker>>>(TickerTableNotifier.new);

final marketSummaryProvider = FutureProvider<MarketSummary>((ref) async {
  final api = ref.watch(backendApiProvider);
  final summary = await api.marketSummary();
  // Keep it fresh while the dashboard is open.
  final timer = Timer.periodic(const Duration(seconds: 45), (_) => ref.invalidateSelf());
  ref.onDispose(timer.cancel);
  return summary;
});

final sparklineProvider = FutureProvider<Map<String, List<double>>>((ref) => ref.watch(backendApiProvider).sparklineSeries());

final symbolListProvider = FutureProvider<List<SymbolInfo>>((ref) => ref.watch(backendApiProvider).symbols());

/// Chart state: REST history backfill + live WS bar merging for one
/// (symbol, interval) pair. Screens watch `chartFeedProvider(key)`.
class ChartKey {
  const ChartKey(this.symbol, this.interval);
  final String symbol;
  final String interval;

  @override
  bool operator ==(Object other) => other is ChartKey && other.symbol == symbol && other.interval == interval;

  @override
  int get hashCode => Object.hash(symbol, interval);

  @override
  String toString() => '$symbol:$interval';
}

class ChartFeed extends Notifier<AsyncValue<KlinePage>> {
  ChartFeed(this.key);

  final ChartKey key;
  KlinePage? _page;
  StreamSubscription<Map<String, dynamic>>? _sub;

  @override
  AsyncValue<KlinePage> build() {
    _sub?.cancel();
    _sub = ref.watch(realtimeProvider).where('kline').listen(_onBar);
    ref.onDispose(() => _sub?.cancel());
    unawaited(load());
    return _page == null ? const AsyncLoading<KlinePage>() : AsyncData<KlinePage>(_page!);
  }

  Future<void> load() async {
    try {
      final page = await ref.read(backendApiProvider).klines(key.symbol, key.interval, limit: 240);
      _page = page;
      state = AsyncData<KlinePage>(page);
    } on AppException catch (e) {
      state = _page == null ? AsyncError<KlinePage>(e, StackTrace.current) : AsyncData<KlinePage>(_page!);
    }
  }

  void _onBar(Map<String, dynamic> event) {
    final data = (event['data'] as Map?)?.cast<String, dynamic>() ?? event;
    final symbol = '${data['s'] ?? data['symbol'] ?? key.symbol}'.toUpperCase();
    final interval = '${data['i'] ?? key.interval}';
    if (symbol != key.symbol.toUpperCase() || interval != key.interval) return;
    final page = _page;
    if (page == null || page.candles.isEmpty) return;
    final bar = Candle.fromJson({
      'open_time': data['t'] ?? data['open_time'],
      'o': data['o'] ?? data['open'],
      'h': data['h'] ?? data['high'],
      'l': data['l'] ?? data['low'],
      'c': data['c'] ?? data['close'],
      'v': data['v'] ?? data['volume'],
      'n': data['n'] ?? data['trades'],
      'closed': data['x'] ?? data['closed'] ?? false,
    });
    final bars = List<Candle>.from(page.candles);
    if (bars.isNotEmpty && bars.last.openTime == bar.openTime) {
      bars[bars.length - 1] = bar;
    } else if (bar.openTime > bars.last.openTime) {
      bars.add(bar);
      if (bars.length > 240) bars.removeAt(0);
    } else {
      return;
    }
    _page = KlinePage(
      symbol: page.symbol,
      interval: page.interval,
      candles: bars,
      changePercent: bars.first.open == 0 ? 0 : (bar.close / bars.first.open - 1) * 100,
    );
    state = AsyncData<KlinePage>(_page!);
  }
}

final chartFeedProvider =
    NotifierProvider.family<ChartFeed, AsyncValue<KlinePage>, ChartKey>((ref, key) => ChartFeed(key));

final orderBookProvider = FutureProvider<OrderBook>((ref) async {
  final symbol = ref.watch(selectedSymbolProvider);
  final api = ref.watch(backendApiProvider);
  final book = await api.orderbook(symbol, depth: 20);
  final sub = ref
      .watch(realtimeProvider)
      .where('depth')
      .where((e) => '${e['symbol'] ?? ''}'.toUpperCase() == symbol.toUpperCase())
      .throttle(const Duration(milliseconds: 350))
      .listen((event) {
    ref.invalidateSelf();
  });
  ref.onDispose(sub.cancel);
  return book;
});

extension<T> on Stream<T> {
  /// Naive leading-edge throttle (keeps the socket from repainting at 10Hz+).
  Stream<T> throttle(Duration window) {
    late final StreamController<T> controller;
    late final StreamSubscription<T> source;
    var blocked = false;
    Timer? timer;
    controller = StreamController<T>(
      onListen: () {
        source = listen(
          (value) {
            if (blocked) return;
            blocked = true;
            controller.add(value);
            timer = Timer(window, () => blocked = false);
          },
          onError: controller.addError,
          onDone: () {
            timer?.cancel();
            controller.close();
          },
        );
      },
      onCancel: () {
        source.cancel();
        timer?.cancel();
      },
    );
    return controller.stream;
  }
}

// -------------------------------------------------------------------- trade --

final accountProvider = FutureProvider<AccountSnapshot>((ref) async {
  final snapshot = await ref.watch(backendApiProvider).account();
  // Portfolio/positions move with fills; re-pull on any trade event.
  final sub = ref.watch(realtimeProvider).where('trade').listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  return snapshot;
});

final positionsProvider = FutureProvider<List<OpenPosition>>((ref) async {
  final rows = await ref.watch(backendApiProvider).positions();
  final sub = ref.watch(realtimeProvider).where('trade').listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  return rows;
});

final openOrdersProvider = FutureProvider<List<TradeRow>>((ref) async {
  final rows = await ref.watch(backendApiProvider).openOrders();
  final sub = ref.watch(realtimeProvider).where('order_update').listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  return rows;
});

final tradeHistoryProvider = FutureProvider<List<TradeRow>>((ref) => ref.watch(backendApiProvider).history(limit: 80));

final tradeSummaryProvider = FutureProvider<Map<String, dynamic>>((ref) => ref.watch(backendApiProvider).tradeSummary());

/// Submits an order, keeping the last result around so the confirmation sheet can
/// show fill details (and the risk rejection reason when blocked).
class TradeSubmitNotifier extends Notifier<AsyncValue<OrderResult?>> {
  @override
  AsyncValue<OrderResult?> build() => const AsyncData(null);

  Future<OrderResult?> submit(Map<String, dynamic> payload) async {
    state = const AsyncLoading();
    try {
      final result = await ref.read(backendApiProvider).placeOrder(payload);
      state = AsyncData(result);
      ref.invalidate(accountProvider);
      ref.invalidate(positionsProvider);
      ref.invalidate(openOrdersProvider);
      ref.invalidate(tradeHistoryProvider);
      ref.invalidate(tradeSummaryProvider);
      ref.invalidate(portfolioChartProvider);
      return result;
    } on AppException catch (e) {
      state = AsyncError(e, StackTrace.current);
      rethrow;
    }
  }

  Future<OrderPreview> preview(Map<String, dynamic> payload) => ref.read(backendApiProvider).previewOrder(payload);

  /// Cancel by client order id (or exchange order id - the backend accepts both).
  Future<void> cancel(String clientOrderId) async {
    state = const AsyncLoading();
    try {
      final result = await ref.read(backendApiProvider).cancelOrderByRef(clientOrderId);
      state = AsyncData(result);
      ref.invalidate(openOrdersProvider);
      ref.invalidate(positionsProvider);
      ref.invalidate(accountProvider);
    } on AppException catch (e) {
      state = AsyncError(e, StackTrace.current);
      rethrow;
    }
  }
}

final tradeSubmitProvider =
    NotifierProvider<TradeSubmitNotifier, AsyncValue<OrderResult?>>(TradeSubmitNotifier.new);

// ----------------------------------------------------------------------- ai --

final aiSignalProvider = FutureProvider.autoDispose.family<AiSignal, (String, String)>((ref, key) async {
  final (symbol, interval) = key;
  final signal = await ref.watch(backendApiProvider).signal(symbol, interval: interval, bars: 400);
  return signal;
});

final aiSignalsBatchProvider = FutureProvider<List<SymbolSignal>>((ref) async {
  final rows = await ref.watch(backendApiProvider).batchSignals(interval: ref.watch(selectedIntervalProvider));
  final timer = Timer.periodic(const Duration(minutes: 3), (_) => ref.invalidateSelf());
  ref.onDispose(timer.cancel);
  return rows;
});

final sentimentProvider = FutureProvider<MarketSentiment>((ref) async {
  final sentiment = await ref.watch(backendApiProvider).sentiment();
  final timer = Timer.periodic(const Duration(minutes: 2), (_) => ref.invalidateSelf());
  ref.onDispose(timer.cancel);
  return sentiment;
});

final indicatorsProvider = FutureProvider<Indicators>((ref) async {
  final symbol = ref.watch(selectedSymbolProvider);
  final interval = ref.watch(selectedIntervalProvider);
  return ref.watch(backendApiProvider).indicators(symbol, interval);
});

final modelsProvider = FutureProvider<ModelInfo>((ref) async {
  final info = await ref.watch(backendApiProvider).models();
  final sub = ref
      .watch(realtimeProvider)
      .where('status')
      .where((e) => '${e['job'] ?? ''}' == 'ai-retrain')
      .listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  return info;
});

final backtestProvider = FutureProvider.autoDispose.family<BacktestResult, Map<String, dynamic>>((ref, cfg) {
  return ref.read(backendApiProvider).backtest(
        symbol: '${cfg['symbol'] ?? 'BTCUSDT'}',
        interval: '${cfg['interval'] ?? '1h'}',
        bars: cfg['bars'] is int ? cfg['bars'] as int : 500,
        strategy: '${cfg['strategy'] ?? 'ai_hybrid'}',
        riskPerTrade: (cfg['risk_per_trade'] as num?)?.toDouble() ?? 1.0,
        atrTpMult: (cfg['atr_tp_mult'] as num?)?.toDouble() ?? 2.0,
        atrSlMult: (cfg['atr_sl_mult'] as num?)?.toDouble() ?? 1.5,
      );
});

final strategiesProvider = FutureProvider<List<StrategySpec>>((ref) => ref.watch(backendApiProvider).strategies());

final signalHistoryProvider = FutureProvider.family<List<AiSignal>, String>(
  (ref, symbol) => ref.watch(backendApiProvider).signalHistory(symbol, limit: 24),
);

// --------------------------------------------------------------------- auto --

final autoStatusProvider = FutureProvider<AutoTraderStatus>((ref) async {
  final status = await ref.watch(backendApiProvider).autoStatus();
  final sub = ref
      .watch(realtimeProvider)
      .where('ai_trade')
      .listen((_) {
    ref.invalidateSelf();
    ref.invalidate(autoLogProvider);
    ref.invalidate(accountProvider);
  });
  final timer = Timer.periodic(const Duration(seconds: 30), (_) => ref.invalidateSelf());
  ref.onDispose(() {
    sub.cancel();
    timer.cancel();
  });
  return status;
});

final autoLogProvider = FutureProvider<List<AutoTradeEntry>>((ref) => ref.watch(backendApiProvider).autoLog(limit: 40));

final autoPerformanceProvider = FutureProvider<AutoPerformance>((ref) => ref.watch(backendApiProvider).autoPerformance());

// ------------------------------------------------------------------ alerts ----

final alertsProvider = FutureProvider<List<PriceAlert>>((ref) async {
  final rows = await ref.watch(backendApiProvider).alerts();
  final sub = ref
      .watch(realtimeProvider)
      .where('alert_triggered')
      .listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  return rows;
});

final notificationsProvider = FutureProvider<List<AppNotification>>((ref) async {
  final rows = await ref.watch(backendApiProvider).notifications(limit: 40);
  final sub = ref.watch(realtimeProvider).where('notification').listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  return rows;
});

// ---------------------------------------------------------------- portfolio --

final portfolioChartProvider = FutureProvider<List<EquityPoint>>((ref) async {
  final api = ref.watch(backendApiProvider);
  return api.portfolioHistory(days: 30);
});

// ----------------------------------------------------------------- settings --

final settingsProvider = FutureProvider<Map<String, dynamic>>((ref) => ref.watch(backendApiProvider).settings());

final keyStatusProvider = FutureProvider<KeyStatus>((ref) async {
  final status = await ref.watch(backendApiProvider).keyStatus();
  return status;
});

final watchlistProvider = FutureProvider<List<WatchItem>>((ref) => ref.watch(backendApiProvider).watchlist());

/// Preference: allow the "Execute with AI plan" button on the signal card.
final executeFromSignalProvider = StateProvider<bool>((ref) => ref.read(localStoreProvider).executeFromSignal);
