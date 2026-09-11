import { Router } from 'express';
import { cache, cacheJson } from '../../db/cache.js';
import { KLINE_INTERVALS } from '../../websocket/handlers.js';
import { getDemoMarket, isDemoEnabled } from '../../demo/feed.js';

/**
 * Market data routes. Public endpoints proxy to Binance and are cached in
 * Redis (TTL per data type) to reduce load and respect rate limits.
 */
export function marketRouter(client) {
  const router = Router();

  const validateSymbol = (symbol) =>
    typeof symbol === 'string' && /^[A-Z0-9]{5,20}$/i.test(symbol) ? symbol.toUpperCase() : null;

  // GET /api/market/klines?symbol=BTCUSDT&interval=1m&limit=200
  router.get('/klines', async (req, res) => {
    const symbol = validateSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ error: 'valid symbol required' });
    const interval = KLINE_INTERVALS.includes(req.query.interval) ? req.query.interval : '1m';
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));

    const key = `rest:kline:${symbol}:${interval}:${limit}`;
    const cached = await cacheJson.get(key);
    if (cached) return res.json(cached);

    try {
      const raw = await client.klines(symbol, interval, limit);
      const klines = raw.map((k) => ({
        openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]),
        close: parseFloat(k[4]), volume: parseFloat(k[5]), closeTime: k[6],
        quoteVolume: parseFloat(k[7]), trades: k[8],
      }));
      await cacheJson.set(key, { symbol, interval, klines }, interval === '1m' ? 15_000 : 60_000);
      return res.json({ symbol, interval, klines });
    } catch (err) {
      // Offline demo fallback: serve synthetic candles when Binance is unreachable.
      if (isDemoEnabled()) {
        const raw = getDemoMarket([symbol]).klines(symbol, interval, limit);
        const klines = raw.map((k) => ({
          openTime: k[0], open: k[1], high: k[2], low: k[3],
          close: k[4], volume: k[5], closeTime: k[6], quoteVolume: k[7], trades: k[8],
        }));
        return res.json({ symbol, interval, klines, demo: true });
      }
      return res.status(502).json({ error: err.message });
    }
  });

  // GET /api/market/tickers
  router.get('/tickers', async (req, res) => {
    try {
      const rows = await client.ticker24h();
      return res.json(rows);
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  });

  // GET /api/market/orderbook?symbol=BTCUSDT&limit=100
  router.get('/orderbook', async (req, res) => {
    const symbol = validateSymbol(req.query.symbol);
    if (!symbol) return res.status(400).json({ error: 'valid symbol required' });
    const limit = Math.min(500, Math.max(5, Number(req.query.limit) || 100));
    const key = `rest:depth:${symbol}:${limit}`;
    const cached = await cacheJson.get(key);
    if (cached) return res.json(cached);
    try {
      const book = await client.orderBook(symbol, limit);
      const out = {
        symbol,
        lastUpdateId: book.lastUpdateId,
        bids: book.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
        asks: book.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
      };
      await cacheJson.set(key, out, 5_000);
      return res.json(out);
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  });

  // GET /api/market/latest — latest cached ticker/depth for the dashboard
  router.get('/latest', async (req, res) => {
    const symbols = String(req.query.symbols || '')
      .split(',')
      .map((s) => validateSymbol(s))
      .filter(Boolean);
    const out = {};
    for (const symbol of symbols) {
      out[symbol] = {
        ticker: await cacheJson.get(`ticker:${symbol}`),
        depth: await cacheJson.get(`depth:${symbol}`),
      };
    }
    return res.json(out);
  });

  // GET /api/market/ping
  router.get('/ping', async (_req, res) => {
    try {
      await client.ping();
      return res.json({ ok: true });
    } catch {
      return res.status(502).json({ ok: false });
    }
  });

  return router;
}

export default marketRouter;
