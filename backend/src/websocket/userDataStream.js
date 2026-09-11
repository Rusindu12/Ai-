import { logger } from '../logger.js';

/**
 * User data stream (listen key) manager.
 *
 * Binance user data streams give us push updates for account balance changes,
 * order fills and `listenKeyExpired` events. Lifecycle:
 *   1. POST /api/v3/userDataStream -> `{ listenKey }` (valid ~60 min)
 *   2. PUT  /api/v3/userDataStream?listenKey=... every 30 min to keep alive
 *   3. On `listenKeyExpired` we close, request a fresh key and re-subscribe.
 */
export class UserDataStream {
  /**
   * @param {object} opts
   * @param {BinanceClient} opts.client  Binance REST client
   * @param {BinanceStream} opts.stream  Binance websocket client
   * @param {number} [opts.keepAliveMs=30 * 60 * 1000]
   */
  constructor({ client, stream, keepAliveMs = 30 * 60 * 1000 }) {
    this.client = client;
    this.stream = stream;
    this.keepAliveMs = keepAliveMs;
    this.listenKey = null;
    this._keepAliveTimer = null;
  }

  get active() {
    return Boolean(this.listenKey);
  }

  async start() {
    const res = await this.client.createListenKey();
    if (!res?.listenKey) throw new Error('Failed to obtain Binance listen key');
    this.listenKey = res.listenKey;
    this.stream.subscribeUserData(this.listenKey);
    this._scheduleKeepAlive();
    logger.info('User data stream started');
    return this.listenKey;
  }

  _scheduleKeepAlive() {
    if (this._keepAliveTimer) clearInterval(this._keepAliveTimer);
    this._keepAliveTimer = setInterval(async () => {
      try {
        await this.client.keepAliveListenKey(this.listenKey);
        logger.debug('User data stream keepalive sent');
      } catch (err) {
        logger.warn('User data stream keepalive failed', { error: err.message });
      }
    }, this.keepAliveMs);
    // Don't let the interval hold the process open.
    if (this._keepAliveTimer.unref) this._keepAliveTimer.unref();
  }

  /** Called when a `listenKeyExpired` frame arrives. */
  async onExpired() {
    logger.warn('User data listen key expired, restarting stream');
    await this.stop();
    await this.start();
  }

  async stop() {
    if (this._keepAliveTimer) clearInterval(this._keepAliveTimer);
    this._keepAliveTimer = null;
    if (this.listenKey) {
      try {
        await this.client.closeListenKey(this.listenKey);
      } catch {
        /* ignore */
      }
    }
    this.listenKey = null;
  }
}

export default UserDataStream;
