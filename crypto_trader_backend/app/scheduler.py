"""Background jobs (no external scheduler dependency).

* **weekly auto-retrain** - refits LSTM + classifier on the freshest klines,
  writes a new artifact version and hot-swaps it (see :mod:`app.ai.train`)
* **token hygiene** - purges expired refresh tokens / revoked jtis daily
* **market snapshot** - periodically warms candles for tracked symbols
* **daily market summary push** - optional notification to opted-in users

Intervals are deliberately coarse; heavy work runs in a lock so a slow training
run can never overlap itself.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Callable, Coroutine
from typing import Any

from app.config import settings

log = logging.getLogger(__name__)


class Job:
    def __init__(self, name: str, fn: Callable[[], Coroutine[Any, Any, dict[str, Any] | None]], interval_s: float, *, initial_delay_s: float = 0.0) -> None:
        self.name = name
        self.fn = fn
        self.interval_s = interval_s
        self.initial_delay_s = initial_delay_s
        self.runs = 0
        self.errors = 0
        self.last_run_ms = 0
        self.last_result: dict[str, Any] | None = None
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name=f"job-{self.name}")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _loop(self) -> None:
        if self.initial_delay_s:
            await asyncio.sleep(self.initial_delay_s)
        while True:
            if not self._lock.locked():
                try:
                    async with self._lock:
                        self.last_result = await self.fn()
                        self.runs += 1
                        self.last_run_ms = int(time.time() * 1000)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    self.errors += 1
                    log.warning("job %s failed: %s", self.name, exc, exc_info=True)
            await asyncio.sleep(self.interval_s)

    def status(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "interval_s": self.interval_s,
            "runs": self.runs,
            "errors": self.errors,
            "last_run_ms": self.last_run_ms,
            "last_result": self.last_result,
            "next_in_s": max(0, round(self.interval_s - (time.time() - self.last_run_ms / 1000.0), 1)) if self.last_run_ms else None,
        }


class Scheduler:
    def __init__(self) -> None:
        self.jobs: list[Job] = []

    def add(self, job: Job) -> Job:
        self.jobs.append(job)
        return job

    async def start(self) -> None:
        for job in self.jobs:
            await job.start()
        log.info("scheduler started with %d job(s)", len(self.jobs))

    async def stop(self) -> None:
        for job in self.jobs:
            await job.stop()

    def status(self) -> dict[str, Any]:
        return {"jobs": [j.status() for j in self.jobs]}


def build_scheduler(hub: Any, auto_trader: Any) -> Scheduler:
    from app.db import repo
    from app.db.base import session_scope

    scheduler = Scheduler()

    async def retrain() -> dict[str, Any]:
        from app.ai.registry import registry
        from app.ai.train import train_models

        bundle = registry.ensure_loaded()
        age_h = (time.time() - bundle.trained_at) / 3600.0 if bundle.trained_at else float("inf")
        if age_h < settings.AI_RETRAIN_DAYS * 24:
            return {"skipped": True, "model_age_hours": round(age_h, 1), "retrain_after_days": settings.AI_RETRAIN_DAYS}
        report = await train_models(symbols=settings.MARKETS[:4], interval="1h", bars=6000, epochs_lstm=18, epochs_clf=120)
        return {"retrained": True, "previous_age_hours": None if age_h == float("inf") else round(age_h, 1), "report": dict(report)}

    async def token_hygiene() -> dict[str, Any]:
        async with session_scope() as session:
            removed = await repo.purge_expired_tokens(session)
        return {"removed": removed}

    async def warm_cache() -> dict[str, Any]:
        symbols = list(hub.symbols or [])[:8]
        for sym in symbols:
            with contextlib.suppress(Exception):
                await hub.load_candles(sym, "1m", 400)
                await hub.load_candles(sym, "1h", 400)
        return {"warmed": len(symbols)}

    async def daily_summary() -> dict[str, Any]:
        from app.services.notifications import notification_service

        rows = hub.all_ticker_rows()
        if not rows:
            return {"skipped": True}
        ups = len([r for r in rows if (r.get("change_percent_24h") or 0) > 0])
        avg = sum((r.get("change_percent_24h") or 0) for r in rows) / len(rows)
        user_ids = list(hub.connected_user_ids())
        for uid in user_ids:
            await notification_service.push(
                user_id=uid,
                kind="system",
                title="Daily market summary",
                body=f"{len(rows)} tracked pairs: {ups} up / {len(rows) - ups} down, average {avg:+.2f}% over 24h",
                data={"avg_change_pct": round(avg, 2), "advancers": ups},
            )
        return {"pushed": len(user_ids)}

    scheduler.add(Job("ai-retrain", retrain, 6 * 3600.0, initial_delay_s=90.0))
    scheduler.add(Job("token-hygiene", token_hygiene, 3600.0, initial_delay_s=30.0))
    scheduler.add(Job("warm-cache", warm_cache, 900.0, initial_delay_s=10.0))
    if settings.FCM_ENABLED:
        scheduler.add(Job("daily-summary", daily_summary, 86_400.0, initial_delay_s=120.0))
    return scheduler
