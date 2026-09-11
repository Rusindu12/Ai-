/**
 * Portfolio tracking & performance analytics.
 *
 * Tracks cash + positions, computes equity & realised/unrealised P&L, and
 * derives classic performance metrics: Sharpe ratio, win rate, max drawdown,
 * total return.
 */
import { mean, stddev } from '../risk/positionSizing.js';

export class Portfolio {
  /**
   * @param {object} opts
   * @param {number} [opts.startingBalance=10000] paper-trading starting cash
   * @param {string} [opts.baseAsset='USDT']
   */
  constructor({ startingBalance = 10_000, baseAsset = 'USDT' } = {}) {
    this.baseAsset = baseAsset;
    this.cash = startingBalance;
    this.startingBalance = startingBalance;
    /** @type {Map<string, {qty:number, avgPrice:number}>} */
    this.positions = new Map();
    /** @type {Array<object>} */
    this.trades = [];
    /** @type {Array<object>} */
    this.equityCurve = [{ ts: Date.now(), equity: startingBalance }];
  }

  get symbols() {
    return [...this.positions.keys()];
  }

  /** Current equity given live prices. */
  equity(prices) {
    let value = this.cash;
    for (const [symbol, pos] of this.positions) {
      const price = prices[symbol] ?? pos.avgPrice;
      value += pos.qty * price;
    }
    return value;
  }

  /** Mark-to-market P&L (realised + unrealised). */
  pnl(prices) {
    return this.equity(prices) - this.startingBalance;
  }

  pnlPct(prices) {
    if (this.startingBalance <= 0) return 0;
    return this.pnl(prices) / this.startingBalance;
  }

  /** Realise a buy (increase position). */
  buy(symbol, price, quantity, fee = 0.001) {
    const cost = price * quantity;
    const feeAmount = cost * fee;
    if (cost + feeAmount > this.cash) throw new Error('insufficient cash');
    this.cash -= cost + feeAmount;
    const existing = this.positions.get(symbol) || { qty: 0, avgPrice: 0 };
    const newQty = existing.qty + quantity;
    const newAvg =
      existing.qty === 0
        ? price
        : (existing.avgPrice * existing.qty + price * quantity) / newQty;
    this.positions.set(symbol, { qty: newQty, avgPrice: newAvg });
    return this._record('BUY', symbol, price, quantity, feeAmount);
  }

  /** Realise a sell (reduce/close position). */
  sell(symbol, price, quantity, fee = 0.001) {
    const existing = this.positions.get(symbol);
    if (!existing || existing.qty < quantity) throw new Error('insufficient position');
    const proceeds = price * quantity;
    const feeAmount = proceeds * fee;
    this.cash += proceeds - feeAmount;
    const remainingQty = existing.qty - quantity;
    const realizedPnl = (price - existing.avgPrice) * quantity - feeAmount;
    if (remainingQty <= 1e-12) this.positions.delete(symbol);
    else this.positions.set(symbol, { qty: remainingQty, avgPrice: existing.avgPrice });
    return this._record('SELL', symbol, price, quantity, feeAmount, realizedPnl);
  }

  _record(side, symbol, price, quantity, fee, realizedPnl = null) {
    const trade = {
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      side,
      symbol,
      price,
      quantity,
      fee,
      realizedPnl,
      equityAfter: this.equity({ [symbol]: price }),
    };
    this.trades.push(trade);
    return trade;
  }

  /** Append an equity point to the curve (used for metrics & drawdown). */
  track(prices) {
    const eq = this.equity(prices);
    this.equityCurve.push({ ts: Date.now(), equity: eq });
    return eq;
  }

  /** Summary snapshot for the dashboard. */
  summary(prices) {
    const eq = this.equity(prices);
    const closedTrades = this.trades.filter((t) => t.realizedPnl != null);
    return {
      equity: eq,
      cash: this.cash,
      startingBalance: this.startingBalance,
      pnl: eq - this.startingBalance,
      pnlPct: this.pnlPct(prices),
      positions: [...this.positions.entries()].map(([symbol, p]) => ({
        symbol,
        qty: p.qty,
        avgPrice: p.avgPrice,
        price: prices[symbol] ?? p.avgPrice,
        value: p.qty * (prices[symbol] ?? p.avgPrice),
        unrealizedPnl: p.qty * ((prices[symbol] ?? p.avgPrice) - p.avgPrice),
      })),
      openPositions: this.positions.size,
      tradeCount: this.trades.length,
      realizedPnl: closedTrades.reduce((s, t) => s + (t.realizedPnl || 0), 0),
    };
  }

  /** Performance analytics: Sharpe, win rate, max drawdown, total return. */
  performance(prices) {
    const curve = this.equityCurve.map((p) => p.equity);
    const returns = [];
    for (let i = 1; i < curve.length; i++) {
      if (curve[i - 1] > 0) returns.push(curve[i] / curve[i - 1] - 1);
    }
    const mu = mean(returns);
    const sd = stddev(returns);
    const sharpe = sd > 0 ? (mu / sd) * Math.sqrt(365) : 0;

    let peak = -Infinity;
    let maxDD = 0;
    for (const e of curve) {
      peak = Math.max(peak, e);
      if (peak > 0) maxDD = Math.max(maxDD, (peak - e) / peak);
    }

    const closed = this.trades.filter((t) => t.realizedPnl != null);
    const wins = closed.filter((t) => (t.realizedPnl || 0) > 0).length;
    const winRate = closed.length ? wins / closed.length : 0;

    return {
      sharpeRatio: sharpe,
      winRate,
      maxDrawdown: maxDD,
      totalReturn: this.pnlPct(prices),
      trades: closed.length,
      equity: this.equity(prices),
    };
  }

  /** CSV export of the trade history. */
  toCsv() {
    const header = 'id,ts,side,symbol,price,quantity,fee,realizedPnl';
    const rows = this.trades.map((t) =>
      [
        t.id,
        t.ts,
        t.side,
        t.symbol,
        t.price,
        t.quantity,
        t.fee,
        t.realizedPnl ?? '',
      ].join(',')
    );
    return [header, ...rows].join('\n');
  }
}

export default Portfolio;
