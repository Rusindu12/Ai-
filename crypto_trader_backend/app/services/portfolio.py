"""Portfolio construction: balances + live prices + P&L + allocation.

Used by ``GET /api/account`` (dashboard + portfolio screen) and by the AI
auto-trader for position sizing.

Live mode reads the exchange's own balances; paper/demo mode reads the virtual
ledger.  Everything is valued in USDT using the hub's cached tickers so the
endpoint is ~O(1) regardless of how many assets the user holds.
"""

from __future__ import annotations

import csv
import io
import logging
import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import repo
from app.db.models import User
from app.services import accounts
from app.services.gateway import get_gateway

log = logging.getLogger(__name__)

STABLES = {"USDT", "BUSD", "USDC", "FDUSD", "TUSD", "DAI", "USDP", "USDD", "EUR", "USDE"}


class PortfolioService:
    def __init__(self, hub: Any = None) -> None:
        self.hub = hub

    def attach_hub(self, hub: Any) -> None:
        self.hub = hub

    # ------------------------------------------------------------------ prices
    def price_of(self, asset: str) -> tuple[float, str | None, float]:
        """Return (price, symbol_used, change_pct) for a base asset."""
        if asset in STABLES:
            return 1.0, None, 0.0
        for cand in (f"{asset}USDT", f"{asset}BUSD", f"{asset}USDC"):
            if self.hub is not None:
                t = self.hub.ticker(cand)
                if t and t.get("price"):
                    return float(t["price"]), cand, float(t.get("change_percent_24h") or 0.0)
        return 0.0, None, 0.0

    async def sparkline(self, symbol: str | None, points: int = 32) -> list[float]:
        if not symbol or self.hub is None:
            return []
        gateway = await get_gateway()
        if getattr(gateway, "is_simulated", False):
            try:
                return gateway.sparkline(symbol, points)
            except Exception:  # pragma: no cover
                return []
        try:
            rows = await self.hub.get_candles(symbol, "1h", points)
            return [round(float(r["close"]), 8) for r in rows[-points:]]
        except Exception:  # pragma: no cover - cosmetic
            return []

    # -------------------------------------------------------------- snapshots
    async def build(self, session: AsyncSession, user: User, *, include_series: bool = True) -> dict[str, Any]:
        gateway = await get_gateway()
        creds = await accounts.resolve_creds(session, user)
        paper = settings.DEMO_MODE or creds.paper

        balances = await self._balances(session, user, gateway, creds, paper=paper)
        holdings: list[dict[str, Any]] = []
        cash: dict[str, float] = {}
        total = 0.0
        prev_total = 0.0
        positions = {p.symbol: p for p in await repo.list_positions(session, user.id, paper=True)}
        if not paper:
            for p in await repo.list_positions(session, user.id, paper=False):
                positions.setdefault(p.symbol, p)

        for asset, qty in sorted(balances.items(), key=lambda kv: -kv[1]):
            if qty <= 0:
                continue
            price, symbol, chg = self.price_of(asset)
            value = price * qty
            if asset in STABLES:
                cash[asset] = round(value, 4)
                total += value
                prev_total += value
                continue
            pos = positions.get(f"{asset}{symbol_suffix(symbol)}") if symbol else None
            avg = float(pos.avg_price) if pos and pos.avg_price else 0.0
            upnl = (price - avg) * qty if avg else 0.0
            holdings.append(
                {
                    "asset": asset,
                    "symbol": symbol,
                    "name": ASSET_NAMES.get(asset, asset),
                    "amount": round(qty, 8),
                    "price": round(price, 8),
                    "value_usd": round(value, 2),
                    "change_24h_pct": round(chg, 2),
                    "change_24h_usd": round(value * chg / 100.0, 2) if chg else 0.0,
                    "avg_buy_price": round(avg, 8),
                    "unrealized_pnl": round(upnl, 2),
                    "unrealized_pnl_pct": round((price / avg - 1.0) * 100.0, 2) if avg else None,
                    "cost_basis": round(avg * qty, 2) if avg else None,
                    "allocation_pct": 0.0,  # filled below
                    "sparkline": await self.sparkline(symbol, 32) if include_series and symbol else [],
                    "position": (
                        {
                            "qty": round(pos.qty, 8),
                            "avg_price": round(pos.avg_price, 8),
                            "take_profit": pos.take_profit,
                            "stop_loss": pos.stop_loss,
                            "realized_pnl": round(pos.realized_pnl, 2),
                        }
                        if pos is not None
                        else None
                    ),
                }
            )
            total += value
            prev_total += value / (1.0 + chg / 100.0) if chg not in (None, -100.0) else value

        for h in holdings:
            h["allocation_pct"] = round(100.0 * h["value_usd"] / total, 2) if total else 0.0
        holdings.sort(key=lambda h: -h["value_usd"])
        cash_total = round(sum(cash.values()), 2)
        change_usd = total - prev_total
        stats = await repo.trade_stats(session, user.id)

        return {
            "generated_at_ms": int(time.time() * 1000),
            "currency": "USD",
            "mode": "demo" if settings.DEMO_MODE else ("paper" if paper else "live"),
            "paper_trading": bool(paper),
            "total_value_usd": round(total, 2),
            "invested_value_usd": round(total - cash_total, 2),
            "cash_usd": cash_total,
            "cash_balances": cash,
            "change_24h_usd": round(change_usd, 2),
            "change_24h_pct": round(100.0 * change_usd / prev_total, 2) if prev_total else 0.0,
            "holdings": holdings,
            "allocation": [
                {"asset": h["asset"], "label": h["name"], "value_usd": h["value_usd"], "pct": h["allocation_pct"], "color_seed": _color_seed(h["asset"])}
                for h in holdings
            ]
            + ([{"asset": "CASH", "label": "USDT cash", "value_usd": cash_total, "pct": round(100.0 * cash_total / total, 2) if total else 0.0, "color_seed": 0}] if cash_total else []),
            "performance": {
                "realized_pnl": stats["realized_pnl"],
                "fees_paid": stats["fees_usd"],
                "volume": stats["volume_usd"],
                "orders": stats["orders"],
                "closed_trades": stats["closed_trades"],
                "wins": stats["wins"],
                "losses": stats["losses"],
                "win_rate": stats["win_rate"],
                "profit_factor": stats["profit_factor"],
                "avg_win": stats["avg_win"],
                "avg_loss": stats["avg_loss"],
                "daily_loss_limit_usd": float(getattr(user, "daily_loss_limit_usd", 0.0) or 0.0),
                "realized_today": round(await repo.realised_pnl_since(session, user.id, _utc_midnight_ms()), 2),
            },
            "exchange": {
                "name": "simulated" if settings.DEMO_MODE else "binance",
                "can_withdraw": False,
                "key_label": creds.label,
            },
        }

    async def _balances(self, session: AsyncSession, user: User, gateway: Any, creds: Any, paper: bool) -> dict[str, float]:
        """asset -> free quantity."""
        out: dict[str, float] = {}
        if settings.DEMO_MODE:
            acct = await gateway.account(creds)
            for b in acct.get("balances", []):
                out[b["asset"]] = out.get(b["asset"], 0.0) + float(b["free"])
            return out
        if paper:
            state = await accounts.paper_state(user)
            for asset, qty in state.items():
                if qty > 1e-9:
                    out[asset] = float(qty)
            for pos in await repo.list_positions(session, user.id, paper=True):
                base = pos.symbol.replace("USDT", "").replace("BUSD", "").replace("USDC", "")
                if pos.qty > 1e-9 and base not in out:
                    out[base] = pos.qty
            return out

        try:
            acct = await gateway.account(creds)
        except Exception as exc:
            log.warning("exchange account fetch failed: %s", exc)
            return {"USDT": 0.0}
        for b in acct.get("balances", []):
            if float(b["free"]) > 1e-9:
                out[b["asset"]] = float(b["free"])
        return out

    # ------------------------------------------------------------------ export
    async def export_csv(self, session: AsyncSession, user: User, *, kind: str = "trades") -> str:
        buf = io.StringIO()
        writer = csv.writer(buf)
        if kind == "portfolio":
            snap = await self.build(session, user, include_series=False)
            writer.writerow(["asset", "symbol", "amount", "price_usd", "value_usd", "avg_buy_price", "unrealized_pnl", "change_24h_pct", "allocation_pct"])
            for h in snap["holdings"]:
                writer.writerow([h["asset"], h["symbol"], h["amount"], h["price"], h["value_usd"], h["avg_buy_price"], h["unrealized_pnl"], h["change_24h_pct"], h["allocation_pct"]])
            writer.writerow(["CASH", "", "", 1.0, snap["cash_usd"], "", "", "", ""])
            writer.writerow(["TOTAL", "", "", "", snap["total_value_usd"], "", snap["performance"]["realized_pnl"], snap["change_24h_pct"], ""])
            return buf.getvalue()
        trades = await repo.list_trades(session, user.id, limit=5000)
        writer.writerow(["time_iso", "exchange", "symbol", "side", "type", "qty", "price", "notional_usd", "fee_usd", "realized_pnl_usd", "status", "source", "paper", "client_order_id", "order_id"])
        for t in trades:
            writer.writerow(
                [
                    time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime((t.created_at_ms or 0) / 1000.0)),
                    t.exchange,
                    t.symbol,
                    t.side,
                    t.order_type,
                    f"{t.qty:.8f}",
                    f"{t.price:.8f}",
                    f"{t.quote_qty:.6f}",
                    f"{t.fee_usd:.6f}",
                    f"{t.realized_pnl:.4f}",
                    t.status,
                    t.source,
                    str(bool(t.paper)).lower(),
                    t.client_order_id,
                    t.order_id,
                ]
            )
        return buf.getvalue()


def symbol_suffix(symbol: str | None) -> str:
    if not symbol:
        return ""
    for suffix in ("USDT", "BUSD", "USDC"):
        if symbol.endswith(suffix):
            return suffix
    return ""


def _color_seed(asset: str) -> int:
    return int.from_bytes(asset.encode()[:3].ljust(3, b"X"), "big") % 360


def _utc_midnight_ms() -> int:
    now = time.gmtime()
    return int(time.mktime((now.tm_year, now.tm_mon, now.tm_mday, 0, 0, 0, 0, 0, 0)) * 1000)


ASSET_NAMES = {
    "BTC": "Bitcoin",
    "ETH": "Ethereum",
    "BNB": "BNB",
    "SOL": "Solana",
    "XRP": "XRP",
    "ADA": "Cardano",
    "DOGE": "Dogecoin",
    "AVAX": "Avalanche",
    "LINK": "Chainlink",
    "MATIC": "Polygon",
    "LTC": "Litecoin",
    "DOT": "Polkadot",
    "TRX": "TRON",
    "ATOM": "Cosmos",
    "USDT": "Tether USD",
    "BUSD": "Binance USD",
    "USDC": "USD Coin",
}


portfolio_service = PortfolioService()
