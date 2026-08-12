from __future__ import annotations

import secrets


class AuthenticationError(Exception):
    pass


def verify_token(expected: str, provided: str | None) -> None:
    if not provided or not secrets.compare_digest(expected, provided):
        raise AuthenticationError("UNAUTHORIZED")
