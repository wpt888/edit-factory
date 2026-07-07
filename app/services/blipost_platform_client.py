"""
Blipost Platform API client (desktop → web bridge, phase U1).

Thin async httpx wrapper over the web app's token-authenticated Platform API
(`/api/platform/v1`, contract: social-scheduler/docs/platform-api.md). The
desktop app consumes the web account's social connectors + credit balance
through this instead of talking to Postiz directly.

Errors are mapped to typed exceptions so callers get clean, user-facing
messages (401 → token invalid, 402 → insufficient credits, 429 → rate limit).

SECURITY: the Bearer token is NEVER logged. Log lines carry only status codes
and the JSON `error` string returned by the server (which never contains the
token).
"""
import asyncio
import logging
from typing import List, Optional

import httpx

logger = logging.getLogger(__name__)

_API_PREFIX = "/api/platform/v1"
_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
# ponytail: fixed 3-try backoff for 429; if the web app ever returns Retry-After
# we can honor it, but the contract says a flat 60/min limit — a short sleep is enough.
_RATE_LIMIT_RETRIES = 3
_RATE_LIMIT_BACKOFF_S = 2.0


class BlipostPlatformError(Exception):
    """Base error for any Platform API failure."""


class BlipostAuthError(BlipostPlatformError):
    """401 — token missing, invalid, or revoked on the web side."""


class BlipostCreditsError(BlipostPlatformError):
    """402 — insufficient credits. `balance` carries the remaining amount."""

    def __init__(self, message: str, balance: Optional[float] = None):
        super().__init__(message)
        self.balance = balance


class BlipostRateLimitError(BlipostPlatformError):
    """429 — rate limit exceeded even after backoff retries."""


class BlipostPlatformClient:
    """Async client for one (base_url, token) pair.

    Build it per request via `get_client_for_profile()` so a changed/revoked
    token always takes effect immediately (no stale cached client).
    """

    def __init__(self, base_url: str, token: str, transport: Optional[httpx.BaseTransport] = None):
        self.base_url = base_url.rstrip("/")
        self._token = token
        # ponytail: transport seam exists only so the self-check can run offline
        # against a MockTransport; production passes nothing.
        self._transport = transport

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token}"}

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        """Issue a request, retrying transient 429s, and map error statuses."""
        url = f"{self.base_url}{_API_PREFIX}{path}"
        last_exc: Optional[Exception] = None

        for attempt in range(_RATE_LIMIT_RETRIES):
            async with httpx.AsyncClient(timeout=_TIMEOUT, transport=self._transport) as client:
                resp = await client.request(method, url, headers=self._headers, **kwargs)

            if resp.status_code != 429:
                return self._check(resp, path)

            # 429 — back off and retry (unless this was the last attempt)
            last_exc = BlipostRateLimitError("Rate limit exceeded — try again shortly.")
            logger.info("Blipost platform 429 on %s (attempt %d/%d)", path, attempt + 1, _RATE_LIMIT_RETRIES)
            if attempt < _RATE_LIMIT_RETRIES - 1:
                await asyncio.sleep(_RATE_LIMIT_BACKOFF_S * (attempt + 1))

        assert last_exc is not None
        raise last_exc

    def _check(self, resp: httpx.Response, path: str) -> httpx.Response:
        """Raise a typed error for non-2xx; otherwise return the response."""
        if resp.is_success:
            return resp

        # Error bodies are always JSON `{ "error": "..." }` per the contract.
        error_msg = ""
        balance = None
        try:
            body = resp.json()
            error_msg = body.get("error") or ""
            balance = body.get("balance")
        except Exception:
            error_msg = ""

        logger.warning("Blipost platform %d on %s: %s", resp.status_code, path, error_msg or "<no detail>")

        if resp.status_code == 401:
            raise BlipostAuthError(error_msg or "Invalid or revoked Blipost token.")
        if resp.status_code == 402:
            raise BlipostCreditsError(error_msg or "Insufficient credits.", balance=balance)
        if resp.status_code == 404:
            raise BlipostPlatformError(error_msg or "Not found.")
        raise BlipostPlatformError(error_msg or f"Platform API error ({resp.status_code}).")

    # ==================== Endpoints ====================

    async def get_me(self) -> dict:
        """GET /me — { email, plan, credits: { balance } }."""
        resp = await self._request("GET", "/me")
        return resp.json()

    async def get_accounts(self) -> List[dict]:
        """GET /accounts — connected social accounts."""
        resp = await self._request("GET", "/accounts")
        return resp.json().get("accounts", [])

    async def request_media_upload(self, filename: str, content_type: str, size_bytes: int) -> dict:
        """POST /media — request a presigned upload slot. Returns { mediaId, uploadUrl }."""
        resp = await self._request(
            "POST", "/media",
            json={"filename": filename, "contentType": content_type, "sizeBytes": size_bytes},
        )
        return resp.json()

    async def upload_media_bytes(self, upload_url: str, data: bytes, content_type: str) -> None:
        """PUT raw bytes to the presigned R2 URL. Not under the API prefix — absolute URL."""
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0), transport=self._transport) as client:
            resp = await client.put(upload_url, content=data, headers={"Content-Type": content_type})
        if not resp.is_success:
            logger.warning("Blipost media PUT failed: %d", resp.status_code)
            raise BlipostPlatformError(f"Media upload failed ({resp.status_code}).")

    async def create_post(
        self,
        text: str,
        account_ids: List[str],
        media_ids: Optional[List[str]] = None,
        scheduled_at: Optional[str] = None,
        draft: bool = False,
    ) -> dict:
        """POST /posts — schedule a post. `scheduled_at` is ISO-8601 (≥30s future) or None+draft."""
        payload: dict = {"text": text, "accountIds": account_ids}
        if media_ids:
            payload["mediaIds"] = media_ids
        if draft:
            payload["draft"] = True
        elif scheduled_at:
            payload["scheduledAt"] = scheduled_at
        resp = await self._request("POST", "/posts", json=payload)
        return resp.json()

    async def get_post(self, post_id: str) -> dict:
        """GET /posts/{id} — status + per-target results."""
        resp = await self._request("GET", f"/posts/{post_id}")
        return resp.json()


def get_client_for_profile(profile_id: str) -> BlipostPlatformClient:
    """Build a client from the profile's stored token + configured base URL.

    Raises:
        ValueError: if no Blipost token is stored for this profile ("not connected").
    """
    from app.config import get_settings
    from app.services.credentials.vault import get_vault_manager

    token = get_vault_manager().get_api_key_or_default(profile_id, "blipost_platform")
    if not token:
        raise ValueError("Blipost account not connected. Paste a platform token in Settings.")

    base_url = get_settings().blipost_platform_base_url
    return BlipostPlatformClient(base_url=base_url, token=token)
