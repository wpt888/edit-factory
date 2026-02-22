"""
TTS Library API Routes

CRUD endpoints for managing persistent TTS assets (MP3 + SRT files).
Supports create, edit (with auto-regeneration), delete, and audio/SRT serving.
"""
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.api.validators import validate_tts_text_length
from app.config import get_settings
from app.services.tts_library_service import get_tts_library_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tts-library", tags=["TTS Library"])

from app.db import get_supabase


# ============== PYDANTIC MODELS ==============


class TTSAssetCreate(BaseModel):
    tts_text: str
    tts_model: str = "eleven_flash_v2_5"


class TTSAssetUpdate(BaseModel):
    tts_text: str


class TTSAssetResponse(BaseModel):
    id: str
    tts_text: str
    mp3_url: Optional[str] = None
    srt_url: Optional[str] = None
    srt_content: Optional[str] = None
    audio_duration: float = 0.0
    char_count: int = 0
    tts_model: str = "eleven_flash_v2_5"
    status: str = "ready"
    is_used: bool = False
    created_at: str = ""
    updated_at: str = ""


# ============== ENDPOINTS ==============


@router.get("/", response_model=List[TTSAssetResponse])
async def list_tts_assets(
    profile: ProfileContext = Depends(get_profile_context),
):
    """List all TTS assets for the current profile, with is_used badge."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Fetch assets
    result = (
        supabase.table("editai_tts_assets")
        .select("*")
        .eq("profile_id", profile.profile_id)
        .order("created_at", desc=True)
        .execute()
    )

    assets = result.data or []

    # Fetch used texts from clip_content for this profile's clips
    used_texts = set()
    try:
        clips_result = (
            supabase.table("editai_clips")
            .select("id")
            .eq("profile_id", profile.profile_id)
            .execute()
        )
        clip_ids = [c["id"] for c in (clips_result.data or [])]

        if clip_ids:
            content_result = (
                supabase.table("editai_clip_content")
                .select("tts_text")
                .in_("clip_id", clip_ids)
                .execute()
            )
            for row in content_result.data or []:
                if row.get("tts_text"):
                    used_texts.add(row["tts_text"].strip())
    except Exception as e:
        logger.warning(f"Failed to fetch used texts for is_used badge: {e}")

    # Build response
    responses = []
    for asset in assets:
        asset_id = asset["id"]
        is_used = asset.get("tts_text", "").strip() in used_texts
        responses.append(
            TTSAssetResponse(
                id=asset_id,
                tts_text=asset.get("tts_text", ""),
                mp3_url=f"/api/v1/tts-library/{asset_id}/audio" if asset.get("mp3_path") else None,
                srt_url=f"/api/v1/tts-library/{asset_id}/srt" if asset.get("srt_path") else None,
                srt_content=asset.get("srt_content"),
                audio_duration=asset.get("audio_duration", 0.0),
                char_count=asset.get("char_count", 0),
                tts_model=asset.get("tts_model", "eleven_flash_v2_5"),
                status=asset.get("status", "ready"),
                is_used=is_used,
                created_at=asset.get("created_at", ""),
                updated_at=asset.get("updated_at", ""),
            )
        )

    return responses


@router.get("/{asset_id}", response_model=TTSAssetResponse)
async def get_tts_asset(
    asset_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Get a single TTS asset by ID."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = (
        supabase.table("editai_tts_assets")
        .select("*")
        .eq("id", asset_id)
        .eq("profile_id", profile.profile_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="TTS asset not found")

    asset = result.data

    # Check is_used
    is_used = False
    try:
        clips_result = (
            supabase.table("editai_clips")
            .select("id")
            .eq("profile_id", profile.profile_id)
            .execute()
        )
        clip_ids = [c["id"] for c in (clips_result.data or [])]
        if clip_ids and asset.get("tts_text"):
            content_result = (
                supabase.table("editai_clip_content")
                .select("tts_text")
                .in_("clip_id", clip_ids)
                .execute()
            )
            used_texts = {r["tts_text"].strip() for r in (content_result.data or []) if r.get("tts_text")}
            is_used = asset["tts_text"].strip() in used_texts
    except Exception:
        pass

    return TTSAssetResponse(
        id=asset["id"],
        tts_text=asset.get("tts_text", ""),
        mp3_url=f"/api/v1/tts-library/{asset_id}/audio" if asset.get("mp3_path") else None,
        srt_url=f"/api/v1/tts-library/{asset_id}/srt" if asset.get("srt_path") else None,
        srt_content=asset.get("srt_content"),
        audio_duration=asset.get("audio_duration", 0.0),
        char_count=asset.get("char_count", 0),
        tts_model=asset.get("tts_model", "eleven_flash_v2_5"),
        status=asset.get("status", "ready"),
        is_used=is_used,
        created_at=asset.get("created_at", ""),
        updated_at=asset.get("updated_at", ""),
    )


@router.post("/", response_model=TTSAssetResponse, status_code=201)
async def create_tts_asset(
    request: TTSAssetCreate,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Create a new TTS asset. Generates MP3 + SRT in background."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    validate_tts_text_length(request.tts_text, "tts_text")

    import uuid
    asset_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # Insert with status=generating
    supabase.table("editai_tts_assets").insert({
        "id": asset_id,
        "profile_id": profile.profile_id,
        "tts_text": request.tts_text.strip(),
        "tts_model": request.tts_model,
        "char_count": len(request.tts_text.strip()),
        "status": "generating",
        "tts_provider": "elevenlabs",
    }).execute()

    # Background generation
    async def _generate():
        try:
            tts_lib = get_tts_library_service()
            result = await tts_lib.generate_asset(
                text=request.tts_text.strip(),
                profile_id=profile.profile_id,
                asset_id=asset_id,
                model=request.tts_model,
            )
            supabase.table("editai_tts_assets").update({
                "mp3_path": result["mp3_path"],
                "srt_path": result["srt_path"],
                "srt_content": result["srt_content"],
                "audio_duration": result["audio_duration"],
                "char_count": result["char_count"],
                "tts_timestamps": result["tts_timestamps"],
                "tts_voice_id": result["tts_voice_id"],
                "status": "ready",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", asset_id).execute()
            logger.info(f"TTS asset {asset_id} generated successfully")
        except Exception as e:
            logger.error(f"TTS asset {asset_id} generation failed: {e}")
            supabase.table("editai_tts_assets").update({
                "status": "failed",
                "error_message": str(e),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", asset_id).execute()

    background_tasks.add_task(_generate)

    return TTSAssetResponse(
        id=asset_id,
        tts_text=request.tts_text.strip(),
        char_count=len(request.tts_text.strip()),
        tts_model=request.tts_model,
        status="generating",
        created_at=now,
        updated_at=now,
    )


@router.put("/{asset_id}", response_model=TTSAssetResponse)
async def update_tts_asset(
    asset_id: str,
    request: TTSAssetUpdate,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Update text of a TTS asset. Triggers auto-regeneration of MP3 + SRT."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    validate_tts_text_length(request.tts_text, "tts_text")

    # Verify asset exists and belongs to profile
    result = (
        supabase.table("editai_tts_assets")
        .select("*")
        .eq("id", asset_id)
        .eq("profile_id", profile.profile_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="TTS asset not found")

    asset = result.data
    now = datetime.now(timezone.utc).isoformat()

    # Update text and set generating
    supabase.table("editai_tts_assets").update({
        "tts_text": request.tts_text.strip(),
        "char_count": len(request.tts_text.strip()),
        "status": "generating",
        "error_message": None,
        "updated_at": now,
    }).eq("id", asset_id).execute()

    # Background regeneration
    async def _regenerate():
        try:
            tts_lib = get_tts_library_service()
            gen_result = await tts_lib.regenerate_asset(
                asset_id=asset_id,
                new_text=request.tts_text.strip(),
                profile_id=profile.profile_id,
                model=asset.get("tts_model", "eleven_flash_v2_5"),
                old_mp3_path=asset.get("mp3_path"),
                old_srt_path=asset.get("srt_path"),
            )
            supabase.table("editai_tts_assets").update({
                "mp3_path": gen_result["mp3_path"],
                "srt_path": gen_result["srt_path"],
                "srt_content": gen_result["srt_content"],
                "audio_duration": gen_result["audio_duration"],
                "char_count": gen_result["char_count"],
                "tts_timestamps": gen_result["tts_timestamps"],
                "tts_voice_id": gen_result["tts_voice_id"],
                "status": "ready",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", asset_id).execute()
            logger.info(f"TTS asset {asset_id} regenerated successfully")
        except Exception as e:
            logger.error(f"TTS asset {asset_id} regeneration failed: {e}")
            supabase.table("editai_tts_assets").update({
                "status": "failed",
                "error_message": str(e),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", asset_id).execute()

    background_tasks.add_task(_regenerate)

    return TTSAssetResponse(
        id=asset_id,
        tts_text=request.tts_text.strip(),
        char_count=len(request.tts_text.strip()),
        tts_model=asset.get("tts_model", "eleven_flash_v2_5"),
        status="generating",
        created_at=asset.get("created_at", ""),
        updated_at=now,
    )


@router.delete("/{asset_id}")
async def delete_tts_asset(
    asset_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Delete a TTS asset and its files."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify ownership
    result = (
        supabase.table("editai_tts_assets")
        .select("*")
        .eq("id", asset_id)
        .eq("profile_id", profile.profile_id)
        .single()
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="TTS asset not found")

    asset = result.data

    # Delete files
    tts_lib = get_tts_library_service()
    tts_lib.delete_asset_files(asset.get("mp3_path"), asset.get("srt_path"))

    # Delete from DB
    supabase.table("editai_tts_assets").delete().eq("id", asset_id).execute()

    return {"detail": "Asset deleted"}


@router.get("/{asset_id}/audio")
async def serve_audio(
    asset_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Serve the MP3 audio file for a TTS asset."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = (
        supabase.table("editai_tts_assets")
        .select("mp3_path, profile_id")
        .eq("id", asset_id)
        .eq("profile_id", profile.profile_id)
        .single()
        .execute()
    )

    if not result.data or not result.data.get("mp3_path"):
        raise HTTPException(status_code=404, detail="Audio not found")

    settings = get_settings()
    file_path = settings.base_dir / result.data["mp3_path"]

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file missing from disk")

    return FileResponse(
        path=str(file_path),
        media_type="audio/mpeg",
        filename=f"{asset_id}.mp3",
    )


@router.get("/{asset_id}/srt")
async def serve_srt(
    asset_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Serve the SRT subtitle file for a TTS asset."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = (
        supabase.table("editai_tts_assets")
        .select("srt_path, profile_id")
        .eq("id", asset_id)
        .eq("profile_id", profile.profile_id)
        .single()
        .execute()
    )

    if not result.data or not result.data.get("srt_path"):
        raise HTTPException(status_code=404, detail="SRT not found")

    settings = get_settings()
    file_path = settings.base_dir / result.data["srt_path"]

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="SRT file missing from disk")

    return FileResponse(
        path=str(file_path),
        media_type="text/plain",
        filename=f"{asset_id}.srt",
        headers={"Content-Disposition": f'attachment; filename="{asset_id}.srt"'},
    )
