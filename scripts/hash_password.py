#!/usr/bin/env python3
"""Generate an ADLEY_PASSWORD_HASH value for the Adley ML Tools deployment."""

from __future__ import annotations

import argparse
import getpass
import hashlib
import secrets
import sys


MIN_PASSWORD_LENGTH = 12


def hash_password(password: str, iterations: int) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a PBKDF2 password hash for ADLEY_PASSWORD_HASH.",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=600_000,
        help="PBKDF2 iterations (default: 600000, minimum: 100000).",
    )
    args = parser.parse_args()

    if args.iterations < 100_000:
        print("Refusing fewer than 100000 iterations.", file=sys.stderr)
        return 2

    # Always read the password interactively. Accepting it as a command-line
    # argument would leak it into shell history and process listings.
    password = getpass.getpass("New password: ")
    if len(password) < MIN_PASSWORD_LENGTH:
        print(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
            file=sys.stderr,
        )
        return 1

    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        print("Passwords do not match.", file=sys.stderr)
        return 1

    print(hash_password(password, args.iterations))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
