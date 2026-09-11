/**
 * Order automation helpers — take-profit / stop-loss / trailing stop logic.
 * Pure functions, fully unit tested.
 */

/**
 * Evaluate take-profit / stop-loss for a long position.
 * @param {object} o
 * @param {number} o.price current price
 * @param {number} o.entryPrice average entry
 * @param {number} [o.takeProfitPrice]
 * @param {number} [o.stopLossPrice]
 * @returns {'TAKE_PROFIT'|'STOP_LOSS'|null}
 */
export function evaluateTpSlLong({ price, entryPrice, takeProfitPrice, stopLossPrice }) {
  if (takeProfitPrice && price >= takeProfitPrice) return 'TAKE_PROFIT';
  if (stopLossPrice && price <= stopLossPrice) return 'STOP_LOSS';
  return null;
}

/** Same for a short position (mirror). */
export function evaluateTpSlShort({ price, entryPrice, takeProfitPrice, stopLossPrice }) {
  if (takeProfitPrice && price <= takeProfitPrice) return 'TAKE_PROFIT';
  if (stopLossPrice && price >= stopLossPrice) return 'STOP_LOSS';
  return null;
}

/**
 * Trailing stop. Returns the updated stop price for a long position that
 * trails `trailPct` below the highest price seen so far.
 * @param {object} o
 * @param {number} o.price current price
 * @param {number} o.highestPrice highest price since entry
 * @param {number} o.trailPct trailing distance, e.g. 0.02 (2%)
 * @param {number} [o.currentStopPrice]
 * @returns {{ stopPrice:number, highestPrice:number, triggered:boolean }}
 */
export function trailingStopLong({ price, highestPrice, trailPct, currentStopPrice = null }) {
  const peak = Math.max(highestPrice, price);
  let stopPrice = peak * (1 - trailPct);
  if (currentStopPrice != null) stopPrice = Math.max(stopPrice, currentStopPrice);
  return { stopPrice, highestPrice: peak, triggered: price <= stopPrice };
}

/**
 * Convert a take-profit / stop-loss preference (in % from entry) into absolute
 * prices.
 * @param {number} entryPrice
 * @param {object} [opts] { takeProfitPct?, stopLossPct?, trailPct? }
 */
export function bracketPrices(entryPrice, { takeProfitPct = null, stopLossPct = null, trailPct = null } = {}) {
  return {
    takeProfitPrice: takeProfitPct != null ? entryPrice * (1 + takeProfitPct) : null,
    stopLossPrice: stopLossPct != null ? entryPrice * (1 - stopLossPct) : null,
    trailPct,
  };
}

export default { evaluateTpSlLong, evaluateTpSlShort, trailingStopLong, bracketPrices };
