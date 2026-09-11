-- PostgreSQL schema for the AI crypto trading platform.
-- Applied automatically by the backend on startup (see backend/src/db/store.js).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret   TEXT,                -- base32 secret for TOTP 2FA (optional)
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Binance credentials are stored AES-256-GCM encrypted, never in plain text.
CREATE TABLE IF NOT EXISTS api_credentials (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key_encrypted    TEXT NOT NULL,
  api_secret_encrypted TEXT NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trades (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  symbol        TEXT NOT NULL,
  side          TEXT NOT NULL,
  price         DOUBLE PRECISION NOT NULL,
  quantity      DOUBLE PRECISION NOT NULL,
  realized_pnl  DOUBLE PRECISION,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trades_user ON trades (user_id, created_at DESC);
