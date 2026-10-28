from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = PROJECT_ROOT / "frontend" / "dist"
load_dotenv(PROJECT_ROOT / ".env")

MIN_SESSION_SECRET_LENGTH = 32

# Values that must never be accepted as a production signing key. The app has
# no built-in credentials or session secret: every deployment must provide its
# own through environment variables.
INSECURE_SESSION_SECRETS = frozenset(
    {
        "",
        "change-me",
        "changeme",
        "development-secret",
        "dev-only-secret",
        "replace-with-a-long-random-secret",
    }
)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


@dataclass(slots=True)
class Settings:
    app_name: str = "Adley Machine Learning Tools"
    username: str = ""
    password_hash: str = ""
    session_secret: str = ""
    session_cookie: str = "adley_session"
    session_max_age: int = 12 * 60 * 60
    cookie_secure: bool = True

    trust_proxy: bool = False
    trust_cloudflare: bool = False

    login_rate_limit: int = 10
    login_rate_window: int = 60
    api_rate_limit: int = 120
    api_rate_window: int = 60
    page_rate_limit: int = 600
    page_rate_window: int = 60
    failed_login_limit: int = 5
    failed_login_window: int = 5 * 60
    failed_login_block: int = 5 * 60

    static_dir: Path = field(default_factory=lambda: STATIC_DIR)

    @property
    def missing_required(self) -> list[str]:
        missing: list[str] = []
        if not self.username.strip():
            missing.append("ADLEY_USERNAME")
        if not self.password_hash.strip():
            missing.append("ADLEY_PASSWORD_HASH")
        if not self.session_secret.strip():
            missing.append("ADLEY_SESSION_SECRET")
        return missing

    @property
    def using_insecure_secret(self) -> bool:
        secret = self.session_secret.strip()
        return (
            len(secret) < MIN_SESSION_SECRET_LENGTH
            or secret.lower() in INSECURE_SESSION_SECRETS
        )

    def validate(self) -> None:
        """Fail closed when production credentials are missing or weak."""
        missing = self.missing_required
        if missing:
            raise RuntimeError(
                "Missing required environment variables: "
                + ", ".join(missing)
                + ". Set your own username, PBKDF2 password hash, and a "
                "32+ character session secret. Generate the hash with: "
                "python3 scripts/hash_password.py"
            )

        secret = self.session_secret.strip()
        if len(secret) < MIN_SESSION_SECRET_LENGTH:
            raise RuntimeError(
                "ADLEY_SESSION_SECRET must be at least 32 characters. Generate one with: "
                "python3 -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        if secret.lower() in INSECURE_SESSION_SECRETS:
            raise RuntimeError(
                "ADLEY_SESSION_SECRET is a known placeholder. Generate a unique random "
                "value with: python3 -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )

    @classmethod
    def from_env(cls) -> "Settings":
        static_dir = os.getenv("ADLEY_STATIC_DIR")
        return cls(
            username=os.getenv("ADLEY_USERNAME", "").strip(),
            password_hash=os.getenv("ADLEY_PASSWORD_HASH", "").strip(),
            session_secret=os.getenv("ADLEY_SESSION_SECRET", "").strip(),
            session_max_age=_env_int("ADLEY_SESSION_MAX_AGE", 12 * 60 * 60),
            cookie_secure=_env_bool("ADLEY_COOKIE_SECURE", True),
            trust_proxy=_env_bool("ADLEY_TRUST_PROXY", False),
            trust_cloudflare=_env_bool("ADLEY_TRUST_CLOUDFLARE", False),
            login_rate_limit=_env_int("ADLEY_LOGIN_RATE_LIMIT", 10),
            login_rate_window=_env_int("ADLEY_LOGIN_RATE_WINDOW", 60),
            api_rate_limit=_env_int("ADLEY_API_RATE_LIMIT", 120),
            api_rate_window=_env_int("ADLEY_API_RATE_WINDOW", 60),
            page_rate_limit=_env_int("ADLEY_PAGE_RATE_LIMIT", 600),
            page_rate_window=_env_int("ADLEY_PAGE_RATE_WINDOW", 60),
            failed_login_limit=_env_int("ADLEY_FAILED_LOGIN_LIMIT", 5),
            failed_login_window=_env_int("ADLEY_FAILED_LOGIN_WINDOW", 5 * 60),
            failed_login_block=_env_int("ADLEY_FAILED_LOGIN_BLOCK", 5 * 60),
            static_dir=Path(static_dir).expanduser() if static_dir else STATIC_DIR,
        )
