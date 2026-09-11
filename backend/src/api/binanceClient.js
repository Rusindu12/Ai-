import os from 'node:os';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { buildQueryString, buildSignedQuery } from './signature.js';
import { SlidingWindowRateLimiter } from './rateLimiter.js';
import { withRetry } from './retry.js';

/**
 * Binance REST API client.
 *
 *  - Public endpoints: plain GET with a query string.
 *  - Signed endpoints:  `X-MBX-APIKEY` header + HMAC-SHA256 signed query.
 *  - Rate limiting:     sliding-window (default 1200 weight/min) enforced
 *                       locally before the request and tracked via the
 *                       `X-MBX-USED-WEIGHT-1M` response header.
 *  - Retries:           exponential backoff + jitter on 429/5xx/-1003/-1021.
 *  - IP whitelist:      optional outbound safeguard that blocks signed calls
 *                       from non-whitelisted servers.
 *
 * Uses the global `fetch` (Node >= 18).
 */

export class BinanceClient {
  /**
   * @param {object} opts
   * @param {string} [opts.baseUrl] REST base URL
   * @param {string} [opts.apiKey] Binance API key
   * @param {string} [opts.apiSecret] Binance API secret
   * @param {number} [opts.rateLimit=1200] weight budget per minute
   * @param {string[]} [opts.ipWhitelist=[]] IPs allowed to send signed requests
   */
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || config.binance.restBaseUrl).replace(/\/+$/, '');
    this.apiKey = opts.apiKey ?? config.binance.apiKey;
    this.apiSecret = opts.apiSecret ?? config.binance.apiSecret;
    this.ipWhitelist = opts.ipWhitelist ?? config.binance.ipWhitelist;
    this.rateLimiter = new SlidingWindowRateLimiter({ limit: opts.rateLimit ?? config.binance.rateLimit });
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.lastUsedWeight = 0;
    this.serverTimeOffset = 0;
  }

  get hasCredentials() {
    return Boolean(this.apiKey && this.apiSecret);
  }

  /**
   * Perform a request against the Binance API.
   * @param {string} method HTTP method
   * @param {string} path  e.g. '/api/v3/account'
   * @param {object} [params] query params
   * @param {object} [opts]
   * @param {boolean} [opts.signed] sign the request (adds timestamp + signature)
   * @param {number} [opts.weight=1] request weight for local rate limiting
   * @param {boolean} [opts.retry=true] apply automatic retries
   */
  async request(method, path, params = {}, opts = {}) {
    const { signed = false, weight = 1, retry = true } = opts;

    const execute = async () => {
      // Local rate-limit gate (blocking, with timeout).
      const allowed = await this.rateLimiter.acquire(weight, { timeoutMs: 30_000 });
      if (!allowed) {
        const err = new Error('Binance rate limit exceeded locally');
        err.status = 429;
        throw err;
      }

      let url = `${this.baseUrl}${path}`;
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

      if (signed) {
        if (!this.hasCredentials) {
          const err = new Error('Missing Binance API credentials for signed request');
          err.status = 401;
          throw err;
        }
        if (this.ipWhitelist.length && !this._isIpAllowed()) {
          const err = new Error('Server IP is not whitelisted for Binance API');
          err.status = 403;
          throw err;
        }
        headers['X-MBX-APIKEY'] = this.apiKey;
        const query = buildSignedQuery(params, this.apiSecret, {
          timestamp: Date.now() + this.serverTimeOffset,
        });
        url += `?${query}`;
      } else if (Object.keys(params).length) {
        url += `?${buildQueryString(params)}`;
      }

      let res;
      try {
        res = await fetch(url, { method, headers });
      } catch (networkErr) {
        // Network-level failure — surface without HTTP status so `withRetry`
        // treats it as transient.
        throw networkErr;
      }

      this.lastUsedWeight = Number(res.headers.get('x-mbx-used-weight-1m') || 0);

      let body = null;
      const text = await res.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      if (!res.ok || (body && body.code < 0)) {
        const err = new Error(
          `Binance ${method} ${path} failed (${res.status}): ${JSON.stringify(body)}`
        );
        err.status = res.status;
        err.code = body && typeof body === 'object' ? body.code : undefined;
        err.response = body;
        const retryAfter = res.headers.get('retry-after');
        if (retryAfter) err.retryAfterMs = Number(retryAfter) * 1000;
        // -1021 (timestamp outside recvWindow): resync clock and retry.
        if (err.code === -1021) await this.syncTime().catch(() => {});
        throw err;
      }

      return body;
    };

    if (!retry) return execute();
    return withRetry(execute, {
      maxAttempts: this.maxAttempts,
      onRetry: ({ attempt, delay, status, code }) =>
        logger.warn('Retrying Binance request', { path, attempt, delayMs: Math.round(delay), status, code }),
    });
  }

  // ---------- helpers ----------

  get(path, params = {}, opts = {}) {
    return this.request('GET', path, params, opts);
  }
  post(path, params = {}, opts = {}) {
    return this.request('POST', path, params, { signed: true, ...opts });
  }
  delete(path, params = {}, opts = {}) {
    return this.request('DELETE', path, params, { signed: true, ...opts });
  }

  _isIpAllowed() {
    // A real deployment resolves the outbound IP. Here we accept if the env
    // whitelist is empty (disabled) or contains the current hostname/IP. This
    // is a defence-in-depth control, not a substitute for Binance's own
    // restrict-access settings.
    if (!this.ipWhitelist.length) return true;
    try {
      return Object.values(os.networkInterfaces())
        .flat()
        .filter(Boolean)
        .some((iface) => this.ipWhitelist.includes(iface.address));
    } catch {
      return false;
    }
  }

  // ---------- public (market data) ----------

  ping() {
    return this.get('/api/v3/ping');
  }

  /** Server time in ms. Also refreshes our clock offset vs Binance. */
  async time() {
    const res = await this.get('/api/v3/time');
    if (res?.serverTime) this.serverTimeOffset = res.serverTime - Date.now();
    return res;
  }

  /** Re-sync local clock with Binance (mitigates -1021 errors). */
  async syncTime() {
    try {
      await this.time();
      logger.debug('Binance server time synced', { offsetMs: this.serverTimeOffset });
    } catch (e) {
      logger.warn('Binance time sync failed', { error: e.message });
    }
  }

  exchangeInfo(symbol) {
    const params = symbol ? { symbol } : {};
    return this.get('/api/v3/exchangeInfo', params, { weight: 10 });
  }

  /**
   * Candlestick data.
   * @param {string} symbol e.g. 'BTCUSDT'
   * @param {string} interval one of 1m,5m,15m,1h,4h,1d (also 3m,30m,2h,6h,8h,12h,3d,1w,1M)
   * @param {number} [limit=500] 1..1000
   */
  klines(symbol, interval = '1m', limit = 500, { startTime, endTime } = {}) {
    return this.get('/api/v3/klines', { symbol, interval, limit, startTime, endTime }, { weight: 2 });
  }

  ticker24h(symbol) {
    return this.get('/api/v3/ticker/24hr', symbol ? { symbol } : {}, { weight: symbol ? 2 : 40 });
  }

  tickerPrice(symbol) {
    return this.get('/api/v3/ticker/price', symbol ? { symbol } : {}, { weight: symbol ? 1 : 2 });
  }

  orderBook(symbol, limit = 100) {
    return this.get('/api/v3/depth', { symbol, limit }, { weight: limit <= 100 ? 5 : limit <= 500 ? 10 : 25 });
  }

  avgPrice(symbol) {
    return this.get('/api/v3/avgPrice', { symbol }, { weight: 1 });
  }

  recentTrades(symbol, limit = 500) {
    return this.get('/api/v3/trades', { symbol, limit }, { weight: 5 });
  }

  // ---------- signed (account / trading) ----------

  accountInfo() {
    return this.get('/api/v3/account', {}, { signed: true, weight: 10 });
  }

  myTrades(symbol, limit = 500) {
    return this.get('/api/v3/myTrades', { symbol, limit }, { signed: true, weight: 10 });
  }

  openOrders(symbol) {
    return this.get('/api/v3/openOrders', symbol ? { symbol } : {}, { signed: true, weight: 3 });
  }

  allOrders(symbol, limit = 500) {
    return this.get('/api/v3/allOrders', { symbol, limit }, { signed: true, weight: 10 });
  }

  getOrder(symbol, orderId) {
    return this.get('/api/v3/order', { symbol, orderId }, { signed: true, weight: 2 });
  }

  /**
   * Place a spot order.
   * @param {object} o { symbol, side, type: MARKET|LIMIT, quantity, price?, timeInForce?, newClientOrderId? }
   */
  async placeOrder(o) {
    const { symbol, side, type, quantity } = o;
    if (!symbol || !side || !type || !quantity) {
      throw new Error('placeOrder requires symbol, side, type and quantity');
    }
    const params = { symbol, side: side.toUpperCase(), type: type.toUpperCase(), quantity };
    if (type.toUpperCase() === 'LIMIT') {
      params.timeInForce = o.timeInForce || 'GTC';
      params.price = o.price;
    }
    if (o.newClientOrderId) params.newClientOrderId = o.newClientOrderId;
    return this.post('/api/v3/order', params, { weight: 1 });
  }

  cancelOrder(symbol, orderId) {
    return this.delete('/api/v3/order', { symbol, orderId }, { weight: 1 });
  }

  /** One-Cancels-the-Other: take-profit / stop-loss pair for spot. */
  placeOco({ symbol, side, quantity, price, stopPrice, stopLimitPrice, newClientOrderId }) {
    const params = { symbol, side: side.toUpperCase(), quantity, price, stopPrice };
    if (stopLimitPrice) params.stopLimitPrice = stopLimitPrice;
    if (newClientOrderId) params.newClientOrderId = newClientOrderId;
    return this.post('/api/v3/order/oco', params, { weight: 2 });
  }

  // ---------- user data stream (listen key) ----------

  createListenKey() {
    return this.post('/api/v3/userDataStream', {}, { signed: false });
  }

  keepAliveListenKey(listenKey) {
    return this.request('PUT', '/api/v3/userDataStream', { listenKey }, { signed: false });
  }

  closeListenKey(listenKey) {
    return this.request('DELETE', '/api/v3/userDataStream', { listenKey }, { signed: false });
  }
}

export default BinanceClient;
