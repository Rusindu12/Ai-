import { EventEmitter } from 'node:events';
import { logger } from '../logger.js';

/**
 * Dollar-Cost Averaging bot.
 *
 * Buys a fixed quote amount of a symbol on a fixed interval (e.g. $25 of BTC
 * every hour). Runs against the paper portfolio by default; in live mode it
 * submits market buys through the Binance client.
 */
export class DcaBot extends EventEmitter {
  /**
   * @param {object} opts
   * @param {TradingEngine} opts.engine
   * @param {BinanceClient} opts.client
   */
  constructor({ engine, client }) {
    super();
    this.engine = engine;
    this.client = client;
    this.configs = new Map(); // symbol -> config
    this._timers = new Map();
  }

  /**
   * Schedule DCA for a symbol.
   * @param {string} symbol
   * @param {object} opts { amount, intervalMs, enabled }
   */
  schedule(symbol, { amount = 25, intervalMs = 60 * 60 * 1000, enabled = true } = {}) {
    this.configs.set(symbol.toUpperCase(), { amount, intervalMs, enabled });
    this._restartTimer(symbol.toUpperCase());
    logger.info('DCA scheduled', { symbol, amount, intervalMs });
    return this.configs.get(symbol.toUpperCase());
  }

  _restartTimer(symbol) {
    if (this._timers.has(symbol)) clearInterval(this._timers.get(symbol));
    const cfg = this.configs.get(symbol);
    if (!cfg || !cfg.enabled) return;
    const timer = setInterval(() => this.runOnce(symbol).catch(() => {}), cfg.intervalMs);
    if (timer.unref) timer.unref();
    this._timers.set(symbol, timer);
  }

  enable(symbol) {
    const cfg = this.configs.get(symbol.toUpperCase());
    if (!cfg) throw new Error(`no DCA config for ${symbol}`);
    cfg.enabled = true;
    this._restartTimer(symbol.toUpperCase());
  }

  disable(symbol) {
    const cfg = this.configs.get(symbol.toUpperCase());
    if (!cfg) return;
    cfg.enabled = false;
    if (this._timers.has(symbol.toUpperCase())) clearInterval(this._timers.get(symbol.toUpperCase()));
  }

  /** Execute one DCA purchase. */
  async runOnce(symbol) {
    const cfg = this.configs.get(symbol.toUpperCase());
    if (!cfg || !cfg.enabled) return null;

    const price = this.engine._latestPrices?.[symbol.toUpperCase()];
    if (!price) {
      logger.warn('DCA skipped: no price available', { symbol });
      return null;
    }

    const check = this.engine.risk.evaluateOrder({
      equity: this.engine.portfolio.equity(this.engine._latestPrices || {}),
      symbol: symbol.toUpperCase(),
      positionValue: cfg.amount,
      openPositions: this.engine.portfolio.summary(this.engine._latestPrices || {}).positions.map((p) => ({
        symbol: p.symbol, value: p.value,
      })),
    });
    if (!check.allowed) {
      this.emit('rejected', { symbol, reason: check.reason });
      return null;
    }

    const quantity = cfg.amount / price;
    if (this.engine.mode === 'paper') {
      const trade = this.engine.portfolio.buy(symbol.toUpperCase(), price, quantity);
      this.emit('bought', trade);
      return trade;
    }
    const order = await this.client.placeOrder({
      symbol: symbol.toUpperCase(), side: 'BUY', type: 'MARKET', quantity: Number(quantity.toFixed(6)),
    });
    this.emit('bought', { side: 'BUY', symbol, order, live: true });
    return order;
  }

  list() {
    return [...this.configs.entries()].map(([symbol, cfg]) => ({ symbol, ...cfg }));
  }
}

export default DcaBot;
