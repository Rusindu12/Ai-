import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Portfolio } from '../src/trading/portfolio.js';

test('buy and sell track cash, positions and realized P&L', () => {
  const p = new Portfolio({ startingBalance: 10_000 });
  p.buy('BTCUSDT', 100, 1);
  assert.equal(p.positions.get('BTCUSDT').qty, 1);
  assert.equal(p.cash, 10_000 - 100 - 0.1); // minus 0.1% fee

  p.sell('BTCUSDT', 120, 1);
  assert.equal(p.positions.has('BTCUSDT'), false);
  const trade = p.trades[1];
  assert.ok(trade.realizedPnl > 0); // sold at a profit
});

test('equity is cash + marked-to-market positions', () => {
  const p = new Portfolio({ startingBalance: 10_000 });
  p.buy('ETHUSDT', 2000, 1);
  const eq = p.equity({ ETHUSDT: 2500 });
  assert.ok(Math.abs(eq - (10_000 - 2000 - 2 + 2500)) < 1e-6);
});

test('summary reports positions and unrealized P&L', () => {
  const p = new Portfolio({ startingBalance: 10_000 });
  p.buy('SOLUSDT', 100, 5);
  const s = p.summary({ SOLUSDT: 120 });
  assert.equal(s.openPositions, 1);
  assert.equal(s.positions[0].unrealizedPnl, 100);
});

test('performance computes win rate and max drawdown', () => {
  const p = new Portfolio({ startingBalance: 10_000 });
  p.buy('BTCUSDT', 100, 1);
  p.sell('BTCUSDT', 110, 1); // win
  p.buy('BTCUSDT', 100, 1);
  p.sell('BTCUSDT', 90, 1); // loss
  const perf = p.performance({ BTCUSDT: 100 });
  assert.equal(perf.winRate, 0.5);
  assert.ok(perf.maxDrawdown >= 0);
  assert.equal(typeof perf.sharpeRatio, 'number');
});

test('toCsv exports a valid CSV with header', () => {
  const p = new Portfolio({ startingBalance: 10_000 });
  p.buy('BTCUSDT', 100, 1);
  const csv = p.toCsv();
  assert.ok(csv.startsWith('id,ts,side,symbol'));
  assert.ok(csv.split('\n').length >= 2);
});

test('buy throws when there is insufficient cash', () => {
  const p = new Portfolio({ startingBalance: 100 });
  assert.throws(() => p.buy('BTCUSDT', 500, 1));
});
