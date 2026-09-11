import { BaseStrategy } from './base.js';
import { rsi } from './indicators.js';

/**
 * RSI mean-reversion strategy.
 *   - BUY  when RSI crosses up out of oversold (< 30)
 *   - SELL when RSI crosses down out of overbought (> 70)
 * Confidence scales with how extreme the RSI reading is.
 */
export class RsiMeanReversionStrategy extends BaseStrategy {
  constructor({ period = 14, oversold = 30, overbought = 70 } = {}) {
    super('rsi-mean-reversion');
    this.period = period;
    this.oversold = oversold;
    this.overbought = overbought;
  }

  evaluate(context) {
    const closes = context?.closes ?? context?.candles?.map((c) => c.close);
    if (!closes || closes.length < this.period + 2) {
      return { signal: 'HOLD', confidence: 0, reason: `${this.name}: insufficient data` };
    }
    const series = rsi(closes, this.period);
    const pair = BaseStrategy.lastTwo(series);
    if (!pair) return { signal: 'HOLD', confidence: 0, reason: `${this.name}: no RSI data` };

    const { prev, last } = pair;

    if (prev <= this.oversold && last > this.oversold) {
      const confidence = Math.min(0.95, 0.5 + (this.oversold - prev) / 30);
      return { signal: 'BUY', confidence, reason: `RSI crossed above ${this.oversold} (oversold reversal)` };
    }
    if (prev >= this.overbought && last < this.overbought) {
      const confidence = Math.min(0.95, 0.5 + (prev - this.overbought) / 30);
      return { signal: 'SELL', confidence, reason: `RSI crossed below ${this.overbought} (overbought reversal)` };
    }
    return { signal: 'HOLD', confidence: 0.2, reason: `RSI ${last.toFixed(1)} within neutral range` };
  }
}

export default RsiMeanReversionStrategy;
