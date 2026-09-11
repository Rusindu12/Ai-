import 'dotenv/config';

/**
 * Centralised configuration. Every environment variable is read here so the
 * rest of the codebase never touches `process.env` directly.
 */

const bool = (v, fallback = false) => {
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const csv = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: num(process.env.PORT, 4000),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  // Defaults to permissive ('*') so it works behind any preview host / reverse
  // proxy. Set CORS_ORIGINS to a comma-separated list to lock it down.
  corsOrigins: csv(process.env.CORS_ORIGINS || '*'),

  // Auth
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // Database / cache
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',

  // Binance
  binance: {
    testnet: bool(process.env.BINANCE_TESTNET, false),
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    ipWhitelist: csv(process.env.BINANCE_IP_WHITELIST),
    rateLimit: num(process.env.BINANCE_RATE_LIMIT, 1200),
    restBaseUrl:
      process.env.BINANCE_REST_BASE_URL ||
      (bool(process.env.BINANCE_TESTNET, false)
        ? 'https://testnet.binance.vision'
        : 'https://api.binance.com'),
    wsBaseUrl:
      process.env.BINANCE_WS_BASE_URL ||
      (bool(process.env.BINANCE_TESTNET, false)
        ? 'wss://testnet.binance.vision'
        : 'wss://stream.binance.com:9443'),
  },

  // AI service
  ai: {
    serviceUrl: process.env.AI_SERVICE_URL || 'http://localhost:8000',
    retrainCron: process.env.AI_RETRAIN_CRON || '0 2 * * *',
    randomSeed: num(process.env.AI_RANDOM_SEED, 42),
  },

  // Risk defaults
  risk: {
    maxPositionPct: num(process.env.RISK_MAX_POSITION_PCT, 0.05),
    maxPortfolioPct: num(process.env.RISK_MAX_PORTFOLIO_PCT, 0.1),
    dailyLossLimitPct: num(process.env.RISK_DAILY_LOSS_LIMIT_PCT, 0.03),
    maxDrawdownPct: num(process.env.RISK_MAX_DRAWDOWN_PCT, 0.2),
    volatilityLookback: num(process.env.RISK_VOLATILITY_LOOKBACK, 20),
    volatilityTarget: num(process.env.RISK_VOLATILITY_TARGET, 0.01),
    maxOpenPositions: num(process.env.RISK_MAX_OPEN_POSITIONS, 5),
  },

  // Alerts
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  discord: { webhookUrl: process.env.DISCORD_WEBHOOK_URL || '' },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.ALERT_EMAIL_FROM || '',
    to: process.env.ALERT_EMAIL_TO || '',
  },

  // Encryption (AES-256-GCM)
  encryptionKey: process.env.ENCRYPTION_KEY || '',
};

export default config;
