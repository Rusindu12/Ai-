"""Pytest configuration.

Environment is pinned *before* the app is imported so the settings singleton
picks up an isolated SQLite database, demo mode and deterministic simulator
seed.  A single app instance (with its lifespan) is shared by the whole session
because it owns the market-data background task.
"""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="ct_tests_"))

os.environ.update(
    {
        "ENV": "test",
        "DEMO_MODE": "true",
        "SIM_TICK_MS": "120",
        "SIM_SEED": "4242",
        "MARKETS": "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT",
        "DATABASE_URL": f"sqlite+aiosqlite:///{_TMP / 'test.db'}",
        "AI_MODEL_DIR": str(_TMP / "models"),
        "SECRET_KEY": "unit-test-secret-key-not-for-production",
        "ENCRYPTION_KEY": "3q2+7wR9kQZ0mVhTt7YpLsKdJnRfBxwCvUyEaMkPqoQ=",  # 32 random bytes, base64url
        "AUTO_TRADE_INTERVAL_S": "5",
        "AI_MIN_CONFIDENCE_PCT": "10",
        "RATE_LIMIT_PER_MIN": "100000",
        "ORDER_RATE_LIMIT_PER_MIN": "100000",
        "TRADE_COOLDOWN_S": "0",
        "LOG_LEVEL": "WARNING",
        "FIREBASE_CREDENTIALS_PATH": "",
        "FCM_ENABLED": "false",
        "FIRESTORE_ENABLED": "false",
        "ENABLE_SOCKETIO": "false",
    }
)

import asyncio  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest_asyncio.fixture(scope="session", autouse=True)
def _event_loop_policy() -> None:
    asyncio.set_event_loop_policy(asyncio.DefaultEventLoopPolicy())


@pytest_asyncio.fixture(scope="session")
async def app():
    from app.main import create_app

    application = create_app()
    async with application.router.lifespan_context(application):
        yield application


@pytest_asyncio.fixture(scope="session")
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=60.0) as ac:
        yield ac


@pytest_asyncio.fixture(scope="session")
async def hub(app):
    return app.state.hub


@pytest_asyncio.fixture(scope="session")
async def auth(client) -> dict:
    """Register a throwaway account and return tokens + profile."""
    import time

    email = f"pytest{int(time.time())}@example.com"
    password = "pytest-password-1"
    r = await client.post("/api/auth/signup", json={"email": email, "password": password, "name": "Py Test"})
    assert r.status_code == 201, r.text
    body = r.json()
    return {
        "email": email,
        "password": password,
        "user_id": body["user"]["id"],
        "access_token": body["access_token"],
        "refresh_token": body["refresh_token"],
        "user": body["user"],
    }


@pytest.fixture(scope="session")
def api(auth) -> dict[str, str]:
    return {"Authorization": f"Bearer {auth['access_token']}"}


@pytest_asyncio.fixture
async def db_session():
    from app.db.base import session_scope

    async with session_scope() as session:
        yield session


@pytest_asyncio.fixture
async def fresh_user(client) -> dict:
    """A brand-new account per test (trading state must not leak between tests)."""
    email = f"fresh{time.time_ns()}@example.com"
    password = "fresh-password-1"
    r = await client.post("/api/auth/signup", json={"email": email, "password": password, "name": "Fresh"})
    assert r.status_code == 201, r.text
    body = r.json()
    return {
        "email": email,
        "password": password,
        "user_id": body["user"]["id"],
        "access_token": body["access_token"],
        "refresh_token": body["refresh_token"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


@pytest.fixture(autouse=True)
def _reset_risk_state():
    """The risk manager keeps per-user counters in memory - isolate tests."""
    from app.risk.manager import risk_manager

    risk_manager.reset()
    yield
    risk_manager.reset()
