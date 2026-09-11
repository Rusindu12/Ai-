import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { Server } from 'socket.io';

import { config } from './config.js';
import { logger } from './logger.js';
import { store } from './db/store.js';
import { BinanceClient } from './api/binanceClient.js';
import { StreamManager } from './websocket/streamManager.js';
import { AiClient } from './ai/client.js';
import { TradingEngine } from './trading/engine.js';
import { DcaBot } from './trading/dca.js';
import { AlertService } from './services/alerts.js';

import { authRouter } from './api/routes/auth.js';
import { marketRouter } from './api/routes/market.js';
import { tradingRouter } from './api/routes/trading.js';
import { startDailyRetrain } from './scheduler.js';
import { startDemoFeed, isDemoEnabled } from './demo/feed.js';

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

/**
 * Build the full application: Binance client, streams, AI client, trading
 * engine, DCA bot, alerts, Express app and Socket.io server.
 */
export async function createApp({ symbols = DEFAULT_SYMBOLS, autoTrading = false, mode = 'paper' } = {}) {
  await store.init();

  // ---- Binance API + realtime streams ----
  const client = new BinanceClient();
  await client.syncTime().catch(() => {});

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    // Reflect the request origin so the app works behind any reverse proxy /
    // preview host. Tighten to `config.corsOrigins` for a locked-down deploy.
    cors: { origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, methods: ['GET', 'POST'] },
  });

  const streams = new StreamManager({ client, wsBaseUrl: config.binance.wsBaseUrl, io });
  const aiClient = new AiClient();
  const engine = new TradingEngine({ client, streams, aiClient });
  const dca = new DcaBot({ engine, client });
  const alerts = new AlertService();

  // ---- Express middleware ----
  app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins }));
  app.use(express.json({ limit: '1mb' }));

  // ---- Health / status ----
  app.get('/api/health', async (req, res) =>
    res.json({
      ok: true,
      ts: Date.now(),
      streams: streams.stream.status,
      aiConnected: Boolean(await aiClient.health()),
      mode,
      autoTrading: engine.autoTrading,
    })
  );

  // ---- Webhooks (external signals) ----
  app.post('/api/webhook', express.json(), async (req, res) => {
    const { symbol, side, quantity } = req.body || {};
    if (!symbol || !side || !quantity) return res.status(400).json({ error: 'symbol, side, quantity required' });
    const currentPrice = engine._latestPrices?.[String(symbol).toUpperCase()];
    if (!currentPrice) return res.status(400).json({ error: 'no live price for symbol' });
    const trade =
      String(side).toUpperCase() === 'BUY'
        ? engine.portfolio.buy(String(symbol).toUpperCase(), currentPrice, Number(quantity))
        : engine.portfolio.sell(String(symbol).toUpperCase(), currentPrice, Number(quantity));
    alerts.trade(trade).catch(() => {});
    return res.json({ ok: true, trade });
  });

  // ---- Routers ----
  app.use('/api/auth', authRouter());
  app.use('/api/market', marketRouter(client));
  app.use('/api/trading', tradingRouter({ engine, dca, alerts, client }));

  // 404 + error handler
  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  app.use((err, req, res, _next) => {
    logger.error('Unhandled error', { error: err.message });
    res.status(500).json({ error: 'internal server error' });
  });

  // ---- Socket.io bridge ----
  io.on('connection', (socket) => {
    logger.debug('Socket.io client connected', { id: socket.id });

    socket.on('subscribe', (topics = []) => {
      for (const topic of topics) socket.join(String(topic));
    });
    socket.on('unsubscribe', (topics = []) => {
      for (const topic of topics) socket.leave(String(topic));
    });
  });

  // ---- Wire the trading engine to Socket.io + alerts ----
  engine.on('signal', (signal) => {
    io.emit('signal', signal);
    if (signal.signal !== 'HOLD') alerts.signal(signal).catch(() => {});
  });
  engine.on('trade', (trade) => {
    io.emit('trade', trade);
    alerts.trade(trade).catch(() => {});
    store.recordTrade({ ...trade, userId: null }).catch(() => {});
  });
  engine.on('bracketTriggered', (evt) => {
    io.emit('bracket', evt);
    alerts.risk(`${evt.symbol} ${evt.trigger} @ ${evt.price}`).catch(() => {});
  });
  engine.on('orderRejected', (evt) => {
    io.emit('orderRejected', evt);
    alerts.risk(`order rejected: ${evt.reason}`).catch(() => {});
  });

  // ---- Start market streams + engine ----
  streams.start(symbols);
  if (client.hasCredentials) await streams.startUserData().catch(() => {});
  engine.start({ symbols, mode, autoTrading });

  // ---- Offline demo feed (auto-starts only if Binance can't connect) ----
  let demoFeed = null;
  if (isDemoEnabled()) {
    const DEMO_GRACE_MS = Number(process.env.OFFLINE_DEMO_GRACE_MS || 4000);
    const demoTimer = setTimeout(() => {
      if (!streams.stream.connected) {
        demoFeed = startDemoFeed({ streams, symbols });
      }
    }, DEMO_GRACE_MS);
    if (demoTimer.unref) demoTimer.unref();
    // Stop the demo the moment a real Binance stream connects.
    streams.on('status', ({ status }) => {
      if (status === 'connected' && demoFeed) {
        demoFeed.stop();
        demoFeed = null;
        logger.info('Binance stream connected — offline demo feed stopped');
      }
    });
  }

  // ---- Model retraining scheduler (daily) ----
  const retrainScheduler = startDailyRetrain({
    aiClient,
    engine,
    intervalMs: Number(process.env.AI_RETRAIN_INTERVAL_MS || 24 * 60 * 60 * 1000),
  });

  return { app, server, io, client, streams, engine, dca, alerts, aiClient, retrainScheduler };
}

export default createApp;
