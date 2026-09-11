/**
 * Technical indicators — pure functions, fully unit tested.
 *
 * Inputs are arrays of numbers (typically closes, or OHLC). Output arrays align
 * in length with the input; leading positions where the indicator is undefined
 * are `null` so the index maps 1:1 to the source series.
 */
import { mean, stddev } from '../risk/positionSizing.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);

/** Simple Moving Average. */
export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i];
    if (i >= period) windowSum -= values[i - period];
    if (i >= period - 1) out[i] = windowSum / period;
  }
  return out;
}

/** Exponential Moving Average (seeded with SMA of first `period` values). */
export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  out[period - 1] = mean(values.slice(0, period));
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** Relative Strength Index (Wilder smoothing). */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * MACD — returns { macd, signal, histogram } arrays.
 * MACD = EMA(12) - EMA(26); signal = EMA(macd, 9).
 */
export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const firstValid = macdLine.findIndex((v) => v != null);
  const trimmed = macdLine.slice(firstValid);
  const signalTrimmed = ema(trimmed, signalPeriod);
  const signal = new Array(values.length).fill(null);
  for (let i = 0; i < signalTrimmed.length; i++) signal[i + firstValid] = signalTrimmed[i];
  const histogram = macdLine.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { macd: macdLine, signal, histogram };
}

/**
 * Bollinger Bands — returns { upper, middle, lower } (middle = SMA, bands at
 * ±`mult` standard deviations).
 */
export function bollingerBands(values, period = 20, mult = 2) {
  const middle = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const windowSlice = values.slice(i - period + 1, i + 1);
    const sd = stddev(windowSlice);
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
  }
  return { upper, middle, lower };
}

/**
 * Volume-Weighted Average Price. Assumes equal spacing (candle VWAP).
 * @param {number[]} closes
 * @param {number[]} volumes
 */
export function vwap(closes, volumes) {
  const n = Math.min(closes.length, volumes.length);
  const out = new Array(closes.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < n; i++) {
    cumPV += closes[i] * volumes[i];
    cumV += volumes[i];
    out[i] = cumV > 0 ? cumPV / cumV : null;
  }
  return out;
}

/**
 * Order-book imbalance: (bidVol - askVol) / (bidVol + askVol) in [-1, 1].
 * Positive => more bid pressure (bullish). Levels are [price, qty] pairs.
 */
export function orderBookImbalance(bids, asks, depth = 20) {
  const bidVol = sum(bids.slice(0, depth).map(([, q]) => q));
  const askVol = sum(asks.slice(0, depth).map(([, q]) => q));
  const total = bidVol + askVol;
  if (total === 0) return 0;
  return (bidVol - askVol) / total;
}

/**
 * Price momentum: percentage change over `period` bars.
 */
export function momentum(values, period = 10) {
  const out = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    const prev = values[i - period];
    out[i] = prev !== 0 ? (values[i] - prev) / prev : null;
  }
  return out;
}

/**
 * Trend detection via EMA slope + price position:
 * returns the last available trend score in [-1, 1].
 */
export function trendScore(values, period = 20) {
  const e = ema(values, period);
  const valid = e.map((v, i) => ({ v, i })).filter((x) => x.v != null);
  if (valid.length < 2) return 0;
  const last = valid[valid.length - 1];
  const prev = valid[valid.length - 2];
  const slope = (last.v - prev.v) / Math.abs(prev.v || 1);
  return Math.max(-1, Math.min(1, slope * 100));
}

export default {
  sma,
  ema,
  rsi,
  macd,
  bollingerBands,
  vwap,
  orderBookImbalance,
  momentum,
  trendScore,
};
