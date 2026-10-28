from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .config import Settings
from .rate_limit import FailedLoginGuard, client_ip
from .security import SessionTokens, safe_compare, verify_password


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=500)


class UserResponse(BaseModel):
    username: str


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _tokens(request: Request) -> SessionTokens:
    return request.app.state.tokens


def _guard(request: Request) -> FailedLoginGuard:
    return request.app.state.failed_login_guard


def _cookie_secure(request: Request, settings: Settings) -> bool:
    if settings.cookie_secure:
        return True
    forwarded = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip()
    return request.url.scheme == "https" or forwarded == "https"


def current_username(request: Request) -> str:
    settings = _settings(request)
    token = request.cookies.get(settings.session_cookie)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    username = _tokens(request).verify(token)
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired.")
    return username


@router.post("/login", response_model=UserResponse)
async def login(payload: LoginRequest, request: Request) -> Response:
    settings = _settings(request)
    ip = client_ip(request, settings)
    retry_after = _guard(request).retry_after(ip)
    if retry_after > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    username_ok = safe_compare(payload.username, settings.username)
    password_ok = verify_password(payload.password, settings.password_hash)
    if not (username_ok and password_ok):
        _guard(request).record_failure(ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password.")

    _guard(request).clear(ip)
    token = _tokens(request).issue(settings.username)
    response = JSONResponse(content={"username": settings.username})
    response.set_cookie(
        key=settings.session_cookie,
        value=token,
        max_age=settings.session_max_age,
        httponly=True,
        secure=_cookie_secure(request, settings),
        samesite="lax",
        path="/",
    )
    return response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request) -> Response:
    settings = _settings(request)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        key=settings.session_cookie,
        path="/",
        secure=_cookie_secure(request, settings),
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/me", response_model=UserResponse)
async def me(request: Request) -> UserResponse:
    return UserResponse(username=current_username(request))
