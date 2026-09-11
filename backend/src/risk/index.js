import { config } from '../config.js';
import { KillSwitch } from './killSwitch.js';
import { DailyLossLimit, drawdown, maxPositionSize, maxPortfolioSize, isDrawdownBreached } from './limits.js';
import { checkDiversification } from './diversification.js';
import { realizedVolatility, positionSizeByVolatility } from './positionSizing.js';
import { logger } from '../logger.js';

/**
 * RiskManager — single entrypoint the trading engine consults before every
 * order. Aggregates position-size limits, diversification rules, the daily loss
 * limit, drawdown guard and the emergency kill switch.
 */
export class RiskManager {
  constructor(opts = {}) {
    this.maxPositionPct = opts.maxPositionPct ?? config.risk.maxPositionPct;
    this.maxPortfolioPct = opts.maxPortfolioPct ?? config.risk.maxPortfolioPct;
    this.dailyLossLimitPct = opts.dailyLossLimitPct ?? config.risk.dailyLossLimitPct;
    this.maxDrawdownPct = opts.maxDrawdownPct ?? config.risk.maxDrawdownPct;
    this.maxOpenPositions = opts.maxOpenPositions ?? config.risk.maxOpenPositions;

    this.killSwitch = new KillSwitch();
    this.dailyLoss = new DailyLossLimit({
      limitPct: this.dailyLossLimitPct,
      startEquity: 0,
    });
    this.peakEquity = 0;
    this._seeded = false;
  }

  /** Update equity-based risk state on each portfolio valuation. */
  updateEquity(equity) {
    if (!this._seeded) {
      this.dailyLoss.reset(equity);
      this.peakEquity = equity;
      this._seeded = true;
    }
    this.peakEquity = Math.max(this.peakEquity, equity);
    const daily = this.dailyLoss.evaluate(equity);

    // Auto-trigger the kill switch on hard limit breaches.
    if (daily.breached) {
      this.killSwitch.trigger(`daily loss limit exceeded (${(daily.lossPct * 100).toFixed(2)}%)`);
    }
    if (isDrawdownBreached(this.peakEquity, equity, this.maxDrawdownPct)) {
      this.killSwitch.trigger(`max drawdown exceeded (${(this.maxDrawdownPct * 100).toFixed(0)}%)`);
    }
    return this.snapshot();
  }

  /**
   * Evaluate whether an order may be placed.
   *
   * @param {object} req
   * @param {number} req.equity portfolio equity
   * @param {string} req.symbol
   * @param {number} req.positionValue quote-currency value of the order
   * @param {Array<{symbol:string, value:number}>} [req.openPositions]
   * @param {boolean} [req.isClosing=false] closing trades bypass most checks
   * @returns {{ allowed:boolean, reason?:string }}
   */
  evaluateOrder({ equity, symbol, positionValue, openPositions = [], isClosing = false }) {
    if (this.killSwitch.blocksTrading && !isClosing) {
      return { allowed: false, reason: `kill switch active: ${this.killSwitch.reason}` };
    }

    // Closing trades are always allowed (risk reduction).
    if (isClosing) return { allowed: true };

    if (equity <= 0) return { allowed: false, reason: 'no equity' };

    if (this.dailyLoss.breached) {
      return { allowed: false, reason: 'daily loss limit reached — trading halted for today' };
    }

    if (positionValue > maxPositionSize(equity, this.maxPositionPct)) {
      return {
        allowed: false,
        reason: `position exceeds max single-position size (${(this.maxPositionPct * 100).toFixed(1)}% of equity)`,
      };
    }

    const div = checkDiversification(
      { equity, newPositionValue: positionValue, openPositions },
      { maxOpenPositions: this.maxOpenPositions, maxPortfolioPct: this.maxPortfolioPct }
    );
    if (!div.allowed) return div;

    return { allowed: true };
  }

  /**
   * Volatility-aware position sizing for the AI/strategy layer.
   * @param {number} equity
   * @param {number[]} closes recent closes
   */
  sizePosition(equity, closes) {
    const vol = realizedVolatility(closes);
    const { size, fraction } = positionSizeByVolatility(equity, vol, {
      targetVol: config.risk.volatilityTarget,
      maxPct: this.maxPositionPct,
    });
    return { size, fraction, volatility: vol };
  }

  snapshot() {
    const { drawdownPct } = drawdown(this.peakEquity, this.dailyLoss.lowestEquity > 0 ? this.dailyLoss.lowestEquity : this.peakEquity);
    return {
      killSwitch: this.killSwitch.status(),
      dailyLoss: this.dailyLoss.status(),
      peakEquity: this.peakEquity,
      drawdownPct,
      maxPositionPct: this.maxPositionPct,
      maxPortfolioPct: this.maxPortfolioPct,
      maxOpenPositions: this.maxOpenPositions,
      maxPortfolioSize: maxPortfolioSize(this.peakEquity, this.maxPortfolioPct),
    };
  }
}

export default RiskManager;
