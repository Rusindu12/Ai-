"""Market data endpoints (prices, candles, order book, symbols, watchlist).

Every route is served from the in-memory hub cache, so the app can poll freely
without spending Binance request weight.  Paths follow the agreed contract:

    GET /api/prices
    GET /api/klines/{symbol}/{interval}
    GET /api/orderbook/{symbol}
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, get_hub, optional_user, rate_limit
from app.api.schemas import WatchRequest
from app.db import repo
from app.db.base import get_session
from app.db.models import User
from app.errors import ValidationError_
from app.services.gateway import get_gateway

router = APIRouter(tags=["market"], dependencies=[Depends(rate_limit)])


@router.get("/api/prices")
async def prices(
    request: Request,
    symbols: str | None = Query(default=None, description="comma separated list"),
    hub: Any = Depends(get_hub),
) -> dict[str, Any]:
    wanted = [s.strip().upper() for s in symbols.split(",")] if symbols else None
    rows = hub.all_ticker_rows(wanted)
    return {
        "count": len(rows),
        "prices": rows,
        "as_json": {r["symbol"]: r["price"] for r in rows},
        "generated_at_ms": rows[0]["updated_at_ms"] if rows else 0,
        "source": hub.status(),
    }


@router.get("/api/prices/{symbol}")
async def price_one(symbol: str, hub: Any = Depends(get_hub)) -> dict[str, Any]:
    row = hub.ticker(symbol)
    if not row:
        await hub.refresh_symbol(symbol.upper())
        row = hub.ticker(symbol)
    if not row:
        raise ValidationError_(f"unknown symbol {symbol}")
    return row


@router.get("/api/klines/{symbol}/{interval}")
async def klines(
    symbol: str,
    interval: str,
    request: Request,
    limit: int = Query(default=300, ge=5, le=1000),
    with_indicators: bool = Query(default=False),
    hub: Any = Depends(get_hub),
) -> dict[str, Any]:
    from app.ai import indicators as ind

    interval = interval.lower().strip()
    bars = await hub.get_candles(symbol.upper(), interval, limit)
    if not bars:
        raise ValidationError_(f"no candles for {symbol.upper()} {interval}")
    payload: dict[str, Any] = {
        "symbol": symbol.upper(),
        "interval": interval,
        "count": len(bars),
        "candles": bars,
        # convenience arrays for the chart widget
        "times": [b["open_time"] for b in bars],
        "open": [b["open"] for b in bars],
        "high": [b["high"] for b in bars],
        "low": [b["low"] for b in bars],
        "close": [b["close"] for b in bars],
        "volume": [b["volume"] for b in bars],
        "last_close": bars[-1]["close"],
        "change_percent": round((bars[-1]["close"] / bars[0]["open"] - 1) * 100, 3) if bars[0]["open"] else 0.0,
    }
    if with_indicators and len(bars) >= 60:
        try:
            payload["indicators"] = ind.compute(bars, symbol.upper(), interval).as_dict()
        except Exception as exc:  # pragma: no cover
            payload["indicator_error"] = str(exc)
    return payload


@router.get("/api/orderbook/{symbol}")
async def orderbook(
    symbol: str,
    depth: int = Query(default=20, ge=5, le=100),
    hub: Any = Depends(get_hub),
) -> dict[str, Any]:
    book = await hub.get_depth(symbol.upper(), depth)
    bids, asks = book.get("bids", []), book.get("asks", [])
    best_bid = bids[0][0] if bids else 0.0
    best_ask = asks[0][0] if asks else 0.0
    mid = (best_bid + best_ask) / 2 if best_bid and best_ask else (bids[0][0] if bids else 0.0)
    bid_qty = sum(q for _, q in bids)
    ask_qty = sum(q for _, q in asks)
    imbalance = (bid_qty - ask_qty) / (bid_qty + ask_qty) if (bid_qty + ask_qty) else 0.0
    return {
        "symbol": symbol.upper(),
        "bids": bids,
        "asks": asks,
        "best_bid": best_bid,
        "best_ask": best_ask,
        "mid_price": round(mid, 8),
        "spread": round(best_ask - best_bid, 8) if best_ask and best_bid else None,
        "spread_bps": round((best_ask - best_bid) / mid * 10_000, 2) if mid else None,
        "bid_depth": round(bid_qty, 6),
        "ask_depth": round(ask_qty, 6),
        "imbalance": round(imbalance, 4),
        "last_update_id": book.get("lastUpdateId"),
        "from_cache": bool(book.get("cached", False)),
    }


@router.get("/api/recent-trades/{symbol}")
async def recent_trades(symbol: str, limit: int = Query(default=40, ge=1, le=100), hub: Any = Depends(get_hub)) -> dict[str, Any]:
    rows = list(hub.recent_trades.get(symbol.upper(), []))[-limit:][::-1]
    return {"symbol": symbol.upper(), "count": len(rows), "trades": rows}


@router.get("/api/sparklines")
async def sparklines(points: int = Query(default=32, ge=8, le=200), hub: Any = Depends(get_hub)) -> dict[str, Any]:
    gateway = await get_gateway()
    out: dict[str, list[float]] = {}
    for sym in hub.symbols:
        if getattr(gateway, "is_simulated", False):
            out[sym] = gateway.sparkline(sym, points)
        else:
            bars = await hub.get_candles(sym, "1h", points)
            out[sym] = [round(float(b["close"]), 8) for b in bars[-points:]]
    return {"points": points, "series": out}


@router.get("/api/symbols")
async def symbols(hub: Any = Depends(get_hub)) -> dict[str, Any]:
    """Instrument metadata for the pair picker (multi-select screens)."""
    gateway = await get_gateway()
    info = await gateway.exchange_info()
    from app.services.portfolio import ASSET_NAMES, STABLES

    rows = []
    for entry in info.get("symbols", []):
        if entry.get("status") not in (None, "TRADING"):
            continue
        quote = entry.get("quoteAsset", "USDT")
        if quote not in STABLES:
            continue
        base = entry.get("baseAsset") or ""
        rows.append(
            {
                "symbol": entry.get("symbol"),
                "base": base,
                "quote": quote,
                "name": ASSET_NAMES.get(base, base),
                "tracked": entry.get("symbol") in hub.symbols,
                "filters": entry.get("filters", []),
            }
        )
    tracked = [r for r in rows if r["tracked"]]
    others = sorted((r for r in rows if not r["tracked"]), key=lambda r: r["symbol"])
    return {"count": len(rows), "tracked": tracked, "symbols": tracked + others[:400]}


@router.get("/api/market/summary")
async def market_summary(hub: Any = Depends(get_hub)) -> dict[str, Any]:
    rows = hub.all_ticker_rows()
    gainers = sorted(rows, key=lambda r: -(r.get("change_percent_24h") or 0))[:5]
    losers = sorted(rows, key=lambda r: (r.get("change_percent_24h") or 0))[:5]
    return {
        "tracked": len(rows),
        "total_quote_volume_usd": round(sum(r.get("quote_volume_24h") or 0 for r in rows), 2),
        "advancers": len([r for r in rows if (r.get("change_percent_24h") or 0) > 0]),
        "decliners": len([r for r in rows if (r.get("change_percent_24h") or 0) < 0]),
        "gainers": gainers,
        "losers": losers,
        "status": hub.status(),
    }


@router.get("/api/watchlist")
async def get_watchlist(user: User | None = Depends(optional_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    if user is None:
        return {"watchlist": [], "note": "sign in to persist a watchlist"}
    rows = list(await repo.list_watch(session, user.id))
    return {"watchlist": [{"symbol": r.symbol, "note": r.note, "position": r.position} for r in rows]}


@router.post("/api/watchlist", status_code=201)
async def add_watch(body: WatchRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    row = await repo.add_watch(session, user.id, body.symbol, note=body.note)
    await session.commit()
    return {"added": True, "symbol": row.symbol}


@router.delete("/api/watchlist/{symbol}")
async def remove_watch(symbol: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    removed = await repo.remove_watch(session, user.id, symbol.upper())
    await session.commit()
    return {"removed": removed, "symbol": symbol.upper()}
