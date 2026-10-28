FROM node:24-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    ADLEY_STATIC_DIR=/app/frontend/dist

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser

COPY backend/app backend/app
COPY --from=frontend-build /build/frontend/dist frontend/dist

USER appuser

# Render injects PORT (10000 by default) and requires the app to bind 0.0.0.0.
# The 8000 fallback keeps `docker compose` and plain local runs working.
# EXPOSE is intentionally omitted: Render uses PORT, and Compose declares its
# own internal port explicitly.
ENV PORT=8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; port = os.environ.get('PORT', '8000'); urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=3).read()"

WORKDIR /app/backend
# One worker is intentional: rate-limit and failed-login state is in memory.
# In the provided deployments the app port is not published directly. Caddy
# (Compose) or Render's edge proxy is the sole entry point. The app reads
# CF-Connecting-IP or X-Forwarded-For for rate limiting only when the matching
# ADLEY_TRUST_CLOUDFLARE / ADLEY_TRUST_PROXY setting is enabled, so uvicorn is
# not told to trust forwarding headers from arbitrary peers.
CMD ["sh", "-c", "exec uvicorn app.asgi:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
