from __future__ import annotations

import hashlib
import secrets
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.rate_limit import SlidingWindowLimiter, client_ip
from app.security import (
    SessionTokens,
    safe_compare,
    valid_password_hash,
    verify_password,
)

from starlette.requests import Request

TEST_USERNAME = "test-user"
TEST_PASSWORD = "correct-horse-battery-staple-123"
TEST_SESSION_SECRET = "test-session-secret-that-is-at-least-32-chars"


def hash_password(password: str, iterations: int = 100_000) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def make_settings(tmp_path: Path, **overrides: object) -> Settings:
    static = tmp_path / "dist"
    (static / "assets").mkdir(parents=True, exist_ok=True)
    (static / "index.html").write_text(
        "<!doctype html><html><body><div id='root'>adley shell</div></body></html>",
        encoding="utf-8",
    )
    (static / "assets" / "app.js").write_text("console.log('adley');", encoding="utf-8")

    defaults: dict[str, object] = {
        "username": TEST_USERNAME,
        "password_hash": hash_password(TEST_PASSWORD),
        "session_secret": TEST_SESSION_SECRET,
        "cookie_secure": False,
        "static_dir": static,
        "login_rate_limit": 50,
        "login_rate_window": 60,
        "api_rate_limit": 1_000,
        "api_rate_window": 60,
        "page_rate_limit": 1_000,
        "page_rate_window": 60,
        "failed_login_limit": 10,
        "failed_login_window": 300,
        "failed_login_block": 300,
    }
    defaults.update(overrides)
    return Settings(**defaults)  # type: ignore[arg-type]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
def client(settings: Settings) -> TestClient:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def login(client: TestClient, password: str = TEST_PASSWORD):
    return client.post(
        "/api/auth/login",
        json={"username": TEST_USERNAME, "password": password},
    )


def test_password_hash_roundtrip_and_validation() -> None:
    encoded = hash_password(TEST_PASSWORD)
    assert valid_password_hash(encoded)
    assert verify_password(TEST_PASSWORD, encoded)
    assert not verify_password("not-the-password", encoded)


def test_password_helper_handles_malformed_hashes() -> None:
    assert not verify_password("anything", "")
    assert not verify_password("anything", "md5$1$aa$bb")
    assert not verify_password("anything", "pbkdf2_sha256$not-a-number$aa$bb")

    assert not valid_password_hash("")
    assert not valid_password_hash("md5$100000$aa$bb")
    assert not valid_password_hash(hash_password(TEST_PASSWORD, iterations=2_000))
    assert not valid_password_hash("pbkdf2_sha256$100000$zz$zz")


def test_safe_compare_supports_unicode_and_is_constant_time_compatible() -> None:
    assert safe_compare(TEST_USERNAME, TEST_USERNAME)
    assert not safe_compare("tést-user", TEST_USERNAME)
    assert not safe_compare(TEST_USERNAME, TEST_USERNAME + " ")


def test_health_endpoint_and_security_headers(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert client.head("/api/health").status_code == 200
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


def test_health_endpoint_is_not_rate_limited(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, api_rate_limit=1, api_rate_window=60)
    with TestClient(create_app(settings)) as client:
        # Render probes health checks continuously; these must always succeed.
        for _ in range(5):
            assert client.get("/api/health").status_code == 200

        # Ordinary API traffic still uses the configured API bucket.
        assert client.get("/api/auth/me").status_code == 401
        assert client.get("/api/auth/me").status_code == 429


def test_me_requires_login(client: TestClient) -> None:
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated."


def test_login_rejects_wrong_credentials(client: TestClient) -> None:
    wrong_password = login(client, "wrong-password")
    assert wrong_password.status_code == 401
    assert "adley_session" not in wrong_password.cookies

    wrong_user = client.post(
        "/api/auth/login",
        json={"username": "someone_else", "password": TEST_PASSWORD},
    )
    assert wrong_user.status_code == 401


def test_login_accepts_correct_credentials_and_sets_http_only_cookie(
    client: TestClient,
) -> None:
    response = login(client)
    assert response.status_code == 200
    assert response.json() == {"username": TEST_USERNAME}

    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/" in set_cookie
    assert "secure" not in set_cookie
    assert response.cookies.get("adley_session")

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == {"username": TEST_USERNAME}


def test_cookie_is_secure_when_forwarded_proto_is_https(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/auth/login",
        json={"username": TEST_USERNAME, "password": TEST_PASSWORD},
        headers={"x-forwarded-proto": "https"},
    )
    assert response.status_code == 200
    assert "secure" in response.headers["set-cookie"].lower()


def test_non_ascii_username_is_rejected_without_server_error(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        json={"username": "ádley_团队", "password": TEST_PASSWORD},
    )
    assert response.status_code == 401


def test_logout_clears_the_session(client: TestClient) -> None:
    assert login(client).status_code == 200
    assert client.get("/api/auth/me").status_code == 200

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 204
    assert "adley_session" in logout.headers["set-cookie"].lower()
    assert client.get("/api/auth/me").status_code == 401


def test_csrf_origin_and_fetch_metadata_checks(client: TestClient) -> None:
    cross_site = client.post(
        "/api/auth/logout",
        headers={"sec-fetch-site": "cross-site"},
    )
    assert cross_site.status_code == 403

    bad_origin = client.post(
        "/api/auth/logout",
        headers={"origin": "https://evil.example"},
    )
    assert bad_origin.status_code == 403

    good_origin = client.post(
        "/api/auth/logout",
        headers={"origin": "http://testserver", "sec-fetch-site": "same-origin"},
    )
    assert good_origin.status_code == 204


def test_bad_referer_is_rejected_when_origin_is_absent(client: TestClient) -> None:
    response = client.post(
        "/api/auth/logout",
        headers={"referer": "https://evil.example/steal"},
    )
    assert response.status_code == 403


def test_login_rate_limit_returns_retry_after(tmp_path: Path) -> None:
    settings = make_settings(
        tmp_path,
        login_rate_limit=2,
        login_rate_window=60,
        failed_login_limit=100,
    )
    with TestClient(create_app(settings)) as client:
        assert login(client).status_code == 200
        assert login(client).status_code == 200
        limited = login(client)
        assert limited.status_code == 429
        assert int(limited.headers["Retry-After"]) >= 1
        assert limited.headers["X-RateLimit-Remaining"] == "0"
        assert "Too many requests" in limited.json()["detail"]


def test_failed_login_guard_blocks_after_repeated_failures(tmp_path: Path) -> None:
    settings = make_settings(
        tmp_path,
        login_rate_limit=100,
        failed_login_limit=2,
        failed_login_window=300,
        failed_login_block=300,
    )
    with TestClient(create_app(settings)) as client:
        assert login(client, "wrong-1").status_code == 401
        assert login(client, "wrong-2").status_code == 401
        blocked = login(client)
        assert blocked.status_code == 429
        assert int(blocked.headers["Retry-After"]) >= 1


def test_sliding_window_limiter_allows_then_blocks() -> None:
    limiter = SlidingWindowLimiter()
    first = limiter.hit("1.2.3.4", "test", limit=2, window=60)
    second = limiter.hit("1.2.3.4", "test", limit=2, window=60)
    third = limiter.hit("1.2.3.4", "test", limit=2, window=60)
    assert first.allowed and second.allowed
    assert not third.allowed
    assert third.retry_after >= 1
    other = limiter.hit("5.6.7.8", "test", limit=2, window=60)
    assert other.allowed


def test_client_ip_respects_proxy_settings() -> None:
    request = Request(
        {
            "type": "http",
            "headers": [
                (b"x-forwarded-for", b"203.0.113.8, 10.0.0.2"),
                (b"x-real-ip", b"203.0.113.9"),
                (b"cf-connecting-ip", b"203.0.113.10"),
            ],
            "client": ("127.0.0.1", 12345),
        }
    )
    assert client_ip(request, Settings(trust_proxy=False)) == "127.0.0.1"
    assert client_ip(request, Settings(trust_proxy=True)) == "203.0.113.8"
    assert client_ip(request, Settings(trust_cloudflare=True)) == "203.0.113.10"

    # Cloudflare takes precedence even if both trusted-proxy modes are on:
    # Render appends to X-Forwarded-For, so only CF-Connecting-IP is safe.
    both = Settings(trust_proxy=True, trust_cloudflare=True)
    assert client_ip(request, both) == "203.0.113.10"

    # Fail closed to the socket address when the Cloudflare header is absent
    # instead of falling back to a caller-controlled X-Forwarded-For value.
    without_cf = Request(
        {
            "type": "http",
            "headers": [(b"x-forwarded-for", b"203.0.113.8")],
            "client": ("127.0.0.1", 12345),
        }
    )
    assert client_ip(without_cf, Settings(trust_cloudflare=True)) == "127.0.0.1"


def test_spa_and_asset_serving(client: TestClient, settings: Settings) -> None:
    page = client.get("/labeling/workspace")
    assert page.status_code == 200
    assert "adley shell" in page.text
    assert page.headers["Cache-Control"] == "no-cache"

    asset = client.get("/assets/app.js")
    assert asset.status_code == 200
    assert "console.log" in asset.text

    # Unknown non-API paths fall back to the SPA shell.
    fallback = client.get("/tools/classification")
    assert fallback.status_code == 200
    assert "adley shell" in fallback.text


def test_unknown_api_route_returns_json_404(client: TestClient) -> None:
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"detail": "API route not found."}
    assert response.headers["Content-Type"].startswith("application/json")


def test_path_traversal_never_returns_system_files(client: TestClient) -> None:
    response = client.get("/%2e%2e/%2e%2e/%2e%2e/etc/passwd")
    assert response.status_code in {200, 404}
    assert "root:x:" not in response.text


def test_missing_frontend_build_returns_503(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, static_dir=tmp_path / "does-not-exist")
    with TestClient(create_app(settings)) as client:
        response = client.get("/")
        assert response.status_code == 503
        assert "Frontend is not built" in response.json()["detail"]


def test_tampered_and_expired_tokens_are_rejected(settings: Settings) -> None:
    tokens = SessionTokens(settings)
    token = tokens.issue(settings.username)
    assert tokens.verify(token) == settings.username
    assert tokens.verify(f"{token}x") is None

    other = SessionTokens(
        Settings(
            username=settings.username,
            session_secret="a-different-secret-value-for-tests",
            password_hash=settings.password_hash,
        )
    )
    assert other.verify(token) is None

    expired = SessionTokens(
        Settings(
            username=settings.username,
            session_secret=settings.session_secret,
            password_hash=settings.password_hash,
            session_max_age=-1,
        )
    )
    assert expired.verify(token) is None


def test_startup_requires_credentials_and_strong_secret(tmp_path: Path) -> None:
    cases = [
        ({"username": ""}, "ADLEY_USERNAME"),
        ({"password_hash": ""}, "ADLEY_PASSWORD_HASH"),
        ({"session_secret": ""}, "ADLEY_SESSION_SECRET"),
        ({"session_secret": "too-short"}, "ADLEY_SESSION_SECRET"),
        (
            {"session_secret": "replace-with-a-long-random-secret"},
            "ADLEY_SESSION_SECRET",
        ),
        ({"password_hash": "not-a-valid-hash"}, "ADLEY_PASSWORD_HASH"),
    ]
    for overrides, match in cases:
        settings = make_settings(tmp_path, **overrides)
        with pytest.raises(RuntimeError, match=match):
            create_app(settings)


def test_plaintext_password_env_is_not_used(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("ADLEY_USERNAME", raising=False)
    monkeypatch.delenv("ADLEY_PASSWORD_HASH", raising=False)
    monkeypatch.delenv("ADLEY_SESSION_SECRET", raising=False)
    monkeypatch.setenv("ADLEY_PASSWORD", "plaintext-password")

    settings = Settings.from_env()
    assert settings.password_hash == ""
    with pytest.raises(RuntimeError, match="ADLEY_PASSWORD_HASH"):
        create_app(settings)


def test_settings_defaults_and_env(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings()
    assert settings.username == ""
    assert settings.password_hash == ""
    assert settings.session_secret == ""
    assert settings.cookie_secure is True
    assert settings.static_dir.name == "dist"
    assert settings.missing_required == [
        "ADLEY_USERNAME",
        "ADLEY_PASSWORD_HASH",
        "ADLEY_SESSION_SECRET",
    ]

    encoded = hash_password(TEST_PASSWORD)
    monkeypatch.setenv("ADLEY_USERNAME", "team_two")
    monkeypatch.setenv("ADLEY_PASSWORD_HASH", encoded)
    monkeypatch.setenv("ADLEY_SESSION_SECRET", TEST_SESSION_SECRET)
    monkeypatch.setenv("ADLEY_COOKIE_SECURE", "false")
    monkeypatch.setenv("ADLEY_LOGIN_RATE_LIMIT", "7")
    env_settings = Settings.from_env()
    assert env_settings.username == "team_two"
    assert env_settings.password_hash == encoded
    assert env_settings.cookie_secure is False
    assert env_settings.login_rate_limit == 7
    assert env_settings.session_secret == TEST_SESSION_SECRET
    assert not env_settings.using_insecure_secret

    # An empty environment value must never become empty signing material.
    monkeypatch.setenv("ADLEY_SESSION_SECRET", "   ")
    blank = Settings.from_env()
    assert blank.session_secret == ""
    assert "ADLEY_SESSION_SECRET" in blank.missing_required
