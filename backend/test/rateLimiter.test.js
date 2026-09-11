import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SlidingWindowRateLimiter, isRetryable } from '../src/api/rateLimiter.js';

test('rate limiter allows requests within budget and blocks the rest', () => {
  const rl = new SlidingWindowRateLimiter({ limit: 3, windowMs: 60_000 });
  assert.equal(rl.tryAcquire(1), true);
  assert.equal(rl.tryAcquire(1), true);
  assert.equal(rl.tryAcquire(1), true);
  assert.equal(rl.tryAcquire(1), false); // 4th exceeds budget
  assert.equal(rl.usedWeight(), 3);
  assert.equal(rl.remainingWeight(), 0);
});

test('rate limiter frees budget as the window slides', () => {
  const rl = new SlidingWindowRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(rl.tryAcquire(1, 0), true);
  assert.equal(rl.tryAcquire(1, 0), false);
  assert.equal(rl.tryAcquire(1, 1001), true); // window moved past the first hit
});

test('acquire resolves false after timeout when budget is exhausted', async () => {
  const rl = new SlidingWindowRateLimiter({ limit: 1, windowMs: 60_000 });
  rl.tryAcquire(1);
  const ok = await rl.acquire(1, { timeoutMs: 50, pollMs: 10 });
  assert.equal(ok, false);
});

test('isRetryable identifies transient conditions', () => {
  assert.equal(isRetryable(429, 0), true);
  assert.equal(isRetryable(503, 0), true);
  assert.equal(isRetryable(200, -1003), true); // "way too many requests"
  assert.equal(isRetryable(200, -1021), true); // timestamp drift
  assert.equal(isRetryable(400, -1100), false); // bad symbol — not retryable
  assert.equal(isRetryable(401, 0), false);
});
