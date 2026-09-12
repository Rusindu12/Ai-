"""Request/response schemas (pydantic v2).

Only *inputs* are strictly validated; responses are plain dicts assembled by the
services, which keeps the payload flexible (charts/AI like extra keys) while the
OpenAPI schema still documents shapes via ``response_model`` where useful.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

INTERVALS = ("1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w")
Interval = Literal["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"]


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    name: str = Field(default="", max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    totp_code: str | None = Field(default=None, max_length=10)
    device_id: str = Field(default="", max_length=128)


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(min_length=20)
    device_id: str = ""
    platform: str = "android"
    app_version: str = ""


class FirebaseLoginRequest(BaseModel):
    firebase_token: str = Field(min_length=20)
    device_id: str = ""
    fcm_token: str | None = None
    platform: str = "android"
    app_version: str = ""


class BiometricUnlockRequest(BaseModel):
    user_id: int
    device_id: str = Field(min_length=4, max_length=128)
    signature: str = ""  # reserved for a signed challenge (StrongBox)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=16)
    device_id: str = ""


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str = ""
    new_password: str = Field(min_length=10, max_length=256)
    confirm_password: str = Field(min_length=10, max_length=256)


class TwoFactorConfirm(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class TwoFactorDisable(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class DeviceRegister(BaseModel):
    device_id: str = Field(min_length=4, max_length=128)
    platform: Literal["android", "ios", "web"] = "android"
    fcm_token: str | None = Field(default=None, max_length=512)
    app_version: str = ""
    integrity_token: str = ""
    integrity_nonce: str = ""


# --------------------------------------------------------------------------- #
# Keys
# --------------------------------------------------------------------------- #
class EncryptedEnvelope(BaseModel):
    """AES-GCM payload with an RSA-OAEP wrapped session key (from the app)."""

    data: str = Field(min_length=16)
    iv: str = Field(min_length=8)
    key: str = Field(min_length=32)
    tag: str = Field(default="")


class KeySubmitRequest(BaseModel):
    """Either plaintext over TLS (dev) or an ``envelope`` (production apps)."""

    api_key: str | None = Field(default=None, max_length=128)
    api_secret: str | None = Field(default=None, max_length=256)
    envelope: EncryptedEnvelope | None = None
    label: str = Field(default="default", max_length=48)
    is_testnet: bool = False
    delete_local: bool = True

    @model_validator(mode="after")
    def _check(self) -> KeySubmitRequest:
        if self.envelope is None and not (self.api_key and self.api_secret):
            raise ValueError("provide api_key/api_secret or an encrypted envelope")
        return self


class KeyRotateRequest(BaseModel):
    label: str = "default"
    new_label: str | None = None
    is_active: bool | None = None


# --------------------------------------------------------------------------- #
# Market data
# --------------------------------------------------------------------------- #
class KlineQuery(BaseModel):
    symbol: str
    interval: Interval = "1m"
    limit: int = Field(default=300, ge=5, le=1000)


# --------------------------------------------------------------------------- #
# Trading
# --------------------------------------------------------------------------- #
class OrderCreate(BaseModel):
    symbol: str = Field(min_length=5, max_length=20)
    side: Literal["BUY", "SELL", "buy", "sell"]
    order_type: Literal["MARKET", "LIMIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT", "market", "limit"] = "MARKET"
    quantity: float = Field(default=0.0, ge=0, le=1_000_000)
    quoted_qty: float = Field(default=0.0, ge=0, le=10_000_000)
    price: float = Field(default=0.0, ge=0)
    time_in_force: Literal["GTC", "IOC", "FOK", "GTX"] = "GTC"
    take_profit: float | None = Field(default=None, ge=0)
    stop_loss: float | None = Field(default=None, ge=0)
    client_order_id: str = Field(default="", max_length=48)
    use_paper: bool | None = None
    dry_run: bool = False
    ai_signal_id: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=100)

    @field_validator("symbol")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper().strip()

    @field_validator("side")
    @classmethod
    def _upper_side(cls, v: str) -> str:
        return v.upper()


class BulkOrderCreate(BaseModel):
    orders: list[OrderCreate] = Field(min_length=1, max_length=20)


# --------------------------------------------------------------------------- #
# AI
# --------------------------------------------------------------------------- #
class AiSignalQuery(BaseModel):
    symbol: str
    interval: Interval = "1m"
    bars: int = Field(default=400, ge=120, le=1000)
    min_confidence: float | None = Field(default=None, ge=0, le=100)


class TrainRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list, max_length=12)
    interval: Interval = "1h"
    bars: int = Field(default=4000, ge=500, le=60_000)
    look_back: int = Field(default=60, ge=20, le=240)
    horizon: int = Field(default=6, ge=1, le=48)
    hidden: int = Field(default=24, ge=8, le=128)
    epochs_lstm: int = Field(default=22, ge=1, le=200)
    epochs_clf: int = Field(default=140, ge=1, le=600)
    publish: bool = True


class BacktestRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: Interval = "1h"
    bars: int = Field(default=3000, ge=300, le=60_000)
    strategy: str = "ai"
    start_equity: float = Field(default=10_000.0, gt=0)
    risk_per_trade: float = Field(default=0.02, gt=0, le=0.5)
    max_position_pct: float = Field(default=0.5, gt=0, le=1.0)
    atr_sl_mult: float = Field(default=1.5, gt=0, le=20)
    atr_tp_mult: float = Field(default=2.5, gt=0, le=40)
    allow_short: bool = False
    optimistic: bool = False
    include_curve: bool = True


class AutoTradeConfig(BaseModel):
    enabled: bool
    symbols: list[str] = Field(default_factory=list, max_length=25)
    risk_level: Literal["conservative", "moderate", "aggressive"] = "moderate"
    max_trade_size_usd: float = Field(default=250.0, ge=10, le=1_000_000)
    daily_loss_limit_usd: float = Field(default=500.0, ge=10, le=10_000_000)
    min_confidence_pct: float | None = Field(default=None, ge=0, le=100)
    interval_s: int | None = Field(default=None, ge=5, le=3600)

    @field_validator("symbols")
    @classmethod
    def _up(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for raw in v:
            sym = (raw or "").strip().upper()
            if not (5 <= len(sym) <= 20) or not sym.isalnum():
                raise ValueError(f"'{raw}' is not a valid trading pair symbol (e.g. BTCUSDT)")
            out.append(sym)
        return out


class StopAllRequest(BaseModel):
    flatten: bool = False
    reason: str = ""


# --------------------------------------------------------------------------- #
# Alerts / settings
# --------------------------------------------------------------------------- #
class AlertCreate(BaseModel):
    symbol: str = Field(min_length=5, max_length=20)
    operator: Literal[">", "<", ">=", "<=", "=="] = ">"
    threshold: float = Field(gt=0)
    direction: Literal["price", "pct_change", "signal"] = "price"
    cooldown_s: int = Field(default=900, ge=0, le=86_400)
    one_shot: bool = False

    @field_validator("symbol")
    @classmethod
    def _up(cls, v: str) -> str:
        return v.upper().strip()


class AlertUpdate(BaseModel):
    active: bool | None = None
    threshold: float | None = Field(default=None, gt=0)
    operator: Literal[">", "<", ">=", "<=", "=="] | None = None
    cooldown_s: int | None = Field(default=None, ge=0, le=86_400)


class WatchRequest(BaseModel):
    symbol: str = Field(min_length=5, max_length=20)
    note: str = Field(default="", max_length=200)

    @field_validator("symbol")
    @classmethod
    def _up(cls, v: str) -> str:
        return v.upper().strip()


class SettingsUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    theme: Literal["dark", "light", "system"] | None = None
    locale: str | None = Field(default=None, max_length=8)
    paper_trading: bool | None = None
    risk_level: Literal["conservative", "moderate", "aggressive"] | None = None
    max_trade_size_usd: float | None = Field(default=None, ge=10, le=1_000_000)
    daily_loss_limit_usd: float | None = Field(default=None, ge=10, le=10_000_000)
    biometric_enabled: bool | None = None
    notification_prefs: dict[str, Any] | None = None


class ResetPaperRequest(BaseModel):
    confirm: Literal["RESET"]
