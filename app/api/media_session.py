"""Short-lived authentication for native browser media elements.

HTML ``video`` and ``img`` elements cannot attach the Bearer header used by the
normal API client.  We therefore mint an HttpOnly cookie after an authenticated
source-video API call.  The cookie contains only a signed user/profile claim
(never the Supabase access token) and is accepted solely by source-video media
endpoints.  Desktop cookies remain loopback-only; hosted cookies are Secure and
scoped to the Studio API origin.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials

from app.api.auth import (
    ProfileContext,
    get_current_user,
    get_profile_context,
    security,
)
from app.config import get_settings


logger = logging.getLogger(__name__)

SOURCE_MEDIA_COOKIE = "blipost_source_media"
SOURCE_MEDIA_TTL_SECONDS = 12 * 60 * 60
_SOURCE_MEDIA_COOKIE_PATH = "/api/v1/segments/source-videos"

_signing_key: Optional[bytes] = None
_signing_key_lock = threading.Lock()


def _urlsafe_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _urlsafe_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _read_or_create_desktop_key(path: Path) -> bytes:
    """Return a per-installation key without ever overwriting an existing one."""
    try:
        existing = path.read_bytes()
        if len(existing) >= 32:
            return existing
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.warning("Could not read source-media signing key: %s", exc)

    key = secrets.token_bytes(32)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
        fd = os.open(path, flags, 0o600)
        try:
            os.write(fd, key)
        finally:
            os.close(fd)
        return key
    except FileExistsError:
        try:
            existing = path.read_bytes()
            if len(existing) >= 32:
                return existing
        except OSError as exc:
            logger.warning("Could not read concurrently-created media key: %s", exc)
    except OSError as exc:
        logger.warning("Could not persist source-media signing key: %s", exc)

    # The backend remains usable even if AppData is unexpectedly read-only.
    # The cookie will simply be invalidated when this backend process restarts.
    return key


def _get_signing_key() -> bytes:
    global _signing_key
    if _signing_key is not None:
        return _signing_key

    with _signing_key_lock:
        if _signing_key is None:
            settings = get_settings()
            if settings.desktop_mode:
                key_path = settings.base_dir / "cache" / ".source_media_session.key"
                _signing_key = _read_or_create_desktop_key(key_path)
            else:
                # This cookie flow is desktop-only.  A process-local key keeps
                # helper tests and accidental non-desktop calls deterministic in
                # scope without writing runtime secrets into the repository.
                _signing_key = secrets.token_bytes(32)
    return _signing_key


def _encode_media_session(
    profile: ProfileContext,
    *,
    now: Optional[int] = None,
    key: Optional[bytes] = None,
) -> str:
    issued_at = int(time.time()) if now is None else int(now)
    payload = {
        "v": 1,
        "sub": profile.user_id,
        "profile_id": profile.profile_id,
        "iat": issued_at,
        "exp": issued_at + SOURCE_MEDIA_TTL_SECONDS,
    }
    body = _urlsafe_encode(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    signature = hmac.new(key or _get_signing_key(), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_urlsafe_encode(signature)}"


def _decode_media_session(
    token: str,
    *,
    now: Optional[int] = None,
    key: Optional[bytes] = None,
) -> ProfileContext:
    try:
        body, encoded_signature = token.split(".", 1)
        supplied_signature = _urlsafe_decode(encoded_signature)
        expected_signature = hmac.new(
            key or _get_signing_key(), body.encode("ascii"), hashlib.sha256
        ).digest()
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise ValueError("signature mismatch")

        payload = json.loads(_urlsafe_decode(body).decode("utf-8"))
        current_time = int(time.time()) if now is None else int(now)
        if payload.get("v") != 1 or int(payload.get("exp", 0)) < current_time:
            raise ValueError("expired session")

        user_id = payload.get("sub")
        profile_id = payload.get("profile_id")
        if not isinstance(user_id, str) or not user_id:
            raise ValueError("missing user")
        if not isinstance(profile_id, str) or not profile_id:
            raise ValueError("missing profile")
        return ProfileContext(profile_id=profile_id, user_id=user_id)
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired media session",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_profile_context_with_media_session(
    request: Request,
    response: Response,
    profile: ProfileContext = Depends(get_profile_context),
) -> ProfileContext:
    """Refresh the media cookie after a normal authenticated request."""
    settings = get_settings()
    response.set_cookie(
        key=SOURCE_MEDIA_COOKIE,
        value=_encode_media_session(profile),
        max_age=SOURCE_MEDIA_TTL_SECONDS,
        httponly=True,
        secure=not settings.desktop_mode or request.url.scheme == "https",
        samesite="lax",
        path=_SOURCE_MEDIA_COOKIE_PATH,
    )
    return profile


async def get_source_media_profile_context(
    request: Request,
    profile_id: Optional[str] = Query(default=None),
    media_session: Optional[str] = Cookie(default=None, alias=SOURCE_MEDIA_COOKIE),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    authorization: Optional[str] = Header(default=None),
    x_profile_id: Optional[str] = Header(default=None, alias="X-Profile-Id"),
) -> ProfileContext:
    """Authenticate a source-video media request via Bearer header or signed cookie."""
    settings = get_settings()
    requested_profile_id = x_profile_id or profile_id

    # API callers and auth-disabled tests keep using the normal authentication path.
    if credentials or authorization or settings.auth_disabled:
        current_user = await get_current_user(credentials, authorization)
        return await get_profile_context(current_user, requested_profile_id)

    if settings.desktop_mode:
        client_host = request.client.host if request.client else ""
        if client_host not in {"127.0.0.1", "::1", "localhost"}:
            raise HTTPException(status_code=403, detail="Desktop media is local-only")
    if not media_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Media session required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    profile = _decode_media_session(media_session)
    if requested_profile_id and requested_profile_id != profile.profile_id:
        raise HTTPException(status_code=403, detail="Media profile mismatch")
    return profile
