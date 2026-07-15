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
import httpx
import logging
import math
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.api.auth import AuthUser, ProfileContext, get_current_user, get_profile_context
from app.config import get_settings
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters
from app.services.job_storage import get_job_storage
from app.services.render_queue import RenderQueueCancelled, get_render_queue
from app.services.srt_validator import sanitize_srt_full
from app.services.studio_metering import (
    MeteringIdentity,
    StudioMeteringBlocked,
    new_metering_record,
    reserve_metering_record,
    settle_metering_record,
)
from app.utils import normalize_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/products", tags=["product-video"])

_PROCESS_INSTANCE_ID = uuid.uuid4().hex
_ACTIVE_PRODUCT_JOB_STATUSES = frozenset({"pending", "queued", "processing"})
_TERMINAL_METERING_STATES = frozenset({"captured", "released", "refunded", "denied"})
_PRODUCT_JOB_LEASE_SECONDS = 30 * 60


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class ProductGenerateRequest(BaseModel):
    source: str = "feed"                    # "feed" | "catalog"
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
    source: str = "feed"                    # "feed" | "catalog"
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


def _product_request_from_batch(request: BatchGenerateRequest) -> ProductGenerateRequest:
    return ProductGenerateRequest(
        **request.model_dump(exclude={"product_ids"}),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _product_render_queue_job_id(job_id: str) -> str:
    return f"product:{job_id}"


def _product_lease_deadline() -> str:
    return (
        datetime.now(timezone.utc) + timedelta(seconds=_PRODUCT_JOB_LEASE_SECONDS)
    ).isoformat()


def _refresh_product_job_lease(
    job_id: str,
    profile_id: str,
    parent_batch_id: Optional[str] = None,
) -> None:
    storage = get_job_storage()
    deadline = _product_lease_deadline()
    storage.update_job(
        job_id,
        {"lease_expires_at": deadline},
        profile_id=profile_id,
    )
    if parent_batch_id:
        storage.update_job(
            parent_batch_id,
            {"lease_expires_at": deadline},
            profile_id=profile_id,
        )


def _new_product_metering_bundle(
    job_id: str,
    request: ProductGenerateRequest,
    user_id: str,
) -> dict[str, dict]:
    records: dict[str, dict] = {}
    if request.voiceover_mode == "elaborate":
        records["script"] = new_metering_record(
            "studio.script_pipeline",
            1,
            f"product:{job_id}:script",
        )
    records["tts"] = new_metering_record(
        "studio.tts_variant",
        1,
        f"product:{job_id}:tts",
    )
    records["render"] = new_metering_record(
        "studio.render_output_minute",
        max(1, math.ceil(max(1, request.duration_s) / 60)),
        f"product:{job_id}:render",
    )
    for record in records.values():
        record["supabase_user_id"] = user_id
    return records


def _replace_product_metering(job_id: str, bundle: dict[str, dict]) -> dict:
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    return storage.update_job(
        job_id,
        {"metering": {key: dict(value) for key, value in bundle.items()}},
        profile_id=job.get("profile_id"),
    ) or {**job, "metering": bundle}


async def _recover_product_reservations_for_settlement(
    job_id: str,
    fallback_user_id: Optional[str] = None,
) -> dict:
    """Replay only bundle reserve calls whose responses may have been lost."""
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    if job.get("status") not in {"failed", "cancelled"}:
        return job
    bundle = job.get("metering")
    if not isinstance(bundle, dict):
        return job
    updated = {key: dict(value) for key, value in bundle.items() if isinstance(value, dict)}
    changed = False
    for component, record in list(updated.items()):
        if (
            record.get("reservation_id")
            or record.get("provider_started")
            or record.get("state") != "reserve_pending"
        ):
            continue
        user_id = record.get("supabase_user_id") or fallback_user_id
        if not isinstance(user_id, str) or not user_id:
            continue
        try:
            recovered = await reserve_metering_record(
                MeteringIdentity(user_id, record.get("email")),
                record,
            )
        except StudioMeteringBlocked as error:
            recovered = {
                **record,
                "state": (
                    "denied"
                    if error.code == "insufficient_credits"
                    else "reserve_pending"
                ),
                "last_error": error.as_http_detail(),
            }
        updated[component] = recovered
        changed = True
        _replace_product_metering(job_id, updated)
    return storage.get_job(job_id) or ({**job, "metering": updated} if changed else job)


async def _settle_product_metering(
    job_id: str,
    user_id: str,
    *,
    delivered: bool,
    result_metadata: Optional[dict] = None,
) -> dict:
    storage = get_job_storage()
    if not delivered:
        job = await _recover_product_reservations_for_settlement(job_id, user_id)
    else:
        job = storage.get_job(job_id) or {}
    bundle = job.get("metering")
    if not isinstance(bundle, dict):
        return job
    updated: dict[str, dict] = {}
    for component, raw_record in bundle.items():
        if not isinstance(raw_record, dict):
            continue
        if not raw_record.get("reservation_id"):
            updated[component] = dict(raw_record)
            continue
        terminal_states = {"captured"} if delivered else {"released", "refunded"}
        if raw_record.get("state") in terminal_states:
            updated[component] = dict(raw_record)
            continue
        component_metadata = dict(result_metadata or {})
        component_metadata["component"] = component
        updated[component] = await settle_metering_record(
            MeteringIdentity(user_id),
            raw_record,
            delivered=delivered,
            result_metadata=component_metadata if delivered else None,
        )
    return _replace_product_metering(job_id, updated)


async def _reserve_product_metering(
    job_id: str,
    identity: MeteringIdentity,
) -> dict:
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    bundle = job.get("metering")
    if not isinstance(bundle, dict):
        raise RuntimeError("Product job has no durable metering bundle")

    reserved: dict[str, dict] = {}
    attempted_component: Optional[str] = None
    try:
        for component, record in bundle.items():
            attempted_component = component
            reserve_pending = {**record, "state": "reserve_pending"}
            _replace_product_metering(
                job_id,
                {**bundle, **reserved, component: reserve_pending},
            )
            reserved[component] = await reserve_metering_record(identity, reserve_pending)
            _replace_product_metering(job_id, {**bundle, **reserved})
    except StudioMeteringBlocked as error:
        failed_job = storage.get_job(job_id) or {}
        failed_bundle = dict(failed_job.get("metering") or bundle)
        for component, record in failed_bundle.items():
            if isinstance(record, dict) and not record.get("reservation_id"):
                possibly_reserved = (
                    component == attempted_component
                    and record.get("state") == "reserve_pending"
                    and error.code != "insufficient_credits"
                )
                failed_bundle[component] = {
                    **record,
                    "state": "reserve_pending" if possibly_reserved else "denied",
                    "last_error": error.as_http_detail(),
                }
        storage.update_job(
            job_id,
            {
                "status": "failed",
                "progress": (
                    "Blipost credits required"
                    if error.code == "insufficient_credits"
                    else "Blipost credit verification unavailable"
                ),
                "status_code": 402,
                "error": error.as_http_detail()["message"],
                "error_detail": error.as_http_detail(),
                "metering": failed_bundle,
            },
            profile_id=failed_job.get("profile_id"),
        )
        await _settle_product_metering(
            job_id,
            identity.supabase_user_id,
            delivered=False,
        )
        raise

    return _replace_product_metering(job_id, {**bundle, **reserved})


def _mark_product_operation_started(job_id: str, component: str) -> None:
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    bundle = dict(job.get("metering") or {})
    record = bundle.get(component)
    if not isinstance(record, dict):
        return
    bundle[component] = {
        **record,
        "provider_started": True,
        "state": "provider_started",
    }
    _replace_product_metering(job_id, bundle)


def _mark_product_output_persisted(job_id: str) -> dict[str, dict]:
    job = get_job_storage().get_job(job_id) or {}
    bundle = dict(job.get("metering") or {})
    for component, record in list(bundle.items()):
        if isinstance(record, dict):
            bundle[component] = {
                **record,
                "output_persisted": True,
                "state": "output_persisted",
            }
    _replace_product_metering(job_id, bundle)
    return bundle


def _product_job_lease_is_live(job: dict) -> bool:
    if job.get("process_instance_id") == _PROCESS_INSTANCE_ID:
        return True
    lease_expires_at = job.get("lease_expires_at")
    if not lease_expires_at:
        return False
    try:
        lease_expiry = datetime.fromisoformat(
            str(lease_expires_at).replace("Z", "+00:00")
        )
    except (TypeError, ValueError):
        return False
    if lease_expiry.tzinfo is None:
        lease_expiry = lease_expiry.replace(tzinfo=timezone.utc)
    return lease_expiry > datetime.now(timezone.utc)


def _find_persisted_product_output(job: dict) -> Optional[dict]:
    result = job.get("result") or {}
    clip_id = job.get("planned_clip_id") or result.get("clip_id")
    if not clip_id:
        return None
    try:
        clip = get_repository().get_clip(clip_id)
    except Exception:
        logger.exception("Could not inspect planned product clip %s", clip_id)
        return None
    if not isinstance(clip, dict) or clip.get("final_status") != "completed":
        return None
    video_path = clip.get("final_video_path") or clip.get("raw_video_path")
    if not video_path or not Path(video_path).is_file():
        return None
    return {
        "clip_id": clip_id,
        "project_id": clip.get("project_id") or job.get("planned_project_id"),
        "video_path": video_path,
    }


def _persist_recovered_product_output(job_id: str, output: dict) -> dict:
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    bundle = dict(job.get("metering") or {})
    updated_bundle: dict[str, dict] = {}
    for component, record in bundle.items():
        if not isinstance(record, dict):
            continue
        if record.get("state") in {"released", "refunded", "denied"}:
            return job
        updated_bundle[component] = {
            **record,
            "output_persisted": True,
            "state": (
                record.get("state")
                if record.get("state") == "captured"
                else "output_persisted"
            ),
        }
    return storage.update_job(
        job_id,
        {
            "status": "completed",
            "progress": "100",
            "result": dict(output),
            "metering": updated_bundle,
        },
        profile_id=job.get("profile_id"),
    ) or {**job, "status": "completed", "result": output, "metering": updated_bundle}


def _mark_interrupted_product_job(job_id: str, job: dict) -> dict:
    if job.get("status") not in _ACTIVE_PRODUCT_JOB_STATUSES:
        return job
    if not job.get("process_instance_id") or _product_job_lease_is_live(job):
        return job
    bundle = dict(job.get("metering") or {})
    for component, record in list(bundle.items()):
        if not isinstance(record, dict) or record.get("state") in _TERMINAL_METERING_STATES:
            continue
        if record.get("reservation_id"):
            bundle[component] = {**record, "state": "refund_pending"}
        elif record.get("state") == "reserve_pending" and not record.get("provider_started"):
            bundle[component] = dict(record)
        elif record.get("state") == "pending" and not record.get("provider_started"):
            bundle[component] = {**record, "state": "denied"}
    message = "Product generation did not survive a backend restart. Submit it again."
    return get_job_storage().update_job(
        job_id,
        {
            "status": "failed",
            "progress": "Interrupted",
            "error": message,
            "metering": bundle,
        },
        profile_id=job.get("profile_id"),
    ) or {**job, "status": "failed", "error": message, "metering": bundle}


async def _reconcile_product_job(
    job_id: str,
    fallback_user_id: Optional[str] = None,
) -> dict:
    """Recover durable product output or settle an interrupted attempt."""
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    if not job:
        return job
    if (
        job.get("status") in _ACTIVE_PRODUCT_JOB_STATUSES
        and job.get("process_instance_id")
        and _product_job_lease_is_live(job)
    ):
        return job
    output = _find_persisted_product_output(job)
    if output and (
        job.get("status") != "completed"
        or not any(
            isinstance(record, dict) and record.get("output_persisted")
            for record in (job.get("metering") or {}).values()
        )
    ):
        job = _persist_recovered_product_output(job_id, output)
    job = _mark_interrupted_product_job(job_id, job)
    bundle = job.get("metering")
    if not isinstance(bundle, dict):
        return job
    first_record = next(
        (record for record in bundle.values() if isinstance(record, dict)),
        {},
    )
    user_id = first_record.get("supabase_user_id") or job.get("user_id") or fallback_user_id
    if not isinstance(user_id, str) or not user_id:
        return job
    output_persisted = any(
        isinstance(record, dict) and record.get("output_persisted")
        for record in bundle.values()
    )
    if job.get("status") == "completed" or output_persisted:
        result = job.get("result") or {}
        return await _settle_product_metering(
            job_id,
            user_id,
            delivered=True,
            result_metadata={
                "studio_job_id": job_id,
                "output_id": result.get("clip_id") or result.get("project_id"),
            },
        )
    if job.get("status") in {"failed", "cancelled"}:
        return await _settle_product_metering(job_id, user_id, delivered=False)
    return job


class _ProductGenerationCancelled(Exception):
    pass


def _raise_if_product_cancelled(
    job_storage,
    job_id: str,
    parent_batch_id: Optional[str],
) -> None:
    if job_storage.is_job_cancelled(job_id) or (
        parent_batch_id and job_storage.is_job_cancelled(parent_batch_id)
    ):
        raise _ProductGenerationCancelled("Product video generation cancelled")

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


_DEFAULT_PIP_CONFIG = {
    "enabled": True,
    "position": "bottom-right",
    "size": "medium",
    "animation": "static",
}


def _resolve_product_footage(repo, product_id: str, profile_id: str) -> Optional[dict]:
    """Resolve a product's associated local footage + PiP config (Wave 4.1 / G6).

    Looks up ``segment_product_associations`` for this product, then resolves each
    associated segment to a real video file on disk (the pre-extracted clip if one
    exists, otherwise the source video to be input-trimmed to [start, end]).

    This is the gate that decides footage-mode vs. the legacy Ken Burns slideshow:
    returns a plan ONLY when at least one associated segment resolves to a file
    that actually exists. Any other case (no associations, missing segments,
    source video deleted, DB error) returns None so the caller falls back to the
    single-image compositor — footage-mode never regresses existing behavior.

    Note: associations are keyed on the *catalog* product id, so this naturally
    matches ``source="catalog"`` products; feed-source ids won't match → None.

    Returns:
        ``{"clips": [{"path", "start", "end", "trim"}], "pip_config": dict}`` or None.
    """
    try:
        assoc_result = repo.table_query(
            "segment_product_associations", "select",
            filters=QueryFilters(eq={"catalog_product_id": product_id}),
        )
    except Exception as exc:  # noqa: BLE001 — any failure → graceful fallback
        logger.warning("[footage] Association lookup failed for product %s: %s", product_id, exc)
        return None

    associations = assoc_result.data or []
    if not associations:
        return None

    # Pick the PiP config: prefer an explicitly enabled one, else the first
    # present, else a sensible default.
    pip_config: Optional[dict] = None
    for a in associations:
        pc = a.get("pip_config")
        if pc:
            pip_config = pc
            if pc.get("enabled"):
                break
    if not pip_config:
        pip_config = dict(_DEFAULT_PIP_CONFIG)

    segment_ids = [a["segment_id"] for a in associations if a.get("segment_id")]
    if not segment_ids:
        return None

    try:
        seg_result = repo.table_query(
            "editai_segments", "select",
            filters=QueryFilters(
                select="id, source_video_id, start_time, end_time, extracted_video_path, profile_id",
                in_={"id": segment_ids},
            ),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[footage] Segment lookup failed for product %s: %s", product_id, exc)
        return None

    segments = seg_result.data or []
    clips: list[dict] = []
    srcvid_cache: dict[str, Optional[dict]] = {}

    for seg in segments:
        # Profile scoping — never use another profile's footage
        if seg.get("profile_id") != profile_id:
            continue
        try:
            start = float(seg.get("start_time") or 0)
            end = float(seg.get("end_time") or 0)
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue

        # Prefer a pre-extracted clip when present on disk (no re-trim needed)
        extracted = seg.get("extracted_video_path")
        if extracted:
            ep = Path(normalize_path(extracted))
            if ep.exists():
                clips.append({"path": str(ep), "start": start, "end": end, "trim": False})
                continue

        # Otherwise resolve the source video and input-trim to [start, end]
        svid = seg.get("source_video_id")
        if not svid:
            continue
        if svid not in srcvid_cache:
            try:
                srcvid_cache[svid] = repo.get_source_video(svid)
            except Exception as exc:  # noqa: BLE001
                logger.warning("[footage] get_source_video(%s) failed: %s", svid, exc)
                srcvid_cache[svid] = None
        sv = srcvid_cache[svid]
        if not sv or not sv.get("file_path"):
            continue
        fp = Path(normalize_path(sv["file_path"]))
        if not fp.exists():
            logger.warning("[footage] Source video missing on disk, skipping: %s", fp)
            continue
        clips.append({"path": str(fp), "start": start, "end": end, "trim": True})

    if not clips:
        return None

    return {"clips": clips, "pip_config": pip_config}


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/{product_id}/generate")
async def generate_product_video(
    product_id: str,
    request: ProductGenerateRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
    current_user: AuthUser = Depends(get_current_user),
):
    """Kick off background product video generation.

    Validates that the product exists, creates a job record, dispatches the
    6-stage background pipeline, and returns job_id immediately for polling.

    Returns:
        {"job_id": str, "status": "pending"}
    """
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify product exists — source determines which table to query
    if request.source == "local":
        from app.repositories.product_library import get_product_library
        if not get_product_library().get(product_id, profile.profile_id):
            raise HTTPException(status_code=404, detail="Product not found")
    else:
        if request.source == "catalog":
            product_result = repo.table_query("v_catalog_products", "select",
                filters=QueryFilters(select="id, title", eq={"id": product_id}, limit=1))
        else:
            product_result = repo.table_query("products", "select",
                filters=QueryFilters(
                    select="id, title, feed_id, product_feeds!inner(profile_id)",
                    eq={"id": product_id, "product_feeds.profile_id": profile.profile_id},
                    limit=1,
                ))

        if not product_result.data:
            raise HTTPException(status_code=404, detail="Product not found")

    job_id = str(uuid.uuid4())
    job_storage = get_job_storage()
    metering = _new_product_metering_bundle(job_id, request, profile.user_id)

    job_storage.create_job(
        job_data={
            "job_id": job_id,
            "job_type": "product_video",
            "status": "pending",
            "progress": "0",
            "product_id": product_id,
            "profile_id": profile.profile_id,
            "user_id": profile.user_id,
            "process_instance_id": _PROCESS_INSTANCE_ID,
            "lease_expires_at": _product_lease_deadline(),
            "planned_project_id": str(uuid.uuid4()),
            "planned_clip_id": str(uuid.uuid4()),
            "metering": metering,
        },
        profile_id=profile.profile_id,
    )

    try:
        await _reserve_product_metering(
            job_id,
            MeteringIdentity(profile.user_id, current_user.email),
        )
    except StudioMeteringBlocked as error:
        raise HTTPException(
            status_code=402,
            detail={**error.as_http_detail(), "studio_job_id": job_id},
        )

    background_tasks.add_task(
        _generate_product_video_task,
        job_id=job_id,
        product_id=product_id,
        profile_id=profile.profile_id,
        user_id=profile.user_id,
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
    current_user: AuthUser = Depends(get_current_user),
):
    """Kick off batch product video generation.

    Creates a batch job record in JobStorage, fetches product titles for display,
    and dispatches a single sequential background task that processes each product
    with per-product error isolation.

    Returns:
        {"batch_id": str, "total": int}
    """
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
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
        if request.source == "local":
            from app.repositories.product_library import get_product_library
            store = get_product_library()
            for pj in product_jobs:
                local = store.get(pj["product_id"], profile.profile_id)
                pj["title"] = (local or {}).get("title", "")
        else:
            titles_table = "v_catalog_products" if request.source == "catalog" else "products"
            titles_result = repo.table_query(titles_table, "select",
                filters=QueryFilters(select="id, title", in_={"id": request.product_ids}))

            if titles_result.data:
                title_map = {row["id"]: row.get("title", "") for row in titles_result.data}
                for pj in product_jobs:
                    pj["title"] = title_map.get(pj["product_id"], "")
    except Exception as exc:  # noqa: BLE001
        logger.warning("[batch %s] Failed to fetch product titles: %s", batch_id, exc)

    # Persist the batch and every child attempt before reserving any credits.
    job_storage.create_job(
        job_data={
            "job_id": batch_id,
            "job_type": "batch_product_video",
            "status": "pending",
            "progress": "0",
            "profile_id": profile.profile_id,
            "user_id": profile.user_id,
            "process_instance_id": _PROCESS_INSTANCE_ID,
            "lease_expires_at": _product_lease_deadline(),
            "product_jobs": product_jobs,
            "total": len(product_jobs),
            "completed": 0,
            "failed": 0,
        },
        profile_id=profile.profile_id,
    )

    single_request = _product_request_from_batch(request)
    for product_job in product_jobs:
        child_job_id = product_job["job_id"]
        job_storage.create_job(
            job_data={
                "job_id": child_job_id,
                "job_type": "product_video",
                "status": "pending",
                "progress": "Awaiting credit reservation",
                "product_id": product_job["product_id"],
                "profile_id": profile.profile_id,
                "user_id": profile.user_id,
                "process_instance_id": _PROCESS_INSTANCE_ID,
                "lease_expires_at": _product_lease_deadline(),
                "planned_project_id": str(uuid.uuid4()),
                "planned_clip_id": str(uuid.uuid4()),
                "parent_batch_id": batch_id,
                "metering": _new_product_metering_bundle(
                    child_job_id,
                    single_request,
                    profile.user_id,
                ),
            },
            profile_id=profile.profile_id,
        )

    identity = MeteringIdentity(profile.user_id, current_user.email)
    reserved_children: list[str] = []
    try:
        for product_job in product_jobs:
            child_job_id = product_job["job_id"]
            await _reserve_product_metering(child_job_id, identity)
            job_storage.update_job(
                child_job_id,
                {"status": "queued", "progress": "Queued"},
                profile_id=profile.profile_id,
            )
            reserved_children.append(child_job_id)
    except StudioMeteringBlocked as error:
        for child_job_id in reserved_children:
            await _settle_product_metering(
                child_job_id,
                profile.user_id,
                delivered=False,
            )
        for product_job in product_jobs:
            child_job_id = product_job["job_id"]
            child = job_storage.get_job(child_job_id) or {}
            bundle = dict(child.get("metering") or {})
            for component, record in list(bundle.items()):
                if (
                    isinstance(record, dict)
                    and not record.get("reservation_id")
                    and record.get("state") == "pending"
                ):
                    bundle[component] = {
                        **record,
                        "state": "denied",
                        "last_error": error.as_http_detail(),
                    }
            job_storage.update_job(
                child_job_id,
                {
                    "status": "failed",
                    "progress": (
                        "Blipost credits required"
                        if error.code == "insufficient_credits"
                        else "Blipost credit verification unavailable"
                    ),
                    "status_code": 402,
                    "error": error.as_http_detail()["message"],
                    "error_detail": error.as_http_detail(),
                    "metering": bundle,
                },
                profile_id=profile.profile_id,
            )
            product_job["status"] = "failed"
            product_job["error"] = error.as_http_detail()["message"]
        job_storage.update_job(
            batch_id,
            {
                "status": "failed",
                "progress": "Blipost credits required",
                "status_code": 402,
                "error": error.as_http_detail()["message"],
                "error_detail": error.as_http_detail(),
                "product_jobs": product_jobs,
                "failed": len(product_jobs),
            },
            profile_id=profile.profile_id,
        )
        raise HTTPException(
            status_code=402,
            detail={**error.as_http_detail(), "studio_job_id": batch_id},
        )

    job_storage.update_job(
        batch_id,
        {"status": "processing", "progress": "0"},
        profile_id=profile.profile_id,
    )

    # Dispatch single background task — processes products sequentially with error isolation
    background_tasks.add_task(
        _batch_generate_task,
        batch_id=batch_id,
        product_jobs=product_jobs,
        profile_id=profile.profile_id,
        user_id=profile.user_id,
        request=request,
    )

    return {"batch_id": batch_id, "total": len(product_jobs)}


def _mark_interrupted_product_batch(batch_id: str, batch: dict) -> dict:
    if batch.get("status") not in _ACTIVE_PRODUCT_JOB_STATUSES:
        return batch
    if not batch.get("process_instance_id") or _product_job_lease_is_live(batch):
        return batch
    message = "Product batch did not survive a backend restart. Submit it again."
    return get_job_storage().update_job(
        batch_id,
        {
            "status": "failed",
            "progress": "Interrupted",
            "error": message,
        },
        profile_id=batch.get("profile_id"),
    ) or {**batch, "status": "failed", "error": message}


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

    if batch.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied")
    batch = _mark_interrupted_product_batch(batch_id, batch)

    product_statuses = []
    for pj in batch.get("product_jobs", []):
        child = job_storage.get_job(pj["job_id"]) or {}
        if (
            batch.get("status") in {"failed", "cancelled"}
            and child.get("status") not in {"completed", "failed", "cancelled"}
        ):
            child_status = "cancelled" if batch.get("status") == "cancelled" else "failed"
            child_bundle = dict(child.get("metering") or {})
            for component, record in list(child_bundle.items()):
                if not isinstance(record, dict) or record.get("state") in _TERMINAL_METERING_STATES:
                    continue
                if record.get("reservation_id"):
                    child_bundle[component] = {**record, "state": "refund_pending"}
                elif record.get("state") == "pending" and not record.get("provider_started"):
                    child_bundle[component] = {**record, "state": "denied"}
            child = job_storage.update_job(
                pj["job_id"],
                {
                    "status": child_status,
                    "progress": "Batch interrupted",
                    "error": batch.get("error") or "Batch did not complete",
                    "metering": child_bundle,
                },
                profile_id=profile.profile_id,
            ) or child
        if isinstance(child.get("metering"), dict):
            child = await _reconcile_product_job(
                pj["job_id"],
                batch.get("user_id"),
            ) or child
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
    cancelled = sum(1 for p in product_statuses if p["status"] == "cancelled")

    if batch.get("status") == "failed":
        overall_status = "failed"
    elif batch.get("status") == "cancelled":
        overall_status = "cancelled"
    else:
        overall_status = (
            "completed"
            if (completed + failed + cancelled) == total
            else "processing"
        )

    return {
        "batch_id": batch_id,
        "status": overall_status,
        "total": total,
        "completed": completed,
        "failed": failed,
        "cancelled": cancelled,
        "product_jobs": product_statuses,
    }


# ---------------------------------------------------------------------------
# Batch background task — sequential with per-product error isolation
# ---------------------------------------------------------------------------

async def _batch_generate_task(
    batch_id: str,
    product_jobs: list[dict],
    profile_id: str,
    user_id: str,
    request: BatchGenerateRequest,
) -> None:
    """Sequential batch processing with per-product error isolation.

    Each product is processed independently. A failure in product N does NOT
    prevent product N+1 from processing — the except block NEVER re-raises.
    """
    job_storage = get_job_storage()

    for product_index, product_job in enumerate(product_jobs):
        job_storage.update_job(
            batch_id,
            {"lease_expires_at": _product_lease_deadline()},
            profile_id=profile_id,
        )
        # Check if batch was cancelled
        if job_storage.is_job_cancelled(batch_id):
            logger.info("[batch %s] Batch cancelled by user, stopping", batch_id)
            for remaining in product_jobs[product_index:]:
                child_job_id = remaining["job_id"]
                child = job_storage.get_job(child_job_id) or {}
                if child.get("status") not in {"completed", "failed", "cancelled"}:
                    job_storage.cancel_job(child_job_id)
                    await _settle_product_metering(
                        child_job_id,
                        user_id,
                        delivered=False,
                    )
                    _update_batch_product_status(
                        batch_id,
                        remaining["product_id"],
                        "cancelled",
                        job_storage,
                        profile_id,
                    )
            break

        pid = product_job["product_id"]
        child_job_id = product_job["job_id"]

        # Mark this product as processing in the batch record
        _update_batch_product_status(batch_id, pid, "processing", job_storage, profile_id)

        try:
            job_storage.update_job(
                child_job_id,
                {"status": "processing", "progress": "0"},
                profile_id=profile_id,
            )
            single_request = _product_request_from_batch(request)

            # Reuse the proven single-product 6-stage pipeline
            await _generate_product_video_task(
                job_id=child_job_id,
                product_id=pid,
                profile_id=profile_id,
                user_id=user_id,
                request=single_request,
                parent_batch_id=batch_id,
            )

            # Check child job final state
            child = job_storage.get_job(child_job_id)
            if child and child.get("status") == "completed":
                _update_batch_product_status(batch_id, pid, "completed", job_storage, profile_id)
            elif child and child.get("status") == "cancelled":
                _update_batch_product_status(batch_id, pid, "cancelled", job_storage, profile_id)
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
    cancelled = sum(1 for pj in product_jobs if pj.get("status") == "cancelled")
    total = len(product_jobs)

    # "completed" even if some failed — batch ran to completion
    if job_storage.is_job_cancelled(batch_id) or cancelled:
        final_status = "cancelled"
    else:
        final_status = (
            "completed"
            if (completed + failed) == total
            else "completed_with_errors"
        )

    job_storage.update_job(
        batch_id,
        {
            "status": final_status,
            "progress": "100",
            "completed": completed,
            "failed": failed,
            "cancelled": cancelled,
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
    user_id: Optional[str] = None,
    parent_batch_id: Optional[str] = None,
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
    user_id = user_id or profile_id
    render_ticket = None
    render_ticket_entered = False

    # Import everything we need up front so any import error surfaces quickly
    from app.api.library_routes import _render_with_preset
    from app.services.ffmpeg_semaphore import check_disk_space
    from app.services.product_video_compositor import (
        compose_product_video,
        compose_product_video_from_footage,
        CompositorConfig,
    )
    from app.services.tts_subtitle_generator import generate_srt_from_timestamps

    try:
        _raise_if_product_cancelled(job_storage, job_id, parent_batch_id)
        _refresh_product_job_lease(job_id, profile_id, parent_batch_id)
        # ---------------------------------------------------------------
        # Stage 1: Setup (0 -> 10%)
        # ---------------------------------------------------------------
        job_storage.update_job(
            job_id,
            {"status": "processing", "progress": "5"},
            profile_id=profile_id,
        )

        repo = get_repository()

        # Fetch full product row — source determines table
        if request.source == "local":
            from app.repositories.product_library import get_product_library
            store = get_product_library()
            local = store.get(product_id, profile_id)
            if not local:
                raise ValueError(f"Product {product_id} not found")
            first_image = next(
                (str(p) for rel in (local.get("image_paths") or [])
                 if (p := store.abs_image_path(rel))),
                None,
            )
            # Shape the local row like a feed/catalog product so the rest of
            # the 6-stage pipeline runs unchanged (local_image_path drives Stage 1).
            product = {
                "id": local["id"],
                "external_id": local.get("external_id") or local["id"],
                "title": local["title"],
                "description": local.get("description") or "",
                "brand": local.get("brand") or "",
                "price": local.get("price") or "",
                "sale_price": local.get("sale_price") or "",
                "local_image_path": first_image,
                "image_link": next(iter(local.get("image_links") or []), None),
                "feed_id": local.get("source_id") or "local",
            }
        else:
            product_table = "v_catalog_products" if request.source == "catalog" else "products"
            product_result = repo.table_query(product_table, "select",
                filters=QueryFilters(eq={"id": product_id}, maybe_single=True))

            if not product_result.data:
                raise ValueError(f"Product {product_id} not found")

            product = product_result.data[0]

        # Read profile template settings (video_template_settings JSONB column)
        try:
            profile_result = repo.table_query("profiles", "select",
                filters=QueryFilters(
                    select="video_template_settings",
                    eq={"id": profile_id},
                    maybe_single=True,
                ))
            tmpl_cfg = (profile_result.data[0] if profile_result.data else {}).get("video_template_settings") or {}
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
                from app.services.image_fetcher import _download_one, _get_download_semaphore

                feed_id = product.get("feed_id", "unknown")
                cache_dir = settings.base_dir / "images" / feed_id
                cache_dir.mkdir(parents=True, exist_ok=True)

                semaphore = _get_download_semaphore()
                async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                    _, local_path_str = await _download_one(product, cache_dir, semaphore, client)
                if local_path_str:
                    candidate = Path(local_path_str)
                    if candidate.exists():
                        image_path = candidate

        if image_path is None:
            raise FileNotFoundError("Product image not available — cannot compose video")

        # Create profile-scoped temp directory
        temp_dir = settings.base_dir / "temp" / profile_id / "product_gen"
        temp_dir.mkdir(parents=True, exist_ok=True)

        job_storage.update_job(job_id, {"progress": "10"}, profile_id=profile_id)

        # Cancel checkpoint
        _raise_if_product_cancelled(job_storage, job_id, parent_batch_id)

        # ---------------------------------------------------------------
        # Stage 2: TTS Voiceover (10 -> 40%)
        # ---------------------------------------------------------------
        voiceover_text: str = ""

        if request.voiceover_mode == "quick" and request.source == "local":
            # Local products have no brand/price, so the default template would
            # read "Pret: lei." — speak title + description instead.
            voiceover_text = f"{product.get('title', '')}. {product.get('description', '')}".strip(". ") + "."

        elif request.voiceover_mode == "quick":
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

            _mark_product_operation_started(job_id, "script")

            from app.services.credentials.vault import get_vault_manager
            _vault = get_vault_manager()
            generator = ScriptGenerator(
                gemini_api_key=_vault.get_api_key_or_default(profile_id, "gemini") or settings.gemini_api_key,
                anthropic_api_key=_vault.get_api_key_or_default(profile_id, "anthropic") or getattr(settings, "anthropic_api_key", None),
            )

            scripts = await asyncio.to_thread(
                generator.generate_scripts,
                idea=product.get("title", "Product"),
                context=product.get("description", ""),
                keywords=[],
                variant_count=1,
                provider=request.ai_provider,
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
        _refresh_product_job_lease(job_id, profile_id, parent_batch_id)

        # TTS synthesis
        tts_audio_path = temp_dir / f"tts_{job_id}.mp3"
        tts_timestamps: Optional[dict] = None
        _mark_product_operation_started(job_id, "tts")

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
        _refresh_product_job_lease(job_id, profile_id, parent_batch_id)

        # Cancel checkpoint
        _raise_if_product_cancelled(job_storage, job_id, parent_batch_id)

        # ---------------------------------------------------------------
        # Stage 3: Subtitle generation (40 -> 50%)
        # ---------------------------------------------------------------
        srt_path: Optional[Path] = None

        if request.tts_provider == "elevenlabs" and tts_timestamps:
            srt_content = generate_srt_from_timestamps(tts_timestamps)
            if srt_content:
                srt_path = temp_dir / f"subtitles_{job_id}.srt"
                srt_path.write_text(sanitize_srt_full(srt_content), encoding="utf-8")
                logger.info("[%s] SRT subtitles written: %s", job_id, srt_path)
            else:
                logger.warning("[%s] Empty SRT content — skipping subtitles", job_id)

        # Edge TTS: no timestamps, no subtitles (srt_path stays None)

        job_storage.update_job(job_id, {"progress": "50"}, profile_id=profile_id)

        # Cancel checkpoint
        _raise_if_product_cancelled(job_storage, job_id, parent_batch_id)

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

        # Wave 4.1 / G6: if this product has associated local footage, assemble the
        # base from real keyword-matched segments with the product image as a PiP
        # overlay; otherwise fall back to the single-image Ken Burns slideshow.
        footage_plan = await asyncio.to_thread(
            _resolve_product_footage, repo, product_id, profile_id
        )

        # Reserve was obtained at request entry; join the fair queue only when
        # TTS is ready so an unready product job cannot occupy render capacity.
        check_disk_space(settings.output_dir)
        _raise_if_product_cancelled(job_storage, job_id, parent_batch_id)
        job_storage.update_job(
            job_id,
            {"status": "processing", "progress": "Queued for render"},
            profile_id=profile_id,
        )
        _refresh_product_job_lease(job_id, profile_id, parent_batch_id)
        render_ticket = await get_render_queue().enqueue(
            user_id=user_id,
            job_id=_product_render_queue_job_id(job_id),
        )
        try:
            await render_ticket.__aenter__()
        except RenderQueueCancelled as exc:
            raise _ProductGenerationCancelled(
                "Product render cancelled while queued"
            ) from exc
        render_ticket_entered = True
        _raise_if_product_cancelled(job_storage, job_id, parent_batch_id)
        _mark_product_operation_started(job_id, "render")
        job_storage.update_job(
            job_id,
            {"status": "processing", "progress": "Composing video"},
            profile_id=profile_id,
        )

        if footage_plan:
            logger.info(
                "[%s] Stage 4: FOOTAGE mode — %d clip(s), pip=%s",
                job_id, len(footage_plan["clips"]), footage_plan["pip_config"],
            )
            await asyncio.to_thread(
                compose_product_video_from_footage,
                footage_clips=footage_plan["clips"],
                pip_image_path=image_path,
                output_path=composed_path,
                product=product,
                config=compositor_config,
                pip_config=footage_plan["pip_config"],
            )
        else:
            logger.info("[%s] Stage 4: SLIDESHOW mode (no footage associations)", job_id)
            await asyncio.to_thread(
                compose_product_video,
                image_path=image_path,
                output_path=composed_path,
                product=product,
                config=compositor_config,
            )

        logger.info("[%s] Composition complete: %s", job_id, composed_path)
        job_storage.update_job(job_id, {"progress": "70"}, profile_id=profile_id)

        _raise_if_product_cancelled(job_storage, job_id, parent_batch_id)

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

        await _render_with_preset(
            video_path=composed_path,
            audio_path=tts_audio_path,
            srt_path=srt_path,
            subtitle_settings=subtitle_settings,
            preset=preset_dict,
            output_path=final_path,
            enable_denoise=request.enable_denoise,
            enable_sharpen=request.enable_sharpen,
            enable_color=request.enable_color_correction,
        )

        logger.info("[%s] Final render complete: %s", job_id, final_path)
        job_storage.update_job(job_id, {"progress": "90"}, profile_id=profile_id)
        _refresh_product_job_lease(job_id, profile_id, parent_batch_id)
        render_ticket_entered = False
        await render_ticket.__aexit__(None, None, None)
        _raise_if_product_cancelled(job_storage, job_id, parent_batch_id)

        # ---------------------------------------------------------------
        # Stage 6: Library insert (90 -> 100%)
        # ---------------------------------------------------------------
        project_name = f"[Product] {product.get('title', 'Unknown')[:50]}"
        now = datetime.now(timezone.utc).isoformat()
        runtime_job = job_storage.get_job(job_id) or {}
        planned_project_id = runtime_job.get("planned_project_id")
        planned_clip_id = runtime_job.get("planned_clip_id")

        # Insert editai_projects row
        project_payload = {
            "name": project_name,
            "profile_id": profile_id,
            "status": "completed",
            "target_duration": request.duration_s,
            "created_at": now,
            "updated_at": now,
        }
        if planned_project_id:
            project_payload["id"] = planned_project_id
        project_insert = repo.create_project(project_payload)

        project_id = project_insert.get("id") if project_insert else None
        if not project_id:
            raise ValueError("Failed to insert editai_projects row — no id returned")

        # Insert editai_clips row
        clip_payload = {
            "project_id": project_id,
            "profile_id": profile_id,
            "raw_video_path": str(composed_path),
            "final_video_path": str(final_path),
            "final_status": "completed",
            "variant_index": 0,
            "is_selected": True,
            "created_at": now,
            "updated_at": now,
        }
        if planned_clip_id:
            clip_payload["id"] = planned_clip_id
        clip_insert = repo.create_clip(clip_payload)

        clip_id = clip_insert.get("id") if clip_insert else None
        if not clip_id and planned_clip_id:
            persisted_clip = repo.get_clip(planned_clip_id)
            if persisted_clip:
                clip_id = planned_clip_id
        if not clip_id:
            raise ValueError("Failed to insert editai_clips row - no id returned")

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
        _mark_product_output_persisted(job_id)
        await _settle_product_metering(
            job_id,
            user_id,
            delivered=True,
            result_metadata={
                "studio_job_id": job_id,
                "output_id": clip_id or project_id,
            },
        )

        logger.info(
            "[%s] Product video generation complete: project_id=%s clip_id=%s path=%s",
            job_id,
            project_id,
            clip_id,
            final_path,
        )

    except _ProductGenerationCancelled as exc:
        if render_ticket_entered and render_ticket is not None:
            render_ticket_entered = False
            await render_ticket.__aexit__(None, None, None)
        logger.info("[%s] Product video generation cancelled", job_id)
        job_storage.update_job(
            job_id,
            {"status": "cancelled", "error": str(exc), "progress": "0"},
            profile_id=profile_id,
        )
        await _settle_product_metering(job_id, user_id, delivered=False)
        job_storage.clear_job_cancelled(job_id)
    except Exception as exc:  # noqa: BLE001
        if render_ticket_entered and render_ticket is not None:
            render_ticket_entered = False
            await render_ticket.__aexit__(None, None, None)
        logger.error(
            "[%s] Product video generation failed: %s\n%s",
            job_id,
            exc,
            traceback.format_exc(),
        )
        failed_job = job_storage.get_job(job_id) or {}
        persisted_output = _find_persisted_product_output(failed_job)
        if persisted_output:
            _persist_recovered_product_output(job_id, persisted_output)
            await _settle_product_metering(
                job_id,
                user_id,
                delivered=True,
                result_metadata={
                    "studio_job_id": job_id,
                    "output_id": persisted_output["clip_id"],
                },
            )
            logger.info(
                "[%s] Recovered persisted product output after worker failure: %s",
                job_id,
                persisted_output["clip_id"],
            )
            return
        try:
            job_storage.update_job(
                job_id,
                {"status": "failed", "error": str(exc), "progress": "0"},
                profile_id=profile_id,
            )
        except Exception as update_exc:
            logger.error("[%s] Failed to update job to failed state: %s", job_id, update_exc)
        await _settle_product_metering(job_id, user_id, delivered=False)
    finally:
        if render_ticket_entered and render_ticket is not None:
            render_ticket_entered = False
            await render_ticket.__aexit__(None, None, None)
        # Clean up temp files on failure or success
        try:
            temp_dir = settings.base_dir / "temp" / profile_id / "product_gen"
            for pattern in [f"tts_{job_id}.*", f"composed_{job_id}.*", f"subtitles_{job_id}.*"]:
                for f in temp_dir.glob(pattern):
                    f.unlink(missing_ok=True)
        except Exception:
            pass
