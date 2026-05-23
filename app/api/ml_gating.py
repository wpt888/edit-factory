"""ML feature gating + subscription tier gating for backend routes.

Closes requirements ML-04 (412 when ML bundle absent) and ML-05 (402 when sub-Pro tier).

Exports:
  - _enforce_ml_installed(feature: str) -> None         # bare function for inline use
  - require_ml_installed(feature: str) -> Callable      # FastAPI Depends factory
  - require_tier(min_tier: str) -> Callable             # FastAPI Depends factory
  - _TIER_ORDER: Dict[str, int]                          # tier ranking constant
"""
import logging
from typing import Callable, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.config import get_base_dir, get_settings
from app.api.auth import verify_jwt_token

logger = logging.getLogger(__name__)

# Tier ordering — higher integer = more access. Missing claim treated as "free" (0).
_TIER_ORDER = {"free": 0, "starter": 1, "pro": 2}

# Reusable security scheme for tier dependency (auto_error=False so we can
# produce a custom 402 instead of HTTPBearer's default 403).
_security = HTTPBearer(auto_error=False)


def _enforce_ml_installed(feature: str) -> None:
    """Raise HTTPException(412) if <base_dir>/ml/.installed does not exist.

    Called BOTH:
      - Inside FastAPI dependency factory require_ml_installed() for route-level gates
      - Inline from route bodies (e.g. when the trigger is a request body field that
        FastAPI cannot read at dependency-resolution time).

    Args:
        feature: Short identifier surfaced to the frontend. Convention:
          "voice_clone", "voice_mute", "voice_transcribe", etc.

    Raises:
        HTTPException(412): {"error": "ml_not_installed", "feature": "<feature>"}
    """
    marker = get_base_dir() / "ml" / ".installed"
    if not marker.exists():
        logger.info("ML feature '%s' blocked — marker missing at %s", feature, marker)
        raise HTTPException(
            status_code=412,
            detail={"error": "ml_not_installed", "feature": feature},
        )


def require_ml_installed(feature: str) -> Callable[[], None]:
    """FastAPI dependency factory. Use at route signature:

        @router.post("/clone-voice")
        async def clone_voice(_: None = Depends(require_ml_installed("voice_clone"))):
            ...

    Cannot be used when the trigger is a request body field — FastAPI resolves
    dependencies before body parsing. Use _enforce_ml_installed inline in that case.
    """
    def _dep() -> None:
        _enforce_ml_installed(feature)
    return _dep


def require_tier(min_tier: str) -> Callable:
    """FastAPI dependency factory for tier gating.

    Reads subscription_tier from the raw JWT (NOT from AuthUser — AuthUser drops
    non-standard claims). Returns HTTPException(402) when below min_tier.

    Dev/desktop bypass MUST come first (no JWT in dev mode).

    Args:
        min_tier: One of "free" | "starter" | "pro". Looked up in _TIER_ORDER.

    Raises:
        HTTPException(402): {"error": "tier_insufficient", "requires_tier": "<min_tier>"}
    """
    required_rank = _TIER_ORDER.get(min_tier, _TIER_ORDER["pro"])

    def _dep(
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(_security),
    ) -> None:
        settings = get_settings()
        # Dev/desktop bypass — FIRST (no JWT to decode in dev mode).
        # Matches the existing pattern in app/api/auth.py:118-127.
        if settings.auth_disabled or settings.desktop_mode:
            logger.debug("Tier check bypassed — auth_disabled=%s desktop_mode=%s",
                         settings.auth_disabled, settings.desktop_mode)
            return

        # Production: extract JWT, decode, read subscription_tier.
        # Fail-closed if no credentials, no token, or claim absent/unknown.
        if credentials is None or not credentials.credentials:
            logger.info("Tier check blocked — no credentials, requires=%s", min_tier)
            raise HTTPException(
                status_code=402,
                detail={"error": "tier_insufficient", "requires_tier": min_tier},
            )

        # verify_jwt_token raises HTTPException(401) on invalid token — let it propagate.
        payload = verify_jwt_token(credentials.credentials)
        claim = payload.get("subscription_tier")
        user_rank = _TIER_ORDER.get(claim, 0)  # unknown claim → free (0)

        if user_rank < required_rank:
            logger.info("Tier check blocked — user_tier=%s requires=%s",
                        claim or "<missing>", min_tier)
            raise HTTPException(
                status_code=402,
                detail={"error": "tier_insufficient", "requires_tier": min_tier},
            )

    return _dep
