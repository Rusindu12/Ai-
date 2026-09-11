import { EventEmitter } from 'node:events';
import { logger } from '../logger.js';
import { createStrategies, EnsembleStrategy } from '../strategies/index.js';
import { RiskManager } from '../risk/index.js';
import { Portfolio } from './portfolio.js';
import { bracketPrices, evaluateTpSlLong, trailingStopLong } from './orders.js';

/**
 * Trading engine — ties together market data, strategy/AI signals, risk
 * management and execution (paper or live).
 *
 * Modes:
 *   - paper: simulated fills against `Portfolio`
 *   - live : real orders via the Binance client (spot, market/limit)
 *   - manual: paused by the user (no new orders, brackets still monitored)
 *
 * Safety: the engine will refuse to trade when the RiskManager's kill switch is
 * armed, and every order is gated by `riskManager.evaluateOrder`.
 */
export class TradingEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('../api/binanceClient.js').BinanceClient} opts.client
   * @param {import('../websocket/streamManager.js').StreamManager} opts.streams
   * @param {import('../ai/client.js').AiClient} [opts.aiClient]
   * @param {RiskManager} [opts.risk]
   * @param {object} [opts.portfolioOpts]
   */
  constructor({ client, streams, aiClient = null, risk = null, portfolioOpts = {} }) {
    super();
    this.client = client;
    this.streams = streams;
    this.aiClient = aiClient;
    this.risk = risk ?? new RiskManager();
    this.portfolio = new Portfolio(portfolioOpts);
    this.mode = 'paper'; // 'paper' | 'live'
    this.autoTrading = false;
    this.manualOverride = false; // user paused the AI
    this.symbols = [];
    /** candle cache: symbol -> interval -> candle array */
    this.candles = new Map();
    /** bracket orders for open positions */
    this.brackets = new Map();
    this.strategies = createStrategies();
    this.ensemble = new EnsembleStrategy({
      strategies: [this.strategies.rsi, this.strategies.macd, this.strategies.maCross],
    });
    this._tickerHandler = (t) => this._onTicker(t);
    this._klineHandler = (k) => this._onKline(k);
  }

  /** Attach to stream events and begin signal evaluation. */
  start({ symbols, mode = 'paper', autoTrading = false } = {}) {
    this.symbols = symbols.map((s) => s.toUpperCase());
    this.mode = mode;
    this.autoTrading = autoTrading;
    this.streams.on('ticker', this._tickerHandler);
    this.streams.on('kline', this._klineHandler);
    this._lastEvaluated = new Map();
    logger.info('Trading engine started', { mode, autoTrading, symbols: this.symbols });
    return this;
  }

  stop() {
    this.streams.off('ticker', this._tickerHandler);
    this.streams.off('kline', this._klineHandler);
    this.autoTrading = false;
    logger.info('Trading engine stopped');
  }

  setAutoTrading(enabled) {
    this.autoTrading = enabled;
    this.emit('autoTrading', enabled);
    logger.info('Auto-trading toggled', { enabled });
  }

  setManualOverride(paused) {
    this.manualOverride = paused;
    this.emit('manualOverride', paused);
    logger.info('Manual override', { paused });
  }

  // ---------- candle history ----------

  _onKline(kline) {
    const { symbol, interval } = kline;
    if (!this.candles.has(symbol)) this.candles.set(symbol, new Map());
    const byInterval = this.candles.get(symbol);
    if (!byInterval.has(interval)) byInterval.set(interval, []);
    const arr = byInterval.get(interval);

    const candle = {
      open: kline.open,
      high: kline.high,
      low: kline.low,
      close: kline.close,
      volume: kline.volume,
      closeTime: kline.closeTime,
    };

    if (arr.length && arr[arr.length - 1].closeTime === kline.closeTime) {
      arr[arr.length - 1] = candle; // update in-progress candle
    } else {
      arr.push(candle);
      if (arr.length > 1000) arr.shift();
    }

    // Evaluate on closed candles.
    if (kline.isClosed && interval === '1m') this._evaluate(symbol);
  }

  _onTicker(ticker) {
    if (!this.symbols.includes(ticker.symbol)) return;
    this._latestPrices = this._latestPrices || {};
    this._latestPrices[ticker.symbol] = ticker.lastPrice;
    this._checkBrackets(ticker.symbol, ticker.lastPrice);
  }

  /** Gather candle context for a symbol (from 1m closes + higher TFs). */
  _buildContext(symbol) {
    const closes1m = (this.candles.get(symbol)?.get('1m') || []).map((c) => c.close);
    const closes = (this.candles.get(symbol)?.get('1m') || []).map((c) => c.close);
    const volumes = (this.candles.get(symbol)?.get('1m') || []).map((c) => c.volume);

    let orderBook = null;
    // Optionally inject depth (available via cache) — engine receives it lazily.
    return { symbol, closes, volumes, orderBook, closes1m, candles: this.candles.get(symbol)?.get('1m') || [] };
  }

  /**
   * Produce the AI signal panel for a symbol (does NOT trade). Returns the
   * ensemble + optional AI prediction.
   */
  async analyze(symbol) {
    const context = this._buildContext(symbol.toUpperCase());
    const ensembleResult = this.ensemble.evaluate(context);

    let ai = null;
    if (this.aiClient) {
      const candlePayload = context.candles.slice(-200).map((c) => ({
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      }));
      ai = await this.aiClient.predict({
        symbol: symbol.toUpperCase(),
        interval: '1m',
        candles: candlePayload,
      });
      if (ai) {
        const withAi = { ...context, ai };
        return { ...ensembleResult, ai, combined: this.ensemble.evaluate(withAi) };
      }
    }
    return ensembleResult;
  }

  /** Main evaluation & execution loop for one symbol. */
  async _evaluate(symbol) {
    const context = this._buildContext(symbol);
    if (context.closes.length < 30) return;

    const result = await this.analyze(symbol);
    const signal = result.combined?.signal ?? result.signal;
    const confidence = result.combined?.confidence ?? result.confidence;

    // Emit the signal panel for the UI.
    this.emit('signal', { symbol, signal, confidence, votes: result.votes, ai: result.ai, ts: Date.now() });

    if (!this.autoTrading || this.manualOverride || this.mode === 'live' && !this.client.hasCredentials) return;
    if (this.risk.killSwitch.blocksTrading) return;
    if (signal === 'HOLD') return;

    const price = this._latestPrices?.[symbol] ?? context.closes[context.closes.length - 1];
    const position = this.portfolio.positions.get(symbol);

    try {
      if (signal === 'BUY' && (!position || position.qty === 0)) {
        await this._openLong(symbol, price, context, confidence);
      } else if (signal === 'SELL' && position && position.qty > 0) {
        await this._closeLong(symbol, price, position.qty, 'ai-signal');
      }
    } catch (err) {
      logger.warn('Trade execution skipped', { symbol, error: err.message });
    }
  }

  async _openLong(symbol, price, context, confidence) {
    const equity = this.portfolio.equity(this._latestPrices || {});
    const sizing = this.risk.sizePosition(equity, context.closes);
    const quantity = sizing.size / price;

    const check = this.risk.evaluateOrder({
      equity,
      symbol,
      positionValue: sizing.size,
      openPositions: this.portfolio.summary(this._latestPrices || {}).positions.map((p) => ({
        symbol: p.symbol, value: p.value,
      })),
    });
    if (!check.allowed) {
      this.emit('orderRejected', { symbol, reason: check.reason });
      return;
    }

    if (this.mode === 'paper') {
      const trade = this.portfolio.buy(symbol, price, quantity);
      this._attachBracket(symbol, price);
      this.emit('trade', trade);
      logger.info('Paper BUY executed', { symbol, price, quantity });
    } else {
      const order = await this.client.placeOrder({
        symbol, side: 'BUY', type: 'MARKET', quantity: Number(quantity.toFixed(6)),
      });
      this.emit('trade', { side: 'BUY', symbol, order, live: true });
      logger.info('Live BUY submitted', { symbol, orderId: order?.orderId });
    }
  }

  async _closeLong(symbol, price, quantity, reason) {
    if (this.mode === 'paper') {
      const trade = this.portfolio.sell(symbol, price, quantity);
      this.brackets.delete(symbol);
      this.emit('trade', trade);
      logger.info('Paper SELL executed', { symbol, price, quantity, reason });
    } else {
      const order = await this.client.placeOrder({
        symbol, side: 'SELL', type: 'MARKET', quantity: Number(quantity.toFixed(6)),
      });
      this.brackets.delete(symbol);
      this.emit('trade', { side: 'SELL', symbol, order, live: true });
      logger.info('Live SELL submitted', { symbol, orderId: order?.orderId, reason });
    }
  }

  /** Attach take-profit / stop-loss / trailing bracket to a fresh position. */
  _attachBracket(symbol, entryPrice, opts = {}) {
    const bracket = bracketPrices(entryPrice, {
      takeProfitPct: opts.takeProfitPct ?? 0.02,
      stopLossPct: opts.stopLossPct ?? 0.01,
      trailPct: opts.trailPct ?? 0.005,
    });
    this.brackets.set(symbol, {
      ...bracket,
      highestPrice: entryPrice,
      stopPrice: bracket.stopLossPrice,
    });
  }

  _checkBrackets(symbol, price) {
    const bracket = this.brackets.get(symbol);
    const position = this.portfolio.positions.get(symbol);
    if (!bracket || !position) return;

    // Trailing stop ratchet (long side).
    const trail = trailingStopLong({
      price,
      highestPrice: bracket.highestPrice,
      trailPct: bracket.trailPct ?? 0,
      currentStopPrice: bracket.stopPrice,
    });
    bracket.highestPrice = trail.highestPrice;
    bracket.stopPrice = Math.max(bracket.stopPrice ?? 0, trail.stopPrice);

    const trigger = evaluateTpSlLong({
      price,
      entryPrice: position.avgPrice,
      takeProfitPrice: bracket.takeProfitPrice,
      stopLossPrice: bracket.stopPrice,
    });

    if (trigger === 'TAKE_PROFIT') {
      this._closeLong(symbol, price, position.qty, 'take-profit');
      this.emit('bracketTriggered', { symbol, trigger: 'TAKE_PROFIT', price });
    } else if (trigger === 'STOP_LOSS') {
      this._closeLong(symbol, price, position.qty, 'stop-loss');
      this.emit('bracketTriggered', { symbol, trigger: 'STOP_LOSS', price });
    }
  }

  /** Emergency kill: close every position at market. */
  async killAll() {
    const prices = this._latestPrices || {};
    const results = [];
    for (const [symbol, pos] of [...this.portfolio.positions]) {
      const price = prices[symbol] ?? pos.avgPrice;
      try {
        await this._closeLong(symbol, price, pos.qty, 'kill-switch');
        results.push({ symbol, closed: true });
      } catch (err) {
        results.push({ symbol, closed: false, error: err.message });
      }
    }
    this.risk.killSwitch.trigger('manual kill-all');
    return results;
  }
}

export default TradingEngine;
