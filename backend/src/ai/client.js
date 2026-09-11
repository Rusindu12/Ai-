import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * AI service client — bridges the Node trading engine to the Python ML service
 * (`/ai` FastAPI app) which serves the LSTM price-prediction model and the
 * ensemble/RF strategy models.
 *
 * If the Python service is unavailable, `predict` degrades gracefully by
 * returning `null` so the engine falls back to the deterministic technical
 * ensemble (the platform remains fully functional without the ML service).
 */
export class AiClient {
  constructor({ baseUrl = config.ai.serviceUrl, timeoutMs = 5000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async _post(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`AI service ${path} -> HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Request a prediction from the AI service.
   * @param {object} payload { symbol, interval, candles:[{open,high,low,close,volume}], orderBook?:{bids,asks} }
   * @returns {Promise<object|null>} { signal, confidence, predictedPrice, ... } or null on failure
   */
  async predict(payload) {
    try {
      return await this._post('/predict', payload);
    } catch (err) {
      logger.warn('AI service unavailable, falling back to technical ensemble', { error: err.message });
      return null;
    }
  }

  async health() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async retrain(payload = {}) {
    try {
      return await this._post('/retrain', payload);
    } catch (err) {
      logger.warn('AI retrain request failed', { error: err.message });
      return null;
    }
  }
}

export default AiClient;
