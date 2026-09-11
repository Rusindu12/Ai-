import crypto from 'node:crypto';

/**
 * Binance request signing.
 *
 * Signed (private) Binance endpoints require every request to carry:
 *   1. `timestamp` — server time in milliseconds (must be within ±1s drift).
 *   2. `signature` — HMAC-SHA256 of the query string (excluding the
 *      `signature` param itself), using the API secret as the key.
 *
 * The query string is built from the parameters sorted alphabetically by key,
 * with each value URL-encoded (RFC 3986).
 */

/** RFC 3986 URL encoding (Binance rejects `+` for spaces). */
export function encodeParam(value) {
  return encodeURIComponent(String(value));
}

/**
 * Serialise a plain object into a sorted, URL-encoded query string.
 * `undefined`/`null`/empty-string values are dropped (Binance treats them as
 * "parameter not sent"). Arrays are joined with commas for multi-value params.
 */
export function buildQueryString(params = {}) {
  const entries = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      // Encode each element AND the separator (RFC 3986) so commas are %2C.
      entries.push([key, value.map(encodeParam).join(encodeParam(','))]);
      continue;
    }
    const str = String(value);
    if (str === '') continue;
    entries.push([key, encodeParam(str)]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

/**
 * Compute the HMAC-SHA256 signature of a query string using the API secret.
 * @param {string} queryString - sorted query string WITHOUT `signature`
 * @param {string} secret - Binance API secret
 * @returns {string} lowercase hex signature
 */
export function hmacSha256(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

/**
 * Sign a params object. Returns the sorted query string and its signature.
 * Use this to build a full signed query string via `signQuery(params, secret)`.
 */
export function signParams(params, secret) {
  const queryString = buildQueryString(params);
  return { queryString, signature: hmacSha256(queryString, secret) };
}

/**
 * Produce the final query string for a signed request, including the
 * `signature` parameter (appended last, as required by Binance).
 * @example signQuery({ symbol: 'BTCUSDT', side: 'BUY' }, secret)
 */
export function signQuery(params, secret) {
  const { queryString, signature } = signParams(params, secret);
  return `${queryString}&signature=${encodeParam(signature)}`;
}

/**
 * Add the mandatory `timestamp`/`recvWindow` fields and sign the params.
 * This is the single entrypoint used by every signed request.
 */
export function buildSignedQuery(params, secret, { timestamp = Date.now(), recvWindow = 5000 } = {}) {
  return signQuery({ ...params, timestamp, recvWindow }, secret);
}

export default { buildQueryString, hmacSha256, signParams, signQuery, buildSignedQuery, encodeParam };
