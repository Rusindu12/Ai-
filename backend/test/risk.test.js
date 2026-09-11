import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawdown, DailyLossLimit, isDrawdownBreached, maxPositionSize } from '../src/risk/limits.js';
import { KillSwitch } from '../src/risk/killSwitch.js';
import { checkDiversification, canOpenPosition } from '../src/risk/diversification.js';

test('drawdown computes loss from the running peak', () => {
  assert.deepEqual(drawdown(100, 90), { drawdownPct: 0.1, peak: 100 });
  assert.deepEqual(drawdown(100, 120), { drawdownPct: 0, peak: 100 });
});

test('DailyLossLimit breaches when loss exceeds the limit', () => {
  const limit = new DailyLossLimit({ limitPct: 0.03, startEquity: 1000 });
  assert.equal(limit.evaluate(990).breached, false);
  assert.equal(limit.evaluate(965).breached, true);
  assert.equal(limit.lossPct, 0.035);
});

test('DailyLossLimit remaining budget shrinks with losses', () => {
  const limit = new DailyLossLimit({ limitPct: 0.03, startEquity: 1000 });
  limit.evaluate(980);
  assert.equal(limit.remainingBudget, 10);
});

test('isDrawdownBreached triggers at the guard threshold', () => {
  assert.equal(isDrawdownBreached(100, 79, 0.2), true);
  assert.equal(isDrawdownBreached(100, 81, 0.2), false);
});

test('maxPositionSize scales with equity', () => {
  assert.equal(maxPositionSize(10_000, 0.05), 500);
});

test('KillSwitch triggers, blocks trading and can reset', () => {
  const ks = new KillSwitch();
  assert.equal(ks.isTriggered, false);
  ks.trigger('daily loss limit');
  assert.equal(ks.isTriggered, true);
  assert.equal(ks.blocksTrading, true);
  assert.equal(ks.status().reason, 'daily loss limit');
  ks.reset();
  assert.equal(ks.isTriggered, false);
});

test('diversification caps position size as a % of equity', () => {
  const r = checkDiversification(
    { equity: 10_000, newPositionValue: 2_000, openPositions: [] },
    { maxPortfolioPct: 0.1 }
  );
  assert.equal(r.allowed, false);
  assert.match(r.reason, /equity/);
});

test('diversification limits the number of open positions', () => {
  const open = [{ symbol: 'BTCUSDT', value: 100 }, { symbol: 'ETHUSDT', value: 100 }];
  const r = checkDiversification(
    { equity: 10_000, newPositionValue: 100, openPositions: open },
    { maxOpenPositions: 2, maxPortfolioPct: 0.5 }
  );
  assert.equal(r.allowed, false);
  assert.match(r.reason, /open positions/);
});

test('diversification allows a small new position within limits', () => {
  const r = checkDiversification(
    { equity: 10_000, newPositionValue: 200, openPositions: [] },
    { maxOpenPositions: 5, maxPortfolioPct: 0.1 }
  );
  assert.equal(r.allowed, true);
});

test('canOpenPosition returns true for an existing symbol', () => {
  assert.equal(canOpenPosition(['BTCUSDT', 'ETHUSDT'], 'BTCUSDT', 2), true);
  assert.equal(canOpenPosition(['BTCUSDT', 'ETHUSDT'], 'SOLUSDT', 2), false);
});
