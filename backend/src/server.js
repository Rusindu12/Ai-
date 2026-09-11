import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Application entrypoint.
 */
async function main() {
  const { server, engine } = await createApp({
    mode: process.env.TRADING_MODE === 'live' ? 'live' : 'paper',
    autoTrading: process.env.AUTO_TRADING === 'true',
  });

  server.listen(config.port, '0.0.0.0', () => {
    logger.info(`Backend listening on port ${config.port}`, {
      mode: engine.mode,
      binance: config.binance.testnet ? 'testnet' : 'live',
      hasCredentials: config.binance.apiKey ? 'yes' : 'no (paper only)',
    });
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received, shutting down`);
    try {
      engine.stop();
      await engine.streams.stop();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
