"""
ElevenLabs Multi-Account CRUD Routes

Manages multiple ElevenLabs API keys per profile with subscription validation.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import AuthUser, ProfileContext, get_profile_context, require_role
from app.repositories.factory import get_repository
from app.services.elevenlabs_governance import (
    ElevenLabsGovernanceError,
    assign_voice,
    get_credit_balance,
    list_voice_assignments,
    remove_voice_assignment,
    set_credit_limit,
)
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


class AssignVoiceRequest(BaseModel):
    profile_id: str
    voice_id: str


class SetCreditLimitRequest(BaseModel):
    profile_id: str
    monthly_credit_limit: int


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
    Return the active profile's application credit allowance.

    The shared provider subscription balance is intentionally hidden from
    normal users because it is not their individual spending limit.
    """
    try:
        balance = get_credit_balance(ctx.profile_id)
    except ElevenLabsGovernanceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.as_detail())

    credits_used = balance.get("credits_used", 0)
    credits_reserved = balance.get("credits_reserved", 0)
    credit_limit = balance.get("credit_limit", 0)
    credits_remaining = balance.get("credits_remaining", 0)
    usage_pct = (
        round((credits_used + credits_reserved) / credit_limit * 100, 1)
        if credit_limit > 0 else 0
    )

    return {"account": {
        "id": ctx.profile_id,
        "label": "Your monthly allowance",
        "tier": "included",
        "credits_used": credits_used,
        "credits_reserved": credits_reserved,
        "credit_limit": credit_limit,
        "credits_remaining": credits_remaining,
        # Backwards-compatible aliases for older desktop clients.
        "characters_used": credits_used,
        "character_limit": credit_limit,
        "characters_remaining": credits_remaining,
        "usage_percent": usage_pct,
        "period_start": balance.get("period_start"),
        "period_end": balance.get("period_end"),
        "last_error": None,
    }}


@router.get("/voice-access")
async def get_profile_voice_access(
    ctx: ProfileContext = Depends(get_profile_context),
):
    """List private/custom ElevenLabs voices assigned to this profile."""
    return {"voices": list_voice_assignments(ctx.profile_id)}


@router.post("/voice-access", status_code=201)
async def assign_profile_voice(
    body: AssignVoiceRequest,
    _admin: AuthUser = Depends(require_role("admin")),
):
    """Assign one workspace custom voice to a profile (admin only)."""
    repo = get_repository()
    if not repo.get_profile(body.profile_id):
        raise HTTPException(status_code=404, detail="Profile not found")

    try:
        from pathlib import Path
        from app.config import get_settings
        from app.services.tts.elevenlabs import ElevenLabsTTSService

        service = ElevenLabsTTSService(
            output_dir=Path(get_settings().base_dir) / "temp" / body.profile_id,
            profile_id=body.profile_id,
        )
        metadata = await service._get_voice_metadata(body.voice_id)
        labels = metadata.get("labels") or {}
        assignment = assign_voice(
            body.profile_id,
            body.voice_id,
            voice_name=metadata.get("name"),
            category=metadata.get("category"),
            language=labels.get("language"),
            preview_url=metadata.get("preview_url"),
            assigned_by=_admin.id,
        )
        return {"voice": assignment}
    except ElevenLabsGovernanceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.as_detail())
    except Exception as e:
        logger.warning("Failed to assign ElevenLabs voice: %s", e)
        raise HTTPException(status_code=400, detail="Voice could not be assigned")


@router.delete("/voice-access/{profile_id}/{voice_id}")
async def unassign_profile_voice(
    profile_id: str,
    voice_id: str,
    _admin: AuthUser = Depends(require_role("admin")),
):
    """Remove a profile's custom voice access (admin only)."""
    remove_voice_assignment(profile_id, voice_id)
    return {"status": "deleted", "profile_id": profile_id, "voice_id": voice_id}


@router.put("/credits/limit")
async def update_profile_credit_limit(
    body: SetCreditLimitRequest,
    _admin: AuthUser = Depends(require_role("admin")),
):
    """Set a profile's monthly ElevenLabs allowance (admin only)."""
    repo = get_repository()
    if not repo.get_profile(body.profile_id):
        raise HTTPException(status_code=404, detail="Profile not found")
    try:
        return {"account": set_credit_limit(body.profile_id, body.monthly_credit_limit)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ElevenLabsGovernanceError as e:
        raise HTTPException(status_code=e.status_code, detail=e.as_detail())


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
