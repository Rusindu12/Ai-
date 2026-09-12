# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# CryptoTrader backend — signed Binance relay + AI engine.
#
#   docker build -t cryptotrader-backend ./crypto_trader_backend
#   docker run --rm -p 8000:8000 -e DEMO_MODE=true cryptotrader-backend
#
# Multi-stage: the venv is built with wheels in the builder layer and copied
# into a slim runtime image, so the final image has no compiler toolchain.
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

# pandas/numpy ship manylinux wheels; no build deps needed for our pin set.
COPY requirements.txt ./
RUN python -m venv /opt/venv && /opt/venv/bin/pip install -r requirements.txt

COPY . ./
# Compile-check the package at build time: a syntax error must never ship.
RUN /opt/venv/bin/python -m compileall -q app && \
    /opt/venv/bin/python -c "import app.main as m; a=m.create_app(); print('openapi routes:', len(a.openapi()['paths']))"

FROM python:3.11-slim AS runtime

LABEL org.opencontainers.image.title="crypto-trader-backend" \
      org.opencontainers.image.description="FastAPI backend: Binance signed REST/WS relay, AI signals, risk-managed order routing" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    DATA_DIR=/data \
    ENV=production

RUN groupadd -r app && useradd -r -g app -d /data -s /usr/sbin/nologin app \
    && mkdir -p /data && chown -R app:app /data

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /build/app ./app

USER app
WORKDIR /app
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=20s --timeout=4s --start-period=15s --retries=5 \
  CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/ready',timeout=3).status==200 else 1)"

# 2 workers: the market hub + websocket fan-out live in-process, so each worker
# keeps its own cache. Set WEB_CONCURRENCY=1 if you want one shared hub.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-1} --proxy-headers --forwarded-allow-ips='*'"]
