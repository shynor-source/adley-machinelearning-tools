from __future__ import annotations

import math
import threading
import time
from collections import deque
from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from .config import Settings


@dataclass(slots=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    retry_after: int
    window: int


class SlidingWindowLimiter:
    """Small in-memory limiter suitable for a single-process deployment."""

    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()
        self._operations = 0

    def hit(self, ip: str, bucket: str, limit: int, window: int) -> RateLimitDecision:
        now = time.monotonic()
        key = (ip, bucket)
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            cutoff = now - window
            while hits and hits[0] <= cutoff:
                hits.popleft()

            self._operations += 1
            if self._operations % 250 == 0:
                self._cleanup(now)

            if len(hits) >= limit:
                retry_after = max(1, math.ceil(window - (now - hits[0])))
                return RateLimitDecision(False, limit, 0, retry_after, window)

            hits.append(now)
            remaining = max(0, limit - len(hits))
            return RateLimitDecision(True, limit, remaining, 0, window)

    def _cleanup(self, now: float) -> None:
        stale: list[tuple[str, str]] = []
        for key, hits in self._hits.items():
            while hits and hits[0] <= now - 3600:
                hits.popleft()
            if not hits:
                stale.append(key)
        for key in stale:
            self._hits.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


class FailedLoginGuard:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._failures: dict[str, deque[float]] = {}
        self._blocked_until: dict[str, float] = {}
        self._lock = threading.Lock()
        self._operations = 0

    def retry_after(self, ip: str) -> int:
        now = time.monotonic()
        with self._lock:
            self._operations += 1
            if self._operations % 250 == 0:
                self._cleanup(now)
            blocked = self._blocked_until.get(ip, 0)
            if blocked > now:
                return max(1, math.ceil(blocked - now))
            self._blocked_until.pop(ip, None)
            return 0

    def record_failure(self, ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._operations += 1
            if self._operations % 250 == 0:
                self._cleanup(now)
            failures = self._failures.setdefault(ip, deque())
            cutoff = now - self._settings.failed_login_window
            while failures and failures[0] <= cutoff:
                failures.popleft()
            failures.append(now)
            if len(failures) >= self._settings.failed_login_limit:
                self._blocked_until[ip] = now + self._settings.failed_login_block
                failures.clear()

    def clear(self, ip: str) -> None:
        with self._lock:
            self._failures.pop(ip, None)
            self._blocked_until.pop(ip, None)

    def _cleanup(self, now: float) -> None:
        cutoff = now - self._settings.failed_login_window
        for ip, failures in list(self._failures.items()):
            while failures and failures[0] <= cutoff:
                failures.popleft()
            if not failures:
                self._failures.pop(ip, None)
        for ip, blocked_until in list(self._blocked_until.items()):
            if blocked_until <= now:
                self._blocked_until.pop(ip, None)


def client_ip(request: Request, settings: Settings) -> str:
    if settings.trust_cloudflare:
        value = request.headers.get("cf-connecting-ip")
        if value:
            return value.strip()
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",", 1)[0].strip()
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self.settings = settings
        self.limiter = SlidingWindowLimiter()

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        ip = client_ip(request, self.settings)
        path = request.url.path

        # Render (and other load balancers) probe health checks every few
        # seconds. Never let a probe consume the API bucket or receive a 429,
        # which would make the platform restart an otherwise healthy instance.
        if path == "/api/health" and request.method.upper() in {"GET", "HEAD"}:
            return await call_next(request)

        if path == "/api/auth/login" and request.method.upper() == "POST":
            bucket = "login"
            limit = self.settings.login_rate_limit
            window = self.settings.login_rate_window
        elif path.startswith("/api/"):
            bucket = "api"
            limit = self.settings.api_rate_limit
            window = self.settings.api_rate_window
        else:
            bucket = "page"
            limit = self.settings.page_rate_limit
            window = self.settings.page_rate_window

        decision = self.limiter.hit(ip, bucket, limit, window)
        if not decision.allowed:
            response = JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
                headers={"Retry-After": str(decision.retry_after)},
            )
            response.headers["X-RateLimit-Limit"] = str(decision.limit)
            response.headers["X-RateLimit-Remaining"] = "0"
            response.headers["X-RateLimit-Window"] = str(decision.window)
            return response

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(decision.limit)
        response.headers["X-RateLimit-Remaining"] = str(decision.remaining)
        response.headers["X-RateLimit-Window"] = str(decision.window)
        return response
