from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .auth import router as auth_router
from .config import Settings
from .middleware import OriginCheckMiddleware, SecurityHeadersMiddleware
from .rate_limit import FailedLoginGuard, RateLimitMiddleware
from .security import SessionTokens, valid_password_hash


logger = logging.getLogger("adley")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    # No built-in account or signing key exists. Refuse to start unless the
    # operator supplied their own credentials and a strong session secret.
    settings.validate()
    if not valid_password_hash(settings.password_hash):
        raise RuntimeError(
            "ADLEY_PASSWORD_HASH is not a valid PBKDF2-SHA256 hash with at least "
            "100000 iterations. Generate one with: python3 scripts/hash_password.py"
        )

    app = FastAPI(
        title=settings.app_name,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.tokens = SessionTokens(settings)
    app.state.failed_login_guard = FailedLoginGuard(settings)

    # Added from innermost to outermost. Security headers are outermost so
    # they are present on rate-limit and CSRF rejection responses too.
    app.add_middleware(RateLimitMiddleware, settings=settings)
    app.add_middleware(OriginCheckMiddleware)
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)

    app.include_router(auth_router)

    @app.api_route("/api/health", methods=["GET", "HEAD"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": settings.app_name}

    @app.get("/api/{full_path:path}")
    async def api_not_found(full_path: str) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": "API route not found."})

    dist = settings.static_dir
    assets_dir = dist / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str, request: Request) -> Response:
        if not dist.is_dir() or not (dist / "index.html").is_file():
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "Frontend is not built. Run the frontend build or use the Vite development server."
                },
            )

        # Serve real files from the build directory, but never allow traversal.
        if full_path:
            candidate = (dist / full_path).resolve()
            try:
                candidate.relative_to(dist.resolve())
            except ValueError:
                return JSONResponse(status_code=404, content={"detail": "Not found."})
            if candidate.is_file():
                return FileResponse(candidate)

        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "API route not found."})

        index = dist / "index.html"
        response = FileResponse(index)
        response.headers["Cache-Control"] = "no-cache"
        return response

    return app
