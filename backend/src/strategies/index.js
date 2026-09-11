/**
 * Strategy registry — one place to construct and look up every strategy.
 */
import { BaseStrategy } from './base.js';
import { RsiMeanReversionStrategy } from './rsiMeanReversion.js';
import { MacdCrossoverStrategy } from './macdCrossover.js';
import { MaCrossStrategy } from './maCross.js';
import { EnsembleStrategy } from './ensemble.js';

export { BaseStrategy, RsiMeanReversionStrategy, MacdCrossoverStrategy, MaCrossStrategy, EnsembleStrategy };

export function createStrategies() {
  return {
    rsi: new RsiMeanReversionStrategy(),
    macd: new MacdCrossoverStrategy(),
    maCross: new MaCrossStrategy(),
    ensemble: new EnsembleStrategy(),
  };
}

export function buildEnsemble(strategies) {
  return new EnsembleStrategy({ strategies: Object.values(strategies ?? createStrategies()) });
}

export default createStrategies;
