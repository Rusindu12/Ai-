/**
 * Portfolio diversification rules.
 *
 * Prevents concentration risk: caps the number of concurrent open positions and
 * the maximum fraction of the portfolio any single position may represent.
 */

/**
 * Decide whether opening a new position of `newPositionValue` (quote currency)
 * violates the diversification rules.
 *
 * @param {object} opts
 * @param {number} opts.equity total portfolio equity
 * @param {number} opts.newPositionValue value of the proposed position
 * @param {Array<{symbol:string, value:number}>} opts.openPositions existing positions
 * @param {number} [opts.maxOpenPositions=5]
 * @param {number} [opts.maxPortfolioPct=0.1] max % of equity in one position
 * @returns {{ allowed:boolean, reason?:string }}
 */
export function checkDiversification(
  { equity, newPositionValue, openPositions = [] },
  { maxOpenPositions = 5, maxPortfolioPct = 0.1 } = {}
) {
  if (equity <= 0) return { allowed: false, reason: 'equity must be positive' };
  if (newPositionValue <= 0) return { allowed: false, reason: 'position value must be positive' };

  const existingSymbols = new Set(openPositions.map((p) => p.symbol.toUpperCase()));
  const countWouldBecome = existingSymbols.size; // distinct symbols currently open

  const pctOfEquity = newPositionValue / equity;
  if (pctOfEquity > maxPortfolioPct) {
    return {
      allowed: false,
      reason: `position would be ${(pctOfEquity * 100).toFixed(2)}% of equity (max ${(maxPortfolioPct * 100).toFixed(0)}%)`,
    };
  }

  if (countWouldBecome + 1 > maxOpenPositions) {
    return {
      allowed: false,
      reason: `too many open positions (max ${maxOpenPositions})`,
    };
  }

  return { allowed: true };
}

/**
 * Whether adding `symbol` at `value` stays within the max-open-position rule.
 */
export function canOpenPosition(openSymbols, symbol, maxOpenPositions = 5) {
  if (openSymbols.includes(symbol.toUpperCase())) return true; // adding to existing
  return openSymbols.length < maxOpenPositions;
}

export default { checkDiversification, canOpenPosition };
