/**
 * Built-in demo trading engine (client-side).
 *
 * When no backend is reachable — e.g. a freshly installed APK with no server
 * configured — the app runs entirely on-device: it simulates live market data
 * (random-walk prices, candles, order book), an AI-style signal engine, and a
 * paper-trading portfolio with take-profit / stop-loss / trailing brackets.
 *
 * Everything is exposed through the same interfaces the UI already uses:
 *   - demoSocket: a Socket.io-compatible EventEmitter (ticker/kline/depth/
 *     signal/trade/bracket/orderRejected)
 *   - demoApi(path, opts): answers the REST calls the UI makes
 *
 * When a real backend is detected the demo engine is stopped and the app talks
 * to the server instead. No user action required.
 */

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const BASE_PRICES = { BTCUSDT: 60000, ETHUSDT: 3200, SOLUSDT: 145, BNBUSDT: 560 };
const STARTING_BALANCE = 10000;
const INTERVAL_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const HISTORY_MINUTES = 6000; // ~4 days of 1m candles

// ---------------------------------------------------------------- utilities
let seed = 42;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

class Emitter {
  constructor() {
    this.handlers = {};
    this.connected = true;
  }
  on(evt, fn) {
    (this.handlers[evt] ||= []).push(fn);
    return this;
  }
  off(evt, fn) {
    if (!this.handlers[evt]) return this;
    this.handlers[evt] = this.handlers[evt].filter((f) => f !== fn);
    return this;
  }
  emit(evt, data) {
    (this.handlers[evt] || []).forEach((f) => {
      try {
        f(data);
      } catch {
        /* ignore */
      }
    });
  }
}

export const demoSocket = new Emitter();

// ------------------------------------------------------------------- state
const state = {
  seeded: false,
  prices: {},
  candles: {},
  books: {},
  signals: {},
  cash: STARTING_BALANCE,
  positions: {}, // symbol -> { qty, avgPrice }
  brackets: {}, // symbol -> { takeProfitPrice, stopPrice, trailPct, highestPrice }
  trades: [],
  equityCurve: [STARTING_BALANCE],
  autoTrading: false,
  manualOverride: false,
  killSwitch: false,
  dca: {}, // symbol -> { amount, intervalMs, enabled }
};

const dcaTimers = {};

let tickTimer = null;

// -------------------------------------------------------------- persistence
const PERSIST_KEY = 'demo_portfolio_v1';
function persist() {
  try {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ cash: state.cash, positions: state.positions, trades: state.trades.slice(-500) })
    );
  } catch {
    /* ignore */
  }
}
function restore() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (typeof saved.cash === 'number') state.cash = saved.cash;
    if (saved.positions) state.positions = saved.positions;
    if (Array.isArray(saved.trades)) state.trades = saved.trades;
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------- data seeding
function nextCandle(symbol, prevClose, openTime) {
  const base = BASE_PRICES[symbol];
  const drift = (base - prevClose) * 0.0004;
  const shock = gauss() * prevClose * 0.0012;
  const close = Math.max(0.01, prevClose + drift + shock);
  const open = prevClose;
  const high = Math.max(open, close) * (1 + rand() * 0.0008);
  const low = Math.min(open, close) * (1 - rand() * 0.0008);
  const volume = 10 + rand() * 300;
  return {
    openTime,
    closeTime: openTime + INTERVAL_MS['1m'] - 1,
    open,
    high,
    low,
    close,
    volume,
    quoteVolume: volume * close,
    trades: Math.floor(rand() * 500),
  };
}

function seedMarket() {
  restore();
  const end = Math.floor(Date.now() / 60000) * 60000;
  for (const symbol of SYMBOLS) {
    let price = BASE_PRICES[symbol] * (0.9 + rand() * 0.2);
    const arr = [];
    const start = end - (HISTORY_MINUTES - 1) * 60000;
    for (let i = 0; i < HISTORY_MINUTES; i++) {
      const c = nextCandle(symbol, price, start + i * 60000);
      arr.push(c);
      price = c.close;
    }
    state.candles[symbol] = arr;
    state.prices[symbol] = price;
    state.books[symbol] = makeBook(symbol, price);
  }
  state.seeded = true;
}

function advanceCandle(symbol, ts) {
  const minute = Math.floor(ts / 60000) * 60000;
  const arr = state.candles[symbol];
  let candle = arr[arr.length - 1];
  if (candle && candle.openTime === minute) {
    // update in-progress candle
    const prevClose = candle.close;
    const drift = (BASE_PRICES[symbol] - prevClose) * 0.0004;
    const shock = gauss() * prevClose * 0.0012;
    candle.close = Math.max(0.01, prevClose + drift + shock);
    candle.high = Math.max(candle.high, candle.close);
    candle.low = Math.min(candle.low, candle.close);
    candle.volume += 0.5 + rand() * 5;
    candle.quoteVolume = candle.volume * candle.close;
    candle.trades += Math.floor(rand() * 8);
  } else {
    const fresh = nextCandle(symbol, candle.close, minute);
    arr.push(fresh);
    if (arr.length > HISTORY_MINUTES) arr.shift();
    candle = fresh;
  }
  state.prices[symbol] = candle.close;
  return candle;
}

function makeBook(symbol, price) {
  const bids = [];
  const asks = [];
  const step = price * 0.0001;
  for (let i = 0; i < 20; i++) {
    bids.push([price - (i + 1) * step, 0.1 + rand() * 5]);
    asks.push([price + (i + 1) * step, 0.1 + rand() * 5]);
  }
  return { bids, asks };
}

// -------------------------------------------------------------- indicators
function emaLast(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}
function rsiLast(values, period = 14) {
  if (values.length <= period) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let ag = gain / period;
  let al = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}
function realizedVol(values, period = 20) {
  if (values.length < period + 1) return 0;
  const rets = [];
  for (let i = values.length - period; i < values.length; i++) rets.push(Math.log(values[i] / values[i - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v);
}

function computeSignal(symbol) {
  const closes = state.candles[symbol].map((c) => c.close).slice(-120);
  const n = closes.length;
  const price = closes[n - 1];
  const emaF = emaLast(closes, 9);
  const emaS = emaLast(closes, 21);
  const r = rsiLast(closes, 14);
  const mom = price / closes[n - 10] - 1;
  const vol = realizedVol(closes, 20);

  const votes = [];
  let rsiSignal = 'HOLD';
  let rsiConf = 0.2;
  if (r < 30) {
    rsiSignal = 'BUY';
    rsiConf = Math.min(0.9, 0.55 + (30 - r) / 40);
  } else if (r > 70) {
    rsiSignal = 'SELL';
    rsiConf = Math.min(0.9, 0.55 + (r - 70) / 40);
  }
  votes.push({ strategy: 'rsi-mean-reversion', signal: rsiSignal, confidence: +rsiConf.toFixed(3) });

  let trendSignal = 'HOLD';
  let trendConf = 0.2;
  if (emaF != null && emaS != null) {
    if (emaF > emaS && mom > 0) {
      trendSignal = 'BUY';
      trendConf = Math.min(0.85, 0.5 + Math.abs(mom) * 4);
    } else if (emaF < emaS && mom < 0) {
      trendSignal = 'SELL';
      trendConf = Math.min(0.85, 0.5 + Math.abs(mom) * 4);
    }
  }
  votes.push({ strategy: 'trend', signal: trendSignal, confidence: +trendConf.toFixed(3) });

  let momSignal = 'HOLD';
  let momConf = 0.2;
  if (mom > 0.004) {
    momSignal = 'BUY';
    momConf = Math.min(0.8, 0.5 + Math.abs(mom) * 30);
  } else if (mom < -0.004) {
    momSignal = 'SELL';
    momConf = Math.min(0.8, 0.5 + Math.abs(mom) * 30);
  }
  votes.push({ strategy: 'momentum', signal: momSignal, confidence: +momConf.toFixed(3) });

  const sc = { BUY: 1, SELL: -1, HOLD: 0 };
  let score = 0;
  let wsum = 0;
  for (const v of votes) {
    if (sc[v.signal] !== 0) {
      score += sc[v.signal] * v.confidence;
      wsum += v.confidence;
    }
  }
  const raw = wsum > 0 ? score / wsum : 0;
  let signal = 'HOLD';
  if (raw > 0.2) signal = 'BUY';
  else if (raw < -0.2) signal = 'SELL';
  const confidence = wsum > 0 ? Math.min(0.95, Math.abs(raw)) : 0;

  const ai = {
    signal: trendSignal,
    confidence: +trendConf.toFixed(3),
    model: 'demo-ensemble',
    predictedPrice: +(price * (1 + mom * 0.5)).toFixed(2),
  };

  return {
    signal,
    confidence: +confidence.toFixed(3),
    score: +raw.toFixed(3),
    votes,
    ai,
    volatility: +vol.toFixed(4),
  };
}

// ----------------------------------------------------------- portfolio core
function equity() {
  let v = state.cash;
  for (const [symbol, pos] of Object.entries(state.positions)) {
    v += pos.qty * (state.prices[symbol] || pos.avgPrice);
  }
  return v;
}

function buy(symbol, price, quantity, feeRate = 0.001) {
  const cost = price * quantity;
  const fee = cost * feeRate;
  if (cost + fee > state.cash) throw new Error('insufficient cash');
  state.cash -= cost + fee;
  const pos = state.positions[symbol] || { qty: 0, avgPrice: 0 };
  const newQty = pos.qty + quantity;
  const avgPrice = pos.qty === 0 ? price : (pos.avgPrice * pos.qty + price * quantity) / newQty;
  state.positions[symbol] = { qty: newQty, avgPrice };
  const trade = {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    side: 'BUY',
    symbol,
    price,
    quantity,
    fee,
    realizedPnl: null,
    equityAfter: equity(),
  };
  state.trades.push(trade);
  persist();
  return trade;
}

function sell(symbol, price, quantity, feeRate = 0.001) {
  const pos = state.positions[symbol];
  if (!pos || pos.qty < quantity) throw new Error('insufficient position');
  const proceeds = price * quantity;
  const fee = proceeds * feeRate;
  state.cash += proceeds - fee;
  const realizedPnl = (price - pos.avgPrice) * quantity - fee;
  const remaining = pos.qty - quantity;
  if (remaining <= 1e-12) delete state.positions[symbol];
  else state.positions[symbol] = { qty: remaining, avgPrice: pos.avgPrice };
  const trade = {
    id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    side: 'SELL',
    symbol,
    price,
    quantity,
    fee,
    realizedPnl,
    equityAfter: equity(),
  };
  state.trades.push(trade);
  persist();
  return trade;
}

function evaluateOrder({ symbol, value, isClosing }) {
  if (state.killSwitch && !isClosing) return { allowed: false, reason: 'kill switch active' };
  if (isClosing) return { allowed: true };
  if (value > equity() * 0.05) {
    return { allowed: false, reason: 'position exceeds max single-position size (5.0% of equity)' };
  }
  if (!state.positions[symbol] && Object.keys(state.positions).length >= 5) {
    return { allowed: false, reason: 'too many open positions (max 5)' };
  }
  return { allowed: true };
}

function openBracket(symbol, entryPrice) {
  state.brackets[symbol] = {
    takeProfitPrice: entryPrice * 1.02,
    stopPrice: entryPrice * 0.99,
    trailPct: 0.005,
    highestPrice: entryPrice,
  };
}

function checkBracket(symbol, price) {
  const pos = state.positions[symbol];
  const b = state.brackets[symbol];
  if (!pos || !b) return;
  b.highestPrice = Math.max(b.highestPrice, price);
  b.stopPrice = Math.max(b.stopPrice, b.highestPrice * (1 - b.trailPct));
  if (b.takeProfitPrice && price >= b.takeProfitPrice) {
    try {
      sell(symbol, price, pos.qty);
      delete state.brackets[symbol];
      demoSocket.emit('bracket', { symbol, trigger: 'TAKE_PROFIT', price });
    } catch {
      /* ignore */
    }
  } else if (price <= b.stopPrice) {
    try {
      sell(symbol, price, pos.qty);
      delete state.brackets[symbol];
      demoSocket.emit('bracket', { symbol, trigger: 'STOP_LOSS', price });
    } catch {
      /* ignore */
    }
  }
}

function autotrade(symbol, sig, price) {
  const pos = state.positions[symbol];
  if (sig.signal === 'BUY' && !pos) {
    const value = Math.min(equity() * 0.05, 500);
    const check = evaluateOrder({ symbol, value });
    if (!check.allowed) {
      demoSocket.emit('orderRejected', { symbol, reason: check.reason });
      return;
    }
    try {
      const trade = buy(symbol, price, value / price);
      openBracket(symbol, price);
      demoSocket.emit('trade', trade);
    } catch {
      /* ignore */
    }
  } else if (sig.signal === 'SELL' && pos) {
    try {
      const trade = sell(symbol, price, pos.qty);
      delete state.brackets[symbol];
      demoSocket.emit('trade', trade);
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------------- tick
function tick() {
  const ts = Date.now();
  for (const symbol of SYMBOLS) {
    const candle = advanceCandle(symbol, ts);
    const price = state.prices[symbol];

    demoSocket.emit('ticker', {
      type: 'ticker',
      eventTime: ts,
      symbol,
      lastPrice: price,
      priceChange: price - candle.open,
      priceChangePct: ((price - candle.open) / candle.open) * 100,
      openPrice: candle.open,
      highPrice: candle.high,
      lowPrice: candle.low,
      volume: candle.volume,
      quoteVolume: candle.quoteVolume,
      bidPrice: price * 0.9999,
      askPrice: price * 1.0001,
    });

    demoSocket.emit('kline', {
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
    });

    state.books[symbol] = makeBook(symbol, price);
    demoSocket.emit('depth', {
      type: 'depth',
      symbol,
      lastUpdateId: ts,
      bids: state.books[symbol].bids,
      asks: state.books[symbol].asks,
    });

    const sig = computeSignal(symbol);
    state.signals[symbol] = sig;
    demoSocket.emit('signal', { symbol, ...sig, ts });

    checkBracket(symbol, price);
    if (state.autoTrading && !state.killSwitch && !state.manualOverride) {
      autotrade(symbol, sig, price);
    }
  }
  state.equityCurve.push(equity());
}

// ------------------------------------------------------------- demo engine
export function startDemo() {
  if (tickTimer) return;
  if (!state.seeded) seedMarket();
  // Defer the first tick so the UI has a chance to attach its event handlers.
  setTimeout(tick, 0);
  tickTimer = setInterval(tick, 2000);
}

export function stopDemo() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

// -------------------------------------------------------------- demo API
function aggregateKlines(symbol, interval, limit) {
  const src = state.candles[symbol] || [];
  const step = INTERVAL_MS[interval] || 60000;
  const buckets = new Map();
  for (const c of src) {
    const bucket = Math.floor(c.openTime / step) * step;
    const b = buckets.get(bucket);
    if (!b) {
      buckets.set(bucket, {
        openTime: bucket,
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
  return rows.map((r) => ({
    openTime: r.openTime,
    open: +r.open.toFixed(6),
    high: +r.high.toFixed(6),
    low: +r.low.toFixed(6),
    close: +r.close.toFixed(6),
    volume: +r.volume.toFixed(4),
    closeTime: r.openTime + step - 1,
    quoteVolume: +r.quoteVolume.toFixed(2),
    trades: r.trades,
  }));
}

function portfolioSummary() {
  const eq = equity();
  return {
    equity: eq,
    cash: state.cash,
    startingBalance: STARTING_BALANCE,
    pnl: eq - STARTING_BALANCE,
    pnlPct: (eq - STARTING_BALANCE) / STARTING_BALANCE,
    positions: Object.entries(state.positions).map(([symbol, p]) => {
      const px = state.prices[symbol] || p.avgPrice;
      return {
        symbol,
        qty: p.qty,
        avgPrice: p.avgPrice,
        price: px,
        value: p.qty * px,
        unrealizedPnl: p.qty * (px - p.avgPrice),
      };
    }),
    openPositions: Object.keys(state.positions).length,
    tradeCount: state.trades.length,
    realizedPnl: state.trades.reduce((s, t) => s + (t.realizedPnl || 0), 0),
  };
}

function performance() {
  const closed = state.trades.filter((t) => t.realizedPnl != null);
  const wins = closed.filter((t) => (t.realizedPnl || 0) > 0).length;
  const winRate = closed.length ? wins / closed.length : 0;
  const eqs = state.equityCurve;
  let peak = -Infinity;
  let maxDD = 0;
  for (const e of eqs) {
    peak = Math.max(peak, e);
    if (peak > 0) maxDD = Math.max(maxDD, (peak - e) / peak);
  }
  const rets = [];
  for (let i = 1; i < eqs.length; i++) rets.push(eqs[i] / eqs[i - 1] - 1);
  const m = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)) : 0;
  const sharpe = sd > 0 ? (m / sd) * Math.sqrt(365) : 0;
  return {
    sharpeRatio: sharpe,
    winRate,
    maxDrawdown: maxDD,
    totalReturn: equity() / STARTING_BALANCE - 1,
    trades: closed.length,
    equity: equity(),
  };
}

function riskSnapshot() {
  return {
    killSwitch: {
      triggered: state.killSwitch,
      reason: state.killSwitch ? 'manual' : null,
      at: state.killSwitch ? new Date().toISOString() : null,
    },
    dailyLoss: {
      breached: false,
      lossPct: 0,
      lossAmount: 0,
      remainingBudget: 300,
      startEquity: STARTING_BALANCE,
      limitPct: 0.03,
    },
    peakEquity: STARTING_BALANCE,
    drawdownPct: 0,
    maxPositionPct: 0.05,
    maxPortfolioPct: 0.1,
    maxOpenPositions: 5,
  };
}

function placeOrder(body) {
  const { symbol, side, type = 'MARKET', quantity, price } = body || {};
  const sym = String(symbol || '').toUpperCase();
  const current = state.prices[sym] ?? price;
  if (!current) throw Object.assign(new Error('no price available for symbol'), { status: 400 });
  const value = Number(quantity) * current;
  const isClosing = String(side).toUpperCase() === 'SELL';
  const check = evaluateOrder({ symbol: sym, value, isClosing });
  if (!check.allowed) throw Object.assign(new Error(check.reason), { status: 403 });
  try {
    if (String(side).toUpperCase() === 'BUY') {
      const trade = buy(sym, current, Number(quantity));
      openBracket(sym, current);
      demoSocket.emit('trade', trade);
      return trade;
    }
    const trade = sell(sym, current, Number(quantity));
    demoSocket.emit('trade', trade);
    return trade;
  } catch (e) {
    throw Object.assign(new Error(e.message), { status: 400 });
  }
}

function killAll() {
  state.killSwitch = true;
  const results = [];
  for (const [symbol, pos] of Object.entries(state.positions)) {
    const px = state.prices[symbol] || pos.avgPrice;
    try {
      sell(symbol, px, pos.qty);
      delete state.brackets[symbol];
      results.push({ symbol, closed: true });
    } catch (e) {
      results.push({ symbol, closed: false, error: e.message });
    }
  }
  return { triggered: true, results };
}

function scheduleDca(body) {
  const { symbol, amount = 25, intervalMs = 3600000, enabled = true } = body || {};
  const sym = String(symbol || '').toUpperCase();
  if (!sym || !state.prices[sym]) throw new Error('unknown symbol');
  const cfg = { symbol: sym, amount: Number(amount), intervalMs: Number(intervalMs), enabled };
  state.dca[sym] = cfg;
  if (dcaTimers[sym]) clearInterval(dcaTimers[sym]);
  if (cfg.enabled) {
    dcaTimers[sym] = setInterval(() => {
      try {
        const px = state.prices[sym];
        const qty = cfg.amount / px;
        const check = evaluateOrder({ symbol: sym, value: cfg.amount });
        if (check.allowed) {
          buy(sym, px, qty);
          demoSocket.emit('trade', state.trades[state.trades.length - 1]);
        }
      } catch {
        /* ignore */
      }
    }, cfg.intervalMs);
  }
  return cfg;
}

/**
 * Answer the REST calls the UI makes. `path` looks like "/market/klines?…".
 */
export function demoApi(path, { method = 'GET', body } = {}) {
  const url = new URL(path, 'http://demo.local');
  const p = url.pathname.replace(/^\/api/, '') || '/';
  const q = Object.fromEntries(url.searchParams.entries());

  if (p === '/health') return { ok: true, demo: true, mode: 'paper', autoTrading: state.autoTrading };
  if (p === '/auth/login' || p === '/auth/register') {
    return { token: 'demo-token', user: { id: 'demo', email: (body && body.email) || 'demo@arena.ai', twoFactorEnabled: false } };
  }
  if (p === '/auth/me') {
    return { id: 'demo', email: 'demo@arena.ai', twoFactorEnabled: false, hasBinanceCredentials: false };
  }
  if (p === '/auth/binance') return { saved: true };

  if (p === '/market/klines') {
    const symbol = String(q.symbol || 'BTCUSDT').toUpperCase();
    const interval = INTERVAL_MS[q.interval] ? q.interval : '1m';
    const limit = Math.min(1000, Math.max(1, Number(q.limit) || 200));
    return { symbol, interval, klines: aggregateKlines(symbol, interval, limit), demo: true };
  }
  if (p === '/market/orderbook') {
    const symbol = String(q.symbol || 'BTCUSDT').toUpperCase();
    const book = state.books[symbol] || makeBook(symbol, state.prices[symbol] || 100);
    return { symbol, lastUpdateId: Date.now(), bids: book.bids, asks: book.asks };
  }
  if (p === '/market/tickers') return [];

  if (p === '/trading/portfolio') return portfolioSummary();
  if (p === '/trading/performance') return performance();
  if (p === '/trading/trades') return state.trades;
  if (p === '/trading/signal') {
    const symbol = String(q.symbol || 'BTCUSDT').toUpperCase();
    return state.signals[symbol] || computeSignal(symbol);
  }
  if (p === '/trading/order') return placeOrder(body);
  if (p === '/trading/autotrading') {
    if (method === 'POST' && body) {
      if (typeof body.enabled === 'boolean') state.autoTrading = body.enabled;
      if (typeof body.manualOverride === 'boolean') state.manualOverride = body.manualOverride;
    }
    return { enabled: state.autoTrading, manualOverride: state.manualOverride, mode: 'paper' };
  }
  if (p === '/trading/kill') return killAll();
  if (p === '/trading/kill/reset') {
    state.killSwitch = false;
    return { triggered: false, reason: null, at: null };
  }
  if (p === '/trading/dca') {
    if (method === 'POST') return scheduleDca(body);
    return Object.values(state.dca);
  }
  if (p === '/trading/risk') return riskSnapshot();

  return {};
}

export function demoCsv() {
  const header = 'id,ts,side,symbol,price,quantity,fee,realizedPnl';
  const rows = state.trades.map((t) =>
    [t.id, t.ts, t.side, t.symbol, t.price, t.quantity, t.fee, t.realizedPnl ?? ''].join(',')
  );
  return [header, ...rows].join('\n');
}

export function demoAutoTradingEnabled() {
  return state.autoTrading;
}

export default { startDemo, stopDemo, demoApi, demoSocket, demoCsv };
