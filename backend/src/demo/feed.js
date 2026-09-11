import { logger } from '../logger.js';

/**
 * Offline demo market feed.
 *
 * When the Binance streams cannot connect (no network egress, missing
 * credentials, etc.) this synthesises a random-walk market so the platform —
 * paper trading, charts, AI signals, order book, brackets — remains fully
 * usable as a sandbox. It only runs when live data is absent and stops as soon
 * as a real Binance stream connects. Disable with OFFLINE_DEMO=false.
 */

const BASE_PRICES = {
  BTCUSDT: 60_000,
  ETHUSDT: 3_200,
  SOLUSDT: 145,
  BNBUSDT: 560,
};

export const isDemoEnabled = () =>
  !['false', '0', 'no'].includes(String(process.env.OFFLINE_DEMO || 'true').toLowerCase());

const INTERVAL_MS = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

let seed = 42;
function rand() {
  // Deterministic-ish PRNG so the demo looks consistent.
  seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
  return seed / 4_294_967_296;
}

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

class DemoMarket {
  constructor(symbols) {
    this.symbols = symbols;
    this.prices = {};
    this.candles = {}; // symbol -> array of 1m candles
    this.highs = {};
    for (const s of symbols) {
      this.prices[s] = BASE_PRICES[s] || 100;
      this.candles[s] = [];
      this.highs[s] = this.prices[s];
      // Seed ~120 minutes of history so charts & signals have data immediately.
      for (let i = 0; i < 120; i++) this._advance(s, Date.now() - (120 - i) * 60_000);
    }
  }

  _advance(symbol, ts) {
    const prev = this.prices[symbol];
    const drift = (BASE_PRICES[symbol] - prev) * 0.0005;
    const shock = gaussian() * prev * 0.0015;
    const close = Math.max(0.01, prev + drift + shock);
    const open = prev;
    const high = Math.max(open, close) * (1 + rand() * 0.0008);
    const low = Math.min(open, close) * (1 - rand() * 0.0008);
    const volume = 10 + rand() * 300;
    this.prices[symbol] = close;
    this.highs[symbol] = Math.max(this.highs[symbol], high);

    const candle = {
      openTime: ts,
      closeTime: ts + INTERVAL_MS['1m'] - 1,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume: volume * close,
      trades: Math.floor(rand() * 500),
    };
    const arr = this.candles[symbol];
    arr.push(candle);
    if (arr.length > 2000) arr.shift();
    return candle;
  }

  step() {
    const ts = Date.now();
    const out = [];
    for (const symbol of this.symbols) {
      const candle = this._advance(symbol, ts);
      const price = this.prices[symbol];
      out.push({
        ticker: {
          type: 'ticker',
          eventTime: ts,
          symbol,
          priceChange: price - candle.open,
          priceChangePct: ((price - candle.open) / candle.open) * 100,
          weightedAvgPrice: price,
          lastPrice: price,
          lastQty: 0.001,
          bidPrice: price * 0.9999,
          askPrice: price * 1.0001,
          bidQty: 1,
          askQty: 1,
          openPrice: candle.open,
          highPrice: candle.high,
          lowPrice: candle.low,
          volume: candle.volume,
          quoteVolume: candle.quoteVolume,
          openTime: ts,
          closeTime: ts + INTERVAL_MS['1m'],
          count: candle.trades,
        },
        kline: {
          type: 'kline',
          eventTime: ts,
          symbol,
          interval: '1m',
          startTime: candle.openTime,
          closeTime: candle.closeTime,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          quoteVolume: candle.quoteVolume,
          trades: candle.trades,
          isClosed: true,
        },
      });
    }
    return out;
  }

  /** Synthetic order book around the current price. */
  orderBook(symbol, levels = 20) {
    const price = this.prices[symbol] || 100;
    const bids = [];
    const asks = [];
    for (let i = 0; i < levels; i++) {
      bids.push([price - (i + 1) * 0.01, 0.1 + rand() * 5]);
      asks.push([price + (i + 1) * 0.01, 0.1 + rand() * 5]);
    }
    return { bids, asks };
  }

  /** Aggregate synthetic history into Binance-format klines for the REST API. */
  klines(symbol, interval, limit = 200) {
    const src = this.candles[symbol] || [];
    const step = INTERVAL_MS[interval] || 60_000;
    const buckets = new Map();
    for (const c of src) {
      const bucketTs = Math.floor(c.openTime / step) * step;
      const b = buckets.get(bucketTs);
      if (!b) {
        buckets.set(bucketTs, {
          openTime: bucketTs,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          quoteVolume: c.quoteVolume,
          trades: c.trades,
        });
      } else {
        b.high = Math.max(b.high, c.high);
        b.low = Math.min(b.low, c.low);
        b.close = c.close;
        b.volume += c.volume;
        b.quoteVolume += c.quoteVolume;
        b.trades += c.trades;
      }
    }
    const rows = [...buckets.values()].sort((a, b) => a.openTime - b.openTime).slice(-limit);
    return rows.map((r) => [
      r.openTime, r.open, r.high, r.low, r.close, r.volume, r.openTime + step - 1,
      r.quoteVolume, r.trades, 0, 0, 0,
    ]);
  }
}

let instance = null;
export function getDemoMarket(symbols) {
  if (!instance) instance = new DemoMarket(symbols);
  return instance;
}

/**
 * Start the offline feed. Publishes tickers + 1m klines (and refreshes the
 * order book) through the StreamManager so the trading engine, cache and
 * Socket.io broadcasts all behave exactly as they would with live Binance data.
 */
export function startDemoFeed({ streams, symbols }) {
  if (!isDemoEnabled()) return null;
  const market = getDemoMarket(symbols);
  logger.info('Offline demo market feed started (Binance unreachable)', { symbols });

  const tick = () => {
    const events = market.step();
    for (const { ticker, kline } of events) {
      streams.publish(ticker);
      streams.publish(kline);
      streams.publish({ type: 'depth', symbol: ticker.symbol, lastUpdateId: Date.now(), ...market.orderBook(ticker.symbol) });
    }
  };

  // Replay the seeded history so the trading engine and AI service have enough
  // candles to produce signals immediately (no 60s warm-up).
  for (const symbol of symbols) {
    for (const c of (market.candles[symbol] || []).slice(-60)) {
      streams.publish({
        type: 'kline',
        eventTime: c.closeTime,
        symbol,
        interval: '1m',
        startTime: c.openTime,
        closeTime: c.closeTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        quoteVolume: c.quoteVolume,
        trades: c.trades,
        isClosed: true,
      });
    }
  }

  tick();
  const timer = setInterval(tick, 2000);
  if (timer.unref) timer.unref();
  return { stop: () => clearInterval(timer), market };
}

export default { startDemoFeed, getDemoMarket, isDemoEnabled };
