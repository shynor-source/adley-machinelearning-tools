from __future__ import annotations

import hashlib
import hmac

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import Settings


PBKDF2_ALGORITHM = "pbkdf2_sha256"
MIN_PBKDF2_ITERATIONS = 100_000


def safe_compare(value: str, expected: str) -> bool:
    """Constant-time comparison that also handles non-ASCII input safely."""
    return hmac.compare_digest(value.encode("utf-8"), expected.encode("utf-8"))


def valid_password_hash(encoded_hash: str) -> bool:
    """Validate the stored credential format without knowing the password."""
    try:
        algorithm, iterations_text, salt_hex, digest_hex = encoded_hash.strip().split("$", 3)
        if algorithm != PBKDF2_ALGORITHM:
            return False
        if int(iterations_text) < MIN_PBKDF2_ITERATIONS:
            return False
        salt = bytes.fromhex(salt_hex)
        digest = bytes.fromhex(digest_hex)
        return len(salt) >= 16 and len(digest) == 32
    except (ValueError, TypeError):
        return False


def verify_password(password: str, encoded_hash: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded_hash.split("$", 3)
        if algorithm != PBKDF2_ALGORITHM:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iterations),
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


class SessionTokens:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._serializer = URLSafeTimedSerializer(
            settings.session_secret,
            salt="adley-session-v1",
            signer_kwargs={"digest_method": hashlib.sha256},
        )

    def issue(self, username: str) -> str:
        return self._serializer.dumps({"u": username})

    def verify(self, token: str) -> str | None:
        try:
            payload = self._serializer.loads(token, max_age=self._settings.session_max_age)
        except (BadSignature, SignatureExpired):
            return None
        if not isinstance(payload, dict):
            return None
        username = payload.get("u")
        if username != self._settings.username:
            return None
        return username
