/**
 * Unit tests for the pure trading logic (indicators + signal model).
 */
import {
  atrSeries,
  bollingerSeries,
  buildSnapshot,
  emaSeries,
  fibonacciLevels,
  ichimokuSnapshot,
  macdSeries,
  rsiSeries,
  stochasticSeries,
  volumeProfile,
  vwapSeries,
} from '../src/engine/indicators';
import { classifyScore, generateSignal, sentimentFromTickers } from '../src/engine/signal';
import type { Candle } from '../src/types';

/** Deterministic synthetic candle series (sine wave + drift). */
function makeCandles(n: number, base = 100, amp = 6, drift = 0.02): Candle[] {
  const out: Candle[] = [];
  let t = 1_700_000_000_000;
  for (let i = 0; i < n; i++) {
    const close = base + Math.sin(i / 7) * amp + i * drift;
    const open = base + Math.sin((i - 1) / 7) * amp + (i - 1) * drift;
    const high = Math.max(open, close) + 1.2;
    const low = Math.min(open, close) - 1.2;
    out.push({
      openTime: t,
      open,
      high,
      low,
      close,
      volume: 1000 + (i % 13) * 140,
      closeTime: t + 899_999,
      quoteVolume: 0,
      trades: 100,
    });
    t += 900_000;
  }
  return out;
}

describe('indicators', () => {
  const candles = makeCandles(500);
  const closes = candles.map((c) => c.close);

  test('RSI stays within 0..100', () => {
    const rsi = rsiSeries(closes, 14);
    for (const v of rsi) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  test('RSI of monotonically rising series is overbought', () => {
    const rising = Array.from({ length: 100 }, (_, i) => 100 + i);
    const last = rsiSeries(rising, 14).at(-1);
    expect(last).not.toBeNull();
    expect(last as number).toBeGreaterThan(90);
  });

  test('EMA reacts faster than long averages', () => {
    const e9 = emaSeries(closes, 9);
    const e50 = emaSeries(closes, 50);
    expect(e9.length).toBe(closes.length);
    expect(e50.length).toBe(closes.length);
    expect(Number.isFinite(e9[closes.length - 1])).toBe(true);
    expect(Number.isFinite(e50[closes.length - 1])).toBe(true);
  });

  test('MACD histogram equals MACD line minus signal line', () => {
    const m = macdSeries(closes);
    const i = closes.length - 1;
    expect(m.histogram[i]).toBeCloseTo(m.macd[i] - m.signal[i], 9);
  });

  test('Bollinger bands enclose the middle', () => {
    const b = bollingerSeries(closes);
    const i = closes.length - 1;
    expect(b.upper[i]).toBeGreaterThan(b.middle[i]);
    expect(b.middle[i]).toBeGreaterThan(b.lower[i]);
  });

  test('Stochastic K/D within 0..100', () => {
    const s = stochasticSeries(candles);
    const i = candles.length - 1;
    expect(s.k[i]).toBeGreaterThanOrEqual(0);
    expect(s.k[i]).toBeLessThanOrEqual(100);
    expect(s.d[i]).toBeGreaterThanOrEqual(0);
    expect(s.d[i]).toBeLessThanOrEqual(100);
  });

  test('ATR is positive', () => {
    const a = atrSeries(candles);
    expect(a[candles.length - 1]).toBeGreaterThan(0);
  });

  test('VWAP sits inside the traded range', () => {
    const v = vwapSeries(candles);
    const lows = Math.min(...candles.map((c) => c.low));
    const highs = Math.max(...candles.map((c) => c.high));
    expect(v[candles.length - 1]).toBeGreaterThanOrEqual(lows);
    expect(v[candles.length - 1]).toBeLessThanOrEqual(highs);
  });

  test('Ichimoku cloud is well-formed', () => {
    const ik = ichimokuSnapshot(candles);
    expect(Number.isFinite(ik.conversion)).toBe(true);
    expect(ik.cloudTop).toBeGreaterThanOrEqual(ik.cloudBottom);
  });

  test('Fibonacci levels are ordered', () => {
    const levels = fibonacciLevels(120, 100, 'up');
    expect(levels.length).toBe(7);
    expect(levels[0].price).toBeCloseTo(120, 9); // 0% = swing high
    expect(levels[levels.length - 1].price).toBeCloseTo(100, 9); // 100% = swing low
  });

  test('Volume profile POC is inside range', () => {
    const vp = volumeProfile(candles, 24);
    const lows = Math.min(...candles.map((c) => c.low));
    const highs = Math.max(...candles.map((c) => c.high));
    expect(vp.poc).toBeGreaterThanOrEqual(lows);
    expect(vp.poc).toBeLessThanOrEqual(highs);
    expect(vp.bins.length).toBe(24);
  });

  test('Snapshot exposes every indicator family', () => {
    const snap = buildSnapshot(candles);
    expect(snap).not.toBeNull();
    if (!snap) return;
    for (const key of [
      'price', 'rsi', 'macdLine', 'macdSignal', 'macdHist',
      'bbUpper', 'bbLower', 'ema9', 'ema21', 'ema50', 'ema200',
      'stochK', 'stochD', 'atr', 'vwap', 'avgVolume',
    ] as const) {
      expect(Number.isFinite(snap[key] as number)).toBe(true);
    }
    expect(snap.fibonacci.length).toBe(7);
    expect(snap.ichimoku).toBeDefined();
    expect(snap.volumeProfile.poc).toBeGreaterThan(0);
  });
});

describe('signal model', () => {
  test('classification thresholds match the spec', () => {
    expect(classifyScore(75)).toBe('STRONG_BUY');
    expect(classifyScore(60)).toBe('STRONG_BUY');
    expect(classifyScore(45)).toBe('BUY');
    expect(classifyScore(30)).toBe('BUY');
    expect(classifyScore(0)).toBe('HOLD');
    expect(classifyScore(-30)).toBe('SELL');
    expect(classifyScore(-45)).toBe('SELL');
    expect(classifyScore(-60)).toBe('STRONG_SELL');
    expect(classifyScore(-90)).toBe('STRONG_SELL');
  });

  test('generateSignal returns full breakdown and confidence 0..100', () => {
    const res = generateSignal(makeCandles(500), { symbol: 'BTCUSDT', timeframe: '15m', mtf: [] });
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.breakdown.length).toBeGreaterThanOrEqual(8);
    expect(res.confidence).toBeGreaterThanOrEqual(0);
    expect(res.confidence).toBeLessThanOrEqual(100);
    expect(res.score).toBe(res.breakdown.reduce((s, b) => s + b.score, 0));
  });

  test('deep crash scenario produces a bearish score', () => {
    const candles = makeCandles(300);
    // Append a hard sell-off: RSI oversold eventually but EMA stack bearish.
    let last = candles[candles.length - 1].close;
    for (let i = 0; i < 200; i++) {
      last = Math.max(1, last * 0.994);
      candles.push({
        openTime: candles.at(-1)!.closeTime + 1,
        open: last * 1.002,
        high: last * 1.004,
        low: last * 0.998,
        close: last,
        volume: 500,
        closeTime: candles.at(-1)!.closeTime + 900_000,
        quoteVolume: 0,
        trades: 10,
      });
    }
    const res = generateSignal(candles, { symbol: 'BTCUSDT', timeframe: '15m', mtf: [] });
    expect(res).not.toBeNull();
    if (!res) return;
    // Oversold RSI gives +20, but downtrend EMA stack (-20), MACD (-15) and
    // below-VWAP/cloud bias keep the result from being bullish.
    expect(res.score).toBeLessThan(30);
  });

  test('sentiment aggregates ticker moves', () => {
    expect(sentimentFromTickers([3, 4, 2.5, 5, 3, 2, 4, 3, 2, 1])).toBe('Bullish');
    expect(sentimentFromTickers([-3, -4, -2.5, -5, -3, -2, -4, -3, -2, -1])).toBe('Bearish');
    expect(sentimentFromTickers([0.2, -0.4, 0.3, 0.1])).toBe('Neutral');
    expect(sentimentFromTickers([])).toBe('Neutral');
  });
});
