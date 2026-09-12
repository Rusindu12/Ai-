"""WebSocket route (the app's live data channel).

The Flutter client connects to ``/ws?token=<jwt>``.  An unauthenticated socket is
allowed for public market data only (tickers/candles/depth); account and order
events require the ``auth`` op or the query token.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, WebSocket

from app.services.realtime import realtime_hub, serve_socket

router = APIRouter(tags=["realtime"])


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str | None = Query(default=None)) -> None:
    await serve_socket(websocket, realtime_hub, token=token)


@router.get("/api/realtime/stats")
async def stats() -> dict:
    return realtime_hub.status()
