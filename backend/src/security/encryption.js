import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * AES-256-GCM encryption for API secrets.
 *
 * Binance API keys are NEVER stored in plain text: they are encrypted with a
 * 32-byte key (from ENCRYPTION_KEY) before being persisted, and decrypted only
 * transiently when a signed request must be built. GCM provides authenticated
 * encryption (tamper detection).
 */

const ALGO = 'aes-256-gcm';

/** Derive a 32-byte key from the configured secret (accepts hex or raw). */
export function getKey(secret = config.encryptionKey) {
  const raw = secret || 'dev-insecure-key-change-me';
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest(); // 32 bytes
}

/**
 * Encrypt a plaintext string -> "iv:authTag:ciphertext" (base64 segments).
 */
export function encrypt(plaintext, secret) {
  const key = getKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
}

/**
 * Decrypt a value produced by `encrypt`. Throws on tamper/wrong key.
 */
export function decrypt(payload, secret) {
  const key = getKey(secret);
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('malformed encrypted payload');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Whether encryption is properly configured. */
export function isEncryptionConfigured() {
  return Boolean(config.encryptionKey) && config.encryptionKey !== 'change-me-32-byte-key';
}

export default { encrypt, decrypt, getKey, isEncryptionConfigured };
