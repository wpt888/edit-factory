"""Profile-scoped Attention Hook templates."""
import uuid
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.auth import ProfileContext, get_profile_context
from app.repositories.factory import get_repository
from app.services.attention_templates import SYSTEM_TEMPLATES

router = APIRouter(prefix="/attention-templates", tags=["Attention Hooks"])


class AttentionTemplateBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    strategy: Literal["count", "everySeconds"] = "count"
    count: int = Field(default=3, ge=0, le=100)
    everySeconds: float = Field(default=6, ge=1, le=3600)
    minimumGapMs: int = Field(default=1800, ge=0)
    protectedStartMs: int = Field(default=1500, ge=0)
    protectedEndMs: int = Field(default=1500, ge=0)
    durationMs: int = Field(default=1200, ge=100, le=600000)
    animation: Literal["static", "pop", "zoom", "slide", "spin", "tornado"] = "pop"
    layers: int = Field(default=1, ge=1, le=10)
    sfx: Optional[str] = Field(default=None, max_length=500)
    assetPool: list[str] = Field(default_factory=list, max_length=100)


def _owned(repo, template_id: str, profile_id: str) -> Dict[str, Any]:
    row = repo.get_attention_template(template_id)
    if not row:
        raise HTTPException(status_code=404, detail="Attention template not found")
    if row.get("profile_id") != profile_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return row


@router.get("")
async def list_attention_templates(profile: ProfileContext = Depends(get_profile_context)):
    personal = get_repository().list_attention_templates(profile.profile_id)
    return {"templates": [*SYSTEM_TEMPLATES, *[{**row.get("config", {}), "id": row["id"], "name": row["name"], "is_system": False} for row in personal]]}


@router.post("", status_code=201)
async def create_attention_template(body: AttentionTemplateBody, profile: ProfileContext = Depends(get_profile_context)):
    data = body.model_dump()
    row = get_repository().create_attention_template({
        "id": str(uuid.uuid4()), "profile_id": profile.profile_id,
        "name": data.pop("name"), "config": data,
    })
    return {**row.get("config", {}), "id": row["id"], "name": row["name"], "is_system": False}


@router.put("/{template_id}")
async def update_attention_template(template_id: str, body: AttentionTemplateBody, profile: ProfileContext = Depends(get_profile_context)):
    repo = get_repository()
    _owned(repo, template_id, profile.profile_id)
    data = body.model_dump()
    row = repo.update_attention_template(template_id, {"name": data.pop("name"), "config": data})
    return {**row.get("config", {}), "id": row["id"], "name": row["name"], "is_system": False}


@router.delete("/{template_id}", status_code=204)
async def delete_attention_template(template_id: str, profile: ProfileContext = Depends(get_profile_context)):
    repo = get_repository()
    _owned(repo, template_id, profile.profile_id)
    repo.delete_attention_template(template_id)
