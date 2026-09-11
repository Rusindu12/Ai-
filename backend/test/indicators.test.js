import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sma, ema, rsi, macd, bollingerBands, vwap, orderBookImbalance, momentum, trendScore } from '../src/strategies/indicators.js';

test('SMA computes the correct averages', () => {
  const out = sma([1, 2, 3, 4, 5], 3);
  assert.equal(out[0], null);
  assert.equal(out[1], null);
  assert.equal(out[2], 2); // (1+2+3)/3
  assert.equal(out[3], 3); // (2+3+4)/3
  assert.equal(out[4], 4);
});

test('EMA is seeded by the SMA and smooths', () => {
  const closes = [10, 11, 12, 13, 14, 15];
  const out = ema(closes, 3);
  assert.equal(out[2], 11); // seed = mean(10,11,12)
  assert.ok(out[5] > 13); // follows the uptrend
});

test('RSI is 100 for a strictly rising series and 0 for a falling one', () => {
  const rising = Array.from({ length: 20 }, (_, i) => 100 + i);
  const falling = Array.from({ length: 20 }, (_, i) => 100 - i);
  const rsiRising = rsi(rising, 14);
  const rsiFalling = rsi(falling, 14);
  assert.equal(rsiRising[rsiRising.length - 1], 100);
  assert.equal(rsiFalling[rsiFalling.length - 1], 0);
});

test('RSI returns nulls before the warm-up period', () => {
  const out = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], 14);
  assert.equal(out[13], null);
});

test('MACD line equals fast EMA minus slow EMA', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
  const { macd: line, signal } = macd(closes, 12, 26, 9);
  const last = line[line.length - 1];
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const expected = fast[fast.length - 1] - slow[slow.length - 1];
  assert.ok(Math.abs(last - expected) < 1e-9);
  assert.ok(signal[signal.length - 1] != null);
});

test('Bollinger Bands: upper > middle > lower for flat-ish data', () => {
  const closes = Array.from({ length: 30 }, (_, i) => 50 + Math.sin(i));
  const { upper, middle, lower } = bollingerBands(closes, 20, 2);
  const i = 29;
  assert.ok(upper[i] > middle[i]);
  assert.ok(middle[i] > lower[i]);
});

test('VWAP is volume-weighted', () => {
  const closes = [10, 20];
  const volumes = [1, 0]; // all volume at the first price
  const out = vwap(closes, volumes);
  assert.equal(out[0], 10);
  assert.equal(out[1], 10);
});

test('orderBookImbalance is 0 for balanced books and positive for bid-heavy', () => {
  assert.equal(orderBookImbalance([[100, 10]], [[101, 10]]), 0);
  const imbalanced = orderBookImbalance([[100, 30]], [[101, 10]]);
  assert.equal(imbalanced, 0.5);
});

test('momentum returns the period-over-period change', () => {
  const out = momentum([100, 101, 102, 103], 3);
  assert.equal(out[3], 0.03);
});

test('trendScore is positive in an uptrend and bounded to [-1, 1]', () => {
  const up = Array.from({ length: 40 }, (_, i) => 100 + i);
  const down = Array.from({ length: 40 }, (_, i) => 100 - i);
  const upScore = trendScore(up, 20);
  const downScore = trendScore(down, 20);
  assert.ok(upScore > 0);
  assert.ok(downScore < 0);
  assert.ok(upScore <= 1 && upScore >= -1);
});
