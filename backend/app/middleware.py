from __future__ import annotations

from urllib.parse import urlsplit

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .config import Settings


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _host_matches(origin_or_referer: str, request: Request) -> bool:
    try:
        origin = urlsplit(origin_or_referer)
    except ValueError:
        return False
    origin_host = origin.netloc.lower()
    request_host = request.headers.get("host", "").lower()
    if origin_host and request_host:
        return origin_host == request_host
    return False


class OriginCheckMiddleware(BaseHTTPMiddleware):
    """Defence-in-depth CSRF protection for the stateless API."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method.upper() in UNSAFE_METHODS and request.url.path.startswith("/api/"):
            fetch_site = request.headers.get("sec-fetch-site", "").lower()
            if fetch_site == "cross-site":
                return JSONResponse(status_code=403, content={"detail": "Cross-site request rejected."})

            origin = request.headers.get("origin")
            referer = request.headers.get("referer")
            if origin and not _host_matches(origin, request):
                return JSONResponse(status_code=403, content={"detail": "Origin not allowed."})
            if not origin and referer and not _host_matches(referer, request):
                return JSONResponse(status_code=403, content={"detail": "Referer not allowed."})

        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self.settings = settings

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        response.headers.setdefault(
            "Content-Security-Policy",
            (
                "default-src 'self'; "
                "script-src 'self'; "
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' blob: data:; "
                "worker-src 'self' blob:; "
                "connect-src 'self'; "
                "font-src 'self'; "
                "manifest-src 'self'; "
                "object-src 'none'; "
                "base-uri 'self'; "
                "form-action 'self'; "
                "frame-ancestors 'none'"
            ),
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        )

        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"

        forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip()
        if request.url.scheme == "https" or forwarded_proto == "https":
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )

        return response
