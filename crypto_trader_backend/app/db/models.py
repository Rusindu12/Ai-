"""Persistence models.

PostgreSQL in production (asyncpg) and SQLite for tests/dev.  All columns use
portable types; JSON payloads are stored as ``JSON`` which both backends
support natively.

Note on API credentials: ``ExchangeCredential.secret_enc`` holds KMS/AES-GCM
* ciphertext * only.  Nothing in this schema ever contains a plaintext Binance
secret, and there is deliberately no withdrawal-capable credential field.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def epoch_ms() -> int:
    return int(time.time() * 1000)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), default="")
    name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(24), default="user")  # user|admin|readonly
    firebase_uid: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    google_sub: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    two_factor_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    biometric_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    paper_trading: Mapped[bool] = mapped_column(Boolean, default=True)
    daily_loss_limit_usd: Mapped[float] = mapped_column(Float, default=500.0)
    max_trade_size_usd: Mapped[float] = mapped_column(Float, default=250.0)
    risk_level: Mapped[str] = mapped_column(String(16), default="moderate")
    locale: Mapped[str] = mapped_column(String(8), default="en")
    theme: Mapped[str] = mapped_column(String(8), default="dark")
    notification_prefs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # Virtual cash for paper trading when live market data is used (live mode
    # with PAPER trading on).  Never used in DEMO_MODE (simulator owns balances).
    paper_balances: Mapped[dict[str, float]] = mapped_column(JSON, default=dict)
    auto_trade_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_trade_symbols: Mapped[list[str]] = mapped_column(JSON, default=list)
    auto_kill_switch: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    # NOTE: relationships are noload by design - the API answers with explicit
    # queries (repo.list_credentials etc.) so no implicit IO can ever fire
    # inside a sync property access (which breaks asyncio).
    credentials: Mapped[list[ExchangeCredential]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="noload"
    )
    trades: Mapped[list[Trade]] = relationship(back_populates="user", lazy="noload")
    alerts: Mapped[list[PriceAlert]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="noload"
    )
    devices: Mapped[list[Device]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="noload"
    )


class Device(Base):
    """Registered app installs: FCM tokens, Play Integrity nonces, sessions."""

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    platform: Mapped[str] = mapped_column(String(16), default="android")
    fcm_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    app_version: Mapped[str] = mapped_column(String(32), default="")
    integrity_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen_at: Mapped[int] = mapped_column(Integer, default=epoch_ms)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="devices")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    device_id: Mapped[str] = mapped_column(String(128), default="")
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at_ms: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RevokedJti(Base):
    """Short lived deny-list for access tokens (logout / password change)."""

    __tablename__ = "revoked_jtis"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at_ms: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ExchangeCredential(Base):
    __tablename__ = "exchange_credentials"
    __table_args__ = (UniqueConstraint("user_id", "exchange", "label", name="uq_cred_label"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    exchange: Mapped[str] = mapped_column(String(24), default="binance")
    label: Mapped[str] = mapped_column(String(48), default="default")
    api_key_enc: Mapped[bytes] = mapped_column(LargeBinary)   # encrypted too (traceability)
    secret_enc: Mapped[bytes] = mapped_column(LargeBinary)
    key_fp: Mapped[str] = mapped_column(String(16), default="")  # sha256[:12] for display
    can_trade: Mapped[bool] = mapped_column(Boolean, default=True)
    can_withdraw: Mapped[bool] = mapped_column(Boolean, default=False)
    ip_restricted: Mapped[bool] = mapped_column(Boolean, default=True)
    is_testnet: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_checked_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="credentials")


class Trade(Base):
    __tablename__ = "trades"
    __table_args__ = (
        Index("ix_trades_user_created", "user_id", "created_at_ms"),
        Index("ix_trades_symbol_created", "symbol", "created_at_ms"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_order_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    order_id: Mapped[str] = mapped_column(String(64), default="")
    exchange: Mapped[str] = mapped_column(String(24), default="binance")
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    side: Mapped[str] = mapped_column(String(8))  # BUY|SELL
    order_type: Mapped[str] = mapped_column(String(16), default="MARKET")
    qty: Mapped[float] = mapped_column(Float, default=0.0)
    price: Mapped[float] = mapped_column(Float, default=0.0)
    quote_qty: Mapped[float] = mapped_column(Float, default=0.0)
    fee_usd: Mapped[float] = mapped_column(Float, default=0.0)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(16), default="NEW")  # NEW|FILLED|PARTIAL|CANCELED|REJECTED
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="manual")  # manual|ai|paper
    paper: Mapped[bool] = mapped_column(Boolean, default=True)
    ai_signal_id: Mapped[str | None] = mapped_column(String(48), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at_ms: Mapped[int] = mapped_column(Integer, default=epoch_ms)
    updated_at_ms: Mapped[int] = mapped_column(Integer, default=epoch_ms)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="trades")


class Position(Base):
    """Aggregate per-symbol position used for P&L + paper trading."""

    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("user_id", "symbol", "paper", name="uq_position"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    qty: Mapped[float] = mapped_column(Float, default=0.0)
    avg_price: Mapped[float] = mapped_column(Float, default=0.0)
    cost_basis: Mapped[float] = mapped_column(Float, default=0.0)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    paper: Mapped[bool] = mapped_column(Boolean, default=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at_ms: Mapped[int] = mapped_column(Integer, default=epoch_ms)


class AiSignal(Base):
    __tablename__ = "ai_signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    signal_id: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    action: Mapped[str] = mapped_column(String(8))  # BUY|SELL|HOLD
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    reason: Mapped[str] = mapped_column(Text, default="")
    indicators: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    model_version: Mapped[str] = mapped_column(String(32), default="")
    price_at_signal: Mapped[float] = mapped_column(Float, default=0.0)
    acted_on: Mapped[bool] = mapped_column(Boolean, default=False)
    outcome_pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at_ms: Mapped[int] = mapped_column(Integer, default=epoch_ms)


class PriceAlert(Base):
    __tablename__ = "price_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    operator: Mapped[str] = mapped_column(String(2), default=">")  # > < >= <=
    threshold: Mapped[float] = mapped_column(Float)
    direction: Mapped[str] = mapped_column(String(8), default="price")  # price|pct_change|signal
    pct_change_24h: Mapped[float | None] = mapped_column(Float, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    triggered_once: Mapped[bool] = mapped_column(Boolean, default=False)
    cooldown_s: Mapped[int] = mapped_column(Integer, default=900)
    last_triggered_at_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="alerts")


class Watchlist(Base):
    __tablename__ = "watchlists"
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_watchlist"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NotificationLog(Base):
    """Every push/in-app notification, used for the alerts screen history."""

    __tablename__ = "notification_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24), default="info")  # alert|signal|trade|system
    title: Mapped[str] = mapped_column(String(160), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    delivered: Mapped[bool] = mapped_column(Boolean, default=False)
    channel: Mapped[str] = mapped_column(String(16), default="fcm")
    created_at_ms: Mapped[int] = mapped_column(Integer, default=epoch_ms)


class ModelVersion(Base):
    """Registry of trained AI models (auto-retraining audit trail)."""

    __tablename__ = "model_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(16), default="lstm")  # lstm|classifier|rl
    path: Mapped[str] = mapped_column(String(512), default="")
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    training_rows: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AutoTradeLog(Base):
    __tablename__ = "auto_trade_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    decision: Mapped[str] = mapped_column(String(8), default="HOLD")
    executed: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    reason: Mapped[str] = mapped_column(Text, default="")
    order_client_id: Mapped[str] = mapped_column(String(64), default="")
    risk_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at_ms: Mapped[int] = mapped_column(Integer, default=epoch_ms)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(48), index=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at_ms: Mapped[int] = mapped_column(Integer, default=epoch_ms)
