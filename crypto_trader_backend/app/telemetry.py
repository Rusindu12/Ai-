"""Lightweight metrics + request logging (Prometheus text exposition).

Deliberately dependency-free: a process-local counter registry exposed at
``/metrics`` in Prometheus format, plus in-flight latency histograms for the
dashboard.  Swap for ``prometheus-client``/OpenTelemetry in a larger fleet.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Any


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.counters: dict[str, float] = defaultdict(float)
        self.latency: dict[str, list[float]] = defaultdict(list)
        self.started_at = time.time()

    def inc(self, name: str, value: float = 1.0, **labels: Any) -> None:
        key = _key(name, labels)
        with self._lock:
            self.counters[key] += value

    def observe(self, name: str, seconds: float, **labels: Any) -> None:
        key = _key(name, labels)
        with self._lock:
            samples = self.latency[key]
            samples.append(seconds)
            if len(samples) > 2000:
                del samples[: len(samples) - 1000]

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            counters = dict(self.counters)
            lat = {k: _stats(v) for k, v in self.latency.items() if v}
        return {
            "uptime_s": round(time.time() - self.started_at, 1),
            "counters": counters,
            "latency_ms": lat,
        }

    def prometheus(self) -> str:
        lines = [
            "# HELP cryptotrader_uptime_seconds Process uptime",
            "# TYPE cryptotrader_uptime_seconds gauge",
            f"cryptotrader_uptime_seconds {time.time() - self.started_at:.1f}",
            "# HELP cryptotrader_requests_total Counter",
            "# TYPE cryptotrader_requests_total counter",
        ]
        with self._lock:
            for name, value in sorted(self.counters.items()):
                lines.append(f'cryptotrader_requests_total{{name="{name}"}} {value:g}')
            lines.append("# HELP cryptotrader_latency_ms Request latency in ms")
            lines.append("# TYPE cryptotrader_latency_ms summary")
            for name, samples in sorted(self.latency.items()):
                if not samples:
                    continue
                for k, v in _stats(samples).items():
                    lines.append(f'cryptotrader_latency_ms{{name="{name}",quantile="{k}"}} {v:g}')
        return "\n".join(lines) + "\n"


def _key(name: str, labels: dict[str, Any]) -> str:
    if not labels:
        return name
    inner = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
    return f"{name}[{inner}]"


def _stats(samples: list[float]) -> dict[str, float]:
    if not samples:
        return {}
    ordered = sorted(samples)
    n = len(ordered)

    def q(p: float) -> float:
        return round(ordered[min(n - 1, int(p * n))] * 1000.0, 2)

    return {"p50": q(0.50), "p95": q(0.95), "p99": q(0.99), "max": q(0.999), "count": float(n)}


metrics = Metrics()
