"""
product_generate_routes.py - Product video generation endpoint and background pipeline.

Provides a single POST endpoint that dispatches a 6-stage background task:
  Stage 1: Setup — fetch product, resolve image
  Stage 2: TTS voiceover (quick template or elaborate AI script)
  Stage 3: SRT subtitle generation (ElevenLabs only)
  Stage 4: Silent video composition via product_video_compositor
  Stage 5: Final render via _render_with_preset (audio mux + encoding + filters + subtitles)
  Stage 6: Library insert (editai_projects + editai_clips rows)

Endpoints:
    POST /products/{product_id}/generate   Kick off product video generation
"""
import asyncio
import logging
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

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
# Background task — 6-stage pipeline
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

        compositor_config = CompositorConfig(
            duration_s=request.duration_s,
            cta_text=request.cta_text,
            fps=25,
            use_zoompan=True,
            output_dir=settings.output_dir / "product_videos",
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
