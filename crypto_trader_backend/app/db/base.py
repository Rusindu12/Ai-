"""Async SQLAlchemy engine / session plumbing."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

log = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        url = settings.DATABASE_URL
        kwargs: dict = {"echo": settings.DB_ECHO, "future": True}
        if url.startswith("sqlite"):
            # SQLite is only used for dev/tests: WAL + a busy timeout keep the
            # background jobs (notifications, auto-trader) from hitting locks.
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
            _install_sqlite_pragmas(kwargs)
        else:
            kwargs.update(
                pool_size=settings.DB_POOL_SIZE,
                max_overflow=settings.DB_MAX_OVERFLOW,
                pool_pre_ping=True,
                pool_recycle=1800,
            )
        _engine = create_async_engine(url, **kwargs)
        log.info("database engine ready (%s)", url.split("+")[0])
    return _engine


def _install_sqlite_pragmas(kwargs: dict) -> None:
    """WAL + busy_timeout + synchronous=NORMAL on every SQLite connection."""
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    global _PRAGMAS_INSTALLED
    if not _PRAGMAS_INSTALLED:
        _PRAGMAS_INSTALLED = True

        @event.listens_for(Engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, connection_record):
            try:
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA busy_timeout=15000")
                cursor.execute("PRAGMA synchronous=NORMAL")
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()
            except Exception:  # pragma: no cover - non-sqlite drivers
                pass


_PRAGMAS_INSTALLED = False


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(), expire_on_commit=False, autoflush=False
        )
    return _session_factory


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Transactional scope used by background services."""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency."""
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def init_db() -> None:
    engine = get_engine()
    if settings.AUTO_CREATE_SCHEMA:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        log.info("schema ensured (%d tables)", len(Base.metadata.tables))


async def dispose_db() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
