/**
 * Position sizing — volatility-based and fixed-fractional risk sizing.
 *
 * Two complementary methods:
 *   1. Volatility targeting: scale the position so the portfolio exposure
 *      matches a target volatility (smaller positions in choppy markets).
 *   2. Fixed-fractional risk: risk a fixed % of equity per trade based on the
 *      distance to the stop-loss (standard "2% rule").
 *
 * All functions are pure and unit tested.
 */

/** Mean of an array (0 on empty input). */
export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n-1). */
export function stddev(values) {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

/** Log returns between consecutive closes. */
export function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

/**
 * Realised volatility (standard deviation of log returns) over the lookback.
 */
export function realizedVolatility(closes) {
  return stddev(logReturns(closes));
}

/**
 * Annualised volatility. `periodsPerYear` depends on the candle interval:
 * 1m -> 525600, 5m -> 105120, 15m -> 35040, 1h -> 8760, 4h -> 2190, 1d -> 365.
 */
export function annualizedVolatility(closes, periodsPerYear = 365) {
  return realizedVolatility(closes) * Math.sqrt(periodsPerYear);
}

/** True Range (Wilder). */
export function trueRange(high, low, prevClose) {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

/**
 * Average True Range over `period` candles.
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number} [period=14]
 */
export function atr(highs, lows, closes, period = 14) {
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < period + 1) return null;
  const trs = [];
  for (let i = 1; i < n; i++) {
    trs.push(trueRange(highs[i], lows[i], closes[i - 1]));
  }
  // Wilder smoothing: initial ATR is simple average of first `period` TRs.
  let atrValue = mean(trs.slice(0, period));
  for (let i = period; i < trs.length; i++) {
    atrValue = (atrValue * (period - 1) + trs[i]) / period;
  }
  return atrValue;
}

/**
 * Volatility-targeted position size.
 *
 * @param {number} equity total portfolio equity
 * @param {number} volatility realised volatility (per period)
 * @param {object} opts
 * @param {number} [opts.targetVol=0.01] target volatility per period
 * @param {number} [opts.maxPct=0.05] hard cap as a fraction of equity
 * @param {number} [opts.minPct=0] floor as a fraction of equity
 * @returns {{ size:number, fraction:number }} size in quote currency & fraction
 */
export function positionSizeByVolatility(equity, volatility, { targetVol = 0.01, maxPct = 0.05, minPct = 0 } = {}) {
  if (equity <= 0) return { size: 0, fraction: 0 };
  const safeVol = volatility > 0 ? volatility : targetVol;
  let fraction = targetVol / safeVol;
  fraction = Math.min(fraction, maxPct);
  fraction = Math.max(fraction, minPct);
  return { size: equity * fraction, fraction };
}

/**
 * Fixed-fractional risk sizing: risk `riskPct` of equity per trade, sized by
 * the distance from entry to stop.
 *
 * @param {number} equity
 * @param {number} entryPrice
 * @param {number} stopPrice
 * @param {object} opts
 * @param {number} [opts.riskPct=0.01] equity fraction to risk (e.g. 0.01 = 1%)
 * @param {number} [opts.maxPct=0.1] max equity fraction a position may use
 * @returns {{ quantity:number, riskAmount:number, fraction:number }}
 */
export function positionSizeByRisk(equity, entryPrice, stopPrice, { riskPct = 0.01, maxPct = 0.1 } = {}) {
  if (equity <= 0 || entryPrice <= 0) return { quantity: 0, riskAmount: 0, fraction: 0 };
  const riskAmount = equity * riskPct;
  const stopDistance = Math.abs(entryPrice - stopPrice);
  if (stopDistance <= 0) return { quantity: 0, riskAmount, fraction: 0 };
  const quantity = riskAmount / stopDistance;
  const fraction = (quantity * entryPrice) / equity;
  if (fraction > maxPct) {
    return { quantity: (equity * maxPct) / entryPrice, riskAmount, fraction: maxPct };
  }
  return { quantity, riskAmount, fraction };
}

export default {
  mean,
  stddev,
  logReturns,
  realizedVolatility,
  annualizedVolatility,
  trueRange,
  atr,
  positionSizeByVolatility,
  positionSizeByRisk,
};
