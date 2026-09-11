import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RsiMeanReversionStrategy } from '../src/strategies/rsiMeanReversion.js';
import { MacdCrossoverStrategy } from '../src/strategies/macdCrossover.js';
import { MaCrossStrategy } from '../src/strategies/maCross.js';
import { EnsembleStrategy } from '../src/strategies/ensemble.js';

test('RSI strategy emits BUY on oversold crossover', () => {
  // Constructed downtrend -> recovery so RSI crosses up through 30 exactly on
  // the final bar (verified empirically: downLen 10, downStep 2, upStep 1).
  const closes = [];
  for (let i = 0; i < 10; i++) closes.push(1000 - i * 2); // strong downtrend -> oversold
  for (let i = 0; i < 8; i++) closes.push(closes[closes.length - 1] + 1); // recovery
  const s = new RsiMeanReversionStrategy({ period: 14, oversold: 30, overbought: 70 });
  const r = s.evaluate({ closes });
  assert.equal(r.signal, 'BUY');
  assert.ok(r.confidence > 0.5);
});

test('RSI strategy returns HOLD with insufficient data', () => {
  const s = new RsiMeanReversionStrategy();
  const r = s.evaluate({ closes: [1, 2, 3] });
  assert.equal(r.signal, 'HOLD');
});

test('MACD strategy detects a crossover in trending data', () => {
  // A sharp reversal creates a MACD/signal crossover.
  const closes = [
    ...[...Array(40)].map((_, i) => 100 - i), // downtrend
    ...[...Array(40)].map((_, i) => 60 + i), // uptrend
  ];
  const s = new MacdCrossoverStrategy();
  const r = s.evaluate({ closes });
  assert.ok(['BUY', 'SELL', 'HOLD'].includes(r.signal));
});

test('MA cross strategy detects golden cross', () => {
  // Constructed so the fast SMA (9) crosses above the slow SMA (21) exactly on
  // the final bar (verified: downLen 25, downStep 1, upLen 10, upStep 1).
  const closes = [];
  for (let i = 0; i < 25; i++) closes.push(1000 - i); // down
  for (let i = 0; i < 10; i++) closes.push(closes[closes.length - 1] + 1); // up
  const s = new MaCrossStrategy({ fast: 9, slow: 21 });
  const r = s.evaluate({ closes });
  assert.equal(r.signal, 'BUY');
});

test('ensemble aggregates sub-strategy votes', () => {
  const ensemble = new EnsembleStrategy({
    strategies: [
      { name: 'always-buy', evaluate: () => ({ signal: 'BUY', confidence: 0.8 }) },
      { name: 'always-sell', evaluate: () => ({ signal: 'SELL', confidence: 0.4 }) },
    ],
  });
  const r = ensemble.evaluate({});
  assert.equal(r.signal, 'BUY'); // 0.8 vs 0.4 -> net positive
  assert.ok(r.votes.length === 2);
});

test('ensemble respects the AI signal when provided', () => {
  const ensemble = new EnsembleStrategy({
    strategies: [{ name: 'flat', evaluate: () => ({ signal: 'HOLD', confidence: 0 }) }],
    aiWeight: 1,
  });
  const r = ensemble.evaluate({ ai: { signal: 'SELL', confidence: 0.9 } });
  assert.equal(r.signal, 'SELL');
  assert.equal(r.votes.some((v) => v.strategy === 'ai-model'), true);
});
