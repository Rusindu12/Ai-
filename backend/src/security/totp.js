import crypto from 'node:crypto';

/**
 * TOTP (RFC 6238) implementation for two-factor authentication, built on the
 * standard HMAC-SHA1 with a 30-second time step — compatible with Google
 * Authenticator / Authy. No external dependencies.
 */

const STEP = 30;
const DIGITS = 6;

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of cleaned) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error(`invalid base32 char: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function hotp(secretBuffer, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuffer).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return code % 10 ** DIGITS;
}

/** Generate the 6-digit TOTP code for the current time (or a given time). */
export function generateTotp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / STEP);
  return hotp(base32Decode(secret), counter).toString().padStart(DIGITS, '0');
}

/** Verify a user-supplied code against the secret (±1 step for drift). */
export function verifyTotp(secret, code, at = Date.now()) {
  const counter = Math.floor(at / 1000 / STEP);
  for (let offset = -1; offset <= 1; offset++) {
    const expected = hotp(base32Decode(secret), counter + offset).toString().padStart(DIGITS, '0');
    if (expected === String(code)) return true;
  }
  return false;
}

/** Generate a new base32 secret for enrolment. */
export function generateSecret() {
  return crypto.randomBytes(20).toString('base64').replace(/[^A-Za-z2-7]/g, '').slice(0, 32);
}

/** otpauth:// URI for QR enrolment in authenticator apps. */
export function otpauthUrl(secret, account = 'user@example.com', issuer = 'AICryptoTrading') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}

export default { generateTotp, verifyTotp, generateSecret, otpauthUrl };
