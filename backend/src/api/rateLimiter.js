/**
 * Sliding-window rate limiter for Binance.
 *
 * Binance enforces a request-weight budget per minute (default 1200 for spot).
 * Different endpoints consume different weights (e.g. `GET /api/v3/klines` may
 * cost 2, placing an order costs 1, historical queries up to 10). We track the
 * rolling window ourselves so we can throttle *before* hitting Binance, and we
 * also read the `X-MBX-USED-WEIGHT-1M` header returned by Binance to stay
 * honest about the remaining budget.
 */

export class SlidingWindowRateLimiter {
  /**
   * @param {object} opts
   * @param {number} [opts.limit=1200]  total weight allowed per window
   * @param {number} [opts.windowMs=60000] window length in ms
   */
  constructor({ limit = 1200, windowMs = 60_000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    /** @type {Array<{ts:number, weight:number}>} */
    this.hits = [];
  }

  /** Remove events outside the current window. */
  _prune(now = Date.now()) {
    const cutoff = now - this.windowMs;
    while (this.hits.length && this.hits[0].ts <= cutoff) this.hits.shift();
  }

  /** Sum of weights currently inside the window. */
  usedWeight(now = Date.now()) {
    this._prune(now);
    return this.hits.reduce((sum, h) => sum + h.weight, 0);
  }

  remainingWeight(now = Date.now()) {
    return Math.max(0, this.limit - this.usedWeight(now));
  }

  /**
   * Try to reserve `weight` units. Returns true if allowed, false if it would
   * exceed the budget (caller should back off).
   */
  tryAcquire(weight = 1, now = Date.now()) {
    this._prune(now);
    if (this.usedWeight(now) + weight > this.limit) return false;
    this.hits.push({ ts: now, weight });
    return true;
  }

  /**
   * Blocking acquire used by the HTTP client: waits until the reservation can
   * be made or `timeoutMs` elapses. Resolves true on success, false on timeout.
   */
  async acquire(weight = 1, { timeoutMs = 30_000, pollMs = 50 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.tryAcquire(weight)) return true;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return false;
  }

  reset() {
    this.hits = [];
  }
}

/**
 * Normalise a Binance error/status into a retry decision, accounting for both
 * HTTP status codes and Binance's JSON error codes (e.g. -1003 "way too many
 * requests", -1021 "timestamp for this request was outside of the recvWindow").
 */
export function isRetryable(status, binanceCode) {
  if (status === 429) return true;
  if (status >= 500) return true;
  // Binance-specific transient errors
  if (binanceCode === -1003 || binanceCode === -1021) return true;
  return false;
}

export default SlidingWindowRateLimiter;
