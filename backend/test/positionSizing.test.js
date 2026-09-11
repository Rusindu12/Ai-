import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  realizedVolatility,
  annualizedVolatility,
  atr,
  positionSizeByVolatility,
  positionSizeByRisk,
} from '../src/risk/positionSizing.js';

test('realizedVolatility is 0 for a constant series', () => {
  assert.equal(realizedVolatility([10, 10, 10, 10, 10]), 0);
});

test('realizedVolatility is positive for a volatile series', () => {
  assert.ok(realizedVolatility([10, 12, 9, 15, 8, 14]) > 0);
});

test('annualizedVolatility scales by sqrt(periods)', () => {
  const closes = [100, 101, 100, 102, 99, 101];
  const vol = realizedVolatility(closes);
  assert.ok(Math.abs(annualizedVolatility(closes, 365) - vol * Math.sqrt(365)) < 1e-9);
});

test('ATR is null when there is insufficient data and positive otherwise', () => {
  assert.equal(atr([1, 2, 3], [0, 1, 2], [1, 2, 3], 14), null);
  const highs = Array.from({ length: 30 }, (_, i) => 100 + i);
  const lows = Array.from({ length: 30 }, (_, i) => 99 + i);
  const closes = Array.from({ length: 30 }, (_, i) => 99.5 + i);
  assert.ok(atr(highs, lows, closes, 14) > 0);
});

test('positionSizeByVolatility shrinks as volatility rises', () => {
  // maxPct high enough not to cap the fraction so the inverse-volatility
  // relationship is directly observable.
  const lowVol = positionSizeByVolatility(10_000, 0.02, { targetVol: 0.01, maxPct: 1 });
  const highVol = positionSizeByVolatility(10_000, 0.04, { targetVol: 0.01, maxPct: 1 });
  assert.equal(lowVol.fraction, 0.5);
  assert.equal(highVol.fraction, 0.25);
  assert.ok(highVol.size < lowVol.size);
});

test('positionSizeByVolatility respects the maxPct cap', () => {
  const r = positionSizeByVolatility(10_000, 0.0001, { targetVol: 0.01, maxPct: 0.05 });
  assert.equal(r.fraction, 0.05);
  assert.equal(r.size, 500);
});

test('positionSizeByRisk risks a fixed fraction sized by stop distance', () => {
  const r = positionSizeByRisk(10_000, 100, 90, { riskPct: 0.01, maxPct: 0.1 });
  assert.equal(r.riskAmount, 100); // 1% of 10k
  assert.equal(r.quantity, 10); // 100 / (100 - 90)
});

test('positionSizeByRisk caps the position at maxPct of equity', () => {
  const r = positionSizeByRisk(10_000, 100, 99, { riskPct: 0.02, maxPct: 0.05 });
  assert.equal(r.fraction, 0.05);
  assert.equal(r.quantity, 5); // (10k * 0.05) / 100
});
