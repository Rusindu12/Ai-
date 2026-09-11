import { Router } from 'express';
import { requireAuth } from '../../security/jwt.js';

/**
 * Trading routes: portfolio state, manual orders, AI signals, auto-trading
 * controls, DCA, kill switch and CSV export.
 */
export function tradingRouter(ctx) {
  const { engine, dca, alerts, client } = ctx;
  const router = Router();

  const prices = () => engine._latestPrices || {};

  // GET /api/trading/portfolio
  router.get('/portfolio', requireAuth, (req, res) => {
    return res.json(engine.portfolio.summary(prices()));
  });

  // GET /api/trading/performance
  router.get('/performance', requireAuth, (req, res) => {
    return res.json(engine.portfolio.performance(prices()));
  });

  // GET /api/trading/trades
  router.get('/trades', requireAuth, (req, res) => {
    return res.json(engine.portfolio.trades);
  });

  // GET /api/trading/trades.csv
  router.get('/trades.csv', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="trades.csv"');
    return res.send(engine.portfolio.toCsv());
  });

  // GET /api/trading/signal?symbol=BTCUSDT
  router.get('/signal', requireAuth, async (req, res) => {
    const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
    const result = await engine.analyze(symbol);
    return res.json(result);
  });

  // POST /api/trading/order  { symbol, side, type, quantity, price? }
  router.post('/order', requireAuth, async (req, res) => {
    const { symbol, side, type = 'MARKET', quantity, price } = req.body || {};
    if (!symbol || !quantity) return res.status(400).json({ error: 'symbol and quantity required' });
    const currentPrice = prices()[String(symbol).toUpperCase()] ?? price;
    if (!currentPrice) return res.status(400).json({ error: 'no price available for symbol' });

    const isClosing = String(side).toUpperCase() === 'SELL';
    const check = engine.risk.evaluateOrder({
      equity: engine.portfolio.equity(prices()),
      symbol: String(symbol).toUpperCase(),
      positionValue: Number(quantity) * currentPrice,
      openPositions: engine.portfolio.summary(prices()).positions.map((p) => ({ symbol: p.symbol, value: p.value })),
      isClosing,
    });
    if (!check.allowed) return res.status(403).json({ error: check.reason });

    try {
      let trade;
      if (engine.mode === 'paper') {
        const sideU = String(side).toUpperCase();
        trade =
          sideU === 'BUY'
            ? engine.portfolio.buy(String(symbol).toUpperCase(), currentPrice, Number(quantity))
            : engine.portfolio.sell(String(symbol).toUpperCase(), currentPrice, Number(quantity));
        if (sideU === 'BUY') engine._attachBracket(String(symbol).toUpperCase(), currentPrice);
      } else {
        trade = await client.placeOrder({
          symbol: String(symbol).toUpperCase(),
          side: String(side).toUpperCase(),
          type: String(type).toUpperCase(),
          quantity: Number(quantity),
          price: price ? Number(price) : undefined,
        });
      }
      engine.emit('trade', trade);
      alerts.trade(trade).catch(() => {});
      return res.json(trade);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  // GET /api/trading/autotrading  |  POST { enabled }
  router.get('/autotrading', requireAuth, (req, res) =>
    res.json({ enabled: engine.autoTrading, manualOverride: engine.manualOverride, mode: engine.mode })
  );
  router.post('/autotrading', requireAuth, (req, res) => {
    const { enabled, manualOverride } = req.body || {};
    if (typeof enabled === 'boolean') engine.setAutoTrading(enabled);
    if (typeof manualOverride === 'boolean') engine.setManualOverride(manualOverride);
    return res.json({ enabled: engine.autoTrading, manualOverride: engine.manualOverride });
  });

  // POST /api/trading/kill — emergency kill switch (close all + halt)
  router.post('/kill', requireAuth, async (req, res) => {
    const results = await engine.killAll();
    alerts.risk('KILL SWITCH engaged — all positions closed').catch(() => {});
    return res.json({ triggered: true, results });
  });
  router.post('/kill/reset', requireAuth, (req, res) => {
    engine.risk.killSwitch.reset();
    return res.json(engine.risk.killSwitch.status());
  });
  router.get('/kill', requireAuth, (req, res) => res.json(engine.risk.killSwitch.status()));

  // DCA — GET /api/trading/dca | POST { symbol, amount, intervalMs, enabled }
  router.get('/dca', requireAuth, (req, res) => res.json(dca.list()));
  router.post('/dca', requireAuth, (req, res) => {
    const { symbol, amount, intervalMs, enabled } = req.body || {};
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const cfg = dca.schedule(String(symbol).toUpperCase(), { amount, intervalMs, enabled });
    return res.json(cfg);
  });

  // GET /api/trading/risk — risk manager snapshot
  router.get('/risk', requireAuth, (req, res) => res.json(engine.risk.snapshot()));

  return router;
}

export default tradingRouter;
