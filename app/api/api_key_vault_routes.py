"""
API Key Vault CRUD Routes

Manages per-profile API keys for Gemini, fal.ai, Anthropic, Postiz, Buffer, Telegram.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.services.credentials.vault import VAULT_SERVICES, get_vault_manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api-keys", tags=["API Key Vault"])


def _invalidate_service_cache(profile_id: str, service: str) -> None:
    """Invalidate in-memory client caches for a service after a vault mutation.

    Without this, changed keys don't take effect until the cached client is
    rebuilt (Gemini never, FAL after 10 min TTL).
    """
    try:
        if service == "gemini":
            from app.api.image_generate_routes import reset_gemini_client
            reset_gemini_client(profile_id)
        elif service == "fal":
            from app.services.fal_image_service import reset_fal_generator
            reset_fal_generator(profile_id)
    except Exception as e:
        logger.warning(f"Failed to invalidate {service} cache for profile {profile_id}: {e}")


def _validate_service(service: str) -> str:
    if service not in VAULT_SERVICES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid service '{service}'. Must be one of: {', '.join(sorted(VAULT_SERVICES))}",
        )
    return service


class AddKeyRequest(BaseModel):
    label: str
    api_key: str


class ValidateKeyRequest(BaseModel):
    api_key: str


class UpdateKeyRequest(BaseModel):
    label: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/{service}/")
async def list_keys(
    service: str = Path(...),
    ctx: ProfileContext = Depends(get_profile_context),
):
    """List all API keys for a service (keys masked)."""
    _validate_service(service)
    vault = get_vault_manager()
    keys = vault.list_keys(ctx.profile_id, service)
    return {"keys": keys}


@router.post("/{service}/", status_code=201)
async def add_key(
    body: AddKeyRequest,
    service: str = Path(...),
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Add a new API key for a service. Maximum 3 per service per profile."""
    _validate_service(service)
    vault = get_vault_manager()

    try:
        key = vault.add_key(ctx.profile_id, service, body.label, body.api_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _invalidate_service_cache(ctx.profile_id, service)
    return {"key": key}


@router.patch("/{service}/{key_id}")
async def update_key(
    key_id: str,
    body: UpdateKeyRequest,
    service: str = Path(...),
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Update key label or active status."""
    _validate_service(service)
    vault = get_vault_manager()

    updates = {}
    if body.label is not None:
        updates["label"] = body.label
    if body.is_active is not None:
        updates["is_active"] = body.is_active

    try:
        key = vault.update_key(ctx.profile_id, key_id, updates)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _invalidate_service_cache(ctx.profile_id, service)
    return {"key": key}


@router.delete("/{service}/{key_id}")
async def delete_key(
    key_id: str,
    service: str = Path(...),
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Delete an API key."""
    _validate_service(service)
    if key_id == "__env__":
        raise HTTPException(status_code=400, detail="Cannot delete .env default key. Remove it from .env instead.")

    vault = get_vault_manager()
    try:
        vault.delete_key(ctx.profile_id, key_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _invalidate_service_cache(ctx.profile_id, service)
    return {"status": "deleted"}


@router.post("/{service}/{key_id}/set-primary")
async def set_primary(
    key_id: str,
    service: str = Path(...),
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Set a key as primary for this service."""
    _validate_service(service)
    vault = get_vault_manager()

    if key_id == "__env__":
        # Clear all DB primaries so env fallback becomes default
        try:
            from app.repositories.factory import get_repository
            from app.repositories.models import QueryFilters
            repo = get_repository()
            current = repo.list_vault_keys(
                ctx.profile_id, service,
                filters=QueryFilters(select="id, is_primary"),
            )
            for row in (current.data or []):
                if row.get("is_primary"):
                    repo.update_vault_key(row["id"], {"is_primary": False})
        except Exception as e:
            logger.warning(f"Failed to clear primary keys: {e}")
        _invalidate_service_cache(ctx.profile_id, service)
        return {"key": {"id": "__env__", "service": service, "is_primary": True}}

    try:
        key = vault.set_primary(ctx.profile_id, service, key_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    _invalidate_service_cache(ctx.profile_id, service)
    return {"key": key}


@router.post("/{service}/validate")
async def validate_key(
    body: ValidateKeyRequest,
    service: str = Path(...),
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Validate an API key against the provider without persisting it."""
    _validate_service(service)
    from app.services.credentials.validators import validate_gemini, validate_fal

    if service == "gemini":
        result = await validate_gemini(body.api_key)
    elif service == "fal":
        result = await validate_fal(body.api_key)
    else:
        raise HTTPException(status_code=400, detail=f"Validation not supported for service '{service}'")

    return result


@router.get("/{service}/{key_id}/secret")
async def get_key_secret(
    key_id: str,
    service: str = Path(...),
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Return the decrypted API key for the active profile and service."""
    _validate_service(service)
    vault = get_vault_manager()

    try:
        secret = vault.get_key_secret(ctx.profile_id, service, key_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"api_key": secret}
