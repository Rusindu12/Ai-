/**
 * signal.ts — AI signal generation.
 *
 * Implements the composite scoring model:
 *
 *   RSI(14)              ±20   MACD(12,26,9)        ±15
 *   Bollinger(20,2σ)     ±15   EMA stack 9/21/50    ±20
 *   Volume confirmation  +10   Stochastic(14,3,3)   ±10
 *   Multi-timeframe confluence (1m/5m/15m/1h/4h)    ±15
 *   Ichimoku cloud bias  ±5    VWAP bias            ±5
 *
 *   score ≥  60 → STRONG_BUY     score ≥  30 → BUY
 *   score ≤ -60 → STRONG_SELL    score ≤ -30 → SELL
 *   otherwise   → HOLD
 */
import { buildSnapshot } from './indicators';
import { emaLast } from './indicators';
import type {
  Candle,
  IndicatorSnapshot,
  MtfInput,
  Sentiment,
  SignalBreakdownItem,
  SignalResult,
  SignalType,
} from '../types';

export function classifyScore(score: number): SignalType {
  if (score >= 60) return 'STRONG_BUY';
  if (score >= 30) return 'BUY';
  if (score <= -60) return 'STRONG_SELL';
  if (score <= -30) return 'SELL';
  return 'HOLD';
}

/** Cheap per-timeframe trend used by the multi-timeframe confluence check. */
function timeframeTrend(candles: Candle[]): number {
  if (candles.length < 30) return 0;
  const closes = candles.map((c) => c.close);
  const e9 = emaLast(closes, 9);
  const e21 = emaLast(closes, 21);
  if (!isFinite(e9) || !isFinite(e21)) return 0;
  if (e9 > e21) return 1;
  if (e9 < e21) return -1;
  return 0;
}

/**
 * Multi-timeframe confluence: each secondary timeframe whose short-term
 * trend aligns adds ±5, capped at ±15.
 */
export function multiTimeframeConfluence(mtf: MtfInput[]): { score: number; detail: string } {
  let score = 0;
  const parts: string[] = [];
  for (const tf of mtf) {
    const t = timeframeTrend(tf.candles);
    const contribution = Math.max(-5, Math.min(5, t * 5));
    score += contribution;
    parts.push(`${tf.timeframe}:${t > 0 ? '▲' : t < 0 ? '▼' : '•'}`);
  }
  score = Math.max(-15, Math.min(15, score));
  return { score, detail: parts.join(' ') || 'no MTF data' };
}

export interface ScoreOptions {
  symbol: string;
  timeframe: string;
  mtf?: MtfInput[];
}

/** Core scoring function — mirrors the reference implementation 1:1. */
export function generateSignal(candles: Candle[], opts: ScoreOptions): SignalResult | null {
  const snapshot: IndicatorSnapshot | null = buildSnapshot(candles);
  if (!snapshot) return null;

  const breakdown: SignalBreakdownItem[] = [];
  let score = 0;
  const s = snapshot;

  // --- RSI Analysis -------------------------------------------------------
  if (s.rsi < 30) {
    score += 20;
    breakdown.push({ name: 'RSI (14)', score: 20, detail: `${s.rsi.toFixed(1)} — oversold, buy pressure` });
  } else if (s.rsi > 70) {
    score -= 20;
    breakdown.push({ name: 'RSI (14)', score: -20, detail: `${s.rsi.toFixed(1)} — overbought, sell pressure` });
  } else {
    breakdown.push({ name: 'RSI (14)', score: 0, detail: `${s.rsi.toFixed(1)} — neutral zone` });
  }

  // --- MACD Analysis ------------------------------------------------------
  if (s.macdLine > s.macdSignal && s.macdHist > 0) {
    score += 15;
    breakdown.push({ name: 'MACD (12,26,9)', score: 15, detail: 'bullish crossover, histogram positive' });
  } else if (s.macdLine < s.macdSignal && s.macdHist < 0) {
    score -= 15;
    breakdown.push({ name: 'MACD (12,26,9)', score: -15, detail: 'bearish crossover, histogram negative' });
  } else {
    breakdown.push({ name: 'MACD (12,26,9)', score: 0, detail: 'no confirmed crossover' });
  }

  // --- Bollinger Bands ----------------------------------------------------
  if (s.price <= s.bbLower) {
    score += 15;
    breakdown.push({ name: 'Bollinger (20,2σ)', score: 15, detail: 'price at lower band — near support' });
  } else if (s.price >= s.bbUpper) {
    score -= 15;
    breakdown.push({ name: 'Bollinger (20,2σ)', score: -15, detail: 'price at upper band — near resistance' });
  } else {
    breakdown.push({
      name: 'Bollinger (20,2σ)',
      score: 0,
      detail: `%B ${(s.bbPercentB * 100).toFixed(0)}% — inside bands`,
    });
  }

  // --- EMA trend stack ----------------------------------------------------
  if (s.ema9 > s.ema21 && s.ema21 > s.ema50) {
    score += 20;
    breakdown.push({ name: 'EMA stack (9/21/50)', score: 20, detail: 'strong uptrend alignment' });
  } else if (s.ema9 < s.ema21 && s.ema21 < s.ema50) {
    score -= 20;
    breakdown.push({ name: 'EMA stack (9/21/50)', score: -20, detail: 'strong downtrend alignment' });
  } else {
    breakdown.push({ name: 'EMA stack (9/21/50)', score: 0, detail: 'mixed trend structure' });
  }

  // --- Volume confirmation ------------------------------------------------
  if (s.volumeRatio > 1.5) {
    score += 10;
    breakdown.push({
      name: 'Volume',
      score: 10,
      detail: `${s.volumeRatio.toFixed(2)}× average — high-volume confirmation`,
    });
  } else {
    breakdown.push({ name: 'Volume', score: 0, detail: `${s.volumeRatio.toFixed(2)}× average — normal` });
  }

  // --- Stochastic -----------------------------------------------------------
  if (s.stochK < 20 && s.stochK > s.stochD) {
    score += 10;
    breakdown.push({ name: 'Stochastic (14,3,3)', score: 10, detail: `K ${s.stochK.toFixed(1)} turning up from oversold` });
  } else if (s.stochK > 80 && s.stochK < s.stochD) {
    score -= 10;
    breakdown.push({ name: 'Stochastic (14,3,3)', score: -10, detail: `K ${s.stochK.toFixed(1)} turning down from overbought` });
  } else {
    breakdown.push({ name: 'Stochastic (14,3,3)', score: 0, detail: `K ${s.stochK.toFixed(1)} / D ${s.stochD.toFixed(1)}` });
  }

  // --- Multi-timeframe confluence -----------------------------------------
  const mtfResult = multiTimeframeConfluence(opts.mtf ?? []);
  if (mtfResult.score !== 0) score += mtfResult.score;
  breakdown.push({
    name: 'Multi-timeframe',
    score: mtfResult.score,
    detail: mtfResult.detail,
  });

  // --- Ichimoku cloud bias (extension) -------------------------------------
  if (isFinite(s.ichimoku.cloudTop)) {
    if (s.ichimoku.priceAboveCloud) {
      score += 5;
      breakdown.push({ name: 'Ichimoku cloud', score: 5, detail: 'price above the cloud (bullish)' });
    } else if (s.price < s.ichimoku.cloudBottom) {
      score -= 5;
      breakdown.push({ name: 'Ichimoku cloud', score: -5, detail: 'price below the cloud (bearish)' });
    } else {
      breakdown.push({ name: 'Ichimoku cloud', score: 0, detail: 'price inside the cloud' });
    }
  } else {
    breakdown.push({ name: 'Ichimoku cloud', score: 0, detail: 'insufficient history' });
  }

  // --- VWAP bias (extension) -----------------------------------------------
  if (isFinite(s.vwap)) {
    if (s.price > s.vwap) {
      score += 5;
      breakdown.push({ name: 'VWAP', score: 5, detail: 'trading above volume-weighted average' });
    } else if (s.price < s.vwap) {
      score -= 5;
      breakdown.push({ name: 'VWAP', score: -5, detail: 'trading below volume-weighted average' });
    } else {
      breakdown.push({ name: 'VWAP', score: 0, detail: 'at VWAP' });
    }
  } else {
    breakdown.push({ name: 'VWAP', score: 0, detail: 'n/a' });
  }

  return {
    signal: classifyScore(score),
    score,
    confidence: Math.max(0, Math.min(100, Math.abs(score))),
    breakdown,
    snapshot,
    symbol: opts.symbol,
    timeframe: opts.timeframe,
    ts: Date.now(),
  };
}

/** Aggregate several asset scores into a market sentiment label. */
export function sentimentFromScores(scores: number[]): Sentiment {
  if (scores.length === 0) return 'Neutral';
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 12) return 'Bullish';
  if (avg <= -12) return 'Bearish';
  return 'Neutral';
}

/** Lightweight sentiment from 24h ticker moves (used for the dashboard). */
export function sentimentFromTickers(changes: number[]): Sentiment {
  if (changes.length === 0) return 'Neutral';
  const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
  const upRatio = changes.filter((c) => c > 0).length / changes.length;
  if (avg > 1.25 && upRatio >= 0.6) return 'Bullish';
  if (avg < -1.25 && upRatio <= 0.4) return 'Bearish';
  return 'Neutral';
}
