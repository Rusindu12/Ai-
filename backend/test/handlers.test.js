import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeKline,
  normalizeTicker,
  normalizeDepth,
  normalizeExecutionReport,
  parseStreamName,
} from '../src/websocket/handlers.js';

test('normalizeKline parses a combined-stream kline frame', () => {
  const frame = {
    stream: 'btcusdt@kline_1m',
    data: {
      e: 'kline', E: 1700000000000, s: 'BTCUSDT',
      k: {
        t: 1700000000000, T: 1700000059999, s: 'BTCUSDT', i: '1m',
        o: '42000.00', h: '42100.00', l: '41900.00', c: '42050.00',
        v: '12.5', q: '525000.0', n: 100, x: true,
      },
    },
  };
  const k = normalizeKline(frame);
  assert.equal(k.type, 'kline');
  assert.equal(k.symbol, 'BTCUSDT');
  assert.equal(k.interval, '1m');
  assert.equal(k.close, 42050);
  assert.equal(k.isClosed, true);
});

test('normalizeKline returns null for non-kline frames', () => {
  assert.equal(normalizeKline({ e: 'ticker' }), null);
});

test('normalizeTicker converts string prices to numbers', () => {
  const frame = { e: '24hrTicker', E: 1, s: 'ETHUSDT', c: '2500.5', p: '10.2', P: '0.4', v: '100' };
  const t = normalizeTicker(frame);
  assert.equal(t.lastPrice, 2500.5);
  assert.equal(t.priceChangePct, 0.4);
});

test('normalizeDepth parses bids/asks and limits depth', () => {
  const bids = Array.from({ length: 30 }, (_, i) => [`${i + 1}`, `${i + 1}`]);
  const asks = Array.from({ length: 30 }, (_, i) => [`${i + 100}`, `${i + 2}`]);
  const d = normalizeDepth({ lastUpdateId: 123, bids, asks }, 'BTCUSDT');
  assert.equal(d.symbol, 'BTCUSDT');
  assert.equal(d.bids.length, 20);
  assert.equal(d.bids[0][0], 1);
  assert.equal(d.asks[0][1], 2);
});

test('normalizeExecutionReport maps order status and fills', () => {
  const er = normalizeExecutionReport({
    e: 'executionReport', E: 1, s: 'BTCUSDT', c: 'myOrder1', S: 'BUY', o: 'MARKET',
    q: '0.001', p: '42000', X: 'FILLED', i: 999, l: '0.001', z: '0.001', L: '42010',
    n: '0.00001', N: 'BNB', T: 2, t: 88,
  });
  assert.equal(er.status, 'FILLED');
  assert.equal(er.side, 'BUY');
  assert.equal(er.lastFilledPrice, 42010);
  assert.equal(er.cumulativeFilledQty, 0.001);
});

test('parseStreamName handles kline, depth and ticker streams', () => {
  assert.deepEqual(parseStreamName('BTCUSDT@kline_1m'), { symbol: 'BTCUSDT', type: 'kline', interval: '1m' });
  assert.deepEqual(parseStreamName('btcusdt@depth20@100ms'), {
    symbol: 'BTCUSDT', type: 'depth', levels: 20, speed: '100ms',
  });
  assert.deepEqual(parseStreamName('ETHUSDT@ticker'), { symbol: 'ETHUSDT', type: 'ticker' });
});
