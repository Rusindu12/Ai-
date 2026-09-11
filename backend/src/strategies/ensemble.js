import { BaseStrategy } from './base.js';
import { RsiMeanReversionStrategy } from './rsiMeanReversion.js';
import { MacdCrossoverStrategy } from './macdCrossover.js';
import { MaCrossStrategy } from './maCross.js';

const SIGNAL_SCORE = { BUY: 1, SELL: -1, HOLD: 0 };

/**
 * Ensemble strategy — blends multiple independent strategies (and, optionally,
 * the AI model's prediction) into a single weighted Buy/Sell/Hold signal.
 *
 * Each sub-strategy votes with its signal weighted by its confidence. The
 * ensemble normalises the total into a score in [-1, 1] and thresholds it.
 */
export class EnsembleStrategy extends BaseStrategy {
  /**
   * @param {object} opts
   * @param {number} [opts.buyThreshold=0.25]
   * @param {number} [opts.sellThreshold=0.25]
   * @param {number} [opts.aiWeight=0.35] weight of the AI signal when present
   * @param {Array<BaseStrategy>} [opts.strategies]
   */
  constructor(opts = {}) {
    super('ensemble');
    this.buyThreshold = opts.buyThreshold ?? 0.25;
    this.sellThreshold = opts.sellThreshold ?? 0.25;
    this.aiWeight = opts.aiWeight ?? 0.35;
    this.strategies =
      opts.strategies ?? [
        new RsiMeanReversionStrategy(),
        new MacdCrossoverStrategy(),
        new MaCrossStrategy(),
      ];
  }

  evaluate(context) {
    const votes = [];
    let weightSum = 0;
    let scoreSum = 0;
    const details = [];

    for (const strategy of this.strategies) {
      const result = strategy.evaluate(context);
      const score = SIGNAL_SCORE[result.signal] ?? 0;
      votes.push({ strategy: strategy.name, ...result });
      if (score !== 0) {
        scoreSum += score * result.confidence;
        weightSum += result.confidence;
      }
      details.push({ strategy: strategy.name, signal: result.signal, confidence: result.confidence });
    }

    // Incorporate AI signal if provided.
    if (context.ai) {
      const ai = context.ai;
      const aiSignal = ai.signal || ai.action || 'HOLD';
      const aiScore = SIGNAL_SCORE[aiSignal] ?? 0;
      const aiConfidence = ai.confidence ?? 0;
      const aiVoteWeight = this.aiWeight;
      votes.push({ strategy: 'ai-model', signal: aiSignal, confidence: aiConfidence });
      details.push({ strategy: 'ai-model', signal: aiSignal, confidence: aiConfidence });
      if (aiScore !== 0 && aiConfidence > 0) {
        scoreSum += aiScore * aiConfidence * aiVoteWeight;
        weightSum += aiConfidence * aiVoteWeight;
      }
    }

    const rawScore = weightSum > 0 ? scoreSum / weightSum : 0;
    const confidence = weightSum > 0 ? Math.min(0.95, Math.abs(rawScore)) : 0;

    let signal = 'HOLD';
    if (rawScore >= this.buyThreshold) signal = 'BUY';
    else if (rawScore <= -this.sellThreshold) signal = 'SELL';

    return {
      signal,
      confidence,
      score: rawScore,
      reason: `ensemble of ${details.length} models: score=${rawScore.toFixed(3)}`,
      votes,
    };
  }
}

export default EnsembleStrategy;
