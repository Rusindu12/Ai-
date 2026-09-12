import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/formatters.dart';
import '../../core/ta.dart';
import '../../core/theme.dart';
import '../../models/ai.dart';
import '../../models/models.dart';
import '../../models/trading.dart';
import '../../providers/app_state.dart';
import '../../providers/providers.dart';
import '../../widgets/ai_signal_card.dart';
import '../../widgets/candle_chart.dart';
import '../../widgets/charts_extras.dart';
import '../../widgets/common.dart';
import '../../widgets/order_book.dart';
import '../../widgets/pickers.dart';
import '../../widgets/trade_panel.dart';

/// Screen 3 — live chart + order book + AI overlay + the trade panel.
class TradeScreen extends ConsumerStatefulWidget {
  const TradeScreen({super.key});

  @override
  ConsumerState<TradeScreen> createState() => _TradeScreenState();
}

class _TradeScreenState extends ConsumerState<TradeScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 4, vsync: this);
  bool _showTradeSheet = false;

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final symbol = ref.watch(selectedSymbolProvider);
    final interval = ref.watch(selectedIntervalProvider);
    final chartAsync = ref.watch(chartFeedProvider(ChartKey(symbol, interval)));
    final indicators = ref.watch(indicatorsProvider).valueOrNull;
    final orderBook = ref.watch(orderBookProvider).valueOrNull;
    final ticker = ref.watch(tickerTableProvider).valueOrNull?[symbol];
    final positions = (ref.watch(positionsProvider).valueOrNull ?? const []).where((p) => p.symbol == symbol).toList();
    final candles = chartAsync.valueOrNull?.candles ?? const <Candle>[];
    final wide = MediaQuery.sizeOf(context).width >= 720;

    final closes = [for (final c in candles) c.close];
    final overlays = _Overlays.from(candles, closes);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Column(
        children: [
          _SymbolHeader(symbol: symbol, ticker: ticker, onPickSymbol: () async {
            final picked = await showSymbolPicker(context, selected: symbol);
            if (picked == null || picked.isEmpty || !mounted) return;
            setState(() {
              ref.read(selectedSymbolProvider.notifier).state = picked;
              ref.read(localStoreProvider).setDefaultSymbol(picked);
            });
            ref.invalidate(orderBookProvider);
          }),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                await ref.read(chartFeedProvider(ChartKey(symbol, interval)).notifier).load();
                ref.invalidate(indicatorsProvider);
                ref.invalidate(orderBookProvider);
              },
              child: CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: SectionCard(
                                  padding: const EdgeInsets.fromLTRB(6, 6, 6, 0),
                                  child: Column(
                                    children: [
                                      TabBar(
                                        controller: _tabs,
                                        isScrollable: true,
                                        tabAlignment: TabAlignment.start,
                                        labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                                        unselectedLabelStyle: const TextStyle(fontSize: 12),
                                        tabs: const [
                                          Tab(text: 'Chart'),
                                          Tab(text: 'Depth'),
                                          Tab(text: 'Indicators'),
                                          Tab(text: 'AI signal'),
                                        ],
                                      ),
                                      SizedBox(
                                        height: 430,
                                        child: TabBarView(
                                          controller: _tabs,
                                          children: [
                                            _ChartTab(
                                              candles: candles,
                                              loading: chartAsync.isLoading,
                                              error: chartAsync.error,
                                              overlays: overlays,
                                              indicators: indicators,
                                              onRetry: () => ref.read(chartFeedProvider(ChartKey(symbol, interval)).notifier).load(),
                                            ),
                                            _DepthTab(book: orderBook, symbol: symbol, loading: orderBook == null),
                                            _IndicatorsTab(indicators: indicators, candles: candles),
                                            _AiTab(symbol: symbol, interval: interval),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          if (positions.isNotEmpty) _PositionStrip(positions: positions),
                          if (!wide) ...[
                            const SizedBox(height: 10),
                            SectionCard(
                              title: 'Place an order',
                              child: TradePanel(symbol: symbol, referencePrice: ticker?.price ?? indicators?.price),
                            ),
                          ],
                          const SizedBox(height: 16),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: wide
          ? FloatingActionButton.extended(
              onPressed: () => setState(() => _showTradeSheet = true),
              backgroundColor: AppColors.up,
              foregroundColor: Colors.black87,
              icon: const Icon(Icons.add_chart),
              label: const Text('Trade', style: TextStyle(fontWeight: FontWeight.w800)),
            )
          : null,
      bottomSheet: wide && _showTradeSheet
          ? Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              decoration: BoxDecoration(
                color: Theme.of(context).scaffoldBackgroundColor,
                border: Border(top: BorderSide(color: Theme.of(context).dividerColor)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Text('Order ticket · $symbol', style: const TextStyle(fontWeight: FontWeight.w800)),
                      const Spacer(),
                      IconButton(onPressed: () => setState(() => _showTradeSheet = false), icon: const Icon(Icons.close, size: 18)),
                    ],
                  ),
                  SizedBox(height: 420, child: SingleChildScrollView(child: TradePanel(symbol: symbol, referencePrice: ticker?.price))),
                ],
              ),
            )
          : null,
    );
  }
}

class _SymbolHeader extends ConsumerWidget {
  const _SymbolHeader({required this.symbol, required this.ticker, required this.onPickSymbol});

  final String symbol;
  final Ticker? ticker;
  final VoidCallback onPickSymbol;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ticker;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
      child: Column(
        children: [
          Row(
            children: [
              InkWell(
                onTap: onPickSymbol,
                borderRadius: BorderRadius.circular(10),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                  child: Row(
                    children: [
                      Text(symbol, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
                      const Icon(Icons.unfold_more, size: 15),
                    ],
                  ),
                ),
              ),
              if (t != null) ...[
                const SizedBox(width: 10),
                Text(fmtPrice(t.price), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
                const SizedBox(width: 8),
                PnlPill(value: t.changePct),
              ],
              const Spacer(),
              const IntervalSelector(),
            ],
          ),
          if (t != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(
                children: [
                  Expanded(child: _kv(context, '24h High', fmtPrice(t.high))),
                  Expanded(child: _kv(context, '24h Low', fmtPrice(t.low))),
                  Expanded(child: _kv(context, '24h Vol', fmtCompact(t.quoteVolume))),
                  Expanded(child: _kv(context, 'Trades', fmtCompact(t.trades))),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _kv(BuildContext context, String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label.toUpperCase(), style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 8.5, letterSpacing: 0.5)),
        Text(value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
      ],
    );
  }
}

class _Overlays {
  const _Overlays({required this.emaFast, required this.emaSlow, required this.vwap, required this.bb});

  final List<double> emaFast;
  final List<double> emaSlow;
  final List<double> vwap;
  final BollingerSeries bb;

  factory _Overlays.from(List<Candle> candles, List<double> closes) {
    return _Overlays(
      emaFast: toDense(ema(closes, 20)),
      emaSlow: toDense(ema(closes, 50)),
      vwap: toDense(vwap(candles)),
      bb: bollinger(closes),
    );
  }
}

class _ChartTab extends StatelessWidget {
  const _ChartTab({
    required this.candles,
    required this.loading,
    required this.error,
    required this.overlays,
    required this.indicators,
    required this.onRetry,
  });

  final List<Candle> candles;
  final bool loading;
  final Object? error;
  final _Overlays overlays;
  final Indicators? indicators;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (error != null && candles.isEmpty) {
      return ErrorView(error: error!, onRetry: onRetry);
    }
    if (candles.isEmpty) {
      return LoadingBox(height: 380, message: loading ? 'Loading candles…' : 'No candles for this pair yet');
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(6, 4, 6, 0),
          child: Row(
            children: [
              _legend(context, AppColors.up, 'up candle'),
              _legend(context, const Color(0xFFA78BFA), 'EMA50'),
              _legend(context, AppColors.ai, 'EMA20'),
              _legend(context, Colors.white70, 'VWAP'),
              _legend(context, AppColors.info, 'Bollinger'),
              const Spacer(),
              Text('${candles.length} bars', style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 9.5)),
            ],
          ),
        ),
        Expanded(
          child: CandleChart(
            candles: candles,
            height: 320,
            emaFast: overlays.emaFast,
            emaSlow: overlays.emaSlow,
            vwap: overlays.vwap,
            bollingerUpper: toDense(overlays.bb.upper),
            bollingerLower: toDense(overlays.bb.lower),
            supports: indicators?.supports ?? const <double>[],
            resistances: indicators?.resistances ?? const <double>[],
          ),
        ),
      ],
    );
  }

  Widget _legend(BuildContext context, Color colour, String label) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 7, height: 3, decoration: BoxDecoration(color: colour, borderRadius: BorderRadius.circular(2))),
            const SizedBox(width: 3),
            Text(label, style: TextStyle(fontSize: 8.5, color: Theme.of(context).textTheme.bodySmall?.color)),
          ],
        ),
      );
}

class _DepthTab extends StatelessWidget {
  const _DepthTab({required this.book, required this.symbol, required this.loading});

  final OrderBook? book;
  final String symbol;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    if (book == null) {
      return LoadingBox(height: 380, message: loading ? 'Loading order book…' : 'No book yet');
    }
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
      child: OrderBookLadder(book: book!, rows: 12),
    );
  }
}

class _IndicatorsTab extends StatelessWidget {
  const _IndicatorsTab({required this.indicators, required this.candles});

  final Indicators? indicators;
  final List<Candle> candles;

  @override
  Widget build(BuildContext context) {
    if (indicators == null) {
      return const LoadingBox(height: 380, message: 'Computing indicators…');
    }
    final closes = [for (final c in candles) c.close];
    final rsiSeries = rsi(closes);
    final rsiSpots = <FlSpot>[
      for (var i = 0; i < rsiSeries.length; i++)
        if (rsiSeries[i] != null) FlSpot(i.toDouble(), rsiSeries[i]!),
    ];
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          IndicatorStrip(indicators: indicators ?? Indicators.empty),
          const SizedBox(height: 10),
          if (rsiTrim(rsiSpots).length > 2)
            IndicatorPane(
              title: 'RSI 14 (on-device)',
              spots: rsiTrim(rsiSpots),
              minY: 0,
              maxY: 100,
              height: 74,
            ),
          const SizedBox(height: 10),
          InfoRow(label: 'ATR', value: '${fmtPrice(indicators!.atr)}  (${indicators.atrPct.toStringAsFixed(2)}%)'),
          InfoRow(label: 'ADX', value: '${indicators.adx.toStringAsFixed(1)} · trend strength'),
          InfoRow(label: 'Volume vs 20-bar avg', value: '${(indicators.relativeVolume * 100).toStringAsFixed(0)}%'),
          InfoRow(label: 'Taker buy ratio', value: indicators.takerRatio.toStringAsFixed(3)),
          const SizedBox(height: 8),
          _Levels(levels: indicators.levels),
        ],
      ),
    );
  }

  static List<FlSpot> rsiTrim(List<FlSpot> input) => input.length > 120 ? input.sublist(input.length - 120) : input;
}

class _Levels extends StatelessWidget {
  const _Levels({required this.levels});

  final List<PriceLevel> levels;

  @override
  Widget build(BuildContext context) {
    if (levels.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Detected levels', style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 10, letterSpacing: 0.6)),
        const SizedBox(height: 4),
        for (final raw in levels)
          Builder(builder: (context) {
            final level = raw;
            final isSupport = level.isSupport;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Icon(isSupport ? Icons.south : Icons.north, size: 13, color: isSupport ? AppColors.up : AppColors.down),
                  const SizedBox(width: 6),
                  Text(fmtPrice(level.price), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
                  const SizedBox(width: 8),
                  Text(
                    '${isSupport ? 'support' : 'resistance'} · ${level.touches} touches · ${fmtPct(level.distancePct, decimals: 2)} away',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 10),
                  ),
                ],
              ),
            );
          }),
      ],
    );
  }
}

class _AiTab extends ConsumerWidget {
  const _AiTab({required this.symbol, required this.interval});

  final String symbol;
  final String interval;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final signalAsync = ref.watch(aiSignalProvider((symbol, interval)));
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(aiSignalProvider((symbol, interval))),
      child: ListView(
        padding: const EdgeInsets.all(10),
        children: [
          signalAsync.when(
            loading: () => const LoadingBox(height: 220, message: 'Asking the model…'),
            error: (error, _) => ErrorView(error: error, onRetry: () => ref.invalidate(aiSignalProvider((symbol, interval)))),
            data: (signal) => AiSignalCard(
              signal: signal,
              onExecute: () async {
                final ok = await showModalBottomSheet<bool>(
                  context: context,
                  builder: (context) => SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: TradePanel(symbol: symbol, initialSide: signal.action, referencePrice: signal.price, presetQty: signal.tradePlan.suggestedQty),
                    ),
                  ),
                );
                if (ok == true && context.mounted) Navigator.pop(context);
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _PositionStrip extends ConsumerWidget {
  const _PositionStrip({required this.positions});

  final List<OpenPosition> positions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SectionCard(
      title: 'Open position',
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Column(
        children: [
          for (final p in positions)
            Column(
              children: [
                InfoRow(label: 'Size', value: fmtQty(p.qty)),
                InfoRow(label: 'Entry', value: fmtPrice(p.avgPrice)),
                InfoRow(
                  label: 'Unrealised',
                  value: fmtSignedUsd(p.unrealizedPnl),
                  color: p.unrealizedPnl >= 0 ? AppColors.up : AppColors.down,
                  bold: true,
                ),
                if (p.takeProfit != null) InfoRow(label: 'Take profit', value: fmtPrice(p.takeProfit!), color: AppColors.up),
                if (p.stopLoss != null) InfoRow(label: 'Stop loss', value: fmtPrice(p.stopLoss!), color: AppColors.down),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          final notifier = ref.read(tradeSubmitProvider.notifier);
                          try {
                            await notifier.cancel('${p.symbol}');
                          } on Exception catch (e) {
                            if (context.mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Cancel failed: $e')));
                            }
                          }
                        },
                        icon: const Icon(Icons.close, size: 15),
                        label: const Text('Cancel orders', style: TextStyle(fontSize: 11.5)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: FilledButton.tonalIcon(
                        onPressed: () async {
                          final qty = p.qty;
                          final result = await ref.read(tradeSubmitProvider.notifier).submit({
                            'symbol': p.symbol,
                            'side': 'SELL',
                            'order_type': 'MARKET',
                            'quantity': qty,
                          });
                          if (context.mounted && result != null) {
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Closed ${result.symbol} · ${fmtSignedUsd(result.realizedPnl)}')));
                          }
                        },
                        icon: const Icon(Icons.flash_on, size: 15),
                        label: const Text('Market close', style: TextStyle(fontSize: 11.5)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
        ],
      ),
    );
  }
}
