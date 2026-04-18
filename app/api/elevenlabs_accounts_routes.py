"""
ElevenLabs Multi-Account CRUD Routes

Manages multiple ElevenLabs API keys per profile with subscription validation.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.services.elevenlabs_account_manager import get_account_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/elevenlabs-accounts", tags=["ElevenLabs Accounts"])


class AddAccountRequest(BaseModel):
    label: str
    api_key: str


class ValidateAccountRequest(BaseModel):
    api_key: str


class UpdateAccountRequest(BaseModel):
    label: Optional[str] = None
    is_active: Optional[bool] = None


@router.post("/validate")
async def validate_elevenlabs_key(
    body: ValidateAccountRequest,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Validate an ElevenLabs API key without persisting it. Auth required."""
    manager = get_account_manager()
    try:
        sub_info = await manager.check_subscription_async(body.api_key)
        return {
            "connected": True,
            "tier": sub_info.get("tier"),
            "character_limit": sub_info.get("character_limit"),
            "character_count": sub_info.get("character_count"),
        }
    except ValueError as e:
        return {"connected": False, "error": str(e)}
    except Exception as e:
        logger.warning(f"ElevenLabs validation error: {e}")
        return {"connected": False, "error": str(e)[:200]}


@router.get("/")
async def list_accounts(ctx: ProfileContext = Depends(get_profile_context)):
    """List all ElevenLabs accounts for the current profile (keys masked)."""
    manager = get_account_manager()
    accounts = manager.list_accounts(ctx.profile_id)
    return {"accounts": accounts}


@router.get("/credits")
async def get_active_credits(ctx: ProfileContext = Depends(get_profile_context)):
    """
    Return credits for the active (primary) ElevenLabs account.

    Lightweight endpoint intended for the pipeline TTS step — callers get
    just the primary account's quota without loading the full /usage
    summary. Auto-refreshes stale DB rows via the 5-minute TTL cache.
    """
    manager = get_account_manager()
    try:
        accounts = manager.list_accounts_with_refresh(ctx.profile_id)
    except Exception as e:
        logger.warning(f"Failed to list accounts for credits endpoint: {e}")
        return {"account": None, "error": str(e)[:200]}

    if not accounts:
        return {"account": None, "error": "No ElevenLabs accounts configured"}

    primary = next((a for a in accounts if a.get("is_primary")), None) or accounts[0]

    chars_used = primary.get("characters_used") or 0
    chars_limit = primary.get("character_limit") or 0
    chars_remaining = chars_limit - chars_used if chars_limit else 0
    usage_pct = round((chars_used / chars_limit * 100), 1) if chars_limit > 0 else 0

    return {"account": {
        "id": primary.get("id"),
        "label": primary.get("label", "Unknown"),
        "api_key_hint": primary.get("api_key_hint", ""),
        "is_env_default": primary.get("is_env_default", False),
        "tier": primary.get("tier") or "unknown",
        "characters_used": chars_used,
        "character_limit": chars_limit,
        "characters_remaining": chars_remaining,
        "usage_percent": usage_pct,
        "last_error": primary.get("last_error"),
        "last_checked_at": primary.get("last_checked_at"),
    }}


@router.post("/", status_code=201)
async def add_account(
    body: AddAccountRequest,
    ctx: ProfileContext = Depends(get_profile_context)
):
    """
    Add a new ElevenLabs account.

    Validates the API key via subscription check before saving.
    Maximum 3 accounts per profile.
    """
    manager = get_account_manager()

    # Validate key first
    try:
        sub_info = manager.check_subscription(body.api_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Add account
    try:
        account = manager.add_account(ctx.profile_id, body.label, body.api_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Update subscription info
    if account.get("id"):
        try:
            account = manager.update_subscription_info(ctx.profile_id, account["id"])
        except Exception as e:
            logger.warning(f"Failed to update subscription after add: {e}")

    return {
        "account": account,
        "subscription": sub_info,
    }


@router.patch("/{account_id}")
async def update_account(
    account_id: str,
    body: UpdateAccountRequest,
    ctx: ProfileContext = Depends(get_profile_context)
):
    """Update account label or active status."""
    manager = get_account_manager()

    updates = {}
    if body.label is not None:
        updates["label"] = body.label
    if body.is_active is not None:
        updates["is_active"] = body.is_active

    try:
        account = manager.update_account(ctx.profile_id, account_id, updates)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"account": account}


@router.delete("/{account_id}")
async def delete_account(
    account_id: str,
    ctx: ProfileContext = Depends(get_profile_context)
):
    """Delete an ElevenLabs account."""
    if account_id == "__env__":
        raise HTTPException(status_code=400, detail="Cannot delete .env default key. Remove it from .env instead.")
    manager = get_account_manager()

    try:
        manager.delete_account(ctx.profile_id, account_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"status": "deleted"}


@router.post("/{account_id}/set-primary")
async def set_primary(
    account_id: str,
    ctx: ProfileContext = Depends(get_profile_context)
):
    """Set an account as the primary key for this profile."""
    manager = get_account_manager()

    if account_id == "__env__":
        # Unset all DB accounts as primary, making .env the default again
        try:
            manager.clear_all_primary(ctx.profile_id)
        except Exception as e:
            logger.warning(f"Failed to clear primary accounts: {e}")
        return {"account": {"id": "__env__", "is_primary": True}}

    try:
        account = manager.set_primary(ctx.profile_id, account_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"account": account}


@router.post("/{account_id}/refresh")
async def refresh_subscription(
    account_id: str,
    ctx: ProfileContext = Depends(get_profile_context)
):
    """Refresh subscription info from ElevenLabs API."""
    manager = get_account_manager()

    # Handle .env key refresh without DB
    if account_id == "__env__":
        from app.config import get_settings
        settings = get_settings()
        env_key = settings.elevenlabs_api_key
        if not env_key:
            raise HTTPException(status_code=400, detail="No .env API key configured")
        try:
            sub_info = manager.check_subscription(env_key)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return {"account": {
            "id": "__env__",
            "label": ".env default",
            "api_key_hint": f"...{env_key[-4:]}" if len(env_key) >= 4 else "....",
            "is_primary": True,
            "is_active": True,
            "is_env_default": True,
            "sort_order": 999,
            "character_limit": sub_info.get("character_limit"),
            "characters_used": sub_info.get("character_count"),
            "tier": sub_info.get("tier"),
            "last_error": None,
            "last_checked_at": datetime.now(timezone.utc).isoformat(),
        }}

    try:
        account = manager.update_subscription_info(ctx.profile_id, account_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"account": account}


@router.get("/{account_id}/secret")
async def get_account_secret(
    account_id: str,
    ctx: ProfileContext = Depends(get_profile_context)
):
    """Return the decrypted ElevenLabs API key for the active profile."""
    manager = get_account_manager()

    try:
        api_key = manager.get_account_secret(ctx.profile_id, account_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"api_key": api_key}
