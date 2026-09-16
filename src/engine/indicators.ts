/**
 * indicators.ts — real-time technical analysis library (pure TypeScript).
 *
 * Implements every indicator required by the AI engine:
 *   RSI(14) · MACD(12,26,9) · Bollinger(20, 2σ) · EMA(9/21/50/200)
 *   Stochastic(14,3,3) · ATR(14) · VWAP · Ichimoku(9/26/52/26)
 *   Volume Profile (POC + HVN) · Fibonacci retracement levels
 */
import type {
  Candle,
  FibonacciLevel,
  IchimokuSnapshot,
  IndicatorSnapshot,
  VolumeProfileResult,
} from '../types';

/* --------------------------------- moving averages ------------------------ */

export function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function emaSeries(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function emaLast(values: number[], period: number): number {
  const s = emaSeries(values, period);
  return s[s.length - 1];
}

/* ------------------------------------ RSI --------------------------------- */

export function rsiSeries(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/* ----------------------------------- MACD --------------------------------- */

export interface MacdSeries {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macdSeries(closes: number[], fast = 12, slow = 26, signalP = 9): MacdSeries {
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  // Signal line: EMA of the valid MACD region
  const validFrom = slow - 1;
  const validMacd = macdLine.slice(validFrom);
  const signalValid = emaSeries(validMacd, signalP);
  const signal: number[] = new Array(closes.length).fill(NaN);
  for (let i = 0; i < validMacd.length; i++) signal[validFrom + i] = signalValid[i];
  const histogram = macdLine.map((v, i) => v - signal[i]);
  return { macd: macdLine, signal, histogram };
}

/* ------------------------------- Bollinger Bands -------------------------- */

export interface BollingerSeries {
  upper: number[];
  middle: number[];
  lower: number[];
}

export function bollingerSeries(closes: number[], period = 20, mult = 2): BollingerSeries {
  const n = closes.length;
  const upper = new Array<number>(n).fill(NaN);
  const middle = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) varSum += (closes[j] - mean) ** 2;
    const sd = Math.sqrt(varSum / period);
    middle[i] = mean;
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, middle, lower };
}

/* ------------------------------- Stochastic -------------------------------- */

export interface StochSeries {
  k: number[];
  d: number[];
}

export function stochasticSeries(
  candles: Candle[],
  kPeriod = 14,
  kSmooth = 3,
  dPeriod = 3,
): StochSeries {
  const n = candles.length;
  const rawK = new Array<number>(n).fill(NaN);
  for (let i = kPeriod - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, candles[j].high);
      ll = Math.min(ll, candles[j].low);
    }
    rawK[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
  }
  const smooth = (src: number[], p: number): number[] => {
    const out = new Array<number>(src.length).fill(NaN);
    for (let i = 0; i < src.length; i++) {
      if (i < p - 1) continue;
      let sum = 0;
      let ok = true;
      for (let j = i - p + 1; j <= i; j++) {
        if (isNaN(src[j])) {
          ok = false;
          break;
        }
        sum += src[j];
      }
      if (ok) out[i] = sum / p;
    }
    return out;
  };
  const k = smooth(rawK, kSmooth);
  const d = smooth(k, dPeriod);
  return { k, d };
}

/* ------------------------------------ ATR ---------------------------------- */

export function trueRanges(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  });
}

export function atrSeries(candles: Candle[], period = 14): number[] {
  const tr = trueRanges(candles);
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length <= period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  out[period - 1] = seed / period;
  for (let i = period; i < candles.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

/* ------------------------------------ VWAP --------------------------------- */

export function vwapSeries(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  let cumPv = 0;
  let cumVol = 0;
  for (let i = 0; i < candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumPv += tp * candles[i].volume;
    cumVol += candles[i].volume;
    out[i] = cumVol > 0 ? cumPv / cumVol : tp;
  }
  return out;
}

/* ---------------------------------- Ichimoku ------------------------------- */

function midOfHighLow(candles: Candle[], idx: number, period: number): number {
  let hh = -Infinity;
  let ll = Infinity;
  const from = idx - period + 1;
  if (from < 0) return NaN;
  for (let j = from; j <= idx; j++) {
    hh = Math.max(hh, candles[j].high);
    ll = Math.min(ll, candles[j].low);
  }
  return (hh + ll) / 2;
}

export function ichimokuSnapshot(
  candles: Candle[],
  conversion = 9,
  base = 26,
  spanB = 52,
  displacement = 26,
): IchimokuSnapshot {
  const n = candles.length;
  const i = n - 1;
  const conv = midOfHighLow(candles, i, conversion);
  const baseLine = midOfHighLow(candles, i, base);
  // The cloud plotted "now" was generated `displacement` bars ago.
  const ci = i - displacement;
  const spanA = ci >= base - 1
    ? (midOfHighLow(candles, ci, conversion) + midOfHighLow(candles, ci, base)) / 2
    : NaN;
  const spanBv = ci >= 0 ? midOfHighLow(candles, ci, spanB) : NaN;
  const cloudTop = Math.max(spanA, spanBv);
  const cloudBottom = Math.min(spanA, spanBv);
  const price = candles[i].close;
  return {
    conversion: conv,
    baseLine,
    spanA,
    spanB: spanBv,
    cloudTop,
    cloudBottom,
    priceAboveCloud: price > cloudTop,
    priceInCloud: price >= cloudBottom && price <= cloudTop,
  };
}

/* -------------------------------- Fibonacci -------------------------------- */

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/**
 * Fibonacci retracement of the recent swing. Direction 'up' retraces a
 * rally from `low` to `high`; 'down' retraces a decline.
 */
export function fibonacciLevels(
  high: number,
  low: number,
  direction: 'up' | 'down',
): FibonacciLevel[] {
  return FIB_RATIOS.map((r) => ({
    ratio: r,
    price: direction === 'up' ? high - (high - low) * r : low + (high - low) * r,
  }));
}

export function swingHighLow(candles: Candle[], lookback = 120): { high: number; low: number } {
  const slice = candles.slice(-lookback);
  let high = -Infinity;
  let low = Infinity;
  for (const c of slice) {
    high = Math.max(high, c.high);
    low = Math.min(low, c.low);
  }
  return { high, low };
}

/* ------------------------------- Volume profile ---------------------------- */

export function volumeProfile(candles: Candle[], binCount = 24): VolumeProfileResult {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    lo = Math.min(lo, c.low);
    hi = Math.max(hi, c.high);
  }
  const range = hi - lo || 1;
  const binSize = range / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    low: lo + i * binSize,
    high: lo + (i + 1) * binSize,
    volume: 0,
  }));
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    let idx = Math.floor((tp - lo) / binSize);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].volume += c.volume;
  }
  const sortedIdx = bins
    .map((b, i) => ({ i, v: b.volume }))
    .sort((a, b) => b.v - a.v);
  const pocIdx = sortedIdx[0]?.i ?? 0;
  const hvn = sortedIdx.slice(0, 3).map((s) => (bins[s.i].low + bins[s.i].high) / 2);
  return {
    binCount,
    binSize,
    poc: (bins[pocIdx].low + bins[pocIdx].high) / 2,
    hvn,
    bins,
  };
}

/* -------------------------------- Snapshot --------------------------------- */

export function avgVolume(candles: Candle[], period = 20): number {
  const slice = candles.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
}

/** Compute the full indicator snapshot from a candle series (needs ≥ 60 bars). */
export function buildSnapshot(candles: Candle[]): IndicatorSnapshot | null {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const i = candles.length - 1;

  const rsi = rsiSeries(closes, 14)[i] ?? 50;
  const macd = macdSeries(closes, 12, 26, 9);
  const bb = bollingerSeries(closes, 20, 2);
  const ema9 = emaLast(closes, 9);
  const ema21 = emaLast(closes, 21);
  const ema50 = emaLast(closes, 50);
  const ema200 = emaLast(closes, 200);
  const stoch = stochasticSeries(candles, 14, 3, 3);
  const atr = atrSeries(candles, 14)[i];
  const vwap = vwapSeries(candles)[i];
  const price = candles[i].close;

  const bbUpper = bb.upper[i];
  const bbLower = bb.lower[i];
  const bbMiddle = bb.middle[i];
  const bbPercentB =
    isFinite(bbUpper) && isFinite(bbLower) && bbUpper !== bbLower
      ? (price - bbLower) / (bbUpper - bbLower)
      : 0.5;

  const swing = swingHighLow(candles, 120);
  const upSwing = price >= (swing.high + swing.low) / 2;
  const fib = fibonacciLevels(swing.high, swing.low, upSwing ? 'up' : 'down');

  const av = avgVolume(candles, 20);
  const lastVolume = candles[i].volume;

  return {
    price,
    rsi,
    macdLine: macd.macd[i],
    macdSignal: macd.signal[i],
    macdHist: macd.histogram[i],
    bbUpper,
    bbMiddle,
    bbLower,
    bbPercentB,
    ema9,
    ema21,
    ema50,
    ema200: isFinite(ema200) ? ema200 : ema50,
    stochK: stoch.k[i],
    stochD: stoch.d[i],
    atr: isFinite(atr) ? atr : price * 0.005,
    atrPct: isFinite(atr) ? (atr / price) * 100 : 0.5,
    vwap,
    avgVolume: av,
    lastVolume,
    volumeRatio: av > 0 ? lastVolume / av : 1,
    ichimoku: ichimokuSnapshot(candles),
    fibonacci: fib,
    volumeProfile: volumeProfile(candles, 24),
    ts: candles[i].closeTime || Date.now(),
  };
}
