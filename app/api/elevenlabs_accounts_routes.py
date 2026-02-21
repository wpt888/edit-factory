"""
ElevenLabs Multi-Account CRUD Routes

Manages multiple ElevenLabs API keys per profile with subscription validation.
"""
import logging
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

    try:
        account = manager.update_subscription_info(ctx.profile_id, account_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"account": account}
