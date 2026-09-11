import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encrypt, decrypt, getKey } from '../src/security/encryption.js';
import { generateSecret, generateTotp, verifyTotp, otpauthUrl } from '../src/security/totp.js';
import { signToken, verifyToken } from '../src/security/jwt.js';

test('AES-256-GCM round-trips and never stores plaintext', () => {
  const secret = 'my-binance-api-secret-123';
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 32 bytes hex
  const encrypted = encrypt(secret, key);
  assert.notEqual(encrypted, secret);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decrypt(encrypted, key), secret);
});

test('decrypt throws on tampered ciphertext', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const encrypted = encrypt('topsecret', key);
  const parts = encrypted.split(':');
  parts[2] = 'AAAAAA';
  assert.throws(() => decrypt(parts.join(':'), key));
});

test('getKey derives a 32-byte key from hex or a passphrase', () => {
  assert.equal(getKey('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef').length, 32);
  assert.equal(getKey('a-passphrase').length, 32);
});

test('TOTP generates a stable 6-digit code and verifies it', () => {
  const secret = generateSecret();
  assert.equal(secret.length >= 16, true);
  const code = generateTotp(secret, 1_700_000_000_000);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code, 1_700_000_000_000), true);
  assert.equal(verifyTotp(secret, '000000', 1_700_000_000_000), false);
});

test('otpauthUrl encodes the issuer and account', () => {
  const url = otpauthUrl('JBSWY3DPEHPK3PXP', 'user@example.com');
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.ok(url.includes('JBSWY3DPEHPK3PXP'));
});

test('JWT round-trips and rejects tampered tokens', () => {
  const token = signToken({ sub: 'user-1' });
  const payload = verifyToken(token);
  assert.equal(payload.sub, 'user-1');
  assert.throws(() => verifyToken(token + 'x'));
});
