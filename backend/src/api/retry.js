/**
 * Retry helper with exponential backoff + full jitter.
 *
 * Used by the Binance client for transient failures: HTTP 429 (rate limited),
 * HTTP 5xx, network errors, and Binance's "way too many requests" (-1003) and
 * "timestamp outside recvWindow" (-1021) codes. Respects a `Retry-After`
 * header when present.
 */

const DEFAULT_OPTIONS = {
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 10_000,
  retryableStatuses: [429, 500, 502, 503, 504],
  retryableCodes: [-1003, -1021],
  jitter: true,
  onRetry: () => {},
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fullJitter(base, cap) {
  const capped = Math.min(base, cap);
  return Math.random() * capped;
}

/**
 * Execute `fn` with retries. `fn` should throw an error that may carry
 * `status` (HTTP status), `code` (Binance error code) and `retryAfterMs`.
 */
export async function withRetry(fn, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? 0;
      const code = err?.code ?? 0;
      const retryAfterMs = err?.retryAfterMs ?? null;

      const retryable =
        opts.retryableStatuses.includes(status) ||
        opts.retryableCodes.includes(code) ||
        (status === 0 && !err?.response); // network-level failure

      if (!retryable || attempt >= opts.maxAttempts) throw err;

      // Honour Retry-After when the server tells us exactly how long to wait.
      let delay;
      if (retryAfterMs && retryAfterMs > 0) {
        delay = retryAfterMs;
      } else {
        const base = opts.baseDelayMs * 2 ** (attempt - 1);
        delay = opts.jitter ? fullJitter(base, opts.maxDelayMs) : Math.min(base, opts.maxDelayMs);
      }

      opts.onRetry({ attempt, delay, status, code, error: err });
      await sleep(delay);
    }
  }
}

export default withRetry;
