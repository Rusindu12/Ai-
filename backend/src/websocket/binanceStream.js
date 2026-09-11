import WebSocket from 'ws';
import { logger } from '../logger.js';

/**
 * Low-level Binance WebSocket client.
 *
 * Handles the connection lifecycle for Binance's public and user-data streams:
 *   - combined streams (`/stream?streams=btcusdt@ticker/...`)
 *   - single streams (`/ws/btcusdt@kline_1m`)
 *   - user data streams (`/ws/<listenKey>`)
 *
 * Binance closes idle connections and sends a server `ping` every ~3 minutes;
 * the client must answer with a matching `pong`, which we do automatically.
 * On drop we reconnect with exponential backoff + jitter and re-emit
 * subscription names so callers stay in sync.
 */
export class BinanceStream {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl  wss://stream.binance.com:9443
   * @param {number} [opts.maxReconnectDelayMs=30000]
   */
  constructor({ baseUrl, maxReconnectDelayMs = 30_000, reconnectDelayMs = 500 } = {}) {
    this.baseUrl = baseUrl;
    this.maxReconnectDelayMs = maxReconnectDelayMs;
    this.reconnectDelayMs = reconnectDelayMs;
    this.ws = null;
    this.subscriptionNames = [];
    this.connected = false;
    this.closedByUser = false;
    this.onMessage = null;
    this.onStatus = null;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
  }

  get status() {
    return this.connected ? 'connected' : 'disconnected';
  }

  /**
   * Subscribe to one or more stream names (e.g. 'btcusdt@ticker').
   * Re-subscribes automatically on reconnect.
   */
  subscribe(streamNames) {
    const names = Array.isArray(streamNames) ? streamNames : [streamNames];
    for (const n of names) {
      if (n && !this.subscriptionNames.includes(n)) this.subscriptionNames.push(n);
    }
    if (this.connected) this._openSocket();
    else this._openSocket();
    return this;
  }

  /** Subscribe to a user data stream listen key. */
  subscribeUserData(listenKey) {
    this._userData = true;
    this._listenKey = listenKey;
    if (this.connected) this._openSocket();
    else this._openSocket();
    return this;
  }

  close() {
    this.closedByUser = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.terminate();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.connected = false;
  }

  _emitStatus() {
    if (this.onStatus) {
      try {
        this.onStatus({ status: this.status, subscriptions: this.subscriptionNames });
      } catch {
        /* ignore */
      }
    }
  }

  _openSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    let url;
    if (this._userData && this._listenKey) {
      url = `${this.baseUrl}/ws/${this._listenKey}`;
    } else if (this.subscriptionNames.length === 1) {
      url = `${this.baseUrl}/ws/${this.subscriptionNames[0]}`;
    } else {
      url = `${this.baseUrl}/stream?streams=${this.subscriptionNames.join('/')}`;
    }

    logger.debug('Opening Binance websocket', { url: url.replace(/listenKey=\w+/, 'listenKey=***') });
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this._reconnectAttempt = 0;
      logger.info('Binance websocket connected', { streams: this.subscriptionNames.length || 'user-data' });
      this._emitStatus();
    });

    ws.on('pong', () => {
      /* keepalive received — nothing to do */
    });

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      // Server ping -> reply with identical pong payload.
      if (message && message.ping !== undefined) {
        try {
          ws.pong(message.ping);
        } catch {
          /* ignore */
        }
        return;
      }
      if (this.onMessage) {
        try {
          this.onMessage(message);
        } catch (err) {
          logger.error('Binance websocket handler error', { error: err.message });
        }
      }
    });

    ws.on('error', (err) => {
      logger.warn('Binance websocket error', { error: err.message });
    });

    ws.on('close', (code, reason) => {
      this.connected = false;
      this._emitStatus();
      if (this.closedByUser) return;
      logger.warn('Binance websocket closed, reconnecting', { code, reason: reason?.toString() });
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this.closedByUser) return;
    const base = this.reconnectDelayMs * 2 ** this._reconnectAttempt;
    const delay = Math.min(base, this.maxReconnectDelayMs);
    const jitter = Math.random() * Math.min(delay * 0.3, 5000);
    this._reconnectAttempt += 1;
    this._reconnectTimer = setTimeout(() => {
      if (this.closedByUser) return;
      this._openSocket();
    }, delay + jitter);
  }
}

export default BinanceStream;
