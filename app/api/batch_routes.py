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

from app.api.auth import AuthUser, ProfileContext, get_current_user, get_profile_context
from app.config import get_settings
from app.core.rate_limit import limiter
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters
from app.services.job_storage import get_job_storage
from app.services.script_generator import get_script_generator_for_profile
from app.services.codex_script_provider import DEFAULT_CODEX_MODEL
from app.services.studio_metering import (
    MeteringIdentity,
    StudioMeteringBlocked,
    new_metering_record,
    reserve_metering_record,
    settle_metering_record,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipeline", tags=["Batch Pipeline"])

# Single-flight guard: one batch worker per backend process. Sequential by
# design (plan F6: 1-2 concurrent, respecting the FFmpeg semaphore) — TTS and
# preview matching already parallelize internally where safe.
_batch_worker_lock = asyncio.Lock()


class BatchSettings(BaseModel):
    """Common settings applied to every idea in the batch."""
    provider: str = "gemini"
    codex_model: str = Field(
        default=DEFAULT_CODEX_MODEL,
        min_length=1,
        max_length=100,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$",
    )
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


_TERMINAL_METERING_STATES = frozenset({"captured", "released", "refunded", "denied"})


def _new_script_metering_record(
    batch_id: str,
    index: int,
    identity: MeteringIdentity,
) -> dict:
    return {
        **new_metering_record(
            "studio.script_pipeline",
            1,
            f"pipeline-batch:{batch_id}:item:{index}:script:{uuid.uuid4().hex}",
        ),
        **identity.as_payload(),
    }


def _new_item(
    batch_id: str,
    index: int,
    idea: str,
    identity: MeteringIdentity,
) -> dict:
    return {
        "idea": idea,
        "status": "queued",  # queued -> generating_script -> generating_preview -> ready_for_review | failed
        # Allocate the output ID before reservation/provider start. If the
        # process dies after pipeline persistence but before capture, status or
        # resume can prove delivery from this same durable ID.
        "pipeline_id": str(uuid.uuid4()),
        "error": None,
        "status_code": None,
        "error_detail": None,
        "script_metering": _new_script_metering_record(batch_id, index, identity),
        "script_metering_history": [],
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


def _get_item(job_id: str, index: int) -> dict:
    job = get_job_storage().get_job(job_id) or {}
    items = job.get("items") or []
    if index < 0 or index >= len(items) or not isinstance(items[index], dict):
        return {}
    return items[index]


def _metering_http_exception(error: StudioMeteringBlocked) -> HTTPException:
    return HTTPException(status_code=402, detail=error.as_http_detail())


def _batch_error_fields(error: Exception) -> dict:
    if isinstance(error, HTTPException):
        detail = error.detail
        if isinstance(detail, dict):
            message = str(detail.get("message") or detail.get("detail") or "Batch item failed")
        else:
            message = str(detail)
        return {
            "error": message[:500],
            "status_code": error.status_code,
            "error_detail": detail,
        }
    return {
        "error": str(error)[:500],
        "status_code": None,
        "error_detail": None,
    }


async def _settle_batch_script_metering(
    job_id: str,
    index: int,
    *,
    delivered: bool,
) -> dict:
    item = _get_item(job_id, index)
    record = item.get("script_metering")
    if not isinstance(record, dict):
        return item
    user_id = record.get("supabase_user_id")
    if not isinstance(user_id, str) or not user_id:
        return item
    result_metadata = None
    if delivered:
        result_metadata = {
            "studio_job_id": job_id,
            "output_id": item.get("pipeline_id"),
            "batch_item_index": index,
        }
    settled = await settle_metering_record(
        MeteringIdentity(user_id, record.get("email")),
        record,
        delivered=delivered,
        result_metadata=result_metadata,
    )
    _update_item(job_id, index, script_metering=settled)
    return _get_item(job_id, index)


async def _reserve_batch_script_metering(
    job_id: str,
    index: int,
    identity: MeteringIdentity,
) -> dict:
    item = _get_item(job_id, index)
    record = item.get("script_metering")
    if not isinstance(record, dict):
        raise RuntimeError("Batch item has no durable script metering record")
    reserved = await reserve_metering_record(identity, record)
    _update_item(job_id, index, script_metering=reserved)
    return reserved


async def _reserve_batch_scripts(
    job_id: str,
    indices: List[int],
    identity: MeteringIdentity,
) -> None:
    """Reserve every requested script before any batch provider can start."""
    newly_reserved: List[int] = []
    try:
        for index in indices:
            item = _get_item(job_id, index)
            record = item.get("script_metering")
            if not isinstance(record, dict):
                raise RuntimeError("Batch item has no durable script metering record")
            if record.get("state") == "reserved" and record.get("reservation_id"):
                continue
            await _reserve_batch_script_metering(job_id, index, identity)
            newly_reserved.append(index)
    except StudioMeteringBlocked as error:
        for reserved_index in newly_reserved:
            await _settle_batch_script_metering(
                job_id,
                reserved_index,
                delivered=False,
            )
        job = get_job_storage().get_job(job_id) or {}
        items = job.get("items") or []
        for raw_index, item in enumerate(items):
            if raw_index not in indices or not isinstance(item, dict):
                continue
            record = item.get("script_metering")
            if isinstance(record, dict) and not record.get("reservation_id"):
                item["script_metering"] = {
                    **record,
                    "state": "denied",
                    "last_error": error.as_http_detail(),
                }
                item.update(
                    status="failed",
                    status_code=402,
                    error=error.as_http_detail()["message"],
                    error_detail=error.as_http_detail(),
                    updated_at=_now(),
                )
        get_job_storage().update_job(
            job_id,
            {
                "status": "failed",
                "progress": "Blipost credits required",
                "status_code": 402,
                "error": error.as_http_detail()["message"],
                "error_detail": error.as_http_detail(),
                "items": items,
            },
            profile_id=job.get("profile_id"),
        )
        raise


async def _reconcile_batch_item_metering(
    job_id: str,
    index: int,
    fallback_user_id: str,
    *,
    interrupted: bool,
) -> dict:
    """Retry a lost reserve response or pending settlement without rerunning AI."""
    from app.api import pipeline_routes as pr

    item = _get_item(job_id, index)
    record = item.get("script_metering")
    if not isinstance(record, dict) or record.get("state") in _TERMINAL_METERING_STATES:
        return item
    user_id = record.get("supabase_user_id") or fallback_user_id
    if not isinstance(user_id, str) or not user_id:
        return item
    identity = MeteringIdentity(user_id, record.get("email"))
    pipeline_id = item.get("pipeline_id")
    pipeline = pr._get_pipeline_or_load(pipeline_id) if isinstance(pipeline_id, str) else None

    if not record.get("reservation_id"):
        if not interrupted or record.get("provider_started"):
            return item
        try:
            record = await reserve_metering_record(identity, record)
        except StudioMeteringBlocked as error:
            pending = {
                **record,
                "state": (
                    "denied"
                    if error.code == "insufficient_credits"
                    else "reserve_pending"
                ),
                "last_error": error.as_http_detail(),
            }
            _update_item(
                job_id,
                index,
                script_metering=pending,
                **_batch_error_fields(_metering_http_exception(error)),
            )
            return _get_item(job_id, index)
        _update_item(job_id, index, script_metering=record)

    delivered = bool(pipeline)
    if not delivered and not interrupted:
        return _get_item(job_id, index)
    return await _settle_batch_script_metering(
        job_id,
        index,
        delivered=delivered,
    )


async def _reconcile_batch_preview_metering(
    item: dict,
    fallback_user_id: str,
) -> Optional[dict]:
    """Retry the preview TTS settlement through its durable pipeline job."""
    from app.api import pipeline_routes as pr

    pipeline_id = item.get("pipeline_id")
    if not isinstance(pipeline_id, str):
        return None
    pipeline = pr._get_pipeline_or_load(pipeline_id)
    jobs = (pipeline or {}).get("tts_jobs") or {}
    tts_job = jobs.get(0) or jobs.get("0") or {}
    record = tts_job.get("metering")
    if not isinstance(record, dict) or not record.get("reservation_id"):
        return record if isinstance(record, dict) else None
    if tts_job.get("status") == "completed" or record.get("output_persisted"):
        await pr._settle_tts_metering(
            pipeline_id,
            0,
            fallback_user_id,
            delivered=True,
            result_metadata={
                "studio_job_id": pipeline_id,
                "output_id": "variant-0",
            },
        )
    elif tts_job.get("status") in {"failed", "cancelled"}:
        await pr._settle_tts_metering(
            pipeline_id,
            0,
            fallback_user_id,
            delivered=False,
        )
    refreshed_pipeline = pr._get_pipeline_or_load(pipeline_id) or {}
    refreshed_jobs = refreshed_pipeline.get("tts_jobs") or {}
    refreshed_job = refreshed_jobs.get(0) or refreshed_jobs.get("0") or {}
    refreshed_record = refreshed_job.get("metering")
    return refreshed_record if isinstance(refreshed_record, dict) else None


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

    generator = get_script_generator_for_profile(profile_id)
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
        codex_model=settings.codex_model,
    )


async def _process_batch_item(
    job_id: str, index: int, idea: str,
    profile: ProfileContext, settings: BatchSettings,
    current_user: AuthUser,
    existing_pipeline_id: Optional[str] = None,
) -> None:
    # Imported here to avoid a circular import at module load
    # (pipeline_routes is large and imports many services).
    from app.api import pipeline_routes as pr

    # Step 1: scripts -> persisted pipeline (skipped on resume if it exists)
    pipeline_id = existing_pipeline_id or str(uuid.uuid4())
    if not pr._get_pipeline_or_load(pipeline_id):
        item = _get_item(job_id, index)
        script_metering = dict(item.get("script_metering") or {})
        if not script_metering.get("reservation_id"):
            raise RuntimeError("Batch script credits were not reserved")
        script_metering.update(
            {
                "provider_started": True,
                "state": "provider_started",
            }
        )
        _update_item(
            job_id,
            index,
            status="generating_script",
            script_metering=script_metering,
            error=None,
            status_code=None,
            error_detail=None,
        )
        scripts = await _generate_scripts_for_idea(profile.profile_id, idea, settings)
        if not scripts:
            raise RuntimeError("Script generation returned no scripts")

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
        item = _get_item(job_id, index)
        script_metering = dict(item.get("script_metering") or {})
        script_metering.update(
            {
                "output_persisted": True,
                "state": "output_persisted",
            }
        )
        _update_item(
            job_id,
            index,
            pipeline_id=pipeline_id,
            script_metering=script_metering,
        )
        await _settle_batch_script_metering(job_id, index, delivered=True)
    else:
        await _settle_batch_script_metering(job_id, index, delivered=True)

    # Step 2: TTS + SRT + deterministic matching — reuse the preview route
    # function directly (no limiter/Request params), which persists previews
    # and tts_previews through the same code path the UI uses.
    _update_item(job_id, index, status="generating_preview")
    try:
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
            current_user=current_user,
        )
    finally:
        live_pipeline = pr._get_pipeline_or_load(pipeline_id) or {}
        tts_jobs = live_pipeline.get("tts_jobs") or {}
        tts_job = tts_jobs.get(0) or tts_jobs.get("0") or {}
        if isinstance(tts_job, dict) and isinstance(tts_job.get("metering"), dict):
            _update_item(job_id, index, tts_metering=dict(tts_job["metering"]))

    _update_item(job_id, index, status="ready_for_review", error=None)


async def _run_batch(
    job_id: str,
    profile_id: str,
    user_id: str,
    email: Optional[str] = None,
) -> None:
    """Sequential batch worker. Items already ready_for_review are skipped,
    so the same function also implements resume."""
    profile = ProfileContext(profile_id=profile_id, user_id=user_id)
    current_user = AuthUser(user_id, email)
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
                    current_user,
                    existing_pipeline_id=item.get("pipeline_id"),
                )
            except Exception as e:
                logger.error(f"Batch {job_id} item {i} failed: {e}")
                from app.api import pipeline_routes as pr

                failed_item = _get_item(job_id, i)
                failed_pipeline_id = failed_item.get("pipeline_id")
                delivered = bool(
                    isinstance(failed_pipeline_id, str)
                    and pr._get_pipeline_or_load(failed_pipeline_id)
                )
                await _settle_batch_script_metering(
                    job_id,
                    i,
                    delivered=delivered,
                )
                _update_item(
                    job_id,
                    i,
                    status="failed",
                    **_batch_error_fields(e),
                )

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
    current_user: AuthUser = Depends(get_current_user),
):
    """Queue N ideas; each becomes one persisted pipeline processed to
    ready_for_review in the background."""
    ideas = [i.strip() for i in body.ideas if i.strip()]
    if not ideas:
        raise HTTPException(status_code=400, detail="No non-empty ideas provided")
    if body.settings.provider not in {"gemini", "claude", "codex"}:
        raise HTTPException(
            status_code=400,
            detail="provider must be 'gemini', 'claude', or 'codex'",
        )
    if body.settings.provider == "codex" and not get_settings().desktop_mode:
        raise HTTPException(
            status_code=400,
            detail="Codex (ChatGPT subscription) is available only in Blip Studio desktop.",
        )

    storage = get_job_storage()
    batch_id = str(uuid.uuid4())
    identity = MeteringIdentity(profile.user_id, current_user.email)
    items = [
        _new_item(batch_id, index, idea, identity)
        for index, idea in enumerate(ideas)
    ]
    storage.create_job(
        {
            "job_id": batch_id,
            "job_type": "pipeline_batch",
            "status": "queued",
            "progress": f"0/{len(ideas)} processed",
            "user_id": profile.user_id,
            "email": current_user.email,
            "items": items,
            "settings": body.settings.model_dump(),
        },
        profile_id=profile.profile_id,
    )
    try:
        await _reserve_batch_scripts(
            batch_id,
            list(range(len(items))),
            identity,
        )
    except StudioMeteringBlocked as error:
        raise _metering_http_exception(error)
    background_tasks.add_task(
        _run_batch,
        batch_id,
        profile.profile_id,
        profile.user_id,
        current_user.email,
    )
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
    if job.get("status") in {"completed", "completed_with_errors", "failed", "cancelled"}:
        for index, item in enumerate(job.get("items") or []):
            if not isinstance(item, dict):
                continue
            await _reconcile_batch_item_metering(
                batch_id,
                index,
                profile.user_id,
                interrupted=True,
            )
            await _reconcile_batch_preview_metering(item, profile.user_id)
            if (
                job.get("status") in {"failed", "cancelled"}
                and item.get("status") not in {"ready_for_review", "failed"}
            ):
                _update_item(
                    batch_id,
                    index,
                    status="failed",
                    error="Batch processing did not survive a backend restart.",
                    status_code=None,
                    error_detail=None,
                )
        job = get_job_storage().get_job(batch_id) or job
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
    current_user: AuthUser = Depends(get_current_user),
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

    # First close any reservation left by the interrupted worker. A script
    # pipeline with the preallocated ID proves delivery; otherwise the old
    # attempt is refunded before a new user-initiated attempt is created.
    for index, item in enumerate(items):
        if item.get("status") == "ready_for_review":
            continue
        await _reconcile_batch_item_metering(
            batch_id,
            index,
            profile.user_id,
            interrupted=True,
        )
        preview_record = await _reconcile_batch_preview_metering(
            item,
            profile.user_id,
        )
        if (
            isinstance(preview_record, dict)
            and preview_record.get("reservation_id")
            and preview_record.get("state") not in _TERMINAL_METERING_STATES
            and not preview_record.get("output_persisted")
        ):
            error = StudioMeteringBlocked(
                "metering_unavailable",
                "Previous batch voice-over settlement is still pending",
            )
            raise _metering_http_exception(error)

    job = storage.get_job(batch_id) or job
    items = job.get("items") or []
    identity = MeteringIdentity(profile.user_id, current_user.email)
    reserve_indices: List[int] = []
    for index, item in enumerate(items):
        if item.get("status") == "ready_for_review":
            continue
        from app.api import pipeline_routes as pr

        pipeline_id = item.get("pipeline_id")
        pipeline_exists = bool(
            isinstance(pipeline_id, str)
            and pr._get_pipeline_or_load(pipeline_id)
        )
        record = item.get("script_metering")
        if pipeline_exists:
            continue
        if isinstance(record, dict) and record.get("state") not in _TERMINAL_METERING_STATES:
            error = StudioMeteringBlocked(
                "metering_unavailable",
                "Previous batch script settlement is still pending",
            )
            raise _metering_http_exception(error)
        history = list(item.get("script_metering_history") or [])
        if isinstance(record, dict):
            history.append(dict(record))
        item["script_metering_history"] = history[-20:]
        item["script_metering"] = _new_script_metering_record(
            batch_id,
            index,
            identity,
        )
        reserve_indices.append(index)

    # Reset transient statuses so the worker picks them up cleanly
    for it in items:
        if it["status"] in ("generating_script", "generating_preview", "failed"):
            it["status"] = "queued"
            it["error"] = None
            it["status_code"] = None
            it["error_detail"] = None
    storage.update_job(
        batch_id,
        {
            "items": items,
            "status": "queued",
            "user_id": profile.user_id,
            "email": current_user.email,
        },
        profile_id=profile.profile_id,
    )

    try:
        await _reserve_batch_scripts(batch_id, reserve_indices, identity)
    except StudioMeteringBlocked as error:
        raise _metering_http_exception(error)

    background_tasks.add_task(
        _run_batch,
        batch_id,
        profile.profile_id,
        profile.user_id,
        current_user.email,
    )
    return {"batch_id": batch_id, "status": "queued", "resumed": len(pending)}
