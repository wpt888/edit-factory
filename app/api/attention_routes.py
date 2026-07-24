"""Profile-scoped Attention Hook templates."""
import logging
import uuid
from contextlib import contextmanager
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.api.auth import ProfileContext, get_profile_context, security
from app.config import get_settings
from app.repositories.factory import get_repository
from app.repositories.supabase_repo import SupabaseRepository
from app.services.attention_templates import SYSTEM_TEMPLATES

router = APIRouter(prefix="/attention-templates", tags=["Attention Hooks"])
logger = logging.getLogger(__name__)

_STORAGE_UNAVAILABLE_DETAIL = (
    "Content template storage is unavailable. "
    "Ask an administrator to apply the latest database migrations."
)


class AttentionDefaultAsset(BaseModel):
    """Optional content saved with a slot. Step 3 pre-populates from it; the
    pipeline can override it without touching the template."""
    url: str = Field(max_length=4096)
    type: Literal["image", "video"] = "image"


class AttentionTemplateImage(BaseModel):
    id: str = Field(default="", max_length=80)
    defaultAsset: Optional[AttentionDefaultAsset] = None
    x: float = Field(default=0.1, ge=0.0, le=1.0)
    y: float = Field(default=0.1, ge=0.0, le=1.0)
    width: float = Field(default=0.8, gt=0.0, le=1.0)
    height: float = Field(default=0.8, gt=0.0, le=1.0)
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    fit: Literal["contain", "cover"] = "contain"
    startMs: int = Field(default=0, ge=0, le=600000)
    durationMs: int = Field(default=1200, ge=100, le=600000)
    animation: Optional[Literal[
        "static", "fade", "pop", "zoom", "bounce", "slide", "slide-right",
        "slide-up", "slide-down", "wipe-left", "wipe-right", "spin", "tornado",
    ]] = None
    enterMs: Optional[int] = Field(default=None, ge=0, le=10000)
    sfxAssetId: Optional[str] = Field(default=None, max_length=500)
    sfxUrl: Optional[str] = Field(default=None, max_length=4096)
    sfxLabel: Optional[str] = Field(default=None, max_length=120)
    sfxVolumeDb: float = Field(default=0.0, ge=-60.0, le=12.0)
    sfxTrack: int = Field(default=1, ge=1, le=10)


class AttentionTemplateBody(BaseModel):
    """Track-based template: tracks[i] = images on lane V(2+i)."""
    name: str = Field(min_length=1, max_length=80)
    canvasWidth: int = Field(default=1080, ge=64, le=8192, multiple_of=2)
    canvasHeight: int = Field(default=1920, ge=64, le=8192, multiple_of=2)
    zone: Literal["behind", "front"] = "behind"
    animation: Literal[
        "static", "fade", "pop", "zoom", "bounce", "slide", "slide-right",
        "slide-up", "slide-down", "wipe-left", "wipe-right", "spin", "tornado",
    ] = "static"
    enterMs: int = Field(default=250, ge=0, le=10000)
    variantGapMs: int = Field(default=1000, ge=0, le=30000)
    sfx: Optional[str] = Field(default=None, max_length=500)
    audioTrackCount: int = Field(default=1, ge=1, le=10)
    tracks: list[list[AttentionTemplateImage]] = Field(default_factory=lambda: [[]], max_length=10)


def _owned(repo, template_id: str, profile_id: str) -> Dict[str, Any]:
    row = repo.get_attention_template(template_id)
    if not row:
        raise HTTPException(status_code=404, detail="Content template not found")
    if row.get("profile_id") != profile_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return row


def _storage_unavailable(action: str, profile_id: str, exc: Exception) -> HTTPException:
    """Turn repository failures into a response the browser can actually read.

    Unhandled datastore errors can escape outside the CORS middleware and reach
    the editor as the misleading network message ``Failed to fetch``. Keep the
    database error in server logs and return a stable, non-sensitive detail.
    """
    logger.exception(
        "Could not %s attention template for profile %s",
        action,
        profile_id,
        exc_info=exc,
    )
    return HTTPException(status_code=503, detail=_STORAGE_UNAVAILABLE_DETAIL)


@contextmanager
def _attention_repository(credentials: Optional[HTTPAuthorizationCredentials]):
    """Use caller-scoped RLS access when the backend has no admin key."""
    repo = get_repository()
    settings = get_settings()
    if (
        isinstance(repo, SupabaseRepository)
        and not settings.supabase_service_role_key
        and credentials is not None
    ):
        with repo.authenticated(credentials.credentials) as authenticated_repo:
            yield authenticated_repo
        return
    yield repo


@router.get("")
async def list_attention_templates(
    profile: ProfileContext = Depends(get_profile_context),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    personal_templates_available = True
    try:
        with _attention_repository(credentials) as repo:
            personal = repo.list_attention_templates(profile.profile_id)
    except Exception:
        # Personal templates are an optional extension of the built-in library.
        # A deployment that has not applied the attention-template migration (or
        # a temporarily unavailable datastore) must not make the whole editor
        # unusable: the deterministic system templates need no persistence.
        logger.exception(
            "Could not load personal attention templates for profile %s; "
            "serving system templates only",
            profile.profile_id,
        )
        personal = []
        personal_templates_available = False
    return {
        "templates": [*SYSTEM_TEMPLATES, *[{**row.get("config", {}), "id": row["id"], "name": row["name"], "is_system": False} for row in personal]],
        "personal_templates_available": personal_templates_available,
    }


@router.post("", status_code=201)
async def create_attention_template(
    body: AttentionTemplateBody,
    profile: ProfileContext = Depends(get_profile_context),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    data = body.model_dump()
    try:
        with _attention_repository(credentials) as repo:
            row = repo.create_attention_template({
                "id": str(uuid.uuid4()), "profile_id": profile.profile_id,
                "name": data.pop("name"), "config": data,
            })
    except Exception as exc:
        raise _storage_unavailable("create", profile.profile_id, exc) from exc
    return {**row.get("config", {}), "id": row["id"], "name": row["name"], "is_system": False}


@router.put("/{template_id}")
async def update_attention_template(
    template_id: str,
    body: AttentionTemplateBody,
    profile: ProfileContext = Depends(get_profile_context),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    try:
        with _attention_repository(credentials) as repo:
            _owned(repo, template_id, profile.profile_id)
            data = body.model_dump()
            row = repo.update_attention_template(template_id, {"name": data.pop("name"), "config": data})
    except HTTPException:
        raise
    except Exception as exc:
        raise _storage_unavailable("update", profile.profile_id, exc) from exc
    return {**row.get("config", {}), "id": row["id"], "name": row["name"], "is_system": False}


@router.delete("/{template_id}", status_code=204)
async def delete_attention_template(
    template_id: str,
    profile: ProfileContext = Depends(get_profile_context),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    try:
        with _attention_repository(credentials) as repo:
            _owned(repo, template_id, profile.profile_id)
            repo.delete_attention_template(template_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise _storage_unavailable("delete", profile.profile_id, exc) from exc
