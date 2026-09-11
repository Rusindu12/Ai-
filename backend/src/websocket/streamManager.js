import { EventEmitter } from 'node:events';
import { BinanceStream } from './binanceStream.js';
import { UserDataStream } from './userDataStream.js';
import {
  normalizeKline,
  normalizeTicker,
  normalizeDepth,
  normalizeUserData,
  parseStreamName,
} from './handlers.js';
import { logger } from '../logger.js';
import { cache, cacheJson } from '../db/cache.js';

/**
 * Stream manager — the heart of the real-time layer.
 *
 * Responsibilities:
 *   1. Subscribe to Binance public streams (ticker / kline / depth) for a set
 *      of symbols and intervals.
 *   2. Manage the user-data stream (order fills, balance updates).
 *   3. Normalise every incoming frame and:
 *        a. store the latest value in the cache (Redis),
 *        b. broadcast to Socket.io rooms for the frontend,
 *        c. emit an internal event for strategies / risk engine.
 */
export class StreamManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {BinanceClient} opts.client REST client (for user-data stream)
   * @param {string} opts.wsBaseUrl
   * @param {import('socket.io').Server} [opts.io] Socket.io server instance
   */
  constructor({ client, wsBaseUrl, io = null }) {
    super();
    this.client = client;
    this.io = io;
    this.stream = new BinanceStream({ baseUrl: wsBaseUrl });
    this.userData = new UserDataStream({ client, stream: this.stream });
    this.symbols = [];
    this.intervals = ['1m', '15m', '1h', '1d'];
    this.depthLevels = 20;
    this.started = false;

    this.stream.onMessage = (message) => this._dispatch(message);
    this.stream.onStatus = (status) => this.emit('status', status);
  }

  /** Build the list of stream names to subscribe to. */
  _buildStreamNames() {
    const names = [];
    for (const symbol of this.symbols) {
      const s = symbol.toLowerCase();
      names.push(`${s}@ticker`);
      for (const interval of this.intervals) names.push(`${s}@kline_${interval}`);
      names.push(`${s}@depth${this.depthLevels}@100ms`);
    }
    return names;
  }

  /**
   * Start market-data subscriptions.
   * @param {string[]} symbols e.g. ['BTCUSDT','ETHUSDT']
   * @param {object} [opts] { intervals?, depthLevels? }
   */
  start(symbols, opts = {}) {
    this.symbols = symbols.map((s) => s.toUpperCase());
    if (opts.intervals) this.intervals = opts.intervals;
    if (opts.depthLevels) this.depthLevels = opts.depthLevels;
    this.stream.subscribe(this._buildStreamNames());
    this.started = true;
    logger.info('Market streams started', { symbols: this.symbols, intervals: this.intervals });
    return this;
  }

  /** Start the user-data stream (requires API credentials). */
  async startUserData() {
    if (!this.client.hasCredentials) {
      logger.warn('Skipping user-data stream: no Binance API credentials');
      return null;
    }
    return this.userData.start();
  }

  stop() {
    this.stream.close();
    return this.userData.stop();
  }

  /**
   * Publish an already-normalised event: cache it, broadcast to Socket.io and
   * emit internally. Also used by the offline demo feed so synthetic data flows
   * through the exact same pipeline as live Binance data.
   */
  publish(normalized) {
    if (!normalized) return;
    this._cache(normalized);
    this._broadcast(normalized);
    this.emit('data', normalized);
    this.emit(normalized.type, normalized);
  }

  /** Central dispatcher for every raw frame. */
  _dispatch(message) {
    // Combined streams wrap the payload: { stream, data }.
    const streamName = message?.stream || null;
    const data = message?.data ?? message;

    if (!streamName) {
      // User-data stream frames are NOT wrapped in { stream, data }.
      const normalized = normalizeUserData(data);
      if (normalized?.type === 'listenKeyExpired') this.userData.onExpired().catch(() => {});
      this.publish(normalized);
      return;
    }

    const parsed = parseStreamName(streamName);
    if (!parsed) return;

    if (parsed.type === 'ticker') {
      this.publish(normalizeTicker(data));
    } else if (parsed.type === 'kline') {
      this.publish(normalizeKline(data));
    } else if (parsed.type === 'depth') {
      this.publish(normalizeDepth(data, parsed.symbol));
    }
  }

  async _cache(normalized) {
    try {
      if (normalized.type === 'ticker') {
        await cacheJson.set(`ticker:${normalized.symbol}`, normalized, 5_000);
      } else if (normalized.type === 'kline') {
        await cacheJson.set(
          `kline:${normalized.symbol}:${normalized.interval}`,
          normalized,
          2 * 60_000
        );
      } else if (normalized.type === 'depth') {
        await cacheJson.set(`depth:${normalized.symbol}`, normalized, 5_000);
      } else if (normalized.type === 'executionReport' || normalized.type === 'balanceUpdate') {
        await cacheJson.set(`event:${Date.now()}:${Math.random()}`, normalized, 60_000);
      }
    } catch (err) {
      logger.warn('Cache write failed', { error: err.message });
    }
  }

  _broadcast(normalized) {
    if (!this.io) return;
    const room = `${normalized.type}:${normalized.symbol ?? ''}`.replace(/:\s*$/, '');
    this.io.to(room).emit('market', normalized);
    this.io.emit(normalized.type, normalized);
  }
}

export default StreamManager;
