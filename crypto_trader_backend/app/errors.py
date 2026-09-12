"""Structured logging + exception plumbing."""

from __future__ import annotations

import logging
import sys
import time
from typing import Any

_CTX: dict[str, Any] = {}


def configure_logging(level: str = "INFO", json_logs: bool = False) -> None:
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(sys.stdout)
    if json_logs:
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)-7s %(name)-28s %(message)s",
                datefmt="%H:%M:%S",
            )
        )
    root.addHandler(handler)

    for noisy in ("uvicorn.access", "httpx", "httpcore", "websockets.client"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        import json

        payload = {
            "ts": round(time.time(), 3),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        payload.update(_CTX)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def bind_log_context(**kwargs: Any) -> None:
    _CTX.update(kwargs)


def clear_log_context() -> None:
    _CTX.clear()


class BackendError(Exception):
    """Base class for domain errors that map cleanly onto HTTP responses."""

    status_code: int = 500
    error_code: str = "internal_error"

    def __init__(self, message: str = "", *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message or self.__class__.__name__)
        self.message = message or self.__class__.__name__
        self.details = details or {}


class AuthError(BackendError):
    status_code = 401
    error_code = "unauthorized"


class PermissionError_(BackendError):
    status_code = 403
    error_code = "forbidden"


class ValidationError_(BackendError):
    status_code = 422
    error_code = "validation_error"


class RateLimitedError(BackendError):
    status_code = 429
    error_code = "rate_limited"

    def __init__(self, message: str = "too many requests", *, retry_after_s: float = 1.0) -> None:
        super().__init__(message)
        self.retry_after_s = retry_after_s


class BinanceUpstreamError(BackendError):
    status_code = 502
    error_code = "binance_upstream_error"


class ConflictError(BackendError):
    """Resource is in a state that forbids the requested transition."""

    status_code = 409
    error_code = "conflict"


class InsufficientFundsError(BackendError):
    status_code = 400
    error_code = "insufficient_funds"


class RiskLimitError(BackendError):
    status_code = 400
    error_code = "risk_limit_breached"
