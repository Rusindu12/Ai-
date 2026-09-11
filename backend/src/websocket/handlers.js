/**
 * Message normalisation for Binance WebSocket payloads.
 *
 * Binance streams return verbose, stringly-typed payloads. These pure functions
 * reduce them to compact objects the rest of the platform (cache, Socket.io
 * broadcast, AI service, strategies) can consume. They are pure & unit tested.
 */

export const KLINE_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

/**
 * Normalise a kline message. Combined-stream messages arrive wrapped as
 * `{ stream, data }`, single-stream messages are the raw kline object.
 */
export function normalizeKline(message) {
  const raw = message?.data ?? message;
  if (!raw || raw.e !== 'kline') return null;
  const k = raw.k;
  return {
    type: 'kline',
    eventTime: raw.E,
    symbol: raw.s,
    interval: k.i,
    startTime: k.t,
    closeTime: k.T,
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: parseFloat(k.v),
    quoteVolume: parseFloat(k.q),
    trades: k.n,
    isClosed: Boolean(k.x),
  };
}

/** Normalise a 24hr rolling ticker message. */
export function normalizeTicker(message) {
  const raw = message?.data ?? message;
  if (!raw || raw.e !== '24hrTicker') return null;
  return {
    type: 'ticker',
    eventTime: raw.E,
    symbol: raw.s,
    priceChange: parseFloat(raw.p),
    priceChangePct: parseFloat(raw.P),
    weightedAvgPrice: parseFloat(raw.w),
    lastPrice: parseFloat(raw.c),
    lastQty: parseFloat(raw.Q),
    bidPrice: parseFloat(raw.b),
    bidQty: parseFloat(raw.B),
    askPrice: parseFloat(raw.a),
    askQty: parseFloat(raw.A),
    openPrice: parseFloat(raw.o),
    highPrice: parseFloat(raw.h),
    lowPrice: parseFloat(raw.l),
    volume: parseFloat(raw.v),
    quoteVolume: parseFloat(raw.q),
    openTime: raw.O,
    closeTime: raw.C,
    count: raw.n,
  };
}

/**
 * Normalise a partial depth message. The depth stream has no symbol field, so
 * the caller passes the symbol (derived from the stream name).
 */
export function normalizeDepth(message, symbol) {
  const raw = message?.data ?? message;
  if (!raw || !Array.isArray(raw.bids)) return null;
  const parse = (arr) => arr.slice(0, 20).map(([price, qty]) => [parseFloat(price), parseFloat(qty)]);
  return {
    type: 'depth',
    lastUpdateId: raw.lastUpdateId,
    symbol,
    bids: parse(raw.bids),
    asks: parse(raw.asks),
  };
}

/**
 * Normalise user-data stream messages (outboundAccountPosition,
 * executionReport, balanceUpdate, listenKeyExpired).
 */
export function normalizeUserData(message) {
  if (!message) return null;
  if (message.e === 'executionReport') return normalizeExecutionReport(message);
  if (message.e === 'outboundAccountPosition') return normalizeAccountPosition(message);
  if (message.e === 'balanceUpdate') return normalizeBalanceUpdate(message);
  if (message.e === 'listenKeyExpired') return { type: 'listenKeyExpired', eventTime: message.E };
  return null;
}

export function normalizeExecutionReport(raw) {
  return {
    type: 'executionReport',
    eventTime: raw.E,
    symbol: raw.s,
    clientOrderId: raw.c,
    side: raw.S,
    orderType: raw.o,
    timeInForce: raw.f,
    quantity: parseFloat(raw.q),
    price: parseFloat(raw.p),
    stopPrice: parseFloat(raw.P ?? 0) || 0,
    status: raw.X, // NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED
    orderId: raw.i,
    lastFilledQty: parseFloat(raw.l),
    cumulativeFilledQty: parseFloat(raw.z),
    lastFilledPrice: parseFloat(raw.L),
    commission: parseFloat(raw.n ?? 0) || 0,
    commissionAsset: raw.N,
    tradeTime: raw.T,
    tradeId: raw.t,
    isWorking: Boolean(raw.w),
    isBuyerMaker: Boolean(raw.m),
    creationTime: raw.O,
    cumulativeQuoteQty: parseFloat(raw.Z),
    orderRejectReason: raw.r,
  };
}

export function normalizeAccountPosition(raw) {
  return {
    type: 'accountPosition',
    eventTime: raw.E,
    lastAccountUpdate: raw.u,
    balances: (raw.B || []).map((b) => ({
      asset: b.a,
      free: parseFloat(b.f),
      locked: parseFloat(b.l),
    })),
  };
}

export function normalizeBalanceUpdate(raw) {
  return {
    type: 'balanceUpdate',
    eventTime: raw.E,
    asset: raw.a,
    delta: parseFloat(raw.d),
    clearTime: raw.T,
  };
}

/**
 * Parse a raw stream name into its parts, e.g.
 *   'btcusdt@kline_1m'  -> { symbol: 'BTCUSDT', type: 'kline', interval: '1m' }
 *   'btcusdt@depth20@100ms' -> { symbol: 'BTCUSDT', type: 'depth', levels: 20, speed: '100ms' }
 *   'btcusdt@ticker'     -> { symbol: 'BTCUSDT', type: 'ticker' }
 */
export function parseStreamName(name) {
  if (!name) return null;
  const [symbol, ...rest] = name.toLowerCase().split('@');
  const spec = rest.join('@');
  if (spec.startsWith('kline_')) {
    return { symbol: symbol.toUpperCase(), type: 'kline', interval: spec.slice('kline_'.length) };
  }
  if (spec.startsWith('depth')) {
    const m = spec.match(/^depth(\d+)(?:@(\d+ms))?$/);
    return { symbol: symbol.toUpperCase(), type: 'depth', levels: Number(m?.[1] ?? 20), speed: m?.[2] ?? null };
  }
  if (spec === 'ticker') return { symbol: symbol.toUpperCase(), type: 'ticker' };
  if (spec === 'miniTicker') return { symbol: symbol.toUpperCase(), type: 'miniTicker' };
  if (spec === 'bookTicker') return { symbol: symbol.toUpperCase(), type: 'bookTicker' };
  return { symbol: symbol.toUpperCase(), type: spec };
}

export default {
  normalizeKline,
  normalizeTicker,
  normalizeDepth,
  normalizeUserData,
  parseStreamName,
  KLINE_INTERVALS,
};
