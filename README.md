# AI-Powered Cryptocurrency Trading Platform

A full-stack, AI-driven crypto trading application built on the **Binance Live API**.
It streams real-time market data over WebSockets, runs an AI trading engine
(LSTM + scikit-learn ensemble + technical strategies), enforces a multi-layer
risk system, and ships with a paper-trading simulator so you can test safely
before going live.

> ⚠️ **Disclaimer** — Educational software. Cryptocurrency trading is risky and
> this project is not financial advice. The bundled ML models are **sample
> models trained on synthetic data**; retrain them on real data and validate
> extensively before considering real money.

---

## 1. Tech Stack

| Layer        | Technology                                                      |
| ------------ | --------------------------------------------------------------- |
| Frontend     | Next.js 14 (App Router) + React + Tailwind CSS + TradingView lightweight-charts |
| Backend      | Node.js + Express                                               |
| Realtime     | Binance WebSocket streams + Socket.io                           |
| Database     | PostgreSQL (+ in-memory fallback for dev)                       |
| Cache        | Redis (+ in-memory fallback for dev)                            |
| AI / ML      | Python FastAPI + scikit-learn (RandomForest) + PyTorch (LSTM)   |
| Deployment   | Docker + docker-compose (AWS/GCP/any host)                      |

---

## 2. Features

**Binance integration**

- REST + WebSocket, HMAC-SHA256 request signing, API-key auth
- Streams: `@ticker`, `@kline_1m/5m/15m/1h/4h/1d`, `@depth20@100ms`, user-data stream
- Sliding-window rate limiter (1200 weight/min) + `X-MBX-USED-WEIGHT-1M` tracking
- Automatic retry with exponential backoff + jitter (429 / 5xx / -1003 / -1021)

**AI trading engine**

- Technical indicators: RSI, MACD, Bollinger Bands, EMA, SMA, VWAP, ATR,
  momentum, trend score, order-book imbalance, volume profile
- LSTM neural network for price prediction (PyTorch)
- RandomForest ensemble for Buy/Sell/Hold decisions (scikit-learn)
- Ensemble layer that blends strategy + ML votes into a confidence-weighted signal
- Backtesting engine (vectorised) with Sharpe / win-rate / max-drawdown metrics
- Daily model-retraining scheduler

**Trading**

- Spot market & limit orders (paper + live)
- Auto-trading mode with manual override (pause/stop anytime)
- Paper-trading simulator with fees
- Portfolio tracking & P&L dashboard
- Take-profit / stop-loss and trailing-stop automation
- Dollar-cost-averaging (DCA) bot
- Multi-pair support (BTC, ETH, SOL, BNB, …)

**Risk management**

- Max position size, daily loss limit (auto-stop), diversification rules
- Drawdown protection, volatility-based position sizing
- Emergency kill switch (close everything instantly)

**UI / UX**

- Real-time candlestick + volume charts
- Live portfolio value, active positions, trade history (CSV export)
- AI signal panel (Buy/Sell/Hold + confidence %)
- Settings: API keys, risk params, trading pairs, DCA
- Mobile-responsive, dark/light theme, browser push notifications

**Security**

- API keys encrypted with AES-256-GCM (never plaintext)
- TOTP two-factor authentication (RFC 6238, Google Authenticator compatible)
- JWT sessions, IP-whitelist guard for Binance, withdrawal disabled (trade-only)

**Extras**

- Telegram / Discord / email alert channels
- Webhook endpoint for external signals
- Performance analytics (Sharpe, win rate, max drawdown)

---

## 3. Project structure

```
/frontend            Next.js dashboard
/backend
  /src
    /api             Binance REST wrapper, Express routes
    /websocket       Binance stream client + handlers + user-data stream
    /ai              Node <-> Python bridge client
    /strategies      trading logic (RSI, MACD, MA cross, ensemble)
    /risk            risk management (sizing, limits, diversification, kill switch)
    /trading         engine, portfolio, DCA bot, TP/SL/trailing
    /security        AES-256 encryption, JWT, TOTP
    /db              PostgreSQL store + Redis/in-memory cache
    /services        alerts (Telegram/Discord/email)
    scheduler.js     daily model retraining
  /ai                Python ML service (FastAPI)
    indicators.py    feature engineering
    models.py        LSTM + RandomForest models
    backtest.py      vectorised backtester
    train.py         training CLI
    generate_model.py  builds the sample pre-trained model
    models/          pre-trained weights (sample_ensemble.joblib)
  /test              unit tests (Node built-in test runner)
/database/schema.sql PostgreSQL schema
/docker             Dockerfiles
docker-compose.yml  one-command deployment
```

---

## 4. Quick start (Docker)

```bash
cp .env.example .env          # then edit secrets (JWT_SECRET, ENCRYPTION_KEY, …)
docker compose up --build
```

- Frontend → http://localhost:3000
- Backend  → http://localhost:4000/api/health
- AI       → http://localhost:8000/health

---

## 5. Local development

### 5.1 Backend (Node.js)

```bash
cd backend
npm install
npm test                     # 67 unit tests
npm run dev                  # http://localhost:4000
```

### 5.2 AI service (Python)

```bash
cd backend/ai
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python generate_model.py     # regenerate the sample model (optional)
uvicorn main:app --host 0.0.0.0 --port 8000
```

For the LSTM model add `pip install -r requirements-ml.txt` (PyTorch) and rerun
`generate_model.py` — it will also emit `models/lstm.pt`.

### 5.3 Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev                  # http://localhost:3000
```

The frontend rewrites `/api/*` to the backend (see `frontend/next.config.mjs`).

---

## 6. Binance setup

1. Create API keys at [binance.com](https://www.binance.com) → API Management.
   - Enable **Spot & Margin trading** only. **Do NOT enable withdrawals.**
   - Set IP access restrictions to your server IP (the platform also enforces an
     optional `BINANCE_IP_WHITELIST` outbound guard).
2. Put the keys into `.env` (`BINANCE_API_KEY`, `BINANCE_API_SECRET`) or save
   them from the UI Settings page (stored AES-256-encrypted in PostgreSQL).
3. To test without real funds use the [Spot Testnet](https://testnet.binance.vision/):
   ```bash
   BINANCE_TESTNET=true
   ```
4. Switch the engine to live trading with `TRADING_MODE=live` (default is `paper`).

### Key environment variables (see `.env.example` for all)

| Variable                | Purpose                                   |
| ----------------------- | ----------------------------------------- |
| `BINANCE_API_KEY/SECRET`| API credentials                            |
| `BINANCE_TESTNET`       | use testnet endpoints                      |
| `DATABASE_URL`          | PostgreSQL connection string               |
| `REDIS_URL`             | Redis URL (falls back to in-memory)        |
| `JWT_SECRET`            | JWT signing secret                         |
| `ENCRYPTION_KEY`        | 32-byte AES-256 key (hex) for API keys     |
| `AI_SERVICE_URL`        | Python AI service URL                      |
| `RISK_*`                | risk limits (position %, loss %, drawdown) |
| `TELEGRAM_*`, `DISCORD_WEBHOOK_URL`, `SMTP_*` | alert channels |

---

## 7. AI / ML

- **Features** — `backend/ai/indicators.py` computes 20 engineered features per
  candle (RSI, MACD, Bollinger width, VWAP, momentum, ATR, volatility, volume
  profile, order-book imbalance, …).
- **Ensemble (trade decisions)** — `RandomForestClassifier` maps features to
  `{BUY, SELL, HOLD}` with calibrated-ish probabilities used as confidence.
- **LSTM (price prediction)** — sequence model over `(open, high, low, close,
  volume)` windows predicting the next close (PyTorch, optional dependency).
- **Backtesting** — `POST /backtest` or `backend/ai/backtest.py` run a vectorised
  simulation returning equity curve, Sharpe, win rate and max drawdown.
- **Retraining** — `POST /retrain` re-fits the ensemble; the backend scheduler
  calls it daily (`AI_RETRAIN_INTERVAL_MS`).
- **Training CLI** — `python train.py --csv candles.csv` or
  `python train.py --binance --symbol BTCUSDT --interval 1h`.

### Endpoints

| Method | Path        | Description                        |
| ------ | ----------- | ---------------------------------- |
| GET    | `/health`   | model availability                 |
| POST   | `/predict`  | signal + confidence + predicted px |
| POST   | `/retrain`  | refit ensemble from candles        |
| POST   | `/backtest` | run the backtester                 |

---

## 8. Testing

```bash
cd backend && npm test
```

Covers HMAC signing (against Binance's official test vector), rate limiting,
WebSocket message normalisation, technical indicators, position sizing, risk
limits, kill switch, TP/SL/trailing logic, strategies, TOTP, AES encryption and
the portfolio simulator.

---

## 9. Security notes

- API secrets are encrypted with **AES-256-GCM** before storage and decrypted
  only transiently for signed requests.
- 2FA uses **TOTP** (RFC 6238); enrol via the UI with any authenticator app.
- The platform is **trade-only**: there are no withdrawal endpoints.
- Always run behind **HTTPS** in production (a reverse proxy such as Caddy,
  nginx or a cloud load balancer terminates TLS).

---

## 10. Roadmap / future work

- Futures trading support, advanced order types (OCO, trailing orders on exchange)
- RL policy (PPO/DQN) for trade decisions
- Sentiment analysis from news / social feeds
- Kubernetes manifests for scaling the stream + AI tiers

---

MIT License.
