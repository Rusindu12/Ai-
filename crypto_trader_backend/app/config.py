"""Centralised application configuration.

Everything is driven by environment variables (12-factor) with sane, secure
defaults for local development.  See ``.env.example`` for the full list.

The configuration is intentionally split into logical groups so that unit
tests can build a settings object with ``Settings(_env_file=None, ...)``.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

log = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent

# Symbols the backend tracks by default. Overridable with MARKETS="BTCUSDT,ETHUSDT".
DEFAULT_MARKETS = [
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "MATICUSDT",
]


class Settings(BaseSettings):
    """Runtime configuration for the FastAPI backend."""

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ------------------------------------------------------------------ core
    APP_NAME: str = "crypto-trader-backend"
    ENV: Literal["dev", "staging", "prod", "test"] = "dev"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    LOG_LEVEL: str = "INFO"
    DEBUG: bool = False

    # --------------------------------------------------------------- security
    SECRET_KEY: str = "dev-only-insecure-secret-key-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 60
    REFRESH_TOKEN_DAYS: int = 30
    ISSUER: str = "cryptotrader.backend"
    AUDIENCE: str = "cryptotrader.app"
    # AES-256-GCM master key (base64, 32 bytes) used to encrypt Binance API
    # secrets at rest. In prod, prefer KMS/Vault (see key_provider_* below).
    ENCRYPTION_KEY: str = ""
    KEY_PROVIDER: Literal["local", "vault", "aws_kms"] = "local"
    VAULT_ADDR: str = ""
    VAULT_TOKEN: str = ""
    VAULT_TRANSIT_KEY_NAME: str = "cryptotrader-binance"
    AWS_KMS_KEY_ID: str = ""
    AWS_REGION: str = "us-east-1"
    # RSA key pair (PEM) used for the mobile -> backend hybrid encryption
    # handshake. If empty an ephemeral key is generated at boot (dev only).
    HANDSHAKE_PRIVATE_KEY_PEM: str = ""

    # --------------------------------------------------------------- database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{BASE_DIR / 'data' / 'app.db'}"
    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    AUTO_CREATE_SCHEMA: bool = True

    # --------------------------------------------------------------- binance
    BINANCE_BASE_URL: str = "https://api.binance.com"
    BINANCE_WS_URL: str = "wss://stream.binance.com:9443"
    BINANCE_API_KEY: str = ""
    BINANCE_API_SECRET: str = ""
    BINANCE_TESTNET: bool = False
    BINANCE_RECEIVING_WINDOW_MS: int = 5000
    # Hard weight budget per minute (Binance allows 6000 request-weight/min).
    BINANCE_WEIGHT_PER_MIN: int = 5400
    BINANCE_ORDERS_PER_MIN: int = 45
    BINANCE_ORDERS_PER_DAY: int = 46000
    BINANCE_TIMEOUT_S: float = 10.0
    BINANCE_MAX_RETRIES: int = 4
    MARKETS: Annotated[list[str], NoDecode] = Field(default_factory=lambda: list(DEFAULT_MARKETS))
    KLINE_CACHE_TTL_S: float = 2.0
    KLINE_MAX_BARS: int = 1000

    # ---------------------------------------------------------- data sourcing
    # DEMO_MODE never touches Binance and instead uses the high-fidelity
    # market simulator (great for local dev, CI, screenshots and onboarding).
    DEMO_MODE: bool = True
    SIM_SEED: int = 20260911
    SIM_TICK_MS: int = 250

    # ----------------------------------------------------------------- trading
    PAPER_TRADING_DEFAULT: bool = True
    MAX_POSITION_PCT: float = 25.0          # % of quote balance per order
    MAX_DAILY_LOSS_PCT: float = 5.0         # % of equity, trip -> kill switch
    MIN_ORDER_NOTIONAL_USD: float = 10.0
    MAX_TRADE_NOTIONAL_USD: float = 250.0        # per-order notional cap (USDT)
    MAX_TRADE_PCT_OF_BALANCE: float = 25.0       # per-order cap as % of quote balance
    SLIPPAGE_BPS: float = 2.5
    TAKER_FEE_BPS: float = 10.0
    MAKER_FEE_BPS: float = 10.0
    TRADE_COOLDOWN_S: int = 20
    ALLOW_WITHDRAWALS: bool = False         # server refuses withdraw perms, always

    # -------------------------------------------------------------- ai engine
    AI_LOOKBACK_BARS: int = 500
    AI_RETRAIN_DAYS: int = 7
    AI_MIN_CONFIDENCE_PCT: float = 65.0
    AI_MODEL_DIR: str = str(BASE_DIR / "app" / "ai" / "artifacts")
    AI_ALLOW_AUTO_TRADE: bool = True
    AUTO_TRADE_INTERVAL_S: int = 30
    AUTO_TRADE_MAX_OPEN_POSITIONS: int = 6
    AUTO_TRADE_TAKE_PROFIT_PCT: float = 2.2   # default TP for AI entries
    AUTO_TRADE_STOP_LOSS_PCT: float = 1.4     # default SL for AI entries
    ALERT_SCAN_INTERVAL_S: float = 3.0

    # ------------------------------------------------------------ realtime api
    WS_HEARTBEAT_S: int = 25
    WS_MAX_CLIENTS: int = 2000
    WS_BROADCAST_INTERVAL_MS: int = 120      # coalescing window for ticker fan-out
    ENABLE_SOCKETIO: bool = False            # optional Socket.IO bridge (web UIs)
    CORS_ORIGINS: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["*"])

    # ------------------------------------------------------ google / integrity
    GOOGLE_WEB_CLIENT_ID: str = ""
    GOOGLE_ANDROID_CLIENT_ID: str = ""
    GOOGLE_CLOUD_PROJECT: str = ""
    # disabled | jwt | google  (google needs a service account with the
    # playintegrity scope; jwt decodes + checks the token offline)
    PLAY_INTEGRITY_MODE: Literal["disabled", "jwt", "google"] = "disabled"
    PLAY_INTEGRITY_PACKAGE: str = "com.ai.cryptotrader"
    PLAY_INTEGRITY_REQUIRE_STRONG: bool = False
    REQUIRE_INTEGRITY_FOR_KEYS: bool = True

    # -------------------------------------------------------------- firebase
    FIREBASE_CREDENTIALS_PATH: str = ""      # service-account json
    FIRESTORE_ENABLED: bool = False
    FCM_ENABLED: bool = False

    # --------------------------------------------------------------- telemetry
    SENTRY_DSN: str = ""
    METRICS_TOKEN: str = ""

    # ------------------------------------------------------------- rate limits
    RATE_LIMIT_PER_MIN: int = 600
    ORDER_RATE_LIMIT_PER_MIN: int = 30

    @staticmethod
    def _parse_list(v: Any) -> Any:
        """Accept ``a,b`` (CSV) or ``["a","b"]`` (JSON) env values."""
        if isinstance(v, str):
            text = v.strip()
            if not text:
                return []
            if text.startswith(("[", "{")):
                import json

                return json.loads(text)
            return [x.strip() for x in text.split(",") if x.strip()]
        return v

    @field_validator("MARKETS", mode="before")
    @classmethod
    def _markets(cls, v: Any) -> Any:
        parsed = Settings._parse_list(v)
        return [str(x).upper() for x in parsed] if isinstance(parsed, list) else parsed

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _origins(cls, v: Any) -> Any:
        return Settings._parse_list(v)

    @field_validator("LOG_LEVEL", mode="before")
    @classmethod
    def _upper(cls, v):
        return v.upper() if isinstance(v, str) else v

    @field_validator("ENV", mode="before")
    @classmethod
    def _lower_env(cls, v):
        return v.lower() if isinstance(v, str) else v

    @property
    def is_prod(self) -> bool:
        return self.ENV == "prod"

    @property
    def is_test(self) -> bool:
        return self.ENV == "test"

    def validate_runtime(self) -> list[str]:
        """Return a list of human readable warnings/errors for the config."""
        problems: list[str] = []
        if self.ENV == "PROD":
            if self.SECRET_KEY.startswith("dev-only"):
                problems.append("SECRET_KEY is still the insecure default")
            if not self.ENCRYPTION_KEY and self.KEY_PROVIDER == "local":
                problems.append("ENCRYPTION_KEY must be set when KEY_PROVIDER=local in prod")
            if "*" in self.CORS_ORIGINS:
                problems.append("CORS_ORIGINS must not be '*' in production")
            if self.DEMO_MODE:
                problems.append("DEMO_MODE is enabled in production - orders will be simulated")
        if not self.DEMO_MODE and not (self.BINANCE_API_KEY and self.BINANCE_API_SECRET):
            problems.append("DEMO_MODE=false but no server BINANCE_API_KEY/SECRET configured")
        return problems

    @property
    def binance_rest_base(self) -> str:
        if self.BINANCE_TESTNET:
            return "https://testnet.binance.vision"
        return self.BINANCE_BASE_URL.rstrip("/")

    @property
    def binance_ws_base(self) -> str:
        if self.BINANCE_TESTNET:
            return "wss://stream.testnet.binance.vision"
        return self.BINANCE_WS_URL.rstrip("/")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    for problem in settings.validate_runtime():
        log.warning("config warning: %s", problem)
    return settings


settings = get_settings()
