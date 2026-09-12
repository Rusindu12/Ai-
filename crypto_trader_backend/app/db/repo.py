"""Thin async data-access layer (kept deliberately explicit over an ORM abstractions).

Every function takes an :class:`AsyncSession` so FastAPI dependencies and
background tasks share the same transaction semantics.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    AiSignal,
    AuditEvent,
    AutoTradeLog,
    Device,
    ExchangeCredential,
    NotificationLog,
    Position,
    PriceAlert,
    RefreshToken,
    RevokedJti,
    Trade,
    User,
    Watchlist,
)


def _ms() -> int:
    return int(time.time() * 1000)


# --------------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------------- #
async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    res = await session.execute(select(User).where(func.lower(User.email) == email.strip().lower()))
    return res.scalar_one_or_none()


async def get_user_by_id(session: AsyncSession, user_id: int) -> User | None:
    return await session.get(User, int(user_id))


async def get_user_by_firebase(session: AsyncSession, uid: str) -> User | None:
    res = await session.execute(select(User).where(User.firebase_uid == uid))
    return res.scalar_one_or_none()


async def get_user_by_google(session: AsyncSession, sub: str) -> User | None:
    res = await session.execute(select(User).where(User.google_sub == sub))
    return res.scalar_one_or_none()


async def create_user(
    session: AsyncSession, *, email: str, password_hash: str = "", name: str = "", role: str = "user"
) -> User:
    user = User(email=email.strip().lower(), password_hash=password_hash, name=name or email.split("@")[0], role=role)
    session.add(user)
    await session.flush()
    return user


async def update_user(session: AsyncSession, user_id: int, **fields: Any) -> User | None:
    clean = {k: v for k, v in fields.items() if hasattr(User, k)}
    if clean:
        await session.execute(update(User).where(User.id == int(user_id)).values(**clean))
    await session.flush()
    return await get_user_by_id(session, user_id)


async def touch_login(session: AsyncSession, user_id: int) -> None:
    await session.execute(update(User).where(User.id == int(user_id)).values(last_login_at=datetime.now(UTC)))


# --------------------------------------------------------------------------- #
# Tokens / devices / audit
# --------------------------------------------------------------------------- #
async def store_refresh_token(session: AsyncSession, user_id: int, token_hash: str, *, days: int, device_id: str = "") -> None:
    session.add(
        RefreshToken(
            user_id=int(user_id),
            token_hash=token_hash,
            device_id=device_id,
            expires_at_ms=_ms() + days * 86400_000,
        )
    )
    await session.flush()


async def find_refresh_token(session: AsyncSession, token_hash: str) -> RefreshToken | None:
    res = await session.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    return res.scalar_one_or_none()


async def revoke_refresh_token(session: AsyncSession, token_hash: str) -> None:
    await session.execute(update(RefreshToken).where(RefreshToken.token_hash == token_hash).values(revoked=True))


async def revoke_all_refresh_tokens(session: AsyncSession, user_id: int) -> None:
    await session.execute(update(RefreshToken).where(RefreshToken.user_id == int(user_id)).values(revoked=True))


async def revoke_jti(session: AsyncSession, jti: str, exp_ms: int) -> None:
    if not jti:
        return
    exists = await session.get(RevokedJti, jti)
    if exists is None:
        session.add(RevokedJti(jti=jti, expires_at_ms=exp_ms))
        await session.flush()


async def is_jti_revoked(session: AsyncSession, jti: str) -> bool:
    if not jti:
        return False
    return (await session.get(RevokedJti, jti)) is not None


async def purge_expired_tokens(session: AsyncSession) -> int:
    now = _ms()
    r1 = await session.execute(delete(RefreshToken).where(RefreshToken.expires_at_ms < now))
    r2 = await session.execute(delete(RevokedJti).where(RevokedJti.expires_at_ms < now))
    await session.flush()
    return int(r1.rowcount or 0) + int(r2.rowcount or 0)


async def upsert_device(session: AsyncSession, user_id: int, *, device_id: str, platform: str, fcm_token: str | None, app_version: str) -> Device:
    res = await session.execute(select(Device).where(Device.device_id == device_id))
    dev = res.scalar_one_or_none()
    if dev is None:
        dev = Device(
            user_id=int(user_id), device_id=device_id, platform=platform, fcm_token=fcm_token, app_version=app_version
        )
        session.add(dev)
    else:
        dev.user_id = int(user_id)
        dev.last_seen_at = _ms()
        if fcm_token:
            dev.fcm_token = fcm_token
        dev.app_version = app_version or dev.app_version
    await session.flush()
    return dev


async def list_devices(session: AsyncSession, user_id: int) -> Sequence[Device]:
    res = await session.execute(select(Device).where(Device.user_id == int(user_id)))
    return res.scalars().all()


async def audit(session: AsyncSession, *, user_id: int | None, action: str, ip: str = "", detail: dict[str, Any] | None = None) -> None:
    session.add(AuditEvent(user_id=user_id, action=action, ip=ip, detail=detail or {}))
    await session.flush()


# --------------------------------------------------------------------------- #
# Exchange credentials (ciphertext only)
# --------------------------------------------------------------------------- #
async def save_credential(
    session: AsyncSession,
    user_id: int,
    *,
    api_key_enc: bytes,
    secret_enc: bytes,
    key_fp: str,
    label: str = "default",
    exchange: str = "binance",
    can_trade: bool = True,
    can_withdraw: bool = False,
    ip_restricted: bool = True,
    is_testnet: bool = False,
) -> ExchangeCredential:
    res = await session.execute(
        select(ExchangeCredential).where(
            ExchangeCredential.user_id == int(user_id),
            ExchangeCredential.exchange == exchange,
            ExchangeCredential.label == label,
        )
    )
    cred = res.scalar_one_or_none()
    if cred is None:
        cred = ExchangeCredential(user_id=int(user_id), exchange=exchange, label=label)
        session.add(cred)
    cred.api_key_enc = api_key_enc
    cred.secret_enc = secret_enc
    cred.key_fp = key_fp
    cred.can_trade = can_trade
    cred.can_withdraw = can_withdraw
    cred.ip_restricted = ip_restricted
    cred.is_testnet = is_testnet
    cred.is_active = True
    cred.last_error = ""
    await session.flush()
    return cred


async def list_credentials(session: AsyncSession, user_id: int) -> Sequence[ExchangeCredential]:
    res = await session.execute(
        select(ExchangeCredential).where(ExchangeCredential.user_id == int(user_id)).order_by(ExchangeCredential.created_at.desc())
    )
    return res.scalars().all()


async def count_credentials(session: AsyncSession, user_id: int) -> int:
    res = await session.execute(
        select(func.count(ExchangeCredential.id)).where(
            ExchangeCredential.user_id == int(user_id), ExchangeCredential.is_active.is_(True)
        )
    )
    return int(res.scalar_one() or 0)


async def get_active_credential(session: AsyncSession, user_id: int, *, exchange: str = "binance", label: str | None = None) -> ExchangeCredential | None:
    stmt = select(ExchangeCredential).where(
        ExchangeCredential.user_id == int(user_id),
        ExchangeCredential.exchange == exchange,
        ExchangeCredential.is_active.is_(True),
    )
    if label:
        stmt = stmt.where(ExchangeCredential.label == label)
    stmt = stmt.order_by(ExchangeCredential.created_at.desc()).limit(1)
    res = await session.execute(stmt)
    return res.scalar_one_or_none()


async def mark_credential_checked(session: AsyncSession, cred_id: int, *, ok: bool, error: str = "", perms: dict[str, Any] | None = None) -> None:
    values: dict[str, Any] = {"last_checked_at": _ms(), "last_error": "" if ok else error[:250]}
    if perms is not None:
        values["can_trade"] = bool(perms.get("can_trade", True))
        values["can_withdraw"] = bool(perms.get("can_withdraw", False))
        values["ip_restricted"] = bool(perms.get("ip_restricted", True))
    await session.execute(update(ExchangeCredential).where(ExchangeCredential.id == int(cred_id)).values(**values))
    await session.flush()


async def delete_credential(session: AsyncSession, cred_id: int, user_id: int) -> None:
    await session.execute(
        delete(ExchangeCredential).where(ExchangeCredential.id == int(cred_id), ExchangeCredential.user_id == int(user_id))
    )
    await session.flush()


# --------------------------------------------------------------------------- #
# Trades / positions
# --------------------------------------------------------------------------- #
async def record_trade(session: AsyncSession, **fields: Any) -> Trade:
    trade = Trade(**{k: v for k, v in fields.items() if hasattr(Trade, k)})
    session.add(trade)
    await session.flush()
    return trade


async def list_trades(
    session: AsyncSession,
    user_id: int,
    *,
    symbol: str | None = None,
    side: str | None = None,
    status: str | None = None,
    source: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> Sequence[Trade]:
    stmt = select(Trade).where(Trade.user_id == int(user_id))
    if symbol:
        stmt = stmt.where(Trade.symbol == symbol.upper())
    if side:
        stmt = stmt.where(Trade.side == side.upper())
    if status:
        stmt = stmt.where(Trade.status == status.upper())
    if source:
        stmt = stmt.where(Trade.source == source.lower())
    stmt = stmt.order_by(Trade.created_at_ms.desc()).limit(int(limit)).offset(int(offset))
    res = await session.execute(stmt)
    return res.scalars().all()


async def trade_stats(session: AsyncSession, user_id: int) -> dict[str, Any]:
    base = select(func.count(Trade.id), func.coalesce(func.sum(Trade.quote_qty), 0.0), func.coalesce(func.sum(Trade.fee_usd), 0.0), func.coalesce(func.sum(Trade.realized_pnl), 0.0)).where(Trade.user_id == int(user_id))
    total, volume, fees, pnl = (await session.execute(base)).one()
    wins = (
        await session.execute(
            select(func.count(Trade.id)).where(Trade.user_id == int(user_id), Trade.realized_pnl > 0)
        )
    ).scalar_one()
    losses = (
        await session.execute(
            select(func.count(Trade.id)).where(Trade.user_id == int(user_id), Trade.realized_pnl < 0)
        )
    ).scalar_one()
    closed = int(wins or 0) + int(losses or 0)
    gross_win = (
        await session.execute(
            select(func.coalesce(func.sum(Trade.realized_pnl), 0.0)).where(Trade.user_id == int(user_id), Trade.realized_pnl > 0)
        )
    ).scalar_one()
    gross_loss = abs(
        float(
            (
                await session.execute(
                    select(func.coalesce(func.sum(Trade.realized_pnl), 0.0)).where(
                        Trade.user_id == int(user_id), Trade.realized_pnl < 0
                    )
                )
            ).scalar_one()
        )
    )
    return {
        "orders": int(total or 0),
        "closed_trades": closed,
        "wins": int(wins or 0),
        "losses": int(losses or 0),
        "win_rate": round(100.0 * int(wins or 0) / closed, 2) if closed else 0.0,
        "volume_usd": round(float(volume or 0.0), 2),
        "fees_usd": round(float(fees or 0.0), 2),
        "realized_pnl": round(float(pnl or 0.0), 2),
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss else None,
        "avg_win": round(gross_win / wins, 2) if wins else 0.0,
        "avg_loss": round(-gross_loss / losses, 2) if losses else 0.0,
    }


async def realised_pnl_since(session: AsyncSession, user_id: int, since_ms: int) -> float:
    res = await session.execute(
        select(func.coalesce(func.sum(Trade.realized_pnl), 0.0)).where(
            Trade.user_id == int(user_id), Trade.created_at_ms >= since_ms
        )
    )
    return float(res.scalar_one() or 0.0)


async def get_position(session: AsyncSession, user_id: int, symbol: str, *, paper: bool) -> Position | None:
    res = await session.execute(
        select(Position).where(
            Position.user_id == int(user_id), Position.symbol == symbol.upper(), Position.paper.is_(paper)
        )
    )
    return res.scalar_one_or_none()


async def apply_fill(
    session: AsyncSession,
    user_id: int,
    *,
    symbol: str,
    side: str,
    qty: float,
    price: float,
    fee: float = 0.0,
    paper: bool = True,
    take_profit: float | None = None,
    stop_loss: float | None = None,
) -> tuple[Position, float]:
    """Update the average cost basis; returns (position, realised_pnl_delta)."""
    pos = await get_position(session, user_id, symbol, paper=paper)
    if pos is None:
        pos = Position(user_id=int(user_id), symbol=symbol.upper(), paper=paper)
        session.add(pos)
        await session.flush()
    realised = 0.0
    if side.upper() == "BUY":
        new_qty = pos.qty + qty
        pos.avg_price = ((pos.avg_price * pos.qty) + (price * qty) + fee) / new_qty if new_qty > 0 else price
        pos.qty = new_qty
        pos.cost_basis = pos.avg_price * pos.qty
    else:
        closed_qty = min(pos.qty, qty)
        realised = (price - pos.avg_price) * closed_qty - fee
        pos.qty = pos.qty - qty
        pos.realized_pnl += realised
        pos.cost_basis = pos.avg_price * max(pos.qty, 0.0)
        if pos.qty <= 1e-12:
            pos.qty = 0.0
            pos.avg_price = 0.0
            pos.cost_basis = 0.0
    if take_profit:
        pos.take_profit = take_profit
    if stop_loss:
        pos.stop_loss = stop_loss
    pos.updated_at_ms = _ms()
    await session.flush()
    return pos, realised


async def list_positions(session: AsyncSession, user_id: int, *, paper: bool | None = None) -> Sequence[Position]:
    stmt = select(Position).where(Position.user_id == int(user_id))
    if paper is not None:
        stmt = stmt.where(Position.paper.is_(paper))
    res = await session.execute(stmt)
    return res.scalars().all()


async def find_trade_by_client_id(session: AsyncSession, client_order_id: str) -> Trade | None:
    res = await session.execute(select(Trade).where(Trade.client_order_id == client_order_id))
    return res.scalar_one_or_none()


async def update_trade_status(session: AsyncSession, client_order_id: str, **fields: Any) -> None:
    fields["updated_at_ms"] = _ms()
    await session.execute(update(Trade).where(Trade.client_order_id == client_order_id).values(**fields))
    await session.flush()


# --------------------------------------------------------------------------- #
# AI artefacts
# --------------------------------------------------------------------------- #
async def save_signal(session: AsyncSession, **fields: Any) -> AiSignal:
    row = AiSignal(**{k: v for k, v in fields.items() if hasattr(AiSignal, k)})
    session.add(row)
    await session.flush()
    return row


async def recent_signals(session: AsyncSession, user_id: int | None, *, symbol: str | None = None, limit: int = 50) -> Sequence[AiSignal]:
    stmt = select(AiSignal)
    if user_id is not None:
        stmt = stmt.where((AiSignal.user_id == int(user_id)) | (AiSignal.user_id.is_(None)))
    if symbol:
        stmt = stmt.where(AiSignal.symbol == symbol.upper())
    res = await session.execute(stmt.order_by(AiSignal.created_at_ms.desc()).limit(int(limit)))
    return res.scalars().all()


async def log_auto_trade(session: AsyncSession, **fields: Any) -> AutoTradeLog:
    row = AutoTradeLog(**{k: v for k, v in fields.items() if hasattr(AutoTradeLog, k)})
    session.add(row)
    await session.flush()
    return row


async def auto_trade_log(session: AsyncSession, user_id: int, *, limit: int = 100) -> Sequence[AutoTradeLog]:
    res = await session.execute(
        select(AutoTradeLog).where(AutoTradeLog.user_id == int(user_id)).order_by(AutoTradeLog.created_at_ms.desc()).limit(int(limit))
    )
    return res.scalars().all()


# --------------------------------------------------------------------------- #
# Alerts / watchlist / notifications
# --------------------------------------------------------------------------- #
async def create_alert(session: AsyncSession, **fields: Any) -> PriceAlert:
    row = PriceAlert(**{k: v for k, v in fields.items() if hasattr(PriceAlert, k)})
    session.add(row)
    await session.flush()
    return row


async def list_alerts(session: AsyncSession, user_id: int, *, active_only: bool = False) -> Sequence[PriceAlert]:
    stmt = select(PriceAlert).where(PriceAlert.user_id == int(user_id))
    if active_only:
        stmt = stmt.where(PriceAlert.active.is_(True))
    res = await session.execute(stmt.order_by(PriceAlert.created_at.desc()))
    return res.scalars().all()


async def alert_by_id(session: AsyncSession, alert_id: int, user_id: int) -> PriceAlert | None:
    res = await session.execute(select(PriceAlert).where(PriceAlert.id == int(alert_id), PriceAlert.user_id == int(user_id)))
    return res.scalar_one_or_none()


async def delete_alert(session: AsyncSession, alert_id: int, user_id: int) -> bool:
    res = await session.execute(
        delete(PriceAlert).where(PriceAlert.id == int(alert_id), PriceAlert.user_id == int(user_id))
    )
    await session.flush()
    return bool(res.rowcount)


async def update_alert(session: AsyncSession, alert_id: int, user_id: int, **fields: Any) -> None:
    fields["last_triggered_at_ms"] = _ms()
    await session.execute(update(PriceAlert).where(PriceAlert.id == int(alert_id), PriceAlert.user_id == int(user_id)).values(**fields))
    await session.flush()


async def active_alerts_for_scan(session: AsyncSession) -> Sequence[PriceAlert]:
    res = await session.execute(
        select(PriceAlert, User.email)
        .join(User, User.id == PriceAlert.user_id)
        .where(PriceAlert.active.is_(True), User.is_active.is_(True))
    )
    return [row[0] for row in res.all()]


async def add_watch(session: AsyncSession, user_id: int, symbol: str, *, note: str = "") -> Watchlist:
    existing = await session.execute(
        select(Watchlist).where(Watchlist.user_id == int(user_id), Watchlist.symbol == symbol.upper())
    )
    row = existing.scalar_one_or_none()
    if row is None:
        row = Watchlist(user_id=int(user_id), symbol=symbol.upper(), note=note)
        session.add(row)
        await session.flush()
    return row


async def remove_watch(session: AsyncSession, user_id: int, symbol: str) -> bool:
    res = await session.execute(
        delete(Watchlist).where(Watchlist.user_id == int(user_id), Watchlist.symbol == symbol.upper())
    )
    await session.flush()
    return bool(res.rowcount)


async def list_watch(session: AsyncSession, user_id: int) -> Sequence[Watchlist]:
    res = await session.execute(select(Watchlist).where(Watchlist.user_id == int(user_id)).order_by(Watchlist.position.asc(), Watchlist.symbol.asc()))
    return res.scalars().all()


async def log_notification(session: AsyncSession, **fields: Any) -> NotificationLog:
    row = NotificationLog(**{k: v for k, v in fields.items() if hasattr(NotificationLog, k)})
    session.add(row)
    await session.flush()
    return row


async def list_notifications(session: AsyncSession, user_id: int, *, limit: int = 50) -> Sequence[NotificationLog]:
    res = await session.execute(
        select(NotificationLog).where(NotificationLog.user_id == int(user_id)).order_by(NotificationLog.created_at_ms.desc()).limit(int(limit))
    )
    return res.scalars().all()
