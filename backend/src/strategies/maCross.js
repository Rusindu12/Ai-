import { BaseStrategy } from './base.js';
import { sma } from './indicators.js';

/**
 * Moving-average crossover strategy (classic golden/death cross on a fast
 * timeframe).
 *   - BUY  when fast SMA crosses above slow SMA
 *   - SELL when fast SMA crosses below slow SMA
 */
export class MaCrossStrategy extends BaseStrategy {
  constructor({ fast = 9, slow = 21 } = {}) {
    super('ma-cross');
    this.fast = fast;
    this.slow = slow;
  }

  evaluate(context) {
    const closes = context?.closes ?? context?.candles?.map((c) => c.close);
    if (!closes || closes.length < this.slow + 2) {
      return { signal: 'HOLD', confidence: 0, reason: `${this.name}: insufficient data` };
    }
    const fastLine = sma(closes, this.fast);
    const slowLine = sma(closes, this.slow);

    const prevFast = fastLine[closes.length - 2];
    const lastFast = fastLine[closes.length - 1];
    const prevSlow = slowLine[closes.length - 2];
    const lastSlow = slowLine[closes.length - 1];
    if ([prevFast, lastFast, prevSlow, lastSlow].some((v) => v == null)) {
      return { signal: 'HOLD', confidence: 0, reason: `${this.name}: no SMA data` };
    }

    if (prevFast <= prevSlow && lastFast > lastSlow) {
      return { signal: 'BUY', confidence: 0.7, reason: `SMA${this.fast} crossed above SMA${this.slow}` };
    }
    if (prevFast >= prevSlow && lastFast < lastSlow) {
      return { signal: 'SELL', confidence: 0.7, reason: `SMA${this.fast} crossed below SMA${this.slow}` };
    }
    return { signal: 'HOLD', confidence: 0.2, reason: 'SMA trend unchanged' };
  }
}

export default MaCrossStrategy;
