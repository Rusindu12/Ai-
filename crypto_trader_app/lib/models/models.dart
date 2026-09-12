import '../core/json.dart';

/// ---------------------------------------------------------------------------
/// All DTOs mirror `crypto_trader_backend` responses exactly (the numbers come
/// back as doubles or decimal strings, hence the `asDouble` helpers).
/// ---------------------------------------------------------------------------

/// `GET /api/prices` rows and `GET /api/prices/{symbol}`.
class Ticker {
  const Ticker({
    required this.symbol,
    required this.price,
    required this.changePct,
    required this.change,
    required this.high,
    required this.low,
    required this.volume,
    required this.quoteVolume,
    required this.trades,
    required this.bid,
    required this.ask,
    required this.open24h,
    required this.updatedAtMs,
  });

  final String symbol;
  final double price;
  final double changePct;
  final double change;
  final double high;
  final double low;
  final double volume;
  final double quoteVolume;
  final int trades;
  final double bid;
  final double ask;
  final double open24h;
  final int updatedAtMs;

  bool get isUp => changePct >= 0;
  double get spreadPct => price == 0 ? 0 : (ask - bid) / price * 100;

  static Ticker fromJson(Map<String, dynamic> json) => Ticker(
        symbol: asString(json['symbol']),
        price: asDouble(json['price']),
        changePct: asDouble(json['change_percent_24h']),
        change: asDouble(json['change_24h']),
        high: asDouble(json['high_24h']),
        low: asDouble(json['low_24h']),
        volume: asDouble(json['volume_24h']),
        quoteVolume: asDouble(json['quote_volume_24h']),
        trades: asInt(json['trades_24h']),
        bid: asDouble(json['bid']),
        ask: asDouble(json['ask']),
        open24h: asDouble(json['open_24h']),
        updatedAtMs: asInt(json['updated_at_ms']),
      );

  /// Apply a live `tickers` WS event on top of this row.
  Ticker applyTick({
    required double close,
    required double open,
    required double high,
    required double low,
    required double volume,
    required int trades,
  }) =>
      Ticker(
        symbol: symbol,
        price: close,
        changePct: open == 0 ? 0 : (close - open) / open * 100,
        change: close - open,
        high: high,
        low: low,
        volume: volume,
        quoteVolume: close * volume,
        trades: trades,
        bid: bid,
        ask: ask,
        open24h: open,
        updatedAtMs: DateTime.now().millisecondsSinceEpoch,
      );
}

/// `GET /api/klines/{symbol}/{interval}` -> `candles[]`.
class Candle {
  const Candle({
    required this.openTime,
    required this.open,
    required this.high,
    required this.low,
    required this.close,
    required this.volume,
    required this.trades,
    required this.closed,
  });

  final int openTime; // epoch ms
  final double open;
  final double high;
  final double low;
  final double close;
  final double volume;
  final int trades;
  final bool closed;

  bool get isUp => close >= open;
  DateTime get time => DateTime.fromMillisecondsSinceEpoch(openTime);
  double get rangePct => low == 0 ? 0 : (high - low) / low * 100;

  static Candle fromJson(Map<String, dynamic> json) => Candle(
        openTime: asInt(json['open_time'] ?? json['t']),
        open: asDouble(json['open'] ?? json['o']),
        high: asDouble(json['high'] ?? json['h']),
        low: asDouble(json['low'] ?? json['l']),
        close: asDouble(json['close'] ?? json['c']),
        volume: asDouble(json['volume'] ?? json['v']),
        trades: asInt(json['trades'] ?? json['n']),
        closed: asBool(json['closed'], fallback: true),
      );
}

class KlinePage {
  const KlinePage({required this.symbol, required this.interval, required this.candles, required this.changePercent});

  final String symbol;
  final String interval;
  final List<Candle> candles;
  final double changePercent;

  static KlinePage fromJson(Map<String, dynamic> json) => KlinePage(
        symbol: asString(json['symbol']),
        interval: asString(json['interval']),
        candles: asMapList(json['candles']).map(Candle.fromJson).toList(growable: false),
        changePercent: asDouble(json['change_percent']),
      );

  Candle? get last => candles.isEmpty ? null : candles.last;
}

/// `GET /api/orderbook/{symbol}`.
class OrderBook {
  const OrderBook({
    required this.symbol,
    required this.bids,
    required this.asks,
    required this.bestBid,
    required this.bestAsk,
    required this.midPrice,
    required this.spreadBps,
    required this.imbalance,
    required this.fromCache,
  });

  final String symbol;
  final List<List<double>> bids;
  final List<List<double>> asks;
  final double bestBid;
  final double bestAsk;
  final double midPrice;
  final double spreadBps;
  final double imbalance;
  final bool fromCache;

  double get maxSideQty {
    double m = 0;
    for (final row in bids.take(20)) {
      if (row.length > 1 && row[1] > m) m = row[1];
    }
    for (final row in asks.take(20)) {
      if (row.length > 1 && row[1] > m) m = row[1];
    }
    return m == 0 ? 1 : m;
  }

  static OrderBook fromJson(Map<String, dynamic> json) => OrderBook(
        symbol: asString(json['symbol']),
        bids: _side(json['bids']),
        asks: _side(json['asks']),
        bestBid: asDouble(json['best_bid']),
        bestAsk: asDouble(json['best_ask']),
        midPrice: asDouble(json['mid_price']),
        spreadBps: asDouble(json['spread_bps']),
        imbalance: asDouble(json['imbalance']),
        fromCache: asBool(json['from_cache']),
      );

  static List<List<double>> _side(Object? raw) {
    final out = <List<double>>[];
    for (final row in asList(raw)) {
      if (row is List && row.length >= 2) {
        out.add([asDouble(row[0]), asDouble(row[1])]);
      }
    }
    return out;
  }
}

class SymbolInfo {
  const SymbolInfo({
    required this.symbol,
    required this.base,
    required this.quote,
    required this.name,
    required this.tracked,
    required this.tickSize,
    required this.stepSize,
    required this.minNotional,
  });

  final String symbol;
  final String base;
  final String quote;
  final String name;
  final bool tracked;
  final double tickSize;
  final double stepSize;
  final double minNotional;

  static SymbolInfo fromJson(Map<String, dynamic> json) {
    double tick = 0, step = 0, minNotional = 0;
    for (final f in asMapList(json['filters'])) {
      switch (asString(f['filterType'])) {
        case 'PRICE_FILTER':
          tick = asDouble(f['tickSize'], fallback: asDouble(f['tick']));
        case 'LOT_SIZE':
          step = asDouble(f['stepSize'], fallback: asDouble(f['step']));
        case 'MIN_NOTIONAL':
          minNotional = asDouble(f['minNotional'], fallback: asDouble(f['notional']));
        case 'NOTIONAL':
          minNotional = asDouble(f['minNotional'], fallback: minNotional);
      }
    }
    return SymbolInfo(
      symbol: asString(json['symbol']),
      base: asString(json['base']),
      quote: asString(json['quote']),
      name: asString(json['name']),
      tracked: asBool(json['tracked']),
      tickSize: tick,
      stepSize: step,
      minNotional: minNotional,
    );
  }
}

/// `GET /api/watchlist` rows.
class WatchItem {
  const WatchItem({required this.symbol, required this.note, required this.position});
  final String symbol;
  final String note;
  final int position;

  static WatchItem fromJson(Map<String, dynamic> json) => WatchItem(
        symbol: asString(json['symbol']),
        note: asString(json['note']),
        position: asInt(json['position']),
      );
}

/// `GET /api/market/summary`.
class MarketSummary {
  const MarketSummary({
    required this.tracked,
    required this.totalQuoteVolumeUsd,
    required this.advancers,
    required this.decliners,
    required this.gainers,
    required this.losers,
    required this.source,
    required this.demoMode,
    required this.subscribers,
    required this.streamConnected,
    required this.secondsSinceEvent,
  });

  final int tracked;
  final double totalQuoteVolumeUsd;
  final int advancers;
  final int decliners;
  final List<Ticker> gainers;
  final List<Ticker> losers;
  final String source;
  final bool demoMode;
  final int subscribers;
  final bool streamConnected;
  final double secondsSinceEvent;

  double get breadthValue => tracked == 0 ? 0 : advancers / tracked;

  static MarketSummary fromJson(Map<String, dynamic> json) {
    final status = asMap(json['status']);
    return MarketSummary(
      tracked: asInt(json['tracked']),
      totalQuoteVolumeUsd: asDouble(json['total_quote_volume_usd']),
      advancers: asInt(json['advancers']),
      decliners: asInt(json['decliners']),
      gainers: asMapList(json['gainers']).map(Ticker.fromJson).toList(growable: false),
      losers: asMapList(json['losers']).map(Ticker.fromJson).toList(growable: false),
      source: asString(status['source'], fallback: 'unknown'),
      demoMode: asBool(status['demo_mode']),
      subscribers: asInt(status['subscribers']),
      streamConnected: asBool(asMap(status['stream'])['connected'], fallback: asBool(status['demo_mode'])),
      secondsSinceEvent: asDouble(status['seconds_since_event']),
    );
  }
}
