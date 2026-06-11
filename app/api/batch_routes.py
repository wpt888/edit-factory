"""
Batch Pipeline Routes (MVP desktop F6 — mass editing).

The product promise: paste N ideas, walk away, come back to N variants ready
for review. Each idea becomes one persisted pipeline (script -> TTS -> SRT ->
deterministic keyword matching), processed sequentially by a background worker
so FFmpeg/TTS resources are never oversubscribed.

State lives in JobStorage (Supabase/SQLite persisted, in-memory fallback) so
batches survive a backend restart: a half-finished batch can be resumed with
POST /pipeline/batch/{batch_id}/resume — items already ready_for_review are
skipped, queued/failed items are re-processed.

Rendering approved variants reuses the existing POST /pipeline/render/{id}
endpoint (called per-pipeline from the review UI), which already runs in the
background, respects the global FFmpeg semaphore, and persists outputs.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.auth import ProfileContext, get_profile_context
from app.core.rate_limit import limiter
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters
from app.services.job_storage import get_job_storage
from app.services.script_generator import get_script_generator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipeline", tags=["Batch Pipeline"])

# Single-flight guard: one batch worker per backend process. Sequential by
# design (plan F6: 1-2 concurrent, respecting the FFmpeg semaphore) — TTS and
# preview matching already parallelize internally where safe.
_batch_worker_lock = asyncio.Lock()


class BatchSettings(BaseModel):
    """Common settings applied to every idea in the batch."""
    provider: str = "gemini"
    voice_id: Optional[str] = None
    elevenlabs_model: str = "eleven_flash_v2_5"
    words_per_subtitle: int = Field(default=2, ge=1, le=6)
    min_segment_duration: float = Field(default=3.0, ge=0.5, le=10.0)
    target_script_duration: Optional[float] = Field(default=None, ge=5, le=300)
    source_video_ids: Optional[List[str]] = None
    ultra_rapid_intro: bool = False


class BatchCreateRequest(BaseModel):
    ideas: List[str] = Field(..., min_length=1, max_length=20)
    settings: BatchSettings = Field(default_factory=BatchSettings)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_item(idea: str) -> dict:
    return {
        "idea": idea,
        "status": "queued",  # queued -> generating_script -> generating_preview -> ready_for_review | failed
        "pipeline_id": None,
        "error": None,
        "updated_at": _now(),
    }


def _update_item(job_id: str, index: int, **changes) -> None:
    """Read-modify-write one batch item; JobStorage persists the whole job.

    JobStorage job_data is FLAT (items/settings are top-level keys merged by
    update_job), not nested under "data"."""
    storage = get_job_storage()
    job = storage.get_job(job_id)
    if not job:
        return
    items = job.get("items") or []
    if index >= len(items):
        return
    items[index].update(changes, updated_at=_now())
    done = sum(1 for it in items if it["status"] in ("ready_for_review", "failed"))
    storage.update_job(job_id, {
        "items": items,
        "progress": f"{done}/{len(items)} processed",
    })


async def _generate_scripts_for_idea(
    profile_id: str, idea: str, settings: BatchSettings
) -> List[str]:
    """Script generation for one idea (mirrors the /generate route core)."""
    repo = get_repository()
    unique_keywords: List[str] = []
    product_groups_dict: dict = {}
    ai_instructions = ""
    if repo:
        try:
            result = repo.list_segments(
                profile_id, QueryFilters(select="keywords, product_group")
            )
            all_keywords = set()
            for seg in result.data:
                pg = seg.get("product_group")
                for kw in seg.get("keywords") or []:
                    all_keywords.add(kw)
                    if pg:
                        product_groups_dict.setdefault(pg, set()).add(kw)
            unique_keywords = sorted(all_keywords)
            product_groups_dict = {k: sorted(v) for k, v in product_groups_dict.items()}
        except Exception as e:
            logger.warning(f"Batch: keyword fetch failed: {e}")
        try:
            profile_row = repo.get_profile(profile_id)
            if profile_row:
                ai_instructions = profile_row.get("ai_instructions") or ""
        except Exception as e:
            logger.warning(f"Batch: ai_instructions fetch failed: {e}")

    generator = get_script_generator()
    return await asyncio.to_thread(
        generator.generate_scripts,
        idea=idea,
        context="",
        keywords=unique_keywords,
        variant_count=1,
        provider=settings.provider,
        product_groups=product_groups_dict or None,
        ai_instructions=ai_instructions,
        target_duration=settings.target_script_duration,
    )


async def _process_batch_item(
    job_id: str, index: int, idea: str,
    profile: ProfileContext, settings: BatchSettings,
    existing_pipeline_id: Optional[str] = None,
) -> None:
    # Imported here to avoid a circular import at module load
    # (pipeline_routes is large and imports many services).
    from app.api import pipeline_routes as pr

    # Step 1: scripts -> persisted pipeline (skipped on resume if it exists)
    pipeline_id = existing_pipeline_id
    if not pipeline_id or not pr._get_pipeline_or_load(pipeline_id):
        _update_item(job_id, index, status="generating_script")
        scripts = await _generate_scripts_for_idea(profile.profile_id, idea, settings)
        if not scripts:
            raise RuntimeError("Script generation returned no scripts")

        pipeline_id = str(uuid.uuid4())
        pipeline = {
            "pipeline_id": pipeline_id,
            "scripts": scripts,
            "provider": settings.provider,
            "name": idea[:60],
            "idea": idea,
            "context": "",
            "context_products": [],
            "variant_count": len(scripts),
            "keyword_count": 0,
            "previews": {},
            "tts_previews": {},
            "segment_usage": {},
            "preview_renders": {},
            "render_jobs": {},
            # Batch keeps review simple: one variant per idea, no A/B versions
            "meta_multiplication": False,
            "created_at": _now(),
            "profile_id": profile.profile_id,
            "target_script_duration": settings.target_script_duration,
        }
        with pr._pipelines_lock:
            pr._pipelines[pipeline_id] = pipeline
        pr._db_save_pipeline(pipeline_id, dict(pipeline))
        _update_item(job_id, index, pipeline_id=pipeline_id)

    # Step 2: TTS + SRT + deterministic matching — reuse the preview route
    # function directly (no limiter/Request params), which persists previews
    # and tts_previews through the same code path the UI uses.
    _update_item(job_id, index, status="generating_preview")
    await pr.preview_variant(
        pipeline_id=pipeline_id,
        variant_index=0,
        profile=profile,
        elevenlabs_model=settings.elevenlabs_model,
        voice_id=settings.voice_id,
        source_video_ids=settings.source_video_ids,
        voice_settings=None,
        words_per_subtitle=settings.words_per_subtitle,
        min_segment_duration=settings.min_segment_duration,
        ultra_rapid_intro=settings.ultra_rapid_intro,
        visual_version=None,
        force_regenerate_tts=False,
    )

    _update_item(job_id, index, status="ready_for_review", error=None)


async def _run_batch(job_id: str, profile_id: str, user_id: str) -> None:
    """Sequential batch worker. Items already ready_for_review are skipped,
    so the same function also implements resume."""
    profile = ProfileContext(profile_id=profile_id, user_id=user_id)
    storage = get_job_storage()

    async with _batch_worker_lock:
        job = storage.get_job(job_id)
        if not job:
            logger.error(f"Batch {job_id}: job disappeared before start")
            return
        items = job.get("items") or []
        settings = BatchSettings(**(job.get("settings") or {}))

        storage.update_job(job_id, {"status": "processing"})
        for i, item in enumerate(items):
            # Re-read each iteration: statuses move under us via _update_item
            job = storage.get_job(job_id)
            item = (job.get("items") or [])[i]
            if item["status"] == "ready_for_review":
                continue
            try:
                await _process_batch_item(
                    job_id, i, item["idea"], profile, settings,
                    existing_pipeline_id=item.get("pipeline_id"),
                )
            except Exception as e:
                logger.error(f"Batch {job_id} item {i} failed: {e}")
                _update_item(job_id, i, status="failed", error=str(e)[:500])

        job = storage.get_job(job_id)
        items = (job.get("items") or []) if job else []
        failed = sum(1 for it in items if it["status"] == "failed")
        storage.update_job(job_id, {
            "status": "completed" if failed == 0 else "completed_with_errors",
        })
        logger.info(f"Batch {job_id} finished: {len(items) - failed}/{len(items)} ready for review")


@router.post("/batch")
@limiter.limit("5/minute")
async def create_batch(
    request: Request,
    body: BatchCreateRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Queue N ideas; each becomes one persisted pipeline processed to
    ready_for_review in the background."""
    ideas = [i.strip() for i in body.ideas if i.strip()]
    if not ideas:
        raise HTTPException(status_code=400, detail="No non-empty ideas provided")

    storage = get_job_storage()
    batch_id = str(uuid.uuid4())
    storage.create_job(
        {
            "job_id": batch_id,
            "job_type": "pipeline_batch",
            "status": "queued",
            "progress": f"0/{len(ideas)} processed",
            "items": [_new_item(i) for i in ideas],
            "settings": body.settings.model_dump(),
        },
        profile_id=profile.profile_id,
    )
    background_tasks.add_task(_run_batch, batch_id, profile.profile_id, profile.user_id)
    return {"batch_id": batch_id, "item_count": len(ideas), "status": "queued"}


@router.get("/batch/{batch_id}")
async def get_batch_status(
    batch_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    job = get_job_storage().get_job(batch_id)
    if not job or job.get("job_type") != "pipeline_batch":
        raise HTTPException(status_code=404, detail="Batch not found")
    if job.get("profile_id") and job["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this batch")
    return {
        "batch_id": batch_id,
        "status": job.get("status"),
        "progress": job.get("progress"),
        "items": job.get("items") or [],
        "settings": job.get("settings") or {},
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }


@router.get("/batch")
async def list_batches(
    profile: ProfileContext = Depends(get_profile_context),
    limit: int = 10,
):
    """Recent batches for the profile (newest first)."""
    storage = get_job_storage()
    # JobStorage has no job_type filter — list recent for the profile and filter
    jobs = [
        j for j in storage.list_jobs(profile_id=profile.profile_id, limit=200)
        if j.get("job_type") == "pipeline_batch"
    ][:limit]
    return {
        "batches": [
            {
                "batch_id": j.get("job_id") or j.get("id"),
                "status": j.get("status"),
                "progress": j.get("progress"),
                "item_count": len(j.get("items") or []),
                "created_at": j.get("created_at"),
            }
            for j in jobs
        ]
    }


@router.post("/batch/{batch_id}/resume")
async def resume_batch(
    batch_id: str,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Re-run unfinished items (queued/processing/failed) after a restart or
    partial failure. Items already ready_for_review are skipped."""
    storage = get_job_storage()
    job = storage.get_job(batch_id)
    if not job or job.get("job_type") != "pipeline_batch":
        raise HTTPException(status_code=404, detail="Batch not found")
    if job.get("profile_id") and job["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this batch")

    items = job.get("items") or []
    pending = [it for it in items if it["status"] != "ready_for_review"]
    if not pending:
        return {"batch_id": batch_id, "status": job.get("status"), "resumed": 0}

    # Reset transient statuses so the worker picks them up cleanly
    for it in items:
        if it["status"] in ("generating_script", "generating_preview", "failed"):
            it["status"] = "queued"
    storage.update_job(batch_id, {"items": items, "status": "queued"})

    background_tasks.add_task(_run_batch, batch_id, profile.profile_id, profile.user_id)
    return {"batch_id": batch_id, "status": "queued", "resumed": len(pending)}
