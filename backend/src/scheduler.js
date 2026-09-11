import { logger } from './logger.js';

/**
 * Model retraining scheduler.
 *
 * On a daily interval (configurable via AI_RETRAIN_INTERVAL_MS) it collects the
 * recent 1m candles the stream manager has accumulated, hands them to the
 * Python AI service (`POST /retrain`) and logs the outcome. The AI service
 * re-fits the RandomForest ensemble and persists the new weights.
 */
export function startDailyRetrain({ aiClient, engine, intervalMs = 24 * 60 * 60 * 1000 }) {
  if (!aiClient) return null;

  const retrain = async () => {
    try {
      let trained = 0;
      for (const [symbol, byInterval] of engine.candles.entries()) {
        const candles = byInterval.get('1m') || [];
        if (candles.length < 100) continue;
        const payload = {
          symbol,
          interval: '1m',
          candles: candles.slice(-500).map((c) => ({
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
          })),
        };
        const res = await aiClient.retrain(payload);
        if (res?.ok) trained += 1;
      }
      logger.info('Model retraining completed', { modelsTrained: trained });
    } catch (err) {
      logger.warn('Model retraining failed', { error: err.message });
    }
  };

  const timer = setInterval(retrain, intervalMs);
  if (timer.unref) timer.unref();
  logger.info('Retrain scheduler started', { intervalMs });
  return { stop: () => clearInterval(timer), retrain };
}

export default startDailyRetrain;
