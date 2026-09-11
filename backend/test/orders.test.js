import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateTpSlLong, evaluateTpSlShort, trailingStopLong, bracketPrices } from '../src/trading/orders.js';

test('evaluateTpSlLong triggers take profit and stop loss', () => {
  assert.equal(evaluateTpSlLong({ price: 105, entryPrice: 100, takeProfitPrice: 104, stopLossPrice: 95 }), 'TAKE_PROFIT');
  assert.equal(evaluateTpSlLong({ price: 94, entryPrice: 100, takeProfitPrice: 104, stopLossPrice: 95 }), 'STOP_LOSS');
  assert.equal(evaluateTpSlLong({ price: 100, entryPrice: 100, takeProfitPrice: 104, stopLossPrice: 95 }), null);
});

test('evaluateTpSlShort mirrors the long logic', () => {
  assert.equal(evaluateTpSlShort({ price: 96, entryPrice: 100, takeProfitPrice: 97, stopLossPrice: 105 }), 'TAKE_PROFIT');
  assert.equal(evaluateTpSlShort({ price: 106, entryPrice: 100, takeProfitPrice: 97, stopLossPrice: 105 }), 'STOP_LOSS');
});

test('trailingStopLong ratchets the stop upward and never lowers it', () => {
  const first = trailingStopLong({ price: 100, highestPrice: 100, trailPct: 0.02 });
  assert.equal(first.stopPrice, 98);
  const second = trailingStopLong({ price: 110, highestPrice: first.highestPrice, trailPct: 0.02, currentStopPrice: first.stopPrice });
  assert.equal(second.highestPrice, 110);
  assert.equal(second.stopPrice, 107.8); // 110 * 0.98
  const dip = trailingStopLong({ price: 105, highestPrice: second.highestPrice, trailPct: 0.02, currentStopPrice: second.stopPrice });
  assert.equal(dip.stopPrice, 107.8); // does not ratchet down
});

test('trailingStopLong triggers when price falls to the stop', () => {
  const r = trailingStopLong({ price: 100, highestPrice: 100, trailPct: 0.02 });
  const t = trailingStopLong({ price: 97.5, highestPrice: r.highestPrice, trailPct: 0.02, currentStopPrice: r.stopPrice });
  assert.equal(t.triggered, true);
});

test('bracketPrices converts percentages to absolute prices', () => {
  const b = bracketPrices(100, { takeProfitPct: 0.05, stopLossPct: 0.02, trailPct: 0.01 });
  assert.equal(b.takeProfitPrice, 105);
  assert.equal(b.stopLossPrice, 98);
  assert.equal(b.trailPct, 0.01);
});
