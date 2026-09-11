import { BaseStrategy } from './base.js';
import { macd } from './indicators.js';

/**
 * MACD crossover strategy.
 *   - BUY  when the MACD line crosses above the signal line
 *   - SELL when it crosses below
 * Confidence scales with the size of the histogram relative to recent price.
 */
export class MacdCrossoverStrategy extends BaseStrategy {
  constructor({ fast = 12, slow = 26, signalPeriod = 9 } = {}) {
    super('macd-crossover');
    this.fast = fast;
    this.slow = slow;
    this.signalPeriod = signalPeriod;
  }

  evaluate(context) {
    const closes = context?.closes ?? context?.candles?.map((c) => c.close);
    if (!closes || closes.length < this.slow + this.signalPeriod + 2) {
      return { signal: 'HOLD', confidence: 0, reason: `${this.name}: insufficient data` };
    }
    const { macd: macdLine, signal } = macd(closes, this.fast, this.slow, this.signalPeriod);

    // find last two bars where both lines are defined
    const idx = [];
    for (let i = macdLine.length - 1; i >= 0 && idx.length < 2; i--) {
      if (macdLine[i] != null && signal[i] != null) idx.push(i);
    }
    if (idx.length < 2) return { signal: 'HOLD', confidence: 0, reason: `${this.name}: no MACD data` };

    const [iLast, iPrev] = idx;
    const prevDiff = macdLine[iPrev] - signal[iPrev];
    const lastDiff = macdLine[iLast] - signal[iLast];
    const price = closes[iLast] || 1;

    if (prevDiff <= 0 && lastDiff > 0) {
      const confidence = Math.min(0.9, 0.55 + Math.abs(lastDiff) / Math.abs(price) * 100);
      return { signal: 'BUY', confidence, reason: 'MACD crossed above signal line' };
    }
    if (prevDiff >= 0 && lastDiff < 0) {
      const confidence = Math.min(0.9, 0.55 + Math.abs(lastDiff) / Math.abs(price) * 100);
      return { signal: 'SELL', confidence, reason: 'MACD crossed below signal line' };
    }
    return { signal: 'HOLD', confidence: 0.2, reason: 'MACD histogram unchanged' };
  }
}

export default MacdCrossoverStrategy;
