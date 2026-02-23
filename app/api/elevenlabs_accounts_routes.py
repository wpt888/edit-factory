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


class UpdateAccountRequest(BaseModel):
    label: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/")
async def list_accounts(ctx: ProfileContext = Depends(get_profile_context)):
    """List all ElevenLabs accounts for the current profile (keys masked)."""
    manager = get_account_manager()
    accounts = manager.list_accounts(ctx.profile_id)
    return {"accounts": accounts}


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
