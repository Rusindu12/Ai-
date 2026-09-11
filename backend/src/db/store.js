import { config } from '../config.js';
import { logger } from '../logger.js';
import { encrypt, decrypt } from '../security/encryption.js';

/**
 * Data store abstraction.
 *
 * Uses PostgreSQL (node-postgres) when DATABASE_URL is set; falls back to an
 * in-memory store for local development and tests. Stores:
 *   - users            (id, email, password hash, totp secret, ip whitelist)
 *   - api_credentials  (user_id, api_key [AES-256 encrypted], secret [encrypted])
 *   - trades           (trade history, also duplicated in the portfolio module)
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS api_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  realized_pnl DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT now()
);
`;

class MemoryStore {
  constructor() {
    this.users = new Map();
    this.credentials = new Map();
    this.trades = [];
  }
  async init() {}
  async createUser(user) { this.users.set(user.id, user); return user; }
  async getUserByEmail(email) { return [...this.users.values()].find((u) => u.email === email) || null; }
  async getUserById(id) { return this.users.get(id) || null; }
  async saveCredentials(userId, apiKey, apiSecret) {
    this.credentials.set(userId, { user_id: userId, api_key_encrypted: apiKey, api_secret_encrypted: apiSecret });
  }
  async getCredentials(userId) { return this.credentials.get(userId) || null; }
  async insertTrade(trade) { this.trades.push(trade); return trade; }
  async listTrades(userId) { return this.trades.filter((t) => t.user_id === userId); }
}

class PostgresStore {
  constructor(url) {
    this.url = url;
    this.pool = null;
  }
  async init() {
    const { default: pg } = await import('pg');
    this.pool = new pg.Pool({ connectionString: this.url, max: 10 });
    await this.pool.query(SCHEMA);
  }
  async createUser(user) {
    await this.pool.query(
      'INSERT INTO users (id, email, password_hash, totp_secret) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [user.id, user.email, user.passwordHash, user.totpSecret || null]
    );
    return user;
  }
  async getUserByEmail(email) {
    const r = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!r.rows.length) return null;
    return { id: r.rows[0].id, email: r.rows[0].email, passwordHash: r.rows[0].password_hash, totpSecret: r.rows[0].totp_secret };
  }
  async getUserById(id) {
    const r = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!r.rows.length) return null;
    return { id: r.rows[0].id, email: r.rows[0].email, passwordHash: r.rows[0].password_hash, totpSecret: r.rows[0].totp_secret };
  }
  async saveCredentials(userId, apiKey, apiSecret) {
    await this.pool.query(
      `INSERT INTO api_credentials (user_id, api_key_encrypted, api_secret_encrypted)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET api_key_encrypted=$2, api_secret_encrypted=$3, updated_at=now()`,
      [userId, apiKey, apiSecret]
    );
  }
  async getCredentials(userId) {
    const r = await this.pool.query('SELECT * FROM api_credentials WHERE user_id = $1', [userId]);
    return r.rows.length ? r.rows[0] : null;
  }
  async insertTrade(trade) {
    await this.pool.query(
      'INSERT INTO trades (id, user_id, symbol, side, price, quantity, realized_pnl) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [trade.id, trade.userId || null, trade.symbol, trade.side, trade.price, trade.quantity, trade.realizedPnl ?? null]
    );
    return trade;
  }
  async listTrades(userId) {
    const r = await this.pool.query('SELECT * FROM trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500', [userId]);
    return r.rows;
  }
}

export class Store {
  constructor() {
    this.backend = config.databaseUrl ? new PostgresStore(config.databaseUrl) : new MemoryStore();
  }

  async init() {
    await this.backend.init().catch((e) => logger.warn('DB init failed', { error: e.message }));
  }

  // ---- users ----
  async createUser({ id, email, passwordHash, totpSecret }) {
    return this.backend.createUser({ id, email, passwordHash, totpSecret });
  }
  async getUserByEmail(email) {
    return this.backend.getUserByEmail(email);
  }
  async getUserById(id) {
    return this.backend.getUserById(id);
  }

  // ---- credentials (encrypt before storing) ----
  async saveApiCredentials(userId, apiKey, apiSecret) {
    const encryptedKey = encrypt(apiKey);
    const encryptedSecret = encrypt(apiSecret);
    await this.backend.saveCredentials(userId, encryptedKey, encryptedSecret);
    return { userId };
  }
  async getApiCredentials(userId) {
    const row = await this.backend.getCredentials(userId);
    if (!row) return null;
    try {
      return {
        apiKey: decrypt(row.api_key_encrypted),
        apiSecret: decrypt(row.api_secret_encrypted),
      };
    } catch {
      logger.error('Failed to decrypt API credentials', { userId });
      return null;
    }
  }
  async hasApiCredentials(userId) {
    return Boolean(await this.backend.getCredentials(userId));
  }

  // ---- trades ----
  async recordTrade(trade) {
    return this.backend.insertTrade(trade);
  }
  async listTrades(userId) {
    return this.backend.listTrades(userId);
  }
}

export const store = new Store();
export default store;
