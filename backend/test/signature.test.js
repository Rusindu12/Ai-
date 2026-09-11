import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQueryString,
  hmacSha256,
  signQuery,
  buildSignedQuery,
  encodeParam,
} from '../src/api/signature.js';

test('HMAC-SHA256 matches the official Binance documentation example', () => {
  const secret = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';
  const query =
    'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559';
  const expected = 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71';
  assert.equal(hmacSha256(query, secret), expected);
});

test('buildQueryString sorts keys alphabetically and drops empties', () => {
  const qs = buildQueryString({
    symbol: 'BTCUSDT',
    quantity: 1,
    type: 'LIMIT',
    empty: '',
    nully: null,
    undef: undefined,
  });
  assert.equal(qs, 'quantity=1&symbol=BTCUSDT&type=LIMIT');
});

test('buildQueryString joins array values with commas', () => {
  assert.equal(buildQueryString({ symbols: ['BTCUSDT', 'ETHUSDT'] }), 'symbols=BTCUSDT%2CETHUSDT');
});

test('encodeParam uses RFC 3986 encoding (no + for spaces)', () => {
  assert.equal(encodeParam('a b'), 'a%20b');
});

test('signQuery appends signature last', () => {
  const secret = 'test-secret';
  const signed = signQuery({ symbol: 'BTCUSDT', side: 'BUY' }, secret);
  const parts = signed.split('&');
  assert.equal(parts[parts.length - 1].startsWith('signature='), true);
  const sig = parts[parts.length - 1].slice('signature='.length);
  assert.equal(sig, hmacSha256('side=BUY&symbol=BTCUSDT', secret));
});

test('buildSignedQuery injects timestamp and recvWindow', () => {
  const signed = buildSignedQuery({ symbol: 'BTCUSDT' }, 's', { timestamp: 1000, recvWindow: 5000 });
  assert.match(signed, /timestamp=1000/);
  assert.match(signed, /recvWindow=5000/);
  assert.match(signed, /signature=/);
});
