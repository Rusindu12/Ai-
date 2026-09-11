/**
 * Trading limits: max position size, daily loss limit, max drawdown guard.
 * Pure, deterministic helpers — no I/O — so they can be unit tested easily.
 */

/**
 * Current drawdown of `equity` versus the running peak.
 * @returns {{ drawdownPct:number, peak:number }}
 */
export function drawdown(peak, equity) {
  if (peak <= 0) return { drawdownPct: 0, peak: Math.max(peak, equity) };
  const dd = (peak - equity) / peak;
  return { drawdownPct: Math.max(0, dd), peak };
}

/**
 * Daily-loss tracker. Seed with the equity at the start of the trading day;
 * call `evaluate` with the current equity to know whether the daily loss limit
 * has been breached.
 */
export class DailyLossLimit {
  /**
   * @param {object} opts
   * @param {number} opts.limitPct e.g. 0.03 (3% of start-of-day equity)
   * @param {number} opts.startEquity equity at day start
   */
  constructor({ limitPct = 0.03, startEquity = 0 }) {
    this.limitPct = limitPct;
    this.startEquity = startEquity;
    this.lowestEquity = startEquity;
  }

  /** Register the current equity and return the loss state. */
  evaluate(equity) {
    this.lowestEquity = Math.min(this.lowestEquity, equity);
    return this.status();
  }

  get lossAmount() {
    return this.startEquity - this.lowestEquity;
  }

  get lossPct() {
    if (this.startEquity <= 0) return 0;
    return this.lossAmount / this.startEquity;
  }

  get breached() {
    return this.lossPct >= this.limitPct;
  }

  /** Remaining loss budget in quote currency (>= 0). */
  get remainingBudget() {
    const budget = this.startEquity * this.limitPct;
    return Math.max(0, budget - this.lossAmount);
  }

  status() {
    return {
      breached: this.breached,
      lossPct: this.lossPct,
      lossAmount: this.lossAmount,
      remainingBudget: this.remainingBudget,
      startEquity: this.startEquity,
      limitPct: this.limitPct,
    };
  }

  reset(startEquity) {
    this.startEquity = startEquity;
    this.lowestEquity = startEquity;
  }
}

/** Max single-position size in quote currency. */
export function maxPositionSize(equity, maxPositionPct = 0.05) {
  return equity * maxPositionPct;
}

/** Max total portfolio exposure in quote currency. */
export function maxPortfolioSize(equity, maxPortfolioPct = 0.1) {
  return equity * maxPortfolioPct;
}

/** Whether the portfolio drawdown has exceeded the guard threshold. */
export function isDrawdownBreached(peak, equity, maxDrawdownPct = 0.2) {
  const { drawdownPct } = drawdown(peak, equity);
  return drawdownPct >= maxDrawdownPct;
}

export default {
  drawdown,
  DailyLossLimit,
  maxPositionSize,
  maxPortfolioSize,
  isDrawdownBreached,
};
