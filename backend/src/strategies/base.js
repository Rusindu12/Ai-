/**
 * Base strategy contract.
 *
 * A strategy receives a `context` snapshot and returns a signal object:
 *   { signal: 'BUY' | 'SELL' | 'HOLD', confidence: 0..1, reason: string }
 *
 * `context` may include candles (OHLCV), indicators, order book, and AI output.
 */
export class BaseStrategy {
  constructor(name) {
    this.name = name;
  }

  /** Override in subclasses. */
  evaluate(_context) {
    return { signal: 'HOLD', confidence: 0, reason: `${this.name}: not implemented` };
  }

  /** Convenience: last defined value of an indicator array. */
  static lastValue(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] != null) return arr[i];
    }
    return null;
  }

  /** Convenience: last two defined values. */
  static lastTwo(arr) {
    const found = [];
    for (let i = arr.length - 1; i >= 0 && found.length < 2; i--) {
      if (arr[i] != null) found.push(arr[i]);
    }
    return found.length === 2 ? { prev: found[1], last: found[0] } : null;
  }
}

export default BaseStrategy;
