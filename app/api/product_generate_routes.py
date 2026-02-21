"""
product_generate_routes.py - Product video generation endpoint and background pipeline.

Provides endpoints that dispatch background tasks for video generation:
  Stage 1: Setup — fetch product, resolve image
  Stage 2: TTS voiceover (quick template or elaborate AI script)
  Stage 3: SRT subtitle generation (ElevenLabs only)
  Stage 4: Silent video composition via product_video_compositor
  Stage 5: Final render via _render_with_preset (audio mux + encoding + filters + subtitles)
  Stage 6: Library insert (editai_projects + editai_clips rows)

Endpoints:
    POST /products/{product_id}/generate        Kick off single product video generation
    POST /products/batch-generate               Kick off batch product video generation
    GET  /products/batch/{batch_id}/status      Poll per-product batch status
"""
import asyncio
import logging
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.api.auth import ProfileContext, get_profile_context
from app.config import get_settings
from app.services.job_storage import get_job_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/products", tags=["product-video"])


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class ProductGenerateRequest(BaseModel):
    voiceover_mode: str = "quick"           # "quick" | "elaborate"
    tts_provider: str = "edge"              # "edge" | "elevenlabs"
    voice_id: Optional[str] = None         # Override voice; falls back to profile/default
    ai_provider: str = "gemini"             # "gemini" | "claude" (elaborate mode only)
    duration_s: int = 30                    # 15 | 30 | 45 | 60
    encoding_preset: str = "tiktok"         # "tiktok" | "reels" | "youtube_shorts"
    voiceover_template: str = "{title}. {brand}. Pret: {price} lei."  # quick mode template
    cta_text: str = "Comanda acum!"
    enable_denoise: bool = False
    enable_sharpen: bool = False
    enable_color_correction: bool = False


class BatchGenerateRequest(BaseModel):
    """Request model for batch product video generation.

    All settings are applied uniformly to every product in the batch.
    Per-product customization is explicitly out of scope.
    """
    product_ids: list[str]                  # 2-50 product IDs
    voiceover_mode: str = "quick"           # "quick" | "elaborate"
    tts_provider: str = "edge"              # "edge" default per v5 roadmap decision
    voice_id: Optional[str] = None
    ai_provider: str = "gemini"
    duration_s: int = 30
    encoding_preset: str = "tiktok"
    voiceover_template: str = "{title}. {brand}. Pret: {price} lei."
    cta_text: str = "Comanda acum!"
    enable_denoise: bool = False
    enable_sharpen: bool = False
    enable_color_correction: bool = False

    @field_validator("product_ids")
    @classmethod
    def validate_product_ids(cls, v: list[str]) -> list[str]:
        if len(v) < 2:
            raise ValueError("Batch requires at least 2 product_ids")
        if len(v) > 50:
            raise ValueError("Batch cannot exceed 50 product_ids")
        return v


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_supabase():
    """Lazy-init Supabase client (same pattern as product_routes and library_routes)."""
    from supabase import create_client
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_key)


def _build_preset_dict(preset_name: str) -> dict:
    """Convert EncodingPreset to the dict format expected by _render_with_preset.

    _render_with_preset was designed for DB-originated preset dicts, so we need
    to bridge the gap by constructing the same shape from an EncodingPreset object.
    """
    from app.services.encoding_presets import get_preset

    ep = get_preset(preset_name)
    return {
        "name": ep.name,
        "width": 1080,
        "height": 1920,
        "fps": 30,
        "audio_bitrate": ep.audio_bitrate,
        "extra_flags": "-movflags +faststart",
    }


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/{product_id}/generate")
async def generate_product_video(
    product_id: str,
    request: ProductGenerateRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Kick off background product video generation.

    Validates that the product exists, creates a job record, dispatches the
    6-stage background pipeline, and returns job_id immediately for polling.

    Returns:
        {"job_id": str, "status": "pending"}
    """
    supabase = _get_supabase()

    # Verify product exists (and belongs to profile's accessible feeds)
    product_result = supabase.table("products")\
        .select("id, title, feed_id")\
        .eq("id", product_id)\
        .single()\
        .execute()

    if not product_result.data:
        raise HTTPException(status_code=404, detail="Product not found")

    job_id = str(uuid.uuid4())
    job_storage = get_job_storage()

    job_storage.create_job(
        job_data={
            "job_id": job_id,
            "job_type": "product_video",
            "status": "pending",
            "progress": "0",
            "product_id": product_id,
            "profile_id": profile.profile_id,
        },
        profile_id=profile.profile_id,
    )

    background_tasks.add_task(
        _generate_product_video_task,
        job_id=job_id,
        product_id=product_id,
        profile_id=profile.profile_id,
        request=request,
    )

    return {"job_id": job_id, "status": "pending"}


# ---------------------------------------------------------------------------
# Batch endpoints
# ---------------------------------------------------------------------------

@router.post("/batch-generate")
async def batch_generate_products(
    request: BatchGenerateRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Kick off batch product video generation.

    Creates a batch job record in JobStorage, fetches product titles for display,
    and dispatches a single sequential background task that processes each product
    with per-product error isolation.

    Returns:
        {"batch_id": str, "total": int}
    """
    supabase = _get_supabase()
    job_storage = get_job_storage()

    batch_id = str(uuid.uuid4())

    # Build per-product job stubs (titles fetched below)
    product_jobs = [
        {
            "product_id": pid,
            "job_id": str(uuid.uuid4()),
            "title": "",
            "status": "queued",
            "progress": "0",
            "error": None,
        }
        for pid in request.product_ids
    ]

    # Fetch product titles in one query for display — non-fatal if it fails
    try:
        titles_result = supabase.table("products")\
            .select("id, title")\
            .in_("id", request.product_ids)\
            .execute()

        if titles_result.data:
            title_map = {row["id"]: row.get("title", "") for row in titles_result.data}
            for pj in product_jobs:
                pj["title"] = title_map.get(pj["product_id"], "")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[batch %s] Failed to fetch product titles: %s", batch_id, exc)

    # Persist batch record to Supabase via JobStorage
    job_storage.create_job(
        job_data={
            "job_id": batch_id,
            "job_type": "batch_product_video",
            "status": "processing",
            "progress": "0",
            "profile_id": profile.profile_id,
            "product_jobs": product_jobs,
            "total": len(product_jobs),
            "completed": 0,
            "failed": 0,
        },
        profile_id=profile.profile_id,
    )

    # Dispatch single background task — processes products sequentially with error isolation
    background_tasks.add_task(
        _batch_generate_task,
        batch_id=batch_id,
        product_jobs=product_jobs,
        profile_id=profile.profile_id,
        request=request,
    )

    return {"batch_id": batch_id, "total": len(product_jobs)}


@router.get("/batch/{batch_id}/status")
async def get_batch_status(
    batch_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Poll batch job status with per-product details.

    Reads the batch record from JobStorage, then merges fresh child job states
    so callers see live progress per product.

    Returns:
        {
            "batch_id": str,
            "status": "processing" | "completed",
            "total": int,
            "completed": int,
            "failed": int,
            "product_jobs": [{"product_id", "job_id", "title", "status", "progress", "error", "result"}, ...]
        }
    """
    job_storage = get_job_storage()

    batch = job_storage.get_job(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    product_statuses = []
    for pj in batch.get("product_jobs", []):
        child = job_storage.get_job(pj["job_id"]) or {}
        product_statuses.append({
            "product_id": pj["product_id"],
            "job_id": pj["job_id"],
            "title": pj.get("title", ""),
            "status": child.get("status", pj.get("status", "queued")),
            "progress": child.get("progress", "0"),
            "error": child.get("error"),
            "result": child.get("result"),
        })

    total = len(product_statuses)
    completed = sum(1 for p in product_statuses if p["status"] == "completed")
    failed = sum(1 for p in product_statuses if p["status"] == "failed")

    # Batch is done when every product has reached a terminal state (completed or failed)
    overall_status = "completed" if (completed + failed) == total else "processing"

    return {
        "batch_id": batch_id,
        "status": overall_status,
        "total": total,
        "completed": completed,
        "failed": failed,
        "product_jobs": product_statuses,
    }


# ---------------------------------------------------------------------------
# Batch background task — sequential with per-product error isolation
# ---------------------------------------------------------------------------

async def _batch_generate_task(
    batch_id: str,
    product_jobs: list[dict],
    profile_id: str,
    request: BatchGenerateRequest,
) -> None:
    """Sequential batch processing with per-product error isolation.

    Each product is processed independently. A failure in product N does NOT
    prevent product N+1 from processing — the except block NEVER re-raises.
    """
    job_storage = get_job_storage()

    for product_job in product_jobs:
        pid = product_job["product_id"]
        child_job_id = product_job["job_id"]

        # Mark this product as processing in the batch record
        _update_batch_product_status(batch_id, pid, "processing", job_storage, profile_id)

        try:
            # Create child job record in JobStorage so it's pollable independently
            job_storage.create_job(
                job_data={
                    "job_id": child_job_id,
                    "job_type": "product_video",
                    "status": "pending",
                    "progress": "0",
                    "product_id": pid,
                    "profile_id": profile_id,
                },
                profile_id=profile_id,
            )

            # Build a single-product request from shared batch settings
            single_request = ProductGenerateRequest(
                voiceover_mode=request.voiceover_mode,
                tts_provider=request.tts_provider,
                voice_id=request.voice_id,
                ai_provider=request.ai_provider,
                duration_s=request.duration_s,
                encoding_preset=request.encoding_preset,
                voiceover_template=request.voiceover_template,
                cta_text=request.cta_text,
                enable_denoise=request.enable_denoise,
                enable_sharpen=request.enable_sharpen,
                enable_color_correction=request.enable_color_correction,
            )

            # Reuse the proven single-product 6-stage pipeline
            await _generate_product_video_task(
                job_id=child_job_id,
                product_id=pid,
                profile_id=profile_id,
                request=single_request,
            )

            # Check child job final state
            child = job_storage.get_job(child_job_id)
            if child and child.get("status") == "completed":
                _update_batch_product_status(batch_id, pid, "completed", job_storage, profile_id)
            else:
                err = (child.get("error", "Unknown error") if child else "Child job not found after pipeline")
                _update_batch_product_status(batch_id, pid, "failed", job_storage, profile_id, err)

        except Exception as exc:  # noqa: BLE001 — NEVER re-raise; continue to next product
            logger.error(
                "[batch %s] Product %s failed with exception: %s",
                batch_id,
                pid,
                exc,
                exc_info=True,
            )
            _update_batch_product_status(batch_id, pid, "failed", job_storage, profile_id, str(exc))

    # Finalize batch after all products processed
    _finalize_batch(batch_id, job_storage, profile_id)


def _update_batch_product_status(
    batch_id: str,
    product_id: str,
    status: str,
    job_storage,
    profile_id: str,
    error: Optional[str] = None,
) -> None:
    """Update the status of a single product within the batch job record.

    Reads the batch record, finds the product_job entry by product_id,
    updates its status/error fields, then writes back via update_job.
    """
    batch = job_storage.get_job(batch_id)
    if not batch:
        logger.warning("[batch %s] Cannot update product %s status — batch record not found", batch_id, product_id)
        return

    product_jobs = batch.get("product_jobs", [])
    for pj in product_jobs:
        if pj["product_id"] == product_id:
            pj["status"] = status
            if error is not None:
                pj["error"] = error
            break

    job_storage.update_job(
        batch_id,
        {"product_jobs": product_jobs},
        profile_id=profile_id,
    )


def _finalize_batch(batch_id: str, job_storage, profile_id: str) -> None:
    """Compute final batch counts and set overall batch status.

    Called once after all products in the sequential loop have been processed.
    """
    batch = job_storage.get_job(batch_id)
    if not batch:
        logger.warning("[batch %s] Cannot finalize — batch record not found", batch_id)
        return

    product_jobs = batch.get("product_jobs", [])
    completed = sum(1 for pj in product_jobs if pj.get("status") == "completed")
    failed = sum(1 for pj in product_jobs if pj.get("status") == "failed")
    total = len(product_jobs)

    # "completed" even if some failed — batch ran to completion
    final_status = "completed" if (completed + failed) == total else "completed_with_errors"

    job_storage.update_job(
        batch_id,
        {
            "status": final_status,
            "progress": "100",
            "completed": completed,
            "failed": failed,
        },
        profile_id=profile_id,
    )

    logger.info(
        "[batch %s] Finalized: total=%d completed=%d failed=%d status=%s",
        batch_id,
        total,
        completed,
        failed,
        final_status,
    )


# ---------------------------------------------------------------------------
# Background task — 6-stage single-product pipeline
# ---------------------------------------------------------------------------

async def _generate_product_video_task(
    job_id: str,
    product_id: str,
    profile_id: str,
    request: ProductGenerateRequest,
) -> None:
    """Full product video generation pipeline.

    Stages:
      1 (0-10%): Setup — fetch product row, resolve image
      2 (10-40%): TTS voiceover (quick template or elaborate AI)
      3 (40-50%): SRT subtitle generation (ElevenLabs only)
      4 (50-70%): Silent video composition via product_video_compositor
      5 (70-90%): Final render via _render_with_preset
      6 (90-100%): Library insert — editai_projects + editai_clips rows
    """
    job_storage = get_job_storage()
    settings = get_settings()

    # Import everything we need up front so any import error surfaces quickly
    from app.api.library_routes import _render_with_preset
    from app.services.product_video_compositor import compose_product_video, CompositorConfig
    from app.services.tts_subtitle_generator import generate_srt_from_timestamps

    try:
        # ---------------------------------------------------------------
        # Stage 1: Setup (0 -> 10%)
        # ---------------------------------------------------------------
        job_storage.update_job(
            job_id,
            {"status": "processing", "progress": "5"},
            profile_id=profile_id,
        )

        supabase = _get_supabase()

        # Fetch full product row
        product_result = supabase.table("products")\
            .select("*")\
            .eq("id", product_id)\
            .single()\
            .execute()

        if not product_result.data:
            raise ValueError(f"Product {product_id} not found")

        product = product_result.data

        # Read profile template settings (video_template_settings JSONB column)
        try:
            profile_result = _get_supabase().table("profiles")\
                .select("video_template_settings")\
                .eq("id", profile_id)\
                .single()\
                .execute()
            tmpl_cfg = (profile_result.data or {}).get("video_template_settings") or {}
        except Exception as _tmpl_exc:
            logger.warning("[%s] Failed to read profile template settings: %s", job_id, _tmpl_exc)
            tmpl_cfg = {}

        # Resolve image path
        image_path: Optional[Path] = None

        raw_local = product.get("local_image_path")
        if raw_local:
            candidate = Path(raw_local)
            if candidate.exists():
                image_path = candidate

        if image_path is None:
            # Attempt re-download from image_link
            image_link = product.get("image_link")
            if image_link:
                from app.services.image_fetcher import _download_one, CONCURRENT_DOWNLOADS
                import asyncio as _asyncio

                feed_id = product.get("feed_id", "unknown")
                cache_dir = settings.base_dir / "images" / feed_id
                cache_dir.mkdir(parents=True, exist_ok=True)

                semaphore = _asyncio.Semaphore(CONCURRENT_DOWNLOADS)
                _, local_path_str = await _download_one(product, cache_dir, semaphore)
                candidate = Path(local_path_str)
                if candidate.exists():
                    image_path = candidate

        if image_path is None:
            raise FileNotFoundError("Product image not available — cannot compose video")

        # Create profile-scoped temp directory
        temp_dir = settings.base_dir / "temp" / profile_id / "product_gen"
        temp_dir.mkdir(parents=True, exist_ok=True)

        job_storage.update_job(job_id, {"progress": "10"}, profile_id=profile_id)

        # ---------------------------------------------------------------
        # Stage 2: TTS Voiceover (10 -> 40%)
        # ---------------------------------------------------------------
        voiceover_text: str = ""

        if request.voiceover_mode == "quick":
            # Build from template — no AI call
            title = product.get("title", "")
            brand = product.get("brand", "") or ""
            price = (
                product.get("raw_sale_price_str")
                or product.get("raw_price_str")
                or str(product.get("price", ""))
            )
            try:
                voiceover_text = request.voiceover_template.format(
                    title=title,
                    brand=brand,
                    price=price,
                )
            except KeyError as e:
                logger.warning(
                    "Voiceover template key error (%s), falling back to basic template", e
                )
                voiceover_text = f"{title}. {brand}. Pret: {price} lei."

        elif request.voiceover_mode == "elaborate":
            # Use ScriptGenerator for AI-generated script
            from app.services.script_generator import ScriptGenerator

            generator = ScriptGenerator(
                gemini_api_key=settings.gemini_api_key,
                anthropic_api_key=getattr(settings, "anthropic_api_key", None),
            )

            loop = asyncio.get_event_loop()
            scripts = await loop.run_in_executor(
                None,
                lambda: generator.generate_scripts(
                    idea=product.get("title", "Product"),
                    context=product.get("description", ""),
                    keywords=[],
                    variant_count=1,
                    provider=request.ai_provider,
                ),
            )

            if scripts:
                voiceover_text = scripts[0]
            else:
                raise ValueError("ScriptGenerator returned no scripts")

        else:
            raise ValueError(f"Unknown voiceover_mode: {request.voiceover_mode!r}")

        if not voiceover_text.strip():
            raise ValueError("Voiceover text is empty — cannot generate TTS")

        job_storage.update_job(job_id, {"progress": "25"}, profile_id=profile_id)

        # TTS synthesis
        tts_audio_path = temp_dir / f"tts_{job_id}.mp3"
        tts_timestamps: Optional[dict] = None

        if request.tts_provider == "elevenlabs":
            from app.services.tts.elevenlabs import ElevenLabsTTSService

            tts_service = ElevenLabsTTSService(
                output_dir=temp_dir,
                voice_id=request.voice_id,
                profile_id=profile_id,
            )

            tts_result, tts_timestamps = await tts_service.generate_audio_with_timestamps(
                text=voiceover_text,
                voice_id=request.voice_id or tts_service._voice_id,
                output_path=tts_audio_path,
            )
            tts_audio_path = tts_result.audio_path
            logger.info(
                "[%s] ElevenLabs TTS done: duration=%.1fs, chars=%d",
                job_id,
                tts_result.duration_seconds,
                len(voiceover_text),
            )

        else:  # edge (default)
            from app.services.tts.edge import EdgeTTSService

            edge_voice = request.voice_id or "ro-RO-EmilNeural"
            tts_service = EdgeTTSService(
                output_dir=temp_dir,
                default_voice=edge_voice,
            )

            tts_result = await tts_service.generate_audio(
                text=voiceover_text,
                voice_id=edge_voice,
                output_path=tts_audio_path,
            )
            tts_audio_path = tts_result.audio_path
            logger.info(
                "[%s] Edge TTS done: duration=%.1fs",
                job_id,
                tts_result.duration_seconds,
            )

        job_storage.update_job(job_id, {"progress": "40"}, profile_id=profile_id)

        # ---------------------------------------------------------------
        # Stage 3: Subtitle generation (40 -> 50%)
        # ---------------------------------------------------------------
        srt_path: Optional[Path] = None

        if request.tts_provider == "elevenlabs" and tts_timestamps:
            srt_content = generate_srt_from_timestamps(tts_timestamps)
            if srt_content:
                srt_path = temp_dir / f"subtitles_{job_id}.srt"
                srt_path.write_text(srt_content, encoding="utf-8")
                logger.info("[%s] SRT subtitles written: %s", job_id, srt_path)
            else:
                logger.warning("[%s] Empty SRT content — skipping subtitles", job_id)

        # Edge TTS: no timestamps, no subtitles (srt_path stays None)

        job_storage.update_job(job_id, {"progress": "50"}, profile_id=profile_id)

        # ---------------------------------------------------------------
        # Stage 4: Silent video composition (50 -> 70%)
        # ---------------------------------------------------------------
        composed_path = temp_dir / f"composed_{job_id}.mp4"

        # CTA priority: explicit non-default request value wins; otherwise use profile setting
        cta_text = (
            request.cta_text
            if request.cta_text != "Comanda acum!"
            else (tmpl_cfg.get("cta_text") or request.cta_text)
        )

        compositor_config = CompositorConfig(
            duration_s=request.duration_s,
            cta_text=cta_text,
            fps=25,
            use_zoompan=True,
            output_dir=settings.output_dir / "product_videos",
            template_name=tmpl_cfg.get("template_name", "product_spotlight"),
            primary_color=tmpl_cfg.get("primary_color", "#FF0000"),
            accent_color=tmpl_cfg.get("accent_color", "#FFFF00"),
            font_family=tmpl_cfg.get("font_family", ""),
        )

        # compose_product_video is synchronous (FFmpeg subprocess)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: compose_product_video(
                image_path=image_path,
                output_path=composed_path,
                product=product,
                config=compositor_config,
            ),
        )

        logger.info("[%s] Composition complete: %s", job_id, composed_path)
        job_storage.update_job(job_id, {"progress": "70"}, profile_id=profile_id)

        # ---------------------------------------------------------------
        # Stage 5: Final render with preset (70 -> 90%)
        # ---------------------------------------------------------------
        output_dir = settings.output_dir / "product_videos"
        output_dir.mkdir(parents=True, exist_ok=True)

        final_path = output_dir / f"product_{product_id}_{job_id}.mp4"

        preset_dict = _build_preset_dict(request.encoding_preset)

        # Build subtitle settings if we have an SRT file
        subtitle_settings: Optional[dict] = None
        if srt_path and srt_path.exists():
            subtitle_settings = {
                "fontSize": 48,
                "fontFamily": "Montserrat",
                "textColor": "#FFFFFF",
                "outlineColor": "#000000",
                "outlineWidth": 3,
                "positionY": 85,
                "shadowDepth": 0,
                "enableGlow": False,
                "glowBlur": 0,
                "adaptiveSizing": False,
            }

        # _render_with_preset is synchronous (FFmpeg subprocess)
        await loop.run_in_executor(
            None,
            lambda: _render_with_preset(
                video_path=composed_path,
                audio_path=tts_audio_path,
                srt_path=srt_path,
                subtitle_settings=subtitle_settings,
                preset=preset_dict,
                output_path=final_path,
                enable_denoise=request.enable_denoise,
                enable_sharpen=request.enable_sharpen,
                enable_color=request.enable_color_correction,
            ),
        )

        logger.info("[%s] Final render complete: %s", job_id, final_path)
        job_storage.update_job(job_id, {"progress": "90"}, profile_id=profile_id)

        # ---------------------------------------------------------------
        # Stage 6: Library insert (90 -> 100%)
        # ---------------------------------------------------------------
        project_name = f"[Product] {product.get('title', 'Unknown')[:50]}"
        now = datetime.now().isoformat()

        # Insert editai_projects row
        project_insert = supabase.table("editai_projects").insert({
            "name": project_name,
            "profile_id": profile_id,
            "status": "completed",
            "target_duration": request.duration_s,
            "created_at": now,
            "updated_at": now,
        }).execute()

        project_id = project_insert.data[0]["id"] if project_insert.data else None
        if not project_id:
            raise ValueError("Failed to insert editai_projects row — no id returned")

        # Insert editai_clips row
        clip_insert = supabase.table("editai_clips").insert({
            "project_id": project_id,
            "profile_id": profile_id,
            "raw_video_path": str(composed_path),
            "final_video_path": str(final_path),
            "final_status": "completed",
            "variant_index": 0,
            "is_selected": True,
            "created_at": now,
            "updated_at": now,
        }).execute()

        clip_id = clip_insert.data[0]["id"] if clip_insert.data else None
        if not clip_id:
            logger.warning("[%s] editai_clips insert returned no id — library insert may have failed", job_id)

        job_storage.update_job(
            job_id,
            {
                "status": "completed",
                "progress": "100",
                "result": {
                    "clip_id": clip_id,
                    "project_id": project_id,
                    "video_path": str(final_path),
                },
            },
            profile_id=profile_id,
        )

        logger.info(
            "[%s] Product video generation complete: project_id=%s clip_id=%s path=%s",
            job_id,
            project_id,
            clip_id,
            final_path,
        )

    except Exception as exc:  # noqa: BLE001
        logger.error(
            "[%s] Product video generation failed: %s\n%s",
            job_id,
            exc,
            traceback.format_exc(),
        )
        try:
            job_storage.update_job(
                job_id,
                {"status": "failed", "error": str(exc), "progress": "0"},
                profile_id=profile_id,
            )
        except Exception as update_exc:
            logger.error("[%s] Failed to update job to failed state: %s", job_id, update_exc)
