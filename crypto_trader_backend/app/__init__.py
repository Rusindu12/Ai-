"""AI Crypto Trading Backend.

Package layout::

    app/
      main.py            FastAPI entry point + wiring (lifespan)
      config.py          pydantic-settings configuration (.env driven)
      errors.py          domain exceptions + structured logging
      telemetry.py       metrics counters + Prometheus exposition
      scheduler.py       background jobs (weekly retrain, hygiene, warm-up)
      socketio_app.py    optional Socket.IO bridge for web dashboards
      security/          passwords, JWT, envelope crypto, TOTP, Play Integrity
      db/                async SQLAlchemy models + data access layer
      binance/           signed REST client, WS streams, rate limiter, simulator
      services/          market hub, trading, portfolio, alerts, realtime, AI loop
      ai/                indicators, features, models, signals, backtest, train
      risk/              order gates + position sizing
      strategies/        pluggable strategies shared by backtest + live
      api/               HTTP + WebSocket route modules

Version 1.0.0
"""

__version__ = "1.0.0"
APP_VERSION = __version__
APP_NAME = "crypto-trader-backend"
