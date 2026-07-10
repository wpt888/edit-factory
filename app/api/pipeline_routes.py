"""
Multi-Variant Pipeline API Routes

Orchestrates end-to-end pipeline:
1. Generate N script variants from an idea (Phase 14 script generation)
2. Preview segment matching per variant (Phase 15 assembly preview)
3. Batch-render selected variants with progress tracking (Phase 15 assembly render)
4. Status tracking for all variants in a pipeline

This is the glue layer connecting script generation and assembly into a single workflow.
"""
import asyncio
import hashlib
import json as _json
import logging
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, List, Literal, Optional, Dict, Tuple
from pathlib import Path

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Body, Query, Request
from fastapi.responses import FileResponse
import re as _re
from pydantic import BaseModel, Field, field_validator

from app.api.auth import ProfileContext, get_profile_context
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters
from app.utils import normalize_path
from app.core.rate_limit import limiter
from app.services.script_generator import get_script_generator_for_profile
from app.services.assembly_service import get_assembly_service, strip_product_group_tags
from app.services.meta_visual_profiles import META_PROFILES, META_PROFILES_BY_NAME, get_version_label
from app.config import get_settings

# Global FFmpeg concurrency — shared across ALL routes (library, pipeline, product)
from app.services.ffmpeg_semaphore import acquire_render_slot, acquire_preview_slot, check_disk_space, safe_ffmpeg_run, is_nvenc_available


def _stable_hash(text: str) -> str:
    """Stable hash that persists across Python process restarts (unlike built-in hash())."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _increment_segment_usage(supabase_client, segment_ids: list):
    """Increment usage_count for segments after a successful render.

    The first argument ``supabase_client`` is kept for backwards compatibility
    with callers that historically passed a Supabase client. It is IGNORED —
    we always go through the repository. Callers should pass ``None``. This
    signature is locked by W-81-01 in 81-01-PLAN.md so Plan 81-02 callers do
    not need to drop the argument.
    """
    if not segment_ids:
        return
    _logger = logging.getLogger(__name__)
    try:
        get_repository().increment_segment_usage(segment_ids)
    except Exception as e:
        _logger.warning(
            f"Failed to increment usage_count for segments: {e}"
        )

logger = logging.getLogger(__name__)


def _strip_embedded_product_blocks(context: str) -> str:
    """Remove legacy frontend-injected product blocks from freeform context.

    Older frontend builds persisted selected products both in `context_products`
    and inline inside `context` as:

        [Product: Title]
        Description...

    This leaked stale products into later Gemini calls when a pipeline was
    restored and product selection changed. Keep `context` as manual text only.
    """
    if not context:
        return ""

    cleaned = _re.sub(
        r"(?:^|\n)\[Product:\s*[^\]]+\]\s*(?:\n[^\n\[]*)*",
        "",
        context,
        flags=_re.MULTILINE,
    )
    cleaned = _re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _build_effective_pipeline_context(
    context: str,
    context_products: Optional[List[Any]] = None,
) -> str:
    """Compose AI context from manual text plus structured product data."""
    manual_context = _strip_embedded_product_blocks(context or "")
    product_blocks: List[str] = []

    for product in context_products or []:
        if isinstance(product, dict):
            title = (product.get("title") or "").strip()
            description = (product.get("description") or "").strip()
        else:
            title = (getattr(product, "title", "") or "").strip()
            description = (getattr(product, "description", "") or "").strip()

        if title and description:
            product_blocks.append(f"[Product: {title}]\n{description}")
        elif title:
            product_blocks.append(f"[Product: {title}]")

    return "\n\n".join(part for part in [manual_context, *product_blocks] if part).strip()


def _restore_missing_tts_audio_paths(
    pipeline_id: str,
    pipeline: dict,
    *,
    persist: bool = True,
) -> int:
    """Repair missing Step 2 TTS audio paths for an already-loaded pipeline.

    TTS previews are first generated in temp directories that may be cleaned up
    hours later. The persistent copy lives in the TTS library (`media/tts/...`),
    but older in-memory pipeline objects may still point at the now-deleted temp
    file. This helper reattaches missing variants to the durable library asset
    and falls back to Step 3 preview audio when available.
    """
    scripts = pipeline.get("scripts") or []
    if not scripts:
        return 0

    state_lock = _get_pipeline_state_lock(pipeline_id)
    with state_lock:
        tts_previews = pipeline.setdefault("tts_previews", {})
        previews = pipeline.get("previews", {})
        missing_audio_texts: Dict[int, str] = {}

        for raw_key, raw_value in list(tts_previews.items()):
            if not isinstance(raw_value, dict):
                continue
            try:
                idx = int(str(raw_key))
            except (ValueError, TypeError):
                continue
            if idx < 0 or idx >= len(scripts):
                continue

            audio_path_str = raw_value.get("audio_path")
            if audio_path_str and Path(audio_path_str).exists():
                continue

            raw_value["audio_path"] = None
            cleaned_text = strip_product_group_tags(scripts[idx]).strip()
            if cleaned_text:
                missing_audio_texts[idx] = cleaned_text

    if not missing_audio_texts:
        return 0

    restored_entries: Dict[int, Dict[str, Any]] = {}
    profile_id = pipeline.get("profile_id", "")

    try:
        repo = get_repository()
        if repo and profile_id:
            lib_result = repo.list_tts_assets(
                profile_id,
                QueryFilters(
                    eq={"status": "ready"},
                    select="id, tts_text, mp3_path, audio_duration, srt_content, tts_timestamps",
                ),
            )
            if lib_result.data:
                lib_lookup = {}
                for asset in lib_result.data:
                    text = (asset.get("tts_text") or "").strip()
                    path = asset.get("mp3_path")
                    if text and path:
                        if Path(path).exists():
                            lib_lookup[text] = asset
                        else:
                            # DB record exists but file missing — check fallback
                            # location (direct copy from previous generation)
                            _fb_dir = Path(f"media/tts/{profile_id}")
                            if _fb_dir.exists():
                                for _fb_file in _fb_dir.glob("*.mp3"):
                                    if _fb_file.name.startswith(asset["id"]):
                                        asset["mp3_path"] = str(_fb_file)
                                        lib_lookup[text] = asset
                                        break
                            if text not in lib_lookup:
                                logger.warning(
                                    f"Pipeline {pipeline_id}: library asset {asset['id']} "
                                    f"mp3 missing on disk: {path}"
                                )

                # Build a normalized lookup as a fallback so minor whitespace /
                # case differences don't prevent restore.
                def _norm_text(t: str) -> str:
                    return " ".join((t or "").split()).casefold()
                norm_lookup = {_norm_text(t): a for t, a in lib_lookup.items()}

                for idx, text in missing_audio_texts.items():
                    match = lib_lookup.get(text) or norm_lookup.get(_norm_text(text))
                    if not match:
                        continue
                    restored_entries[idx] = {
                        "audio_path": match["mp3_path"],
                        "library_asset_id": match["id"],
                    }
                    if match.get("audio_duration"):
                        restored_entries[idx]["audio_duration"] = match["audio_duration"]
                    if match.get("srt_content"):
                        restored_entries[idx]["srt_content"] = match["srt_content"]
    except Exception as lib_err:
        logger.warning(f"Pipeline {pipeline_id}: TTS library restore failed: {lib_err}")

    for idx in missing_audio_texts:
        if idx in restored_entries:
            continue
        preview = previews.get(idx) or previews.get(str(idx))
        if not isinstance(preview, dict):
            continue
        preview_data = preview.get("preview_data", {})
        preview_audio_path = preview_data.get("audio_path")
        if not preview_audio_path or not Path(preview_audio_path).exists():
            continue
        restored_entries[idx] = {
            "audio_path": preview_audio_path,
        }
        if preview_data.get("audio_duration"):
            restored_entries[idx]["audio_duration"] = preview_data["audio_duration"]
        if preview_data.get("srt_content"):
            restored_entries[idx]["srt_content"] = preview_data["srt_content"]

    if not restored_entries:
        return 0

    with state_lock:
        tts_previews = pipeline.setdefault("tts_previews", {})
        for idx, restored in restored_entries.items():
            entry = tts_previews.get(idx) or tts_previews.get(str(idx))
            if not isinstance(entry, dict):
                continue
            entry.update(restored)
            tts_previews[idx] = entry
            if str(idx) in tts_previews and str(idx) != idx:
                tts_previews.pop(str(idx), None)

    restored_count = len(restored_entries)
    logger.info(
        f"Pipeline {pipeline_id}: restored {restored_count}/{len(missing_audio_texts)} "
        f"missing TTS audio paths"
    )

    if persist:
        try:
            _db_save_pipeline(pipeline_id, pipeline)
        except Exception as persist_err:
            logger.warning(f"Pipeline {pipeline_id}: failed to persist restored TTS paths: {persist_err}")

    return restored_count


def _persist_tts_audio(
    profile_id: str,
    cleaned_text: str,
    audio_path: str,
    srt_content: Optional[str],
    timestamps: Optional[dict],
    model: str,
    duration: float,
    voice_id: Optional[str] = None,
) -> Tuple[str, Optional[str]]:
    """
    Persist a (possibly temp/) TTS file to the TTS library, or media/tts/ as fallback.

    Returns (persistent_audio_path, library_asset_id). Returns the original path
    (with an ERROR log) only if every persistence path fails — a temp/ path left
    in pipeline state breaks later previews/renders once temp/ is cleaned up.
    """
    import shutil

    try:
        from app.services.tts_library_service import get_tts_library_service
        tts_lib = get_tts_library_service()
        saved_asset_id = tts_lib.save_from_pipeline(
            profile_id=profile_id,
            text=cleaned_text,
            audio_path=audio_path,
            srt_content=srt_content,
            timestamps=timestamps,
            model=model,
            duration=duration,
            voice_id=voice_id,
        )
        if saved_asset_id:
            lib_path = f"media/tts/{profile_id}/{saved_asset_id}.mp3"
            if Path(lib_path).exists():
                logger.info(
                    f"[Profile {profile_id}] TTS auto-saved to library: "
                    f"asset {saved_asset_id}, path updated to {lib_path}"
                )
                return lib_path, saved_asset_id
        else:
            # Dedup hit — asset already exists. Look it up and use its path.
            _repo = get_repository()
            if _repo:
                _existing = _repo.list_tts_assets(
                    profile_id,
                    QueryFilters(
                        eq={"status": "ready", "tts_text": cleaned_text},
                        select="id, mp3_path",
                        limit=1,
                    ),
                )
                if _existing.data and _existing.data[0].get("mp3_path"):
                    _lib_path = _existing.data[0]["mp3_path"]
                    _lib_asset_id = _existing.data[0]["id"]
                    if Path(_lib_path).exists():
                        logger.info(
                            f"[Profile {profile_id}] TTS dedup: reusing library path {_lib_path}"
                        )
                        return _lib_path, _lib_asset_id
                    if Path(audio_path).exists():
                        # Library file missing on disk — re-copy from temp source
                        Path(_lib_path).parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(audio_path, _lib_path)
                        logger.info(
                            f"[Profile {profile_id}] TTS dedup: re-copied to library path {_lib_path}"
                        )
                        return _lib_path, _lib_asset_id
    except Exception as lib_err:
        logger.warning(f"TTS library auto-save failed (non-blocking): {lib_err}")

    # Final fallback: copy directly to media/tts/ so audio survives temp/ cleanup
    # on server restart.
    if Path(audio_path).exists():
        try:
            _fallback_dir = Path(f"media/tts/{profile_id}")
            _fallback_dir.mkdir(parents=True, exist_ok=True)
            _fallback_path = _fallback_dir / Path(audio_path).name
            shutil.copy2(audio_path, str(_fallback_path))
            logger.info(
                f"[Profile {profile_id}] TTS fallback: copied to {_fallback_path} "
                f"(library save did not persist)"
            )
            return str(_fallback_path), None
        except Exception as _fb_err:
            logger.error(
                f"[Profile {profile_id}] TTS persistence failed — temp path stays in "
                f"pipeline state and will break previews after temp/ cleanup: {_fb_err}"
            )
    return audio_path, None


router = APIRouter(prefix="/pipeline", tags=["Multi-Variant Pipeline"])

# In-memory pipeline state storage
_pipelines: Dict[str, dict] = {}
_MAX_PIPELINE_ENTRIES = 1000

# Lock for library project creation (prevents duplicate projects from concurrent renders)
_library_project_lock = threading.Lock()

# Per-pipeline render locks (prevents race conditions in concurrent variant renders)
_render_locks: Dict[str, threading.Lock] = {}
_render_locks_meta_lock = threading.Lock()  # PIP-02: guards creation of new entries in _render_locks
_render_locks_timestamps: Dict[str, float] = {}  # pipeline_id -> last acquired time
_RENDER_LOCK_TTL = 3600  # 1 hour

# Per-pipeline preview locks (prevents concurrent preview renders from racing) — PIP-05
_preview_locks: Dict[str, asyncio.Lock] = {}
_preview_locks_meta_lock = threading.Lock()

# Per-pipeline state locks — protects mutations to pipeline["previews"],
# pipeline["tts_previews"], pipeline["segment_usage"], pipeline["preview_renders"]
# from concurrent preview/TTS/render tasks racing on the same pipeline dict.
_pipeline_state_locks: Dict[str, threading.Lock] = {}
_pipeline_state_locks_meta: threading.Lock = threading.Lock()


def _get_pipeline_state_lock(pipeline_id: str, profile_id: str = "") -> threading.Lock:
    """Get or create a lock for pipeline state mutations.

    Keys are scoped by profile_id when available (defense-in-depth for multi-tenancy).
    Pipeline UUIDs are globally unique, so the profile prefix is a secondary safeguard.
    """
    scoped_key = f"{profile_id}:{pipeline_id}" if profile_id else pipeline_id
    with _pipeline_state_locks_meta:
        if scoped_key not in _pipeline_state_locks:
            _pipeline_state_locks[scoped_key] = threading.Lock()
        return _pipeline_state_locks[scoped_key]



# Cancel infrastructure for pipeline renders
import time as _time_mod

def _safe_relative_path(raw_path: Optional[str]) -> Optional[str]:
    """Strip absolute path to output_dir-relative path for client consumption."""
    if not raw_path:
        return None
    p = Path(raw_path)
    try:
        return p.relative_to(get_settings().output_dir).as_posix()
    except (ValueError, Exception):
        # Already relative or different base — try stripping "output/" prefix
        posix = p.as_posix()
        if "output/" in posix:
            return posix.split("output/", 1)[1]
        return p.name


_cancelled_pipelines: Dict[str, float] = {}  # pipeline_id -> monotonic timestamp
_cancelled_pipelines_lock = threading.Lock()
_MAX_CANCELLED_PIPELINES = 200

# Render jobs stuck in "processing" older than this are treated as orphans
# from a crashed/restarted run and eligible to be re-queued.
STALE_PROCESSING_THRESHOLD_SEC = 30 * 60  # 30 minutes

# Per-job cancellation: "pipeline_id:job_key" -> monotonic timestamp
# job_key is a string form of either the integer variant_index ("0") for
# standard renders, or "{vid}_{version}" ("0_A") when Meta multiplication is
# active. Keying by the exact job_key lets Stop target a single A/B card
# instead of cancelling both versions at once.
_cancelled_variants: Dict[str, float] = {}
_cancelled_variants_lock = threading.Lock()


def is_pipeline_cancelled(pipeline_id: str) -> bool:
    """Check if a pipeline has been flagged for cancellation."""
    with _cancelled_pipelines_lock:
        return pipeline_id in _cancelled_pipelines


def is_variant_cancelled(pipeline_id: str, job_key) -> bool:
    """Check if a specific job (variant or variant+version) has been cancelled."""
    key = f"{pipeline_id}:{job_key}"
    with _cancelled_variants_lock:
        return key in _cancelled_variants


def mark_pipeline_cancelled(pipeline_id: str):
    """Flag a pipeline for cancellation."""
    with _cancelled_pipelines_lock:
        _cancelled_pipelines[pipeline_id] = _time_mod.monotonic()
        if len(_cancelled_pipelines) > _MAX_CANCELLED_PIPELINES:
            sorted_ids = sorted(_cancelled_pipelines, key=_cancelled_pipelines.get)
            for pid in sorted_ids[:len(_cancelled_pipelines) - _MAX_CANCELLED_PIPELINES]:
                _cancelled_pipelines.pop(pid, None)


def mark_variant_cancelled(pipeline_id: str, job_key):
    """Flag a specific job (variant or variant+version) for cancellation."""
    key = f"{pipeline_id}:{job_key}"
    with _cancelled_variants_lock:
        _cancelled_variants[key] = _time_mod.monotonic()
        # Evict old entries to prevent unbounded growth
        if len(_cancelled_variants) > _MAX_CANCELLED_PIPELINES * 10:
            sorted_keys = sorted(_cancelled_variants, key=_cancelled_variants.get)
            for k in sorted_keys[:len(_cancelled_variants) - _MAX_CANCELLED_PIPELINES * 5]:
                _cancelled_variants.pop(k, None)


def clear_variant_cancelled(pipeline_id: str, job_key):
    """Clear the cancellation flag for a specific job_key."""
    key = f"{pipeline_id}:{job_key}"
    with _cancelled_variants_lock:
        _cancelled_variants.pop(key, None)


def clear_pipeline_cancelled(pipeline_id: str):
    """Clear the cancellation flag for a pipeline."""
    with _cancelled_pipelines_lock:
        _cancelled_pipelines.pop(pipeline_id, None)


def _compute_render_fingerprint(
    render_request,
    variant_index: int,
    script_text: str,
    job_key: Optional[Any] = None,
    visual_version: Optional[str] = None,
) -> str:
    """Compute a stable SHA-256 fingerprint from ALL render-affecting parameters.

    Used to detect when a variant can skip re-rendering because all parameters
    are identical to the last successful render.

    `job_key` is the same key used by the render dispatch path: an int variant
    index for the standard flow, or a string like "0_A" / "0_B" for Meta
    multiplication versions. When provided, match_overrides and per-key
    subtitle settings are looked up using this key (matching the lookup the
    actual render does), so that A and B can have distinct fingerprints.
    `visual_version` is included as well so flipping Meta on/off invalidates
    the cache even when no other field changed.
    """
    # Match-overrides lookup must use the same key the render uses. Fall back
    # to str(variant_index) for backwards compat with callers that don't pass
    # job_key (e.g. old code paths that haven't been updated yet).
    lookup_key = str(job_key) if job_key is not None else str(variant_index)
    mo_segment_ids = []
    mo_transforms = {}
    if render_request.match_overrides:
        mo_variant = render_request.match_overrides.get(lookup_key)
        # Backwards compat: fall back to bare variant index if Meta key absent
        if not mo_variant and lookup_key != str(variant_index):
            mo_variant = render_request.match_overrides.get(str(variant_index))
        if mo_variant:
            mo_segment_ids = sorted(str(m.get("segment_id", "")) for m in mo_variant)
            mo_transforms = {str(i): m.get("transforms") or {} for i, m in enumerate(mo_variant)}

    interstitial = []
    if render_request.interstitial_slides:
        # Interstitials are still keyed by base variant index (no per-version split)
        interstitial = render_request.interstitial_slides.get(str(variant_index), [])

    # Resolve per-key subtitle override if any. This makes A vs B have distinct
    # fingerprints when only their subtitle styles differ. The render path uses
    # the same _get_subtitle_settings_for_key helper. Mirror the field set
    # produced by _fetch_preset_and_settings so the fingerprint and the actual
    # render see the same settings.
    _default_subtitle = {
        "fontSize": render_request.font_size,
        "fontFamily": render_request.font_family,
        "textColor": render_request.text_color,
        "outlineColor": render_request.outline_color,
        "outlineWidth": render_request.outline_width,
        "positionY": render_request.position_y,
        "shadowDepth": render_request.shadow_depth,
        "shadowColor": render_request.shadow_color,
        "borderStyle": render_request.border_style,
        "enableGlow": render_request.enable_glow,
        "glowBlur": render_request.glow_blur,
        "adaptiveSizing": render_request.adaptive_sizing,
        "opacity": render_request.opacity,
    }
    effective_subtitle, _ = _get_subtitle_settings_for_key(
        render_request, lookup_key, _default_subtitle
    )

    key_data = {
        "script_text": script_text or "",
        "preset_name": render_request.preset_name,
        "voice_id": render_request.voice_id,
        "elevenlabs_model": render_request.elevenlabs_model,
        "voice_settings": render_request.voice_settings or {},
        "words_per_subtitle": render_request.words_per_subtitle,
        "min_segment_duration": render_request.min_segment_duration,
        "ultra_rapid_intro": render_request.ultra_rapid_intro,
        # Effective subtitle settings for THIS specific job_key — captures both
        # the default flat fields AND any per-key override that's in effect.
        "effective_subtitle": effective_subtitle,
        "visual_version": visual_version or "",
        "enable_denoise": render_request.enable_denoise,
        "denoise_strength": render_request.denoise_strength,
        "enable_sharpen": render_request.enable_sharpen,
        "sharpen_amount": render_request.sharpen_amount,
        "enable_color": render_request.enable_color,
        "brightness": render_request.brightness,
        "contrast": render_request.contrast,
        "saturation": render_request.saturation,
        "encoding_mode": render_request.encoding_mode,
        "target_bitrate_kbps": render_request.target_bitrate_kbps,
        "audio_bitrate_kbps": render_request.audio_bitrate_kbps,
        "video_profile": render_request.video_profile,
        "video_level": render_request.video_level,
        "force_cpu": render_request.force_cpu,
        "match_override_segments": mo_segment_ids,
        "match_override_transforms": mo_transforms,
        "interstitial_slides": interstitial,
        "pip_overlays": render_request.pip_overlays or {},
        "source_video_ids": sorted(render_request.source_video_ids or []),
    }
    return hashlib.sha256(
        _json.dumps(key_data, sort_keys=True, default=str).encode()
    ).hexdigest()[:32]


def _evict_stale_render_locks():
    """Evict render locks not acquired for over 1 hour.

    Only evicts a lock if it can be acquired non-blocking (i.e., nobody holds it).
    This prevents deleting a lock while another render is still using it.
    PIP-15: Guarded with _render_locks_meta_lock to prevent races on _render_locks dict.
    """
    now = _time_mod.monotonic()
    with _render_locks_meta_lock:
        stale = [k for k, ts in _render_locks_timestamps.items() if now - ts > _RENDER_LOCK_TTL]
        evicted = 0
        for k in stale:
            lock = _render_locks.get(k)
            if lock is None:
                # Lock already removed, just clean up timestamp
                _render_locks_timestamps.pop(k, None)
                evicted += 1
                continue
            # Only evict if we can acquire the lock (nobody is holding it)
            if lock.acquire(blocking=False):
                lock.release()
                _render_locks.pop(k, None)
                _render_locks_timestamps.pop(k, None)
                evicted += 1
            else:
                # Lock is held — skip eviction, update timestamp to retry later
                logger.debug(f"Skipping eviction of render lock {k} — still held")
        if evicted:
            logger.debug(f"Evicted {evicted} stale render lock(s)")


_eviction_lock = threading.Lock()
_pipelines_lock = threading.Lock()  # Guards all mutations to _pipelines dict

def _evict_old_pipelines():
    """Remove oldest entries if store exceeds max size.
    PIP-09: Also cleans up associated render locks under _render_locks_meta_lock.
    Thread-safe: uses _eviction_lock to prevent concurrent eviction races,
    and _pipelines_lock to guard _pipelines dict mutations.
    BUG-PR-16: len check moved inside lock to avoid TOCTOU race.
    """
    with _eviction_lock:
        # Re-check under lock
        if len(_pipelines) <= _MAX_PIPELINE_ENTRIES:
            return
        with _render_locks_meta_lock:
            with _pipelines_lock:
                to_remove = sorted(_pipelines.keys(),
                    key=lambda k: _pipelines[k].get("created_at") or "9999-12-31T23:59:59"
                )[:len(_pipelines) - _MAX_PIPELINE_ENTRIES]
                logger.info(f"Evicting {len(to_remove)} old pipelines (cache size: {len(_pipelines)})")
                for key in to_remove:
                    _pipelines.pop(key, None)
                    _render_locks.pop(key, None)
                    _render_locks_timestamps.pop(key, None)
                    _pipeline_state_locks.pop(key, None)


# ============== DB PERSISTENCE HELPERS ==============


def _get_data_repository():
    """Indirection for code paths that should not be affected by local imports."""
    return get_repository()


def _path_is_in_temp(p: Optional[str]) -> bool:
    """True if p is an audio path that lives under the temp/ tree (not a durable asset)."""
    if not p:
        return False
    norm = str(p).replace("\\", "/").lower()
    if "/temp/" in norm or norm.startswith("temp/"):
        return True
    try:
        base_temp = (get_settings().base_dir / "temp").resolve()
        Path(p).resolve().relative_to(base_temp)
        return True
    except (ValueError, OSError):
        return False


def _promote_temp_audio_paths_to_library(pipeline_id: str, pipeline_dict: dict) -> None:
    """Pre-persistence guard: copy any temp/ audio referenced by tts_previews or
    previews.preview_data into the durable TTS library, then rewrite the path.

    Invariant after this runs: no audio_path persisted to DB points into temp/.
    Files already missing are zeroed out so the restore helper can reattach them
    on the next GET (instead of leaving a dangling temp/ pointer).
    """
    profile_id = pipeline_dict.get("profile_id")
    if not profile_id:
        return
    scripts = pipeline_dict.get("scripts") or []

    try:
        from app.services.tts_library_service import get_tts_library_service
        tts_lib = get_tts_library_service()
    except Exception as imp_err:
        logger.warning(f"Pipeline {pipeline_id}: tts_library_service unavailable for promotion: {imp_err}")
        tts_lib = None

    def _persist_one(audio_path_str: Optional[str], srt_content: Optional[str],
                     duration: Optional[float], text_for_asset: Optional[str]) -> Optional[Tuple[str, Optional[str]]]:
        """Copy a temp audio into the library. Returns (new_rel_path, asset_id) or None."""
        if not audio_path_str:
            return None
        src = Path(audio_path_str)
        if not src.exists() or not tts_lib:
            return None
        try:
            asset_id = tts_lib.save_from_pipeline(
                profile_id=profile_id,
                text=(text_for_asset or "").strip(),
                audio_path=str(src),
                srt_content=srt_content,
                timestamps=None,
                model="eleven_flash_v2_5",
                duration=duration or 0.0,
                voice_id=None,
            )
            if asset_id:
                rel = f"media/tts/{profile_id}/{asset_id}.mp3"
                if (get_settings().base_dir / rel).exists():
                    return (rel, asset_id)
            # Dedup hit — try to look up the existing asset's path
            try:
                _r = get_repository()
                if _r and text_for_asset:
                    _ex = _r.list_tts_assets(
                        profile_id,
                        QueryFilters(
                            eq={"status": "ready", "tts_text": text_for_asset.strip()},
                            select="id, mp3_path",
                            limit=1,
                        ),
                    )
                    if _ex.data and _ex.data[0].get("mp3_path"):
                        return (_ex.data[0]["mp3_path"], _ex.data[0]["id"])
            except Exception:
                pass
            # Last-ditch: copy verbatim into media/tts/ with a UUID name so audio
            # at least survives temp cleanup, even if no DB row gets written.
            import shutil as _shutil
            from uuid import uuid4 as _uuid4
            _dest_dir = get_settings().base_dir / "media" / "tts" / profile_id
            _dest_dir.mkdir(parents=True, exist_ok=True)
            _name = f"{_uuid4()}.mp3"
            _dest = _dest_dir / _name
            _shutil.copy2(str(src), str(_dest))
            return (f"media/tts/{profile_id}/{_name}", None)
        except Exception as save_err:
            logger.warning(f"Pipeline {pipeline_id}: temp->library promotion failed for {src}: {save_err}")
            return None

    # Promote tts_previews
    tts_previews = pipeline_dict.get("tts_previews") or {}
    for raw_key, entry in list(tts_previews.items()):
        if not isinstance(entry, dict):
            continue
        ap = entry.get("audio_path")
        if not _path_is_in_temp(ap):
            continue
        try:
            idx = int(str(raw_key))
        except (ValueError, TypeError):
            idx = None
        text = scripts[idx] if (idx is not None and 0 <= idx < len(scripts)) else None
        if text:
            text = strip_product_group_tags(text)
        promoted = _persist_one(ap, entry.get("srt_content"), entry.get("audio_duration"), text)
        if promoted:
            new_rel, asset_id = promoted
            entry["audio_path"] = new_rel
            if asset_id:
                entry["library_asset_id"] = asset_id
            logger.info(f"Pipeline {pipeline_id}: promoted tts_previews[{raw_key}] {ap} -> {new_rel}")
        else:
            # File missing or save failed — null the path so restore can reattach
            entry["audio_path"] = None
            logger.info(
                f"Pipeline {pipeline_id}: nulled stale temp tts_previews[{raw_key}] (was {ap})"
            )

    # Promote previews.preview_data
    previews = pipeline_dict.get("previews") or {}
    for raw_key, preview in list(previews.items()):
        if not isinstance(preview, dict):
            continue
        pd = preview.get("preview_data")
        if not isinstance(pd, dict):
            continue
        ap = pd.get("audio_path")
        if not _path_is_in_temp(ap):
            continue
        try:
            idx = int(str(raw_key))
        except (ValueError, TypeError):
            idx = None
        text = scripts[idx] if (idx is not None and 0 <= idx < len(scripts)) else None
        if text:
            text = strip_product_group_tags(text)
        promoted = _persist_one(ap, pd.get("srt_content"), pd.get("audio_duration"), text)
        if promoted:
            new_rel, _asset_id = promoted
            pd["audio_path"] = new_rel
            logger.info(f"Pipeline {pipeline_id}: promoted previews[{raw_key}].audio_path {ap} -> {new_rel}")
        else:
            pd["audio_path"] = None
            logger.info(
                f"Pipeline {pipeline_id}: nulled stale temp previews[{raw_key}].audio_path (was {ap})"
            )


def _db_save_pipeline(pipeline_id: str, pipeline_dict: dict):
    """Upsert full pipeline state to editai_pipelines. Graceful degradation with retry."""
    # PRE-PERSIST INVARIANT: no audio_path under temp/ may be persisted in DB.
    # This is a safety net on top of upstream fixes (assembly_service persists
    # newly generated TTS to the library before returning), so older code paths,
    # caches, or future regressions cannot reintroduce dangling temp pointers.
    try:
        _promote_temp_audio_paths_to_library(pipeline_id, pipeline_dict)
    except Exception as promote_err:
        logger.warning(f"Pipeline {pipeline_id}: temp-path promotion failed (non-blocking): {promote_err}")

    for attempt in range(2):
        try:
            repo = get_repository()
            # Snapshot dicts under a copy to avoid RuntimeError if another coroutine
            # mutates the pipeline dict concurrently (dict.items() is not thread-safe).
            previews_json = {str(k): v for k, v in dict(pipeline_dict.get("previews", {})).items()}
            render_jobs_json = {str(k): v for k, v in dict(pipeline_dict.get("render_jobs", {})).items()}
            tts_previews_json = {str(k): v for k, v in dict(pipeline_dict.get("tts_previews", {})).items()}
            # PIP-14: Include preview render paths in serialization
            preview_renders_json = {str(k): v for k, v in dict(pipeline_dict.get("preview_renders", {})).items()}
            segment_usage_json = {str(k): v for k, v in dict(pipeline_dict.get("segment_usage", {})).items()}
            captions_json = {str(k): v for k, v in dict(pipeline_dict.get("captions", {})).items()}
            selected_captions_json = dict(pipeline_dict.get("selected_captions", {}))
            # Per-variant subtitle overrides: keyed by PreviewKey ("0", "0_A"...)
            subtitle_overrides_raw = pipeline_dict.get("subtitle_settings_by_key")
            subtitle_overrides_json = (
                {str(k): v for k, v in dict(subtitle_overrides_raw).items()}
                if subtitle_overrides_raw
                else None
            )

            row = {
                "id": pipeline_id,
                "profile_id": pipeline_dict.get("profile_id"),
                "name": pipeline_dict.get("name", ""),
                "idea": pipeline_dict.get("idea", ""),
                "context": pipeline_dict.get("context", ""),
                "context_products": pipeline_dict.get("context_products", []),
                "provider": pipeline_dict.get("provider", "gemini"),
                "variant_count": pipeline_dict.get("variant_count", 0),
                "keyword_count": pipeline_dict.get("keyword_count", 0),
                "scripts": pipeline_dict.get("scripts", []),
                "previews": previews_json,
                "render_jobs": render_jobs_json,
                "tts_previews": tts_previews_json,
                "preview_renders": preview_renders_json,
                "segment_usage": segment_usage_json,
                "source_video_ids": pipeline_dict.get("source_video_ids", []),
                "captions": captions_json,
                "selected_captions": selected_captions_json,
                "target_script_duration": pipeline_dict.get("target_script_duration"),
                "meta_multiplication": pipeline_dict.get("meta_multiplication", True),
                "subtitle_settings_by_key": subtitle_overrides_json,
            }
            try:
                repo.upsert_pipeline(row)
            except Exception as upsert_err:
                err_str = str(upsert_err)
                # Graceful degradation for pre-migration databases
                if "subtitle_settings_by_key" in err_str:
                    logger.warning(
                        "subtitle_settings_by_key column missing — run migration 042. "
                        "Retrying without it."
                    )
                    row.pop("subtitle_settings_by_key", None)
                    repo.upsert_pipeline(row)
                elif "selected_captions" in err_str or "target_script_duration" in err_str:
                    logger.warning(f"Column missing, retrying without it: {err_str[:100]}")
                    row.pop("selected_captions", None)
                    row.pop("target_script_duration", None)
                    repo.upsert_pipeline(row)
                else:
                    raise
            logger.debug(f"Pipeline {pipeline_id} saved to DB")
            return  # success
        except Exception as e:
            if attempt == 0:
                logger.warning(f"Pipeline {pipeline_id} DB save failed (attempt 1, retrying): {e}")
                continue
            else:
                logger.error(f"Pipeline {pipeline_id} DB save FAILED after 2 attempts: {e}")


def _db_update_render_jobs(pipeline_id: str, render_jobs: dict):
    """Update only render_jobs column for a pipeline. Graceful degradation."""
    try:
        repo = get_repository()
        render_jobs_json = {str(k): v for k, v in render_jobs.items()}
        repo.update_pipeline(pipeline_id, {"render_jobs": render_jobs_json})
        logger.debug(f"Pipeline {pipeline_id} render_jobs updated in DB")
    except Exception as e:
        logger.warning(f"Failed to update render_jobs for {pipeline_id}: {e}")


def _fetch_preset_and_settings(render_request) -> tuple:
    """Fetch export preset from DB and merge encoding overrides + subtitle settings.

    Returns (preset_data, subtitle_settings) tuple.
    Shared by render_variants and remake_variant to avoid duplication.
    """
    repo = get_repository()

    preset_data = {
        "name": render_request.preset_name,
        "width": 1080,
        "height": 1920,
        "fps": 30,
        "video_codec": "h264_nvenc" if is_nvenc_available() else "libx264",
        "audio_codec": "aac",
        "video_bitrate": "3M",
        "audio_bitrate": "192k"
    }

    if repo:
        try:
            preset_row = repo.get_export_preset_by_name(render_request.preset_name)
            if preset_row:
                preset_data = preset_row
            else:
                logger.warning(f"Preset '{render_request.preset_name}' not found, using default")
        except Exception as e:
            logger.error(f"Failed to fetch preset: {e}")

    # Merge encoding overrides from request into preset_data
    if render_request.encoding_mode:
        preset_data["encoding_mode"] = render_request.encoding_mode
    if render_request.target_bitrate_kbps:
        preset_data["target_bitrate_kbps"] = render_request.target_bitrate_kbps
    if render_request.audio_bitrate_kbps:
        preset_data["audio_bitrate"] = f"{render_request.audio_bitrate_kbps}k"
    if render_request.video_profile:
        preset_data["video_profile"] = render_request.video_profile
    if render_request.video_level:
        preset_data["video_level"] = render_request.video_level

    # Build default subtitle settings dict (camelCase keys to match
    # SubtitleStyleConfig.from_dict). Used as fallback for any variant that
    # doesn't have an explicit override in render_request.subtitle_settings_by_key.
    # Includes the full set of fields the backend's from_dict actually reads,
    # so partial overrides can fall through to defaults for any field.
    default_subtitle_settings = {
        "fontSize": render_request.font_size,
        "fontFamily": render_request.font_family,
        "textColor": render_request.text_color,
        "outlineColor": render_request.outline_color,
        "outlineWidth": render_request.outline_width,
        "positionY": render_request.position_y,
        "shadowDepth": render_request.shadow_depth,
        "shadowColor": render_request.shadow_color,
        "borderStyle": render_request.border_style,
        "enableGlow": render_request.enable_glow,
        "glowBlur": render_request.glow_blur,
        "adaptiveSizing": render_request.adaptive_sizing,
        "opacity": render_request.opacity
    }

    return preset_data, default_subtitle_settings


def _style_key_for_lookup(key: str) -> str:
    """Extract the StyleKey ("A" | "B" | "default") from a render-time PreviewKey.

    PreviewKeys arriving from the render pipeline look like "0", "1", "0_A",
    "1_B" — i.e. "<script_index>" optionally suffixed with "_<version>". The
    subtitle style is now stored per Meta version, not per script, so we map:
      "N_A" → "A"
      "N_B" → "B"
      "N"   → "default"
    """
    if not isinstance(key, str):
        return "default"
    if "_" in key:
        _, version = key.rsplit("_", 1)
        if version in ("A", "B"):
            return version
    return "default"


def _normalize_overrides(raw: Any) -> Dict[str, Any]:
    """Collapse legacy per-script override keys ("0_A", "1_B") to per-Meta-version
    keys ("A", "B", "default"). Idempotent on already-canonical data.

    Sort order: legacy keys are processed before canonical ones so that if the
    dict already contains a canonical "A" alongside legacy "0_A", the canonical
    value wins (last-wins via sorted iteration — "0_A" < "A" alphabetically).

    Logs a WARNING when two legacy keys would map to the same target with
    different values, so operators have forensic evidence of the collapse when
    a user reports "my script-3 A style disappeared".
    """
    if not isinstance(raw, dict) or not raw:
        return {}

    normalized: Dict[str, Any] = {}
    sources: Dict[str, str] = {}  # tracks which legacy key produced each target
    for k in sorted(raw.keys()):
        v = raw[k]
        if not isinstance(v, dict):
            continue
        if k in ("A", "B", "default"):
            target = k
        elif k.endswith("_A"):
            target = "A"
        elif k.endswith("_B"):
            target = "B"
        elif k.isdigit():
            target = "default"
        else:
            # Unknown shape — ignore silently; the PUT regex rejects these,
            # and the resolver's fallback handles any in-flight weirdness.
            continue
        if target in normalized and normalized[target] != v:
            logger.warning(
                "_normalize_overrides: collapsing %r over %r into key %r — "
                "values differ, last-wins (forensic note for user reports).",
                k, sources.get(target), target
            )
        normalized[target] = v
        sources[target] = k
    return normalized


def _get_subtitle_settings_for_key(
    render_request,
    key: str,
    default_subtitle_settings: Dict[str, Any],
) -> tuple:
    """Resolve effective subtitle settings for a single preview key.

    Precedence: explicit override from render_request.subtitle_settings_by_key
    wins completely over default_subtitle_settings (shallow merge — override
    fields replace default fields, unknown fields fall through to default).

    Lookup order: the override dict is now keyed by StyleKey ("A"/"B"/"default").
    We map the incoming render-time `key` ("N_A", "N_B", "N") to its StyleKey
    and look up there. A legacy fallback tries the raw `key` as-is, to protect
    in-flight pipelines whose stored overrides haven't yet been normalized on
    load (e.g. stale cached dicts from before this refactor shipped).

    Returns (effective_settings, has_user_override). The boolean flag lets the
    caller decide whether to still apply a Meta profile override on top:
    - has_user_override=True  → user set something explicit; Meta is suppressed
    - has_user_override=False → Meta fallback still applies as today
    """
    overrides = render_request.subtitle_settings_by_key or {}
    style_key = _style_key_for_lookup(key)
    raw_override = overrides.get(style_key)
    if not isinstance(raw_override, dict) or not raw_override:
        # Legacy fallback: older stored shapes may still have the full key.
        raw_override = overrides.get(key)
    if not isinstance(raw_override, dict) or not raw_override:
        return dict(default_subtitle_settings), False

    # Shallow merge: start from default, then let override replace matching
    # keys. This is robust against override dicts that only contain a subset
    # of fields (e.g. only textColor changed).
    merged = dict(default_subtitle_settings)
    merged.update(raw_override)
    return merged, True


def _is_missing_column_error(exc: Exception, column_name: str) -> bool:
    """Best-effort detection for Supabase/PostgREST missing-column errors."""
    err = str(exc).lower()
    col = column_name.lower()
    return col in err and (
        "column" in err
        or "could not find" in err
        or "schema cache" in err
    )


async def _save_clip_to_library(
    pipeline: dict,
    pipeline_id: str,
    vid: int,
    final_video_path: Path,
    profile_id: str,
    render_fingerprint: str,
    render_jobs_lock: threading.Lock,
    raw_assembly_path: Optional[Path] = None,
    subtitle_settings: Optional[dict] = None,
    segment_composition: Optional[list] = None,
    job_key=None,
    visual_version: Optional[str] = None,
    voice_settings: Optional[dict] = None,
) -> None:
    """Save or update a rendered clip in the library.

    Handles: project creation, thumbnail generation, duration probe,
    clip upsert, clip_content save, segment usage_count increment.
    Shared by do_render and do_remake to avoid duplication.
    """
    _jk = job_key if job_key is not None else vid
    job = pipeline["render_jobs"][_jk]
    with render_jobs_lock:
        job["library_saved"] = False
    try:
        repo_lib = get_repository()
        # Plan 81-02 Task 2 — repo is always usable under DATA_BACKEND=sqlite (FUNC-01);
        # the legacy `if supabase_lib:` guard and `else: library_error = "Supabase unavailable"`
        # branch were dead code and have been collapsed. The outer try/except still wraps the
        # body so failures populate job["library_error"] as before (T-81-02-02 disposition).
        # Step A: Get or create a library project (locked to prevent duplicates)
        library_project_id = pipeline.get("library_project_id")

        if not library_project_id:
            with _library_project_lock:
                library_project_id = pipeline.get("library_project_id")
                if not library_project_id:
                    pipeline_name = (pipeline.get("name") or pipeline.get("idea", ""))[:80].strip() or f"Pipeline {pipeline_id[:8]}"
                    project_payload = {
                        "profile_id": profile_id,
                        "name": pipeline_name,
                        "description": f"Auto-generated from pipeline {pipeline_id}",
                        "status": "completed",
                        "pipeline_id": pipeline_id,
                    }
                    try:
                        created_proj = repo_lib.create_project(project_payload)
                        if created_proj and created_proj.get("id"):
                            library_project_id = created_proj["id"]
                    except Exception as insert_err:
                        insert_err_str = str(insert_err)
                        if "pipeline_id" in insert_err_str:
                            logger.warning(
                                "editai_projects insert rejected pipeline_id; retrying without pipeline linkage"
                            )
                            project_payload.pop("pipeline_id", None)
                            try:
                                created_proj = repo_lib.create_project(project_payload)
                                if created_proj and created_proj.get("id"):
                                    library_project_id = created_proj["id"]
                            except Exception:
                                pass
                        if not library_project_id:
                            logger.debug(
                                f"Project insert conflict, fetching existing: {insert_err}"
                            )
                            existing_proj = repo_lib.get_project_by_name(profile_id, pipeline_name)
                            if existing_proj:
                                library_project_id = existing_proj["id"]
                            else:
                                raise

                    if library_project_id:
                        pipeline["library_project_id"] = library_project_id

        if library_project_id:
            # Step B: Generate thumbnail
            thumb_path = None
            try:
                thumb_dir = final_video_path.parent / "thumbnails"
                thumb_dir.mkdir(parents=True, exist_ok=True)
                thumb_path = thumb_dir / f"{final_video_path.stem}_thumb.jpg"
                await asyncio.to_thread(safe_ffmpeg_run, [
                    "ffmpeg", "-y", "-ss", "1", "-i", str(final_video_path),
                    "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "3",
                    str(thumb_path)
                ], 30, "thumbnail")
                if thumb_path.exists():
                    with render_jobs_lock:
                        job["thumbnail_path"] = str(thumb_path)
                else:
                    thumb_path = None
            except Exception as thumb_err:
                logger.warning(f"Thumbnail generation failed: {thumb_err}")
                thumb_path = None

            # Step C: Get video duration
            duration = None
            try:
                dur_result = await asyncio.to_thread(safe_ffmpeg_run, [
                    "ffprobe", "-v", "error", "-show_entries",
                    "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    str(final_video_path)
                ], 30, "duration probe")
                if dur_result.returncode == 0:
                    try:
                        duration = float(dur_result.stdout.strip())
                    except ValueError:
                        logger.warning(f"ffprobe returned non-numeric duration: {dur_result.stdout.strip()!r}")
            except Exception as dur_err:
                logger.warning(f"Duration probe failed: {dur_err}")

            # Step D: Upsert clip row (update if already exists for this variant)
            clip_supports_visual_version = True
            _list_filters_eq: Dict[str, Any] = {
                "variant_index": vid,
                "is_deleted": False,
            }
            if visual_version:
                _list_filters_eq["visual_version"] = visual_version
            try:
                _list_result = repo_lib.list_clips(
                    library_project_id,
                    QueryFilters(eq=dict(_list_filters_eq), select="id, visual_version", limit=10),
                )
                # When visual_version is None, the original PostgREST query used `.is_("visual_version", "null")`.
                # list_clips eq does not honor IS NULL — filter client-side here.
                if visual_version:
                    existing_clip_data = (_list_result.data or [])[:1]
                else:
                    existing_clip_data = [
                        r for r in (_list_result.data or [])
                        if r.get("visual_version") is None
                    ][:1]
            except Exception as clip_query_err:
                if _is_missing_column_error(clip_query_err, "visual_version"):
                    clip_supports_visual_version = False
                    logger.warning("visual_version column missing, retrying clip lookup without it")
                    _list_filters_eq.pop("visual_version", None)
                    _list_result = repo_lib.list_clips(
                        library_project_id,
                        QueryFilters(eq=dict(_list_filters_eq), select="id", limit=10),
                    )
                    existing_clip_data = (_list_result.data or [])[:1]
                else:
                    raise
            if not existing_clip_data:
                insert_payload = {
                    "project_id": library_project_id,
                    "profile_id": profile_id,
                    "variant_index": vid,
                    "variant_name": f"variant_{vid + 1}" + (f"_{visual_version}" if visual_version else ""),
                    "raw_video_path": str(raw_assembly_path) if raw_assembly_path else str(final_video_path),
                    "final_video_path": str(final_video_path),
                    "thumbnail_path": str(thumb_path) if thumb_path else None,
                    "duration": duration,
                    "is_selected": False,
                    "is_deleted": False,
                    "final_status": "completed",
                }
                if clip_supports_visual_version:
                    insert_payload["visual_version"] = visual_version
                try:
                    insert_payload["render_fingerprint"] = render_fingerprint
                    created_clip = repo_lib.create_clip(insert_payload)
                except Exception as _fp_err:
                    if _is_missing_column_error(_fp_err, "render_fingerprint"):
                        logger.warning("render_fingerprint column missing, retrying INSERT without it")
                        insert_payload.pop("render_fingerprint", None)
                        created_clip = repo_lib.create_clip(insert_payload)
                    elif _is_missing_column_error(_fp_err, "visual_version"):
                        logger.warning("visual_version column missing, retrying INSERT without it")
                        insert_payload.pop("visual_version", None)
                        created_clip = repo_lib.create_clip(insert_payload)
                    else:
                        raise
                if created_clip and created_clip.get("id"):
                    with render_jobs_lock:
                        job["clip_id"] = created_clip["id"]
            else:
                # Existing clip — UPDATE with new video path and metadata
                existing_id = existing_clip_data[0].get("id")
                with render_jobs_lock:
                    job["clip_id"] = existing_id
                update_payload = {
                    "raw_video_path": str(raw_assembly_path) if raw_assembly_path else str(final_video_path),
                    "final_video_path": str(final_video_path),
                    "thumbnail_path": str(thumb_path) if thumb_path else None,
                    "duration": duration,
                    "final_status": "completed",
                    "is_deleted": False,
                }
                try:
                    update_payload["render_fingerprint"] = render_fingerprint
                    repo_lib.update_clip(existing_id, update_payload)
                except Exception as _fp_err:
                    if _is_missing_column_error(_fp_err, "render_fingerprint"):
                        logger.warning("render_fingerprint column missing, retrying UPDATE without it")
                        update_payload.pop("render_fingerprint", None)
                        repo_lib.update_clip(existing_id, update_payload)
                    else:
                        raise
                logger.info(
                    f"Updated existing clip {existing_id} with new video path"
                )

            with render_jobs_lock:
                job["library_saved"] = True

            # Save script text, SRT, and caption to clip_content
            _clip_id = job.get("clip_id")
            if _clip_id:
                try:
                    _script_text = pipeline.get("scripts", [])[vid] if vid < len(pipeline.get("scripts", [])) else None
                    _tts_data = pipeline.get("tts_previews", {}).get(vid) or pipeline.get("tts_previews", {}).get(str(vid), {})
                    _srt = _tts_data.get("srt_content") if _tts_data else None
                    _audio_path = _tts_data.get("audio_path") if _tts_data else None
                    _caption = pipeline.get("selected_captions", {}).get(str(vid))
                    _content_payload = {"clip_id": _clip_id}
                    if _script_text:
                        _content_payload["tts_text"] = _script_text
                    if _srt:
                        _content_payload["srt_content"] = _srt
                    if _audio_path:
                        _content_payload["tts_audio_path"] = _audio_path
                    if str(vid) in pipeline.get("selected_captions", {}):
                        _content_payload["caption"] = _caption or ""
                    if subtitle_settings:
                        _content_payload["subtitle_settings"] = subtitle_settings
                    if voice_settings:
                        _content_payload["voice_settings"] = voice_settings
                    if segment_composition:
                        _content_payload["segment_composition"] = segment_composition
                    if len(_content_payload) > 1:
                        # update_clip_content is UPDATE-only on both backends (Phase 80 lesson) —
                        # use table_query upsert with on_conflict="clip_id" instead.
                        repo_lib.table_query(
                            "editai_clip_content",
                            "upsert",
                            data=_content_payload,
                            filters=QueryFilters(on_conflict="clip_id"),
                        )
                        logger.info(f"Saved clip_content for clip {_clip_id} (variant {vid})")
                except Exception as cc_err:
                    logger.warning(f"Failed to save clip_content for variant {vid}: {cc_err}")

            logger.info(
                f"[Profile {profile_id}] Pipeline {pipeline_id} "
                f"variant {vid} saved to library project {library_project_id}"
            )

            # Increment usage_count for segments used in this variant.
            # W-81-01 signature: first arg is None (ignored — helper goes through get_repository()).
            try:
                used_seg_ids = pipeline.get("segment_usage", {}).get(str(vid), [])
                if used_seg_ids and not job.get("usage_incremented"):
                    _increment_segment_usage(None, used_seg_ids)
                    with render_jobs_lock:
                        job["usage_incremented"] = True
                    logger.info(
                        f"[Profile {profile_id}] Incremented usage_count "
                        f"for {len(used_seg_ids)} segments (variant {vid})"
                    )
            except Exception as usage_err:
                logger.warning(
                    f"[Profile {profile_id}] Failed to increment segment "
                    f"usage_count for variant {vid}: {usage_err}"
                )
        else:
            with render_jobs_lock:
                job["library_error"] = "Failed to create or find library project"
    except Exception as lib_err:
        with render_jobs_lock:
            job["library_error"] = str(lib_err)
        logger.error(
            f"[Profile {profile_id}] Failed to save pipeline variant "
            f"{vid} to library: {lib_err}",
            exc_info=True
        )

    # Persist library_saved/library_error/clip_id to DB after library save attempt
    _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])


def _db_load_pipeline(pipeline_id: str) -> Optional[dict]:
    """Load pipeline from DB into _pipelines cache. Returns pipeline dict or None."""
    try:
        repo = get_repository()
        row = repo.get_pipeline(pipeline_id)
        if not row:
            return None
        # Convert string keys back to int for previews and render_jobs.
        # Meta-multiplication keys ("0_A", "0_B", ...) are kept as strings;
        # legacy integer-only keys are coerced back to int.
        previews = {}
        for k, v in (row.get("previews") or {}).items():
            if isinstance(k, str) and "_" in k and any(k.endswith(f"_{c}") for c in "ABCDEFGHIJ"):
                previews[k] = v
            else:
                try:
                    previews[int(k)] = v
                except (ValueError, TypeError):
                    logger.warning(f"Skipping invalid preview key: {k}")
                    continue
            # Verify audio_path still exists on disk
            if isinstance(v, dict) and "preview_data" in v:
                pd = v["preview_data"]
                if pd.get("audio_path") and not Path(pd["audio_path"]).exists():
                    pd["audio_path"] = None

        render_jobs = {}
        for k, v in (row.get("render_jobs") or {}).items():
            # Meta multiplication keys are strings like "0_A", "0_B"
            if isinstance(k, str) and "_" in k and any(k.endswith(f"_{c}") for c in "ABCDEFGHIJ"):
                render_jobs[k] = v
            else:
                try:
                    render_jobs[int(k)] = v
                except (ValueError, TypeError):
                    logger.warning(f"Skipping invalid render_jobs key: {k}")
                    continue

        # Wave 2.3: this load path only runs for pipelines NOT already live in
        # this process, so any render job still mid-progress was interrupted by a
        # previous crash/restart. Mark it clearly (re-render to resume) instead of
        # leaving a frozen/vanishing progress bar.
        for _rj in render_jobs.values():
            if not isinstance(_rj, dict):
                continue
            _pct = _rj.get("progress") or 0
            _step = str(_rj.get("current_step") or "").lower()
            _terminal = _pct >= 100 or any(t in _step for t in ("complete", "failed", "cancel", "interrupt"))
            if 0 < _pct < 100 and not _terminal:
                _rj["current_step"] = "Render întrerupt — apasă Render din nou"
                _rj["interrupted"] = True
                logger.info(f"Pipeline {pipeline_id}: marked interrupted render job at {_pct}%")

        tts_previews = {}
        for k, v in (row.get("tts_previews") or {}).items():
            try:
                int_k = int(k)
                tts_previews[int_k] = v
            except (ValueError, TypeError):
                logger.warning(f"Skipping invalid tts_previews key: {k}")
                continue
            # Verify audio_path still exists on disk
            if isinstance(v, dict) and v.get("audio_path") and not Path(v["audio_path"]).exists():
                v["audio_path"] = None

        # PIP-14: Load preview_renders from DB. Same meta-multiplication
        # key handling as `previews` above.
        preview_renders = {}
        for k, v in (row.get("preview_renders") or {}).items():
            if isinstance(k, str) and "_" in k and any(k.endswith(f"_{c}") for c in "ABCDEFGHIJ"):
                preview_renders[k] = v
            else:
                try:
                    preview_renders[int(k)] = v
                except (ValueError, TypeError):
                    logger.warning(f"Skipping invalid preview_renders key: {k}")
                    continue

        # Load segment_usage from DB
        segment_usage = {}
        for k, v in (row.get("segment_usage") or {}).items():
            try:
                segment_usage[str(k)] = v
            except (ValueError, TypeError):
                logger.warning(f"Skipping invalid segment_usage key: {k}")
                continue

        # Load per-Meta-version subtitle overrides (keyed by StyleKey: "A",
        # "B", or "default"). Legacy data may contain per-script-variant keys
        # like "0_A"/"1_B" — _normalize_overrides collapses these to the
        # canonical shape (last-wins). Tolerant: non-dict entries are dropped.
        raw_overrides = row.get("subtitle_settings_by_key") or {}
        subtitle_settings_by_key = _normalize_overrides(
            {str(k): v for k, v in raw_overrides.items()}
        )

        pipeline = {
            "pipeline_id": pipeline_id,
            "profile_id": row["profile_id"],
            "name": row.get("name", ""),
            "idea": row.get("idea", ""),
            "context": row.get("context", ""),
            "provider": row.get("provider", "gemini"),
            "variant_count": row.get("variant_count", 0),
            "keyword_count": row.get("keyword_count", 0),
            "scripts": row.get("scripts") or [],
            "previews": previews,
            "render_jobs": render_jobs,
            "tts_previews": tts_previews,
            "preview_renders": preview_renders,
            "segment_usage": segment_usage,
            "source_video_ids": row.get("source_video_ids") or [],
            "context_products": row.get("context_products") or [],
            "captions": row.get("captions") or {},
            "selected_captions": row.get("selected_captions") or {},
            "created_at": row.get("created_at", ""),
            "meta_multiplication": row.get("meta_multiplication", True),
            "subtitle_settings_by_key": subtitle_settings_by_key,
        }

        _restore_missing_tts_audio_paths(pipeline_id, pipeline, persist=False)

        # Cache in memory
        with _pipelines_lock:
            _pipelines[pipeline_id] = pipeline
        logger.info(f"Pipeline {pipeline_id} loaded from DB")
        return pipeline

    except Exception as e:
        logger.warning(f"Failed to load pipeline {pipeline_id} from DB: {e}")
        return None


_pipeline_load_lock = threading.Lock()

def _get_pipeline_or_load(pipeline_id: str) -> Optional[dict]:
    """Get pipeline from in-memory cache, falling back to DB load.
    M6: Wrap initial check with _pipelines_lock to prevent TOCTOU race."""
    with _pipelines_lock:
        if pipeline_id in _pipelines:
            return _pipelines[pipeline_id]
    with _pipeline_load_lock:
        # Double-check after acquiring load lock (DB load is slow, avoid duplicates)
        with _pipelines_lock:
            if pipeline_id in _pipelines:
                return _pipelines[pipeline_id]
        return _db_load_pipeline(pipeline_id)


def _compute_segment_duration(profile_id: str) -> float:
    """Compute total duration of all segments for a profile."""
    repo = get_repository()
    try:
        result = repo.list_segments(
            profile_id,
            QueryFilters(select="start_time, end_time"),
        )
        total = 0.0
        for seg in result.data:
            start = seg.get("start_time")
            end = seg.get("end_time")
            if start is not None and end is not None:
                total += max(0, float(end) - float(start))
        return round(total, 1)
    except Exception as e:
        logger.warning(f"Failed to compute segment duration: {e}")
        return 0.0


def _voice_settings_match(a: Optional[dict], b: Optional[dict]) -> bool:
    """Compare voice settings dicts with tolerance for float precision differences."""
    if a is None or b is None:
        return a is b
    if set(a.keys()) != set(b.keys()):
        return False
    for key in a:
        va, vb = a[key], b[key]
        if isinstance(va, (int, float)) and isinstance(vb, (int, float)):
            if abs(va - vb) > 0.01:
                return False
        elif va != vb:
            return False
    return True


# ============== PYDANTIC MODELS ==============

class ContextProductItem(BaseModel):
    """A product selected from the catalog during pipeline creation."""
    title: str
    description: str = ""


class PipelineGenerateRequest(BaseModel):
    """Request model for pipeline generation."""
    name: str = Field(default="", max_length=200)  # Human-readable name for the script set
    idea: str = Field(..., max_length=2000)       # User's video idea/concept
    context: str = Field(default="", max_length=5000)  # Product/brand context
    context_products: List[ContextProductItem] = Field(default_factory=list)  # Structured product data
    variant_count: int = Field(default=3, ge=1, le=10)  # Number of script variants (1-10)
    provider: str = "gemini"            # "gemini" or "claude"
    target_script_duration: Optional[float] = Field(default=None, ge=5, le=300)  # Desired script duration in seconds (overrides auto-computed from segments)


class PipelineGenerateResponse(BaseModel):
    """Response model for pipeline generation."""
    pipeline_id: str                    # Unique pipeline identifier
    scripts: List[str]                  # Generated script texts
    provider: str                       # Which AI provider was used
    keyword_count: int                  # How many keywords were available
    variant_count: int                  # Number of variants generated
    total_segment_duration: float = 0.0 # Total duration (seconds) of available video segments


class MatchPreview(BaseModel):
    """Preview of a single SRT match."""
    srt_index: int
    srt_text: str
    srt_start: float
    srt_end: float
    segment_id: Optional[str]
    segment_keywords: List[str]
    matched_keyword: Optional[str]
    confidence: float
    is_auto_filled: bool = False
    source_video_id: Optional[str] = None
    segment_start_time: Optional[float] = None
    segment_end_time: Optional[float] = None
    thumbnail_path: Optional[str] = None
    merge_group: Optional[int] = None
    merge_group_duration: Optional[float] = None
    transforms: Optional[dict] = None
    explanation: Optional[str] = None  # F5: why this segment was picked
    pinned: bool = False               # F6: user-locked assignment


class PipelinePreviewResponse(BaseModel):
    """Response model for preview endpoint (same as AssemblyPreviewResponse)."""
    audio_duration: float
    srt_content: str
    matches: List[MatchPreview]
    total_phrases: int
    matched_count: int
    unmatched_count: int
    available_segments: List[dict] = []


class PipelineRenderRequest(BaseModel):
    """Request model for batch render."""
    variant_indices: List[int] = Field(..., min_length=1, max_length=10)  # Which variants to render (BUG-PR-13)
    preset_name: str = "TikTok"
    source_video_ids: Optional[List[str]] = None  # Filter segments to these source videos
    # Timeline editor overrides: preview key -> list of match dicts (with optional duration_override)
    # Keys are either "0" for standard previews or "0_A"/"0_B" for Meta preview versions.
    match_overrides: Optional[Dict[str, List[dict]]] = None

    # BUG-PR-14: Validate source_video_ids are valid UUIDs
    @field_validator("source_video_ids")
    @classmethod
    def _validate_uuid_format(cls, values):
        if values is None:
            return values
        _uuid_re = _re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", _re.IGNORECASE)
        for value in values:
            if not isinstance(value, str) or not _uuid_re.match(value):
                raise ValueError(f"Invalid UUID format: {value!r}")
        return values
    # Subtitle settings
    font_size: int = 48
    font_family: str = "Montserrat"
    text_color: str = "#FFFFFF"
    outline_color: str = "#000000"
    outline_width: int = 3
    position_y: int = 85
    shadow_depth: int = 0
    shadow_color: str = "#000000"
    border_style: int = 1
    enable_glow: bool = False
    glow_blur: int = 0
    adaptive_sizing: bool = False
    opacity: int = 100
    # Video filters
    enable_denoise: bool = False
    denoise_strength: float = 2.0
    enable_sharpen: bool = False
    sharpen_amount: float = 0.5
    enable_color: bool = False
    brightness: float = 0.0
    contrast: float = 1.0
    saturation: float = 1.0
    # Audio adjust
    voice_volume: float = Field(default=1.0, ge=0.0, le=3.0)
    audio_fade_in: float = Field(default=0.0, ge=0.0, le=10.0)
    audio_fade_out: float = Field(default=0.0, ge=0.0, le=10.0)
    # TTS model
    elevenlabs_model: str = "eleven_flash_v2_5"
    # TTS voice
    voice_id: Optional[str] = None
    # ElevenLabs voice settings overrides
    voice_settings: Optional[Dict[str, Any]] = None
    # Subtitle word grouping — BUG-PR-19: bounded
    words_per_subtitle: int = Field(default=2, ge=1, le=20)
    # Minimum video segment duration (seconds) — groups short SRT phrases
    min_segment_duration: float = 3.0
    # F8: segment-selection scoring preset (keyword_strict|balanced|max_variety|shuffle)
    preset: Optional[str] = "balanced"
    # Ultra-rapid intro: 3-4 micro-segments at the start for hook effect
    ultra_rapid_intro: bool = True
    # Interstitial product image slides: variant_index -> list of slide configs
    # Phase 46 will implement FFmpeg rendering — this phase just stores the data
    interstitial_slides: Optional[Dict[str, List[dict]]] = None
    # PiP overlay configs: segment_id -> { image_url, position, size, animation }
    pip_overlays: Optional[Dict[str, dict]] = None

    # Encoding settings overrides
    encoding_mode: Optional[Literal["crf", "vbr_1pass", "vbr_2pass"]] = None
    target_bitrate_kbps: Optional[int] = Field(default=None, ge=500, le=50000)
    audio_bitrate_kbps: Optional[int] = Field(default=None, ge=64, le=512)
    video_profile: Optional[Literal["baseline", "main", "high"]] = None
    video_level: Optional[str] = None
    force_cpu: bool = False

    # Skip re-render: variants that already have a valid render with matching fingerprint
    skip_variants: Optional[List[int]] = None

    # Meta render multiplication: render each variant twice for Instagram/Facebook
    meta_multiplication: bool = False

    # Per-variant subtitle style overrides. Keys are PreviewKey strings used
    # frontend-side: "0", "1", "0_A", "0_B". Values are SubtitleSettings-shaped
    # dicts in camelCase (fontSize, textColor, outlineColor, outlineWidth,
    # positionY, shadowDepth, enableGlow, glowBlur, adaptiveSizing, opacity,
    # fontFamily). When a key is present, it REPLACES the flat subtitle fields
    # for that variant and SUPPRESSES any Meta profile override. When absent,
    # the flat fields above are used as default, and Meta profile overrides
    # (if meta_multiplication) apply on top as today.
    subtitle_settings_by_key: Optional[Dict[str, Dict[str, Any]]] = None


class PipelineRenderResponse(BaseModel):
    """Response model for render endpoint."""
    pipeline_id: str
    rendering_variants: List[int]       # Which variants are being rendered
    total_variants: int                 # Total variants in pipeline
    message: Optional[str] = None       # Informational message (e.g. all already rendering)
    meta_multiplication: bool = False
    visual_versions: Optional[List[str]] = None  # ["A", "B"] when meta_multiplication is active


class VariantStatus(BaseModel):
    """Status of a single variant in the pipeline."""
    variant_index: int
    status: str                         # "not_started", "processing", "completed", "failed"
    progress: int                       # 0-100
    current_step: str
    final_video_path: Optional[str] = None
    thumbnail_path: Optional[str] = None
    clip_id: Optional[str] = None
    error: Optional[str] = None
    library_saved: Optional[bool] = None
    library_error: Optional[str] = None
    render_fingerprint: Optional[str] = None
    visual_version: Optional[str] = None    # "A", "B" when meta_multiplication active
    meta_platform: Optional[str] = None     # "instagram", "facebook"


class RenderCheckResult(BaseModel):
    """Per-variant render skip eligibility check result."""
    variant_index: int
    can_skip: bool
    reason: str  # "fingerprint_match", "no_previous_render", "file_missing", "fingerprint_mismatch", "still_processing"
    existing_video_path: Optional[str] = None


class RenderCheckResponse(BaseModel):
    """Response for the render check endpoint."""
    results: List[RenderCheckResult]
    any_skippable: bool


class VariantPreviewInfo(BaseModel):
    """Preview info for a variant (audio/SRT availability)."""
    has_audio: bool = False
    audio_duration: float = 0.0
    has_srt: bool = False


class VariantTtsInfo(BaseModel):
    """TTS preview info for a variant (Step 2 per-script TTS)."""
    has_audio: bool = False
    audio_duration: float = 0.0
    approved: bool = False


class PipelineStatusResponse(BaseModel):
    """Response model for status endpoint.
    PIP-10: scripts removed from polling endpoint to reduce payload size.
    Scripts are available via the dedicated GET /pipeline/{id}/scripts endpoint.
    """
    pipeline_id: str
    provider: str
    variant_count: int = 0
    variants: List[VariantStatus]
    meta_variants: Optional[List[VariantStatus]] = None
    meta_multiplication: bool = False
    preview_info: Dict[str, VariantPreviewInfo] = {}
    tts_info: Dict[str, VariantTtsInfo] = {}
    library_project_id: Optional[str] = None


class PipelineImportRequest(BaseModel):
    """Request model for importing scripts into a new pipeline (from history)."""
    scripts: List[str] = Field(..., max_length=10)
    name: str = ""
    idea: str = "Imported from history"
    context: str = ""
    context_products: List[ContextProductItem] = Field(default_factory=list)

    @field_validator("scripts")
    @classmethod
    def validate_script_length(cls, values):
        for value in values:
            if len(value) > 5000:
                raise ValueError("Each script must be at most 5000 characters")
        return values
    provider: str = "imported"


class PipelineListItem(BaseModel):
    """Lightweight pipeline summary for list endpoint."""
    pipeline_id: str
    name: str = ""
    idea: str
    provider: str
    variant_count: int
    keyword_count: int
    created_at: str
    target_script_duration: Optional[float] = None


class PipelineListResponse(BaseModel):
    """Response model for list endpoint."""
    pipelines: List[PipelineListItem]
    total: int


class SourceSelectionRequest(BaseModel):
    """Request model for updating source video selection."""
    source_video_ids: List[str]


# ============== ENDPOINTS ==============

@router.get("/list", response_model=PipelineListResponse)
async def list_pipelines(
    profile: ProfileContext = Depends(get_profile_context),
    limit: int = Query(20, ge=1, le=100)
):
    """
    List recent pipelines for the current profile.

    Returns lightweight summaries (no scripts/previews) ordered by creation date.
    Falls back to in-memory pipelines if DB is unavailable.
    """
    items = []

    # Try DB first
    try:
        repo = get_repository()
        if repo:
            result = repo.list_pipelines(
                profile.profile_id,
                QueryFilters(
                    select="id, name, idea, provider, variant_count, keyword_count, created_at, target_script_duration",
                    order_by="created_at",
                    order_desc=True,
                    limit=limit,
                ),
            )
            if result.data:
                for row in result.data:
                    items.append(PipelineListItem(
                        pipeline_id=row["id"],
                        name=row.get("name", ""),
                        idea=row.get("idea", ""),
                        provider=row.get("provider", "gemini"),
                        variant_count=row.get("variant_count", 0),
                        keyword_count=row.get("keyword_count", 0),
                        created_at=row.get("created_at", ""),
                        target_script_duration=row.get("target_script_duration")
                    ))
                return PipelineListResponse(pipelines=items, total=len(items))
    except Exception as e:
        logger.warning(f"Failed to list pipelines from DB: {e}")

    # Fallback to in-memory — BUG-PR-12: snapshot under lock to avoid iteration race
    with _pipelines_lock:
        profile_pipelines = [
            p for p in _pipelines.values()
            if p.get("profile_id") == profile.profile_id
        ]
    profile_pipelines.sort(key=lambda p: p.get("created_at", ""), reverse=True)

    for p in profile_pipelines[:limit]:
        items.append(PipelineListItem(
            pipeline_id=p["pipeline_id"],
            name=p.get("name", ""),
            idea=p.get("idea", ""),
            provider=p.get("provider", "gemini"),
            variant_count=p.get("variant_count", 0),
            keyword_count=p.get("keyword_count", 0),
            created_at=p.get("created_at", ""),
            target_script_duration=p.get("target_script_duration")
        ))

    return PipelineListResponse(pipelines=items, total=len(items))


@router.delete("/{pipeline_id}")
async def delete_pipeline(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Delete a pipeline and all its data from DB and in-memory cache.
    Only the owning profile can delete their pipelines.
    """
    # Remove from DB (verify ownership first, then clean up in-memory cache)
    db_found = False
    try:
        repo = get_repository()
        if repo:
            existing = repo.get_pipeline(pipeline_id)
            if existing:
                # T-81-01-01 IDOR mitigation: verify profile ownership before delete
                if existing.get("profile_id") != profile.profile_id:
                    raise HTTPException(status_code=403, detail="Not authorized to delete this pipeline")
                repo.delete_pipeline(pipeline_id)
                logger.info(f"Pipeline {pipeline_id} deleted from DB")
                db_found = True
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Failed to delete pipeline {pipeline_id} from DB: {e}")

    # Always try memory deletion regardless of DB result
    with _pipelines_lock:
        mem_found = _pipelines.pop(pipeline_id, None) is not None

    if not db_found and not mem_found:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    return {"status": "deleted", "pipeline_id": pipeline_id}


@router.post("/{pipeline_id}/cancel")
async def cancel_pipeline_render(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Cancel an in-progress pipeline render."""
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    mark_pipeline_cancelled(pipeline_id)

    # PIP-03: Acquire per-pipeline render lock before mutating render_jobs state
    pipeline_id_str = str(pipeline_id)
    with _render_locks_meta_lock:
        render_lock = _render_locks.get(pipeline_id_str)

    with _render_locks_meta_lock:
        if not render_lock:
            render_lock = threading.Lock()
            _render_locks[pipeline_id_str] = render_lock

    with render_lock:
        for idx, job in pipeline.get("render_jobs", {}).items():
            if job.get("status") == "processing":
                from app.services.ffmpeg_registry import kill_job
                kill_job(f"{pipeline_id}:{idx}")
                job["status"] = "cancelled"
                job["current_step"] = "Cancelled by user"
                job["progress"] = 0

    # Guard: if pipeline was evicted during cancel, re-insert so mutations persist
    with _pipelines_lock:
        if pipeline_id not in _pipelines:
            _pipelines[pipeline_id] = pipeline

    _db_update_render_jobs(pipeline_id, pipeline.get("render_jobs", {}))

    return {"status": "cancelled", "pipeline_id": pipeline_id}


def _cancel_single_job(pipeline: dict, pipeline_id: str, job_key, render_lock: threading.Lock) -> bool:
    """Mark one render_jobs entry cancelled and kill any live ffmpeg process.

    Returns True if a job with that key existed and was not already in a
    terminal state, False otherwise.  Caller is responsible for persisting
    render_jobs to the DB afterwards.
    """
    from app.services.ffmpeg_registry import kill_job
    render_jobs = pipeline.get("render_jobs", {})
    # Try exact key first, then fall back to int() for back-compat (old
    # clients may still send "0" as a string for a job stored under 0).
    job = render_jobs.get(job_key)
    if job is None and isinstance(job_key, str):
        try:
            job = render_jobs.get(int(job_key))
        except (ValueError, TypeError):
            job = None
    if not job:
        return False
    mark_variant_cancelled(pipeline_id, job_key)
    kill_job(f"{pipeline_id}:{job_key}")
    with render_lock:
        if job.get("status") in ("processing", "not_started", "pending", None):
            job["status"] = "cancelled"
            job["current_step"] = "Cancelled by user"
            job["progress"] = 0
            job["cancelled_at"] = datetime.now(timezone.utc).isoformat()
    return True


@router.post("/{pipeline_id}/cancel/{job_key}")
async def cancel_variant_render(
    pipeline_id: str,
    job_key: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Cancel a single render job while letting others continue.

    ``job_key`` is the render_jobs dict key, as a string:
      - "0", "1", ... for standard (non-Meta) renders
      - "0_A", "0_B" for Meta-multiplication A/B versions

    Sending just "0" when Meta multiplication is active cancels BOTH A and B
    (back-compat with older frontend that didn't know about per-version keys).
    Sending "0_A" cancels only that specific version.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    pipeline_id_str = str(pipeline_id)
    with _render_locks_meta_lock:
        render_lock = _render_locks.get(pipeline_id_str)
    if not render_lock:
        with _render_locks_meta_lock:
            render_lock = threading.Lock()
            _render_locks[pipeline_id_str] = render_lock

    cancelled_keys: list = []

    # Decide scope: a plain integer-looking key cancels variant N and (for
    # back-compat) any "N_X" meta version.  A key with an underscore targets
    # exactly that version.
    is_bare_variant = "_" not in job_key
    if is_bare_variant:
        # Cancel the standard job and every meta version of this variant
        for candidate_key in [job_key]:
            if _cancel_single_job(pipeline, pipeline_id, candidate_key, render_lock):
                cancelled_keys.append(candidate_key)
        try:
            _int_key = int(job_key)
            if _cancel_single_job(pipeline, pipeline_id, _int_key, render_lock):
                cancelled_keys.append(_int_key)
        except (ValueError, TypeError):
            pass
        for suffix in ("_A", "_B", "_C", "_D", "_E"):
            meta_key = f"{job_key}{suffix}"
            if _cancel_single_job(pipeline, pipeline_id, meta_key, render_lock):
                cancelled_keys.append(meta_key)
    else:
        if _cancel_single_job(pipeline, pipeline_id, job_key, render_lock):
            cancelled_keys.append(job_key)

    with _pipelines_lock:
        if pipeline_id not in _pipelines:
            _pipelines[pipeline_id] = pipeline

    _db_update_render_jobs(pipeline_id, pipeline.get("render_jobs", {}))

    logger.info(
        f"[Profile {profile.profile_id}] Cancelled pipeline={pipeline_id} "
        f"job_key={job_key!r} affected={cancelled_keys!r}"
    )

    return {
        "status": "cancelled",
        "pipeline_id": pipeline_id,
        "job_key": job_key,
        "cancelled_keys": [str(k) for k in cancelled_keys],
    }


@router.get("/{pipeline_id}/source-selection")
async def get_source_selection(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Return the stored source_video_ids for a given pipeline.

    Used by the frontend to restore the source video selection when reopening the page.
    Returns an empty list if the column does not exist yet (migration pending).
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")
    return {"source_video_ids": pipeline.get("source_video_ids", [])}


@router.put("/{pipeline_id}/source-selection")
async def update_source_selection(
    pipeline_id: str,
    request: SourceSelectionRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Save the selected source video IDs to in-memory state and DB.

    Called whenever the user changes their source video selection on the pipeline page.
    Gracefully degrades if the DB column does not exist yet (migration pending).
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    with _pipelines_lock:
        pipeline["source_video_ids"] = request.source_video_ids
        _pipelines[pipeline_id] = pipeline

    # Persist to DB — gracefully handle missing column (migration 021 not yet applied)
    db_persisted = False
    try:
        repo = get_repository()
        if repo:
            repo.update_pipeline(pipeline_id, {"source_video_ids": request.source_video_ids})
            db_persisted = True
    except Exception as e:
        logger.warning(f"Failed to save source selection for {pipeline_id}: {e}")

    return {"source_video_ids": request.source_video_ids, "db_persisted": db_persisted}


class PipelineUpdateScriptsRequest(BaseModel):
    """Request model for updating scripts in an existing pipeline."""
    scripts: List[str]


class MetaMultiplicationRequest(BaseModel):
    """Request model for persisting the Meta multiplication toggle."""
    enabled: bool


class SubtitleOverridesRequest(BaseModel):
    """Request model for persisting per-variant subtitle overrides.

    Keys are PreviewKey strings used frontend-side: "0", "1", "0_A", "0_B".
    Values are SubtitleSettings-shaped dicts in camelCase. An empty dict clears
    all overrides for this pipeline.
    """
    overrides: Dict[str, Dict[str, Any]]


@router.get("/{pipeline_id}/meta-multiplication")
async def get_meta_multiplication(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Return the stored Meta multiplication flag for a pipeline."""
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")
    return {"meta_multiplication": bool(pipeline.get("meta_multiplication", True))}


@router.put("/{pipeline_id}/meta-multiplication")
async def update_meta_multiplication(
    pipeline_id: str,
    request: MetaMultiplicationRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Persist the Meta multiplication toggle before render starts."""
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    with _pipelines_lock:
        pipeline["meta_multiplication"] = bool(request.enabled)
        _pipelines[pipeline_id] = pipeline

    _db_save_pipeline(pipeline_id, pipeline)
    return {"meta_multiplication": bool(request.enabled)}


@router.get("/{pipeline_id}/subtitle-overrides")
async def get_subtitle_overrides(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Return per-Meta-version subtitle style overrides for a pipeline.

    Response shape: {"A": {...}, "B": {...}, "default": {...}} — only keys
    with actual overrides are present. Legacy data is normalized on read so
    the frontend always receives the canonical shape.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")
    # Normalize on read: protects against pipelines touched directly in DB,
    # or racing legacy writes that bypassed _get_pipeline_or_load's path.
    normalized = _normalize_overrides(pipeline.get("subtitle_settings_by_key") or {})
    return {"overrides": normalized}


@router.put("/{pipeline_id}/subtitle-overrides")
async def update_subtitle_overrides(
    pipeline_id: str,
    request: SubtitleOverridesRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Persist per-variant subtitle overrides before render starts.

    The frontend calls this (debounced) whenever the user changes a subtitle
    style for a specific variant key. Storage is per-pipeline (not per-profile)
    because per-variant styling is a creative decision specific to this
    pipeline's content.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    # Validate key shape — after the per-Meta-version refactor, the only
    # legal keys are "A", "B", and "default". Reject anything else so stale
    # browser tabs sending legacy "0_A"/"1_B" keys fail loudly instead of
    # silently poisoning the stored shape.
    _key_pattern = _re.compile(r"^(A|B|default)$")
    for key in request.overrides.keys():
        if not isinstance(key, str) or not _key_pattern.match(key):
            raise HTTPException(status_code=400, detail=f"Invalid override key: {key!r}")

    with _pipelines_lock:
        # Empty dict from the client means "clear all overrides"
        pipeline["subtitle_settings_by_key"] = dict(request.overrides) if request.overrides else {}
        _pipelines[pipeline_id] = pipeline

    _db_save_pipeline(pipeline_id, pipeline)
    return {"overrides": pipeline["subtitle_settings_by_key"]}


@router.put("/{pipeline_id}/scripts")
async def update_pipeline_scripts(
    pipeline_id: str,
    request: PipelineUpdateScriptsRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Update scripts for an existing pipeline.

    Used by the frontend auto-save when the user edits script text in Step 2 (Review Scripts).
    Updates both in-memory cache and Supabase.
    """
    if not request.scripts:
        raise HTTPException(status_code=400, detail="scripts list cannot be empty")
    if len(request.scripts) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 scripts allowed")
    for i, script in enumerate(request.scripts):
        if len(script) > 5000:
            raise HTTPException(status_code=400, detail=f"Script {i+1} exceeds 5000 character limit ({len(script)} chars)")

    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found")

    # M1: Acquire pipeline state lock to prevent races with concurrent preview/render tasks
    state_lock = _get_pipeline_state_lock(pipeline_id)
    with state_lock:
        # Invalidate TTS and preview caches for scripts that changed
        # Compare cleaned text (tags stripped) — tag-only changes don't invalidate TTS
        old_scripts = pipeline.get("scripts", [])
        tts_previews = pipeline.setdefault("tts_previews", {})
        previews = pipeline.setdefault("previews", {})
        for i, new_script in enumerate(request.scripts):
            if i < len(old_scripts):
                old_cleaned = strip_product_group_tags(old_scripts[i])
                new_cleaned = strip_product_group_tags(new_script)
                if _stable_hash(new_cleaned) != _stable_hash(old_cleaned):
                    tts_previews.pop(str(i), None)
                    tts_previews.pop(i, None)
                    # Also invalidate Step 3 preview — stale audio/timeline
                    previews.pop(str(i), None)
                    previews.pop(i, None)
                    logger.info(f"Invalidated TTS + preview cache for pipeline {pipeline_id} variant {i} (script changed)")

        # Update scripts in memory
        pipeline["scripts"] = request.scripts
        pipeline["variant_count"] = len(request.scripts)

        # Clean up orphan TTS entries for removed script indices
        new_count = len(request.scripts)
        orphan_keys = []
        for k in list(tts_previews.keys()):
            try:
                if int(str(k)) >= new_count:
                    orphan_keys.append(k)
            except (ValueError, TypeError):
                orphan_keys.append(k)  # Remove invalid keys
        for k in orphan_keys:
            tts_previews.pop(k, None)

        # Clean up orphan segment_usage entries for removed script indices
        segment_usage = pipeline.get("segment_usage", {})
        orphan_seg_keys = []
        for k in list(segment_usage.keys()):
            try:
                if int(str(k)) >= new_count:
                    orphan_seg_keys.append(k)
            except (ValueError, TypeError):
                orphan_seg_keys.append(k)
        for k in orphan_seg_keys:
            segment_usage.pop(k, None)

    # Persist to DB — convert int keys to strings for JSONB compatibility
    try:
        repo = get_repository()
        if repo:
            tts_previews_json = {str(k): v for k, v in pipeline.get("tts_previews", {}).items()}
            previews_json = {str(k): v for k, v in pipeline.get("previews", {}).items()}
            segment_usage_json = {str(k): v for k, v in pipeline.get("segment_usage", {}).items()}
            repo.update_pipeline(pipeline_id, {
                "scripts": request.scripts,
                "variant_count": len(request.scripts),
                "tts_previews": tts_previews_json,
                "previews": previews_json,
                "segment_usage": segment_usage_json,
            })
    except Exception as e:
        logger.warning(f"Failed to update scripts for pipeline {pipeline_id} in DB: {e}")

    logger.info(
        f"[Profile {profile.profile_id}] Updated scripts for pipeline {pipeline_id} "
        f"({len(request.scripts)} scripts)"
    )

    return {"status": "updated", "pipeline_id": pipeline_id, "script_count": len(request.scripts)}


class PipelineRegenerateScriptRequest(BaseModel):
    """Request model for regenerating a single script via AI."""
    provider: str = "gemini"  # "gemini" or "claude"


class PipelineRegenerateScriptResponse(BaseModel):
    """Response model for single script regeneration."""
    status: str
    script: str
    variant_index: int


@router.post("/regenerate-script/{pipeline_id}/{variant_index}",
             response_model=PipelineRegenerateScriptResponse)
@limiter.limit("10/minute")
async def regenerate_script(
    request: Request,
    pipeline_id: str,
    variant_index: int,
    body: PipelineRegenerateScriptRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Regenerate a single script variant using AI.

    Re-uses the original pipeline's idea, context, and context_products.
    Generates 1 new variant and replaces the script at variant_index.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found")

    scripts = pipeline.get("scripts", [])
    if variant_index < 0 or variant_index >= len(scripts):
        raise HTTPException(
            status_code=400,
            detail=f"variant_index {variant_index} out of range (0-{len(scripts) - 1})"
        )

    if body.provider not in ["gemini", "claude"]:
        raise HTTPException(status_code=400, detail="provider must be 'gemini' or 'claude'")

    # Retrieve original generation context from pipeline
    idea = pipeline.get("idea", "")
    stored_products = pipeline.get("context_products", [])
    context_text = _build_effective_pipeline_context(
        pipeline.get("context", ""),
        stored_products,
    )
    if not idea:
        raise HTTPException(
            status_code=400,
            detail="Pipeline has no stored idea — cannot regenerate script"
        )

    # Fetch keywords and product groups, filtered by selected products if available
    repo = get_repository()
    unique_keywords = []
    product_groups_dict = {}

    # Use stored context_products from pipeline to filter keywords
    selected_product_titles = [p["title"] for p in stored_products if p.get("title")] if stored_products else []

    if repo:
        try:
            seg_filters = QueryFilters(select="keywords, product_group")
            if selected_product_titles:
                seg_filters.in_ = {"product_group": selected_product_titles}
            result = repo.list_segments(profile.profile_id, seg_filters)
            all_keywords = set()
            for seg in result.data:
                keywords_list = seg.get("keywords") or []
                pg = seg.get("product_group")
                for kw in keywords_list:
                    all_keywords.add(kw)
                    if pg:
                        if pg not in product_groups_dict:
                            product_groups_dict[pg] = set()
                        product_groups_dict[pg].add(kw)
            unique_keywords = sorted(all_keywords)
            product_groups_dict = {k: sorted(v) for k, v in product_groups_dict.items()}

            if selected_product_titles:
                logger.info(
                    f"[Profile {profile.profile_id}] Regenerate: filtered keywords by products: "
                    f"{selected_product_titles}"
                )
        except Exception as e:
            logger.warning(f"Failed to fetch keywords for script regeneration: {e}")

    # Fetch AI instructions
    ai_instructions = ""
    if repo:
        try:
            profile_row = repo.get_profile(profile.profile_id)
            if profile_row:
                ai_instructions = profile_row.get("ai_instructions") or ""
        except Exception as e:
            logger.warning(f"Failed to fetch AI instructions: {e}")

    # Use stored target_script_duration from the pipeline (user-specified desired output duration)
    stored_target_duration = pipeline.get("target_script_duration")

    # Do not inject full existing scripts into the prompt. In practice this can
    # leak stale product/model names from older variants back into regenerated
    # output. Keep only high-level constraints.
    other_scripts = [s for i, s in enumerate(scripts) if i != variant_index and (s or "").strip()]
    regen_context = context_text
    if other_scripts:
        regen_context += (
            "\n\n[IMPORTANT: Other variants already exist for this video. "
            "Generate a COMPLETELY DIFFERENT script with a different hook, "
            "structure, pacing, and CTA. Do NOT reuse recognizable phrases "
            "or named products from previous variants unless they are also "
            "present in the current product context.]"
        )

    allowed_titles = [p["title"] for p in stored_products if p.get("title")] if stored_products else []
    if allowed_titles:
        regen_context += (
            "\n\n[CRITICAL: If you mention any explicit product or model names, "
            "use only the products present in the current context: "
            + ", ".join(allowed_titles)
            + ". Do NOT introduce any other product names, SKUs, or models.]"
        )

    try:
        generator = get_script_generator_for_profile(profile.profile_id)
        new_scripts = await asyncio.to_thread(
            generator.generate_scripts,
            idea=idea,
            context=regen_context,
            keywords=unique_keywords,
            variant_count=1,
            provider=body.provider,
            product_groups=product_groups_dict if product_groups_dict else None,
            ai_instructions=ai_instructions,
            target_duration=stored_target_duration
        )

        if not new_scripts:
            raise HTTPException(status_code=500, detail="AI returned no script")

        new_script = new_scripts[0]

        # Update pipeline state
        with _get_pipeline_state_lock(pipeline_id):
            pipeline["scripts"][variant_index] = new_script

            # Invalidate TTS for this variant (script changed)
            tts_previews = pipeline.get("tts_previews", {})
            str_idx = str(variant_index)
            if str_idx in tts_previews:
                del tts_previews[str_idx]
            if variant_index in tts_previews:
                del tts_previews[variant_index]

            # Invalidate preview for this variant
            previews = pipeline.get("previews", {})
            if str_idx in previews:
                del previews[str_idx]
            if variant_index in previews:
                del previews[variant_index]

            pipeline_snapshot = dict(pipeline)

        # Persist to DB
        _db_save_pipeline(pipeline_id, pipeline_snapshot)

        logger.info(
            f"[Profile {profile.profile_id}] Regenerated script {variant_index} "
            f"in pipeline {pipeline_id} using {body.provider}"
        )

        return PipelineRegenerateScriptResponse(
            status="ok",
            script=new_script,
            variant_index=variant_index
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Script regeneration failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=503,
            detail="Script regeneration service unavailable. Please try again."
        )


class PipelineRenameRequest(BaseModel):
    """Request model for renaming a pipeline."""
    name: str = Field(..., max_length=200)


@router.patch("/{pipeline_id}/name")
async def rename_pipeline(
    pipeline_id: str,
    request: PipelineRenameRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Update the name of an existing pipeline."""
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found")

    pipeline["name"] = request.name

    try:
        repo = get_repository()
        if repo:
            repo.update_pipeline(pipeline_id, {"name": request.name})
    except Exception as e:
        logger.warning(f"Failed to update name for pipeline {pipeline_id} in DB: {e}")

    return {"status": "updated", "pipeline_id": pipeline_id, "name": request.name}


class TtsApproveRequest(BaseModel):
    approved: bool = True


@router.patch("/{pipeline_id}/tts-approve/{variant_index}")
async def approve_tts_variant(
    pipeline_id: str,
    variant_index: int,
    request: TtsApproveRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Mark a variant's TTS voice-over as approved/unapproved (Step 2 verification)."""
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found")

    tts_previews = pipeline.get("tts_previews", {})
    key = str(variant_index)
    if key not in tts_previews and variant_index not in tts_previews:
        raise HTTPException(status_code=404, detail=f"No TTS data for variant {variant_index}")

    # Update in-memory
    tts_data = tts_previews.get(key) or tts_previews.get(variant_index)
    tts_data["approved"] = request.approved

    # Persist to DB
    try:
        repo = get_repository()
        if repo:
            tts_previews_json = {str(k): v for k, v in dict(tts_previews).items()}
            repo.update_pipeline(pipeline_id, {"tts_previews": tts_previews_json})
    except Exception as e:
        logger.warning(f"Failed to persist TTS approval for pipeline {pipeline_id}: {e}")

    return {"status": "updated", "pipeline_id": pipeline_id, "variant_index": variant_index, "approved": request.approved}


@router.post("/import", response_model=PipelineGenerateResponse)
async def import_pipeline(
    request: PipelineImportRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Import scripts into a new pipeline without AI generation.

    Used by the history sidebar to reload scripts from a previous pipeline,
    optionally with a subset of the original scripts.
    """
    if not request.scripts:
        raise HTTPException(status_code=400, detail="scripts list cannot be empty")

    pipeline_id = str(uuid.uuid4())

    _evict_old_pipelines()
    with _pipelines_lock:
        _pipelines[pipeline_id] = {
            "pipeline_id": pipeline_id,
            "scripts": request.scripts,
            "provider": request.provider,
            "name": request.name,
            "idea": request.idea,
            "context": request.context,
            "context_products": [p.dict() for p in request.context_products],
            "variant_count": len(request.scripts),
            "keyword_count": 0,
            "previews": {},
            "render_jobs": {},
            "tts_previews": {},
            "preview_renders": {},
            "source_video_ids": [],
            "meta_multiplication": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "profile_id": profile.profile_id
        }
        pipeline_snapshot = dict(_pipelines[pipeline_id])

    _db_save_pipeline(pipeline_id, pipeline_snapshot)

    logger.info(
        f"[Profile {profile.profile_id}] Imported pipeline {pipeline_id} "
        f"with {len(request.scripts)} scripts"
    )

    return PipelineGenerateResponse(
        pipeline_id=pipeline_id,
        scripts=request.scripts,
        provider=request.provider,
        keyword_count=0,
        variant_count=len(request.scripts)
    )


@router.post("/generate", response_model=PipelineGenerateResponse)
@limiter.limit("5/minute")
async def generate_pipeline(
    request: Request,
    body: PipelineGenerateRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Generate N script variants and create a pipeline.

    This is step 1 of the multi-variant workflow: create scripts with AI.
    Next steps: preview each variant, then batch-render selected variants.
    """
    # Validate input
    if body.variant_count < 1 or body.variant_count > 10:
        raise HTTPException(
            status_code=400,
            detail="variant_count must be between 1 and 10"
        )

    if body.provider not in ["gemini", "claude"]:
        raise HTTPException(
            status_code=400,
            detail="provider must be 'gemini' or 'claude'"
        )

    if not body.idea.strip():
        raise HTTPException(
            status_code=400,
            detail="idea cannot be empty"
        )

    # Fetch unique keywords from editai_segments table, grouped by product_group
    # When context_products are selected, filter to only those product groups
    repo = get_repository()
    unique_keywords = []
    product_groups_dict = {}  # {group_label: [keywords]}

    # Build product filter from selected catalog products
    selected_product_titles = [p.title for p in body.context_products] if body.context_products else []

    if repo:
        try:
            seg_filters = QueryFilters(select="keywords, product_group")
            # Filter segments to only the selected product groups
            if selected_product_titles:
                seg_filters.in_ = {"product_group": selected_product_titles}
            result = repo.list_segments(profile.profile_id, seg_filters)

            # Flatten and deduplicate keywords, and group by product_group
            all_keywords = set()
            for seg in result.data:
                keywords_list = seg.get("keywords") or []
                pg = seg.get("product_group")
                for kw in keywords_list:
                    all_keywords.add(kw)
                    if pg:
                        if pg not in product_groups_dict:
                            product_groups_dict[pg] = set()
                        product_groups_dict[pg].add(kw)

            unique_keywords = sorted(all_keywords)
            # Convert sets to sorted lists
            product_groups_dict = {k: sorted(v) for k, v in product_groups_dict.items()}

            if selected_product_titles:
                logger.info(
                    f"[Profile {profile.profile_id}] Filtered keywords by selected products: "
                    f"{selected_product_titles}"
                )

        except Exception as e:
            logger.warning(f"Failed to fetch keywords from database: {e}")
    else:
        logger.warning("Repository not available, continuing without keywords")

    # Compute total segment duration using shared helper
    total_segment_duration = _compute_segment_duration(profile.profile_id)

    logger.info(
        f"[Profile {profile.profile_id}] Fetched {len(unique_keywords)} unique keywords, "
        f"{len(product_groups_dict)} product groups, "
        f"total segment duration: {total_segment_duration:.1f}s"
    )

    # Fetch AI instructions from profile
    ai_instructions = ""
    if repo:
        try:
            profile_row = repo.get_profile(profile.profile_id)
            if profile_row:
                ai_instructions = profile_row.get("ai_instructions") or ""
        except Exception as e:
            logger.warning(f"Failed to fetch AI instructions for profile {profile.profile_id}: {e}")

    # Generate scripts
    logger.info(
        f"[Profile {profile.profile_id}] Generating pipeline with {body.variant_count} variants "
        f"using {body.provider}"
    )

    try:
        generator = get_script_generator_for_profile(profile.profile_id)
        # SCR-03: Run synchronous AI call in a thread to avoid blocking the async event loop
        effective_context = _build_effective_pipeline_context(
            body.context,
            body.context_products,
        )

        scripts = await asyncio.to_thread(
            generator.generate_scripts,
            idea=body.idea,
            context=effective_context,
            keywords=unique_keywords,
            variant_count=body.variant_count,
            provider=body.provider,
            product_groups=product_groups_dict if product_groups_dict else None,
            ai_instructions=ai_instructions,
            target_duration=body.target_script_duration
        )

        # Generate pipeline ID
        pipeline_id = str(uuid.uuid4())

        # Store pipeline state (with eviction)
        _evict_old_pipelines()
        with _pipelines_lock:
            _pipelines[pipeline_id] = {
                "pipeline_id": pipeline_id,
                "scripts": scripts,
                "provider": body.provider,
                "name": body.name,
                "idea": body.idea,
                "context": body.context,
                "context_products": [p.dict() for p in body.context_products],
                "variant_count": len(scripts),
                "keyword_count": len(unique_keywords),
                "previews": {},
                "tts_previews": {},
                "segment_usage": {},
                "preview_renders": {},
                "render_jobs": {},
                "meta_multiplication": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "profile_id": profile.profile_id,
                "target_script_duration": body.target_script_duration
            }
            pipeline_snapshot = dict(_pipelines[pipeline_id])

        # Persist to DB
        _db_save_pipeline(pipeline_id, pipeline_snapshot)

        logger.info(
            f"[Profile {profile.profile_id}] Created pipeline {pipeline_id} "
            f"with {len(scripts)} scripts"
        )

        return PipelineGenerateResponse(
            pipeline_id=pipeline_id,
            scripts=scripts,
            provider=body.provider,
            keyword_count=len(unique_keywords),
            variant_count=len(scripts),
            total_segment_duration=round(total_segment_duration, 1)
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # SCR-11: Log detailed error server-side but return sanitized message to client
        logger.error(f"Pipeline generation failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=503,
            detail="Pipeline generation service unavailable. Please try again later."
        )


@router.get("/segment-duration")
async def get_segment_duration(
    profile: ProfileContext = Depends(get_profile_context)
):
    """Return total duration (seconds) of all segments for the current profile."""
    total = _compute_segment_duration(profile.profile_id)
    return {"total_segment_duration": total}


class PipelineTtsRequest(BaseModel):
    """Request model for per-script TTS generation."""
    elevenlabs_model: str = "eleven_flash_v2_5"
    voice_id: Optional[str] = None
    voice_settings: Optional[Dict[str, Any]] = None
    words_per_subtitle: int = Field(default=2, ge=1, le=20)  # BUG-PR-19


class PipelineTtsResponse(BaseModel):
    """Response model for per-script TTS generation."""
    status: str
    audio_duration: float
    srt_content: Optional[str] = None
    script_word_count: Optional[int] = None
    srt_word_count: Optional[int] = None


class PipelineTtsFromLibraryRequest(BaseModel):
    """Request model for adopting a TTS library asset into the pipeline."""
    asset_id: str


@router.post("/tts-from-library/{pipeline_id}/{variant_index}", response_model=PipelineTtsResponse)
async def adopt_library_tts(
    pipeline_id: str,
    variant_index: int,
    request: PipelineTtsFromLibraryRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Adopt a TTS library asset into the pipeline for a specific variant.

    Skips TTS generation by reusing an existing voice-over from the TTS library.
    The adopted audio is stored in pipeline["tts_previews"] with the same shape
    as generated TTS, plus a library_asset_id flag.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    if variant_index < 0 or variant_index >= len(pipeline["scripts"]):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid variant_index: {variant_index}"
        )

    # Fetch the TTS asset from the library. Plan 81-02 cleanup: get_repository() never
    # returns None under DATA_BACKEND=sqlite (FUNC-01) so the legacy `if not repo: raise 503`
    # guard was dead code and has been removed (mirrors Phase 80 80-02 dead-guard cleanup).
    repo = get_repository()
    try:
        asset = repo.get_tts_asset(request.asset_id)
    except Exception as e:
        logger.error(f"Failed to fetch TTS asset: {e}")
        raise HTTPException(status_code=404, detail="TTS asset not found in library")

    # T-81-01-01 IDOR mitigation: verify profile ownership + ready status
    if (
        not asset
        or asset.get("profile_id") != profile.profile_id
        or asset.get("status") != "ready"
    ):
        raise HTTPException(status_code=404, detail="TTS asset not found in library")
    audio_path = asset.get("mp3_path")
    if not audio_path or not Path(audio_path).exists():
        raise HTTPException(status_code=404, detail="TTS audio file no longer exists on disk")

    audio_duration = asset.get("audio_duration", 0.0)
    script_text = pipeline["scripts"][variant_index]

    # Store into pipeline tts_previews with library flag (protected by state lock)
    state_lock = _get_pipeline_state_lock(pipeline_id)
    with state_lock:
        if "tts_previews" not in pipeline:
            pipeline["tts_previews"] = {}

        pipeline["tts_previews"][variant_index] = {
            "audio_path": audio_path,
            "audio_duration": audio_duration,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "script_hash": _stable_hash(script_text),
            "voice_settings": None,  # Not applicable for library audio
            "library_asset_id": request.asset_id,
            "srt_content": asset.get("srt_content"),
            "tts_timestamps": asset.get("tts_timestamps"),
        }

        # Invalidate Step 3 preview cache for this variant
        previews = pipeline.get("previews", {})
        if variant_index in previews or str(variant_index) in previews:
            previews.pop(variant_index, None)
            previews.pop(str(variant_index), None)
            logger.info(f"Invalidated Step 3 preview cache for variant {variant_index} (TTS changed via library)")

    # Persist to DB (outside lock)
    _db_save_pipeline(pipeline_id, pipeline)

    logger.info(
        f"[Profile {profile.profile_id}] Adopted library TTS asset {request.asset_id} "
        f"for pipeline {pipeline_id} variant {variant_index} ({audio_duration:.1f}s)"
    )

    return PipelineTtsResponse(
        status="ok",
        audio_duration=audio_duration
    )


@router.post("/tts/{pipeline_id}/{variant_index}", response_model=PipelineTtsResponse)
async def generate_variant_tts(
    pipeline_id: str,
    variant_index: int,
    request: PipelineTtsRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Generate TTS audio for a single script variant without segment matching.

    Lightweight endpoint for Step 2 per-script voice-over preview.
    Stores result in pipeline["tts_previews"] for later playback.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    if variant_index < 0 or variant_index >= len(pipeline["scripts"]):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid variant_index: {variant_index}. Must be between 0 and {len(pipeline['scripts']) - 1}"
        )

    script_text = pipeline["scripts"][variant_index]
    # Strip [ProductGroup] tags before TTS — tags must not be spoken
    cleaned_text = strip_product_group_tags(script_text)

    logger.info(
        f"[Profile {profile.profile_id}] Generating TTS for pipeline {pipeline_id} variant {variant_index}"
    )

    try:
        assembly_service = get_assembly_service()

        # Bust TTS file cache so ElevenLabs is re-called with fresh audio.
        # Without this, cache_lookup returns the same audio for identical params,
        # making "Regenerate Voice-over" produce the exact same result.
        # IMPORTANT: cache key must match exactly what elevenlabs.py constructs
        # in generate_audio_with_timestamps (provider="elevenlabs", type="with_timestamps").
        from app.services.tts_cache import cache_delete
        from app.services.tts.elevenlabs import ElevenLabsTTSService
        _tts_svc = ElevenLabsTTSService(
            output_dir=Path("."), model_id=request.elevenlabs_model,
            profile_id=profile.profile_id
        )
        _effective_voice = request.voice_id or _tts_svc._voice_id
        ALLOWED_VOICE_KEYS = {"stability", "similarity_boost", "style", "use_speaker_boost", "speed"}
        _vs = {k: v for k, v in (request.voice_settings or {}).items() if k in ALLOWED_VOICE_KEYS}
        # Build voice_settings exactly as elevenlabs.py does (using its defaults for missing keys)
        _full_vs = {
            "stability": _vs.get("stability", _tts_svc.voice_settings["stability"]),
            "similarity_boost": _vs.get("similarity_boost", _tts_svc.voice_settings["similarity_boost"]),
            "style": _vs.get("style", _tts_svc.voice_settings["style"]),
            "speed": _vs.get("speed", _tts_svc.voice_settings.get("speed", 1.0)),
        }
        _cache_key = {
            "text": cleaned_text, "voice_id": _effective_voice,
            "model_id": request.elevenlabs_model, "provider": "elevenlabs",
            "type": "with_timestamps",
            "vs": f"{_full_vs['stability']:.2f}_{_full_vs['similarity_boost']:.2f}_{_full_vs['style']:.2f}_{_full_vs['speed']:.2f}"
        }
        if cache_delete(_cache_key, "elevenlabs"):
            logger.info(f"[Profile {profile.profile_id}] Busted TTS file cache for variant {variant_index}")

        audio_path, audio_duration, _timestamps = await assembly_service.generate_tts_with_timestamps(
            script_text=cleaned_text,
            profile_id=profile.profile_id,
            elevenlabs_model=request.elevenlabs_model,
            voice_id=request.voice_id,
            voice_settings=request.voice_settings
        )

        # Generate SRT from timestamps for subtitle preview
        srt_content = None
        script_word_count = None
        srt_word_count = None
        if _timestamps:
            wpf = request.words_per_subtitle or 2
            srt_content = await assembly_service.generate_srt_from_timestamps(
                _timestamps,
                max_words_per_phrase=wpf
            )
            # Populate SRT cache so Step 3 preview_matches finds a hit
            # (prevents unnecessary TTS regeneration that produces different audio)
            if srt_content:
                from app.services.tts_cache import srt_cache_store
                _srt_cache_key = {
                    "text": cleaned_text,
                    "voice_id": request.voice_id or "",
                    "model_id": request.elevenlabs_model,
                    "provider": "elevenlabs_ts",
                    "wpf": wpf
                }
                srt_cache_store(_srt_cache_key, srt_content, provider_dir="elevenlabs_ts")
            # Count words in script vs SRT for validation
            script_word_count = len(cleaned_text.split())
            if srt_content:
                srt_word_count = sum(
                    len(line.split())
                    for line in srt_content.split('\n')
                    if line.strip() and not line.strip().isdigit() and '-->' not in line
                )
            else:
                srt_word_count = 0

        # Store TTS preview result (protected by state lock)
        # Use cleaned_text hash so tag changes don't invalidate audio cache
        state_lock = _get_pipeline_state_lock(pipeline_id)
        with state_lock:
            if "tts_previews" not in pipeline:
                pipeline["tts_previews"] = {}

            # Clean up old TTS audio files before overwriting.
            # ONLY clean temp/ directories — never touch media/tts/ (library storage).
            old_tts = pipeline["tts_previews"].get(variant_index)
            if old_tts:
                old_path_str = old_tts.get("audio_path") or ""
                old_path = Path(old_path_str) if old_path_str else None
                if old_path and old_path.exists() and old_path != audio_path and "temp" in old_path.parts:
                    old_dir = old_path.parent
                    for f in old_dir.iterdir():
                        try:
                            f.unlink()
                        except OSError:
                            pass
                    try:
                        old_dir.rmdir()
                    except OSError:
                        pass
                    logger.info(f"Cleaned up old TTS temp dir: {old_dir}")

            pipeline["tts_previews"][variant_index] = {
                "audio_path": str(audio_path),
                "audio_duration": audio_duration,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "script_hash": _stable_hash(cleaned_text),
                "voice_settings": request.voice_settings,
                "words_per_subtitle": request.words_per_subtitle,
                "srt_content": srt_content,
                "script_word_count": script_word_count,
                "srt_word_count": srt_word_count,
            }

            # Invalidate Step 3 preview cache for this variant so /audio/ endpoint
            # serves the fresh TTS instead of stale Step 3 audio
            previews = pipeline.get("previews", {})
            if variant_index in previews or str(variant_index) in previews:
                previews.pop(variant_index, None)
                previews.pop(str(variant_index), None)
                logger.info(f"Invalidated Step 3 preview cache for variant {variant_index} (TTS regenerated)")

        # Auto-save to TTS Library (media/tts/ fallback) so audio persists beyond
        # temp/ cleanup. Same pattern used by assemble_and_render.
        _persist_path, _lib_asset_id = _persist_tts_audio(
            profile_id=profile.profile_id,
            cleaned_text=cleaned_text,
            audio_path=str(audio_path),
            srt_content=srt_content,
            timestamps=_timestamps,
            model=request.elevenlabs_model,
            duration=audio_duration,
            voice_id=request.voice_id,
        )
        if _persist_path != str(audio_path) or _lib_asset_id:
            with state_lock:
                pipeline["tts_previews"][variant_index]["audio_path"] = _persist_path
                if _lib_asset_id:
                    pipeline["tts_previews"][variant_index]["library_asset_id"] = _lib_asset_id

        # Persist to DB (outside lock)
        logger.info(
            f"[Profile {profile.profile_id}] Saving TTS for variant {variant_index}: "
            f"audio_path={pipeline['tts_previews'][variant_index].get('audio_path')}, duration={audio_duration:.2f}s"
        )
        _db_save_pipeline(pipeline_id, pipeline)

        return PipelineTtsResponse(
            status="ok",
            audio_duration=audio_duration,
            srt_content=srt_content,
            script_word_count=script_word_count,
            srt_word_count=srt_word_count
        )

    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] TTS generation failed for variant {variant_index}: {e}")
        raise HTTPException(status_code=500, detail="TTS generation failed")


@router.get("/tts-audio/{pipeline_id}/{variant_index}")
async def get_variant_tts_audio(
    pipeline_id: str,
    variant_index: int,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Stream the TTS preview audio for a specific pipeline variant.

    Reads from tts_previews (Step 2 per-script TTS) rather than previews (Step 3 full preview).
    """
    # Fast path: check in-memory cache first, fall back to DB load via thread
    with _pipelines_lock:
        pipeline = _pipelines.get(pipeline_id)
    if not pipeline:
        pipeline = await asyncio.to_thread(_get_pipeline_or_load, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    _restore_missing_tts_audio_paths(pipeline_id, pipeline)

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    tts_preview = pipeline.get("tts_previews", {}).get(variant_index)
    if not tts_preview:
        raise HTTPException(status_code=404, detail="No TTS preview available for this variant")

    audio_path_str = tts_preview.get("audio_path")
    if not audio_path_str:
        raise HTTPException(status_code=404, detail="No audio file for this variant")

    audio_path = Path(audio_path_str)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file no longer exists on disk")

    return FileResponse(
        path=str(audio_path),
        media_type="audio/mpeg",
        content_disposition_type="inline",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )


@router.post("/preview/{pipeline_id}/{variant_index}", response_model=PipelinePreviewResponse)
async def preview_variant(
    pipeline_id: str,
    variant_index: int,
    profile: ProfileContext = Depends(get_profile_context),
    elevenlabs_model: str = Body("eleven_flash_v2_5", embed=True),
    voice_id: Optional[str] = Body(None, embed=True),
    source_video_ids: Optional[List[str]] = Body(None, embed=True),
    voice_settings: Optional[Dict[str, Any]] = Body(None, embed=True),
    words_per_subtitle: int = Body(2, embed=True),
    min_segment_duration: float = Body(3.0, embed=True),
    ultra_rapid_intro: bool = Body(True, embed=True),
    preset: str = Body("balanced", embed=True),  # F8: scoring preset
    visual_version: Optional[str] = Body(None, embed=True),
    force_regenerate_tts: bool = Body(False, embed=True)
):
    """
    Preview segment matching for a single variant.

    Runs TTS, SRT generation, and keyword matching without expensive render.
    This is step 2 of the workflow: preview before rendering.
    """
    # Validate pipeline exists (with DB fallback)
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    # Validate ownership
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    # Validate variant index
    if variant_index < 0 or variant_index >= len(pipeline["scripts"]):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid variant_index: {variant_index}. Must be between 0 and {len(pipeline['scripts']) - 1}"
        )

    preview_key, effective_variant_index, _subtitle_override, normalized_visual_version, meta_platform = _resolve_meta_preview_variant(
        variant_index,
        visual_version,
    )
    script_text = pipeline["scripts"][variant_index]
    cleaned_text = strip_product_group_tags(script_text)

    logger.info(
        f"[Profile {profile.profile_id}] Previewing pipeline {pipeline_id} variant {variant_index}"
        f"{f' version {normalized_visual_version}/{meta_platform}' if normalized_visual_version and meta_platform else ''}"
    )

    # Check if TTS audio already exists from Step 2 preview
    # When force_regenerate_tts is True, skip cache to generate fresh audio
    if force_regenerate_tts:
        logger.info(
            f"[Profile {profile.profile_id}] Force TTS regeneration for variant {variant_index}"
        )
        # Clear in-memory TTS preview so assembly_service doesn't reuse it
        _tts_previews_dict = pipeline.get("tts_previews", {})
        _tts_previews_dict.pop(variant_index, None)
        _tts_previews_dict.pop(str(variant_index), None)

        # Also bust file-based TTS cache (same key format as elevenlabs.py)
        from app.services.tts_cache import cache_delete
        from app.services.tts.elevenlabs import ElevenLabsTTSService
        _tts_svc = ElevenLabsTTSService(
            output_dir=Path("."), model_id=elevenlabs_model,
            profile_id=profile.profile_id
        )
        _effective_voice = voice_id or _tts_svc._voice_id
        ALLOWED_VOICE_KEYS = {"stability", "similarity_boost", "style", "use_speaker_boost", "speed"}
        _vs = {k: v for k, v in (voice_settings or {}).items() if k in ALLOWED_VOICE_KEYS}
        _full_vs = {
            "stability": _vs.get("stability", _tts_svc.voice_settings["stability"]),
            "similarity_boost": _vs.get("similarity_boost", _tts_svc.voice_settings["similarity_boost"]),
            "style": _vs.get("style", _tts_svc.voice_settings["style"]),
            "speed": _vs.get("speed", _tts_svc.voice_settings.get("speed", 1.0)),
        }
        _cache_key = {
            "text": cleaned_text, "voice_id": _effective_voice,
            "model_id": elevenlabs_model, "provider": "elevenlabs",
            "type": "with_timestamps",
            "vs": f"{_full_vs['stability']:.2f}_{_full_vs['similarity_boost']:.2f}_{_full_vs['style']:.2f}_{_full_vs['speed']:.2f}"
        }
        if cache_delete(_cache_key, "elevenlabs"):
            logger.info(f"[Profile {profile.profile_id}] Busted TTS file cache for variant {variant_index}")

    # Normalize key lookup: prefer int key, fall back to str for legacy entries
    _tts_previews = pipeline.get("tts_previews", {})
    existing_tts = _tts_previews.get(variant_index) or _tts_previews.get(str(variant_index))
    reuse_audio_path = None
    reuse_audio_duration = None
    reuse_srt_content = None
    if existing_tts:
        # Verify script hasn't changed since TTS was generated
        # TTS hashes use cleaned text (tags stripped) so tag edits don't invalidate
        stored_hash = existing_tts.get("script_hash")
        current_hash = _stable_hash(cleaned_text)
        script_match = stored_hash == current_hash
        if not script_match:
            logger.info(
                f"[Profile {profile.profile_id}] TTS reuse SKIP for variant {variant_index}: "
                f"script_hash mismatch (stored={stored_hash}, current={current_hash})"
            )
        # Trust Step 2 TTS if script matches — the user explicitly generated this audio,
        # so preview must use it regardless of voice_settings differences.
        # Voice_settings check was causing false negatives and making the preview
        # fall back to file cache which returned stale audio.
        if script_match:
            audio_path_str = existing_tts.get("audio_path")
            if not (audio_path_str and Path(audio_path_str).exists()):
                # Self-heal: the temp file may be gone but a persistent library
                # copy usually exists — reattach it instead of regenerating TTS.
                if _restore_missing_tts_audio_paths(pipeline_id, pipeline):
                    _tts_previews = pipeline.get("tts_previews", {})
                    existing_tts = _tts_previews.get(variant_index) or _tts_previews.get(str(variant_index)) or existing_tts
                    audio_path_str = existing_tts.get("audio_path")
            if audio_path_str and Path(audio_path_str).exists() and Path(audio_path_str).stat().st_size > 100:
                reuse_audio_path = audio_path_str
                reuse_audio_duration = existing_tts.get("audio_duration")
                # Also grab SRT content from Step 2 to avoid TTS regeneration
                stored_srt = existing_tts.get("srt_content")
                stored_wpf = existing_tts.get("words_per_subtitle")
                if stored_srt and stored_wpf == words_per_subtitle:
                    reuse_srt_content = stored_srt
                logger.info(
                    f"[Profile {profile.profile_id}] Reusing Step 2 TTS audio for variant {variant_index}"
                    f"{' (with SRT)' if reuse_srt_content else ' (SRT not available)'}"
                )
            else:
                logger.info(
                    f"[Profile {profile.profile_id}] TTS reuse SKIP for variant {variant_index}: "
                    f"audio_path missing or not on disk (path={audio_path_str})"
                )

    try:
        assembly_service = get_assembly_service()

        # M2: Cross-variant deprioritization: read segment_usage under state lock
        avoid_ids = set()
        state_lock = _get_pipeline_state_lock(pipeline_id)
        with state_lock:
            segment_usage_snapshot = dict(pipeline.get("segment_usage", {}))
        for other_idx, used_set in segment_usage_snapshot.items():
            if str(other_idx) != preview_key:
                avoid_ids.update(used_set)

        if normalized_visual_version:
            current_meta_idx = next(
                (i for i in range(len(META_PROFILES)) if get_version_label(i) == normalized_visual_version),
                None,
            )
            if current_meta_idx and current_meta_idx > 0:
                for prev_idx in range(current_meta_idx):
                    previous_key = _build_preview_key(variant_index, get_version_label(prev_idx))
                    previous_used = segment_usage_snapshot.get(previous_key) or []
                    avoid_ids.update(previous_used)

        # Persistent diversity: deprioritize segments with usage_count > 0
        try:
            repo = _get_data_repository()
            if repo:
                seg_filters = QueryFilters(
                    gt={"usage_count": 0},
                    select="id",
                )
                if source_video_ids:
                    seg_filters.in_ = {"source_video_id": source_video_ids}
                _used_before = repo.list_segments(profile.profile_id, seg_filters)
                if _used_before.data:
                    previously_used = {s["id"] for s in _used_before.data}
                    avoid_ids.update(previously_used)
                    logger.info(
                        f"[Profile {profile.profile_id}] Variant {preview_key}: "
                        f"deprioritizing {len(previously_used)} previously-used segments"
                    )
        except Exception as e:
            logger.warning(f"Failed to load segment usage history: {e}")

        if avoid_ids:
            logger.info(
                f"[Profile {profile.profile_id}] Variant {preview_key}: "
                f"total deprioritized segments: {len(avoid_ids)}"
            )

        preview_data = await assembly_service.preview_matches(
            script_text=script_text,
            profile_id=profile.profile_id,
            elevenlabs_model=elevenlabs_model,
            voice_id=voice_id,
            source_video_ids=source_video_ids,
            variant_index=effective_variant_index,
            reuse_audio_path=reuse_audio_path,
            reuse_audio_duration=reuse_audio_duration,
            voice_settings=voice_settings,
            max_words_per_phrase=words_per_subtitle,
            min_segment_duration=min_segment_duration,
            avoid_segment_ids=avoid_ids if avoid_ids else None,
            ultra_rapid_intro=ultra_rapid_intro,
            reuse_srt_content=reuse_srt_content,
            preset=preset,
        )

        # Track which segments this variant used (for cross-variant deprioritization)
        used_segment_ids = list({
            m["segment_id"] for m in preview_data.get("matches", [])
            if m.get("segment_id")
        })

        # Persist freshly generated TTS out of temp/ BEFORE storing its path —
        # temp/ is cleaned up on restart, and a temp path in tts_previews later
        # breaks /render-preview with "TTS audio file missing from disk".
        _persisted_audio_path: Optional[str] = None
        _persisted_asset_id: Optional[str] = None
        _fresh_audio_path = preview_data.get("audio_path", "")
        if not reuse_audio_path and _fresh_audio_path:
            _persisted_audio_path, _persisted_asset_id = _persist_tts_audio(
                profile_id=profile.profile_id,
                cleaned_text=cleaned_text,
                audio_path=str(_fresh_audio_path),
                srt_content=preview_data.get("srt_content"),
                timestamps=None,
                model=elevenlabs_model,
                duration=preview_data.get("audio_duration", 0.0),
                voice_id=voice_id,
            )

        # BUG-PR-20: Reuse state_lock from above (already obtained), single acquisition for all writes
        with state_lock:
            pipeline.setdefault("segment_usage", {})[preview_key] = used_segment_ids

            # Store preview result in pipeline state
            pipeline["previews"][preview_key] = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "elevenlabs_model": elevenlabs_model,
                "visual_version": normalized_visual_version,
                "meta_platform": meta_platform,
                "preview_data": preview_data
            }

            # Persist SRT content into tts_previews so Step 3 render can reuse it
            # without calling ElevenLabs a second time just to get subtitle timestamps.
            if "tts_previews" not in pipeline:
                pipeline["tts_previews"] = {}
            if variant_index not in pipeline["tts_previews"]:
                pipeline["tts_previews"][variant_index] = {}
            pipeline["tts_previews"][variant_index]["srt_content"] = preview_data.get("srt_content", "")
            pipeline["tts_previews"][variant_index]["words_per_subtitle"] = words_per_subtitle
            # Also persist audio info from preview_data if tts_previews was empty
            # (covers the case where Step 2 standalone TTS was skipped entirely)
            if not pipeline["tts_previews"][variant_index].get("audio_path"):
                pipeline["tts_previews"][variant_index]["audio_path"] = _persisted_audio_path or _fresh_audio_path
                pipeline["tts_previews"][variant_index]["audio_duration"] = preview_data.get("audio_duration", 0.0)
                pipeline["tts_previews"][variant_index]["script_hash"] = _stable_hash(cleaned_text)
                pipeline["tts_previews"][variant_index]["timestamp"] = datetime.now(timezone.utc).isoformat()
                if _persisted_asset_id:
                    pipeline["tts_previews"][variant_index]["library_asset_id"] = _persisted_asset_id

        # Persist to DB (outside lock — DB I/O should not hold the state lock)
        _db_save_pipeline(pipeline_id, pipeline)

        # Convert matches to MatchPreview models
        matches = [
            MatchPreview(
                srt_index=m["srt_index"],
                srt_text=m["srt_text"],
                srt_start=m["srt_start"],
                srt_end=m["srt_end"],
                segment_id=m["segment_id"],
                segment_keywords=m["segment_keywords"],
                matched_keyword=m["matched_keyword"],
                confidence=m["confidence"],
                is_auto_filled=m.get("is_auto_filled", False),
                source_video_id=m.get("source_video_id"),
                segment_start_time=m.get("segment_start_time"),
                segment_end_time=m.get("segment_end_time"),
                thumbnail_path=m.get("thumbnail_path"),
                merge_group=m.get("merge_group"),
                merge_group_duration=m.get("merge_group_duration"),
                transforms=m.get("transforms"),
                explanation=m.get("explanation"),
                pinned=m.get("pinned", False),
            )
            for m in preview_data.get("matches", [])
        ]

        return PipelinePreviewResponse(
            audio_duration=preview_data.get("audio_duration", 0.0),
            srt_content=preview_data.get("srt_content", ""),
            matches=matches,
            total_phrases=preview_data.get("total_phrases", 0),
            matched_count=preview_data.get("matched_count", 0),
            unmatched_count=preview_data.get("unmatched_count", 0),
            available_segments=preview_data.get("available_segments", [])
        )

    except ValueError as e:
        logger.warning(f"[Profile {profile.profile_id}] Preview bad request for variant {variant_index}: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        # Log the full traceback server-side — a bare message masked a NameError
        # here once and surfaced only as an opaque "Preview service unavailable".
        # The traceback (with profile + variant) is the correlation aid; the
        # client message stays opaque so internal details aren't disclosed.
        logger.error(
            f"[Profile {profile.profile_id}] Preview failed for variant {variant_index}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=503, detail="Preview service unavailable")


@router.post("/check-render/{pipeline_id}", response_model=RenderCheckResponse)
@limiter.limit("10/minute")
async def check_render_skip(
    request: Request,
    pipeline_id: str,
    render_request: PipelineRenderRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Check which variants can skip re-rendering because they already have
    a valid render with identical parameters (matching fingerprint + file exists).
    Call this before /render to offer the user a skip option.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # Build a set of soft-deleted clip IDs so we don't offer skip for deleted clips
    _deleted_clip_ids: set = set()
    repo_chk = get_repository()
    _render_jobs = pipeline.get("render_jobs", {})
    _clip_ids_to_check = [
        j.get("clip_id") for j in _render_jobs.values()
        if isinstance(j, dict) and j.get("clip_id")
    ]
    if _clip_ids_to_check:
        try:
            # Option A: list_clips_by_profile with in_ filter on id + eq is_deleted=True
            # Both backends honor in_ on arbitrary columns (sqlite via _apply_filters,
            # Supabase via .in_() chain). Plan 81-02 Task 1.A.
            _del_result = repo_chk.list_clips_by_profile(
                profile.profile_id,
                QueryFilters(
                    in_={"id": _clip_ids_to_check},
                    eq={"is_deleted": True},
                    select="id",
                ),
            )
            _deleted_clip_ids = {r["id"] for r in (_del_result.data or [])}
        except Exception as _del_err:
            logger.warning(f"Failed to check deleted clips: {_del_err}")

    results: List[RenderCheckResult] = []
    for vid in render_request.variant_indices:
        if vid < 0 or vid >= len(pipeline["scripts"]):
            results.append(RenderCheckResult(
                variant_index=vid, can_skip=False, reason="invalid_index"
            ))
            continue

        script_text = pipeline["scripts"][vid]
        # Standard (non-meta) flow: fingerprint includes the bare variant key
        # so per-key subtitle overrides for "0" are picked up.
        new_fingerprint = _compute_render_fingerprint(
            render_request, vid, script_text, job_key=vid
        )

        # For meta multiplication, check ALL versions (A and B must both exist and match)
        if render_request.meta_multiplication:
            _all_meta_ok = True
            for _chk_ver_idx in range(len(META_PROFILES)):
                _chk_key = f"{vid}_{get_version_label(_chk_ver_idx)}"
                _chk_job = pipeline.get("render_jobs", {}).get(_chk_key)
                if not _chk_job or _chk_job.get("status") != "completed":
                    _all_meta_ok = False
                    break
                _chk_video = _chk_job.get("final_video_path")
                if not _chk_video or not Path(_chk_video).exists():
                    _all_meta_ok = False
                    break
                # BUG-FIX: Check if the library clip was soft-deleted
                _chk_clip_id = _chk_job.get("clip_id")
                if _chk_clip_id and _chk_clip_id in _deleted_clip_ids:
                    _all_meta_ok = False
                    break
                # Recompute the meta-derived fingerprint per version-specific
                # key so per-key subtitle overrides AND match-overrides for
                # "0_A" / "0_B" are factored in. Then apply the same offset
                # suffix the render path uses, so the comparison matches.
                _chk_meta_fingerprint = _compute_render_fingerprint(
                    render_request,
                    vid,
                    script_text,
                    job_key=_chk_key,
                    visual_version=get_version_label(_chk_ver_idx),
                )
                _chk_fp = hashlib.sha256(
                    f"{_chk_meta_fingerprint}:meta_ver={get_version_label(_chk_ver_idx)}:offset={META_PROFILES[_chk_ver_idx].segment_offset}".encode()
                ).hexdigest()[:32]
                if _chk_job.get("render_fingerprint") != _chk_fp:
                    _all_meta_ok = False
                    break
            if _all_meta_ok:
                results.append(RenderCheckResult(
                    variant_index=vid, can_skip=True, reason="fingerprint_match",
                    existing_video_path=_safe_relative_path(
                        pipeline["render_jobs"][f"{vid}_A"]["final_video_path"]
                    )
                ))
            else:
                results.append(RenderCheckResult(
                    variant_index=vid, can_skip=False, reason="meta_version_incomplete"
                ))
            continue

        # Standard (non-meta) flow: check integer key
        existing_job = pipeline.get("render_jobs", {}).get(vid)
        if not existing_job:
            results.append(RenderCheckResult(
                variant_index=vid, can_skip=False, reason="no_previous_render"
            ))
            continue

        if existing_job.get("status") == "processing":
            results.append(RenderCheckResult(
                variant_index=vid, can_skip=False, reason="still_processing"
            ))
            continue

        if existing_job.get("status") != "completed":
            results.append(RenderCheckResult(
                variant_index=vid, can_skip=False, reason="no_previous_render"
            ))
            continue

        # Verify the rendered file still exists on disk
        video_path = existing_job.get("final_video_path")
        if not video_path or not Path(video_path).exists():
            results.append(RenderCheckResult(
                variant_index=vid, can_skip=False, reason="file_missing"
            ))
            continue

        # BUG-FIX: Check if the library clip was soft-deleted by the user
        _job_clip_id = existing_job.get("clip_id")
        if _job_clip_id and _job_clip_id in _deleted_clip_ids:
            results.append(RenderCheckResult(
                variant_index=vid, can_skip=False, reason="clip_deleted"
            ))
            continue

        safe_path = _safe_relative_path(video_path)
        old_fingerprint = existing_job.get("render_fingerprint")

        # If fingerprint matches exactly → safe to skip
        if old_fingerprint and old_fingerprint == new_fingerprint:
            results.append(RenderCheckResult(
                variant_index=vid, can_skip=True, reason="fingerprint_match",
                existing_video_path=safe_path
            ))
            continue

        # If no fingerprint or old format (pre-SHA256) but video exists →
        # still offer skip option but with a different reason so UI can indicate
        # that parameters may have changed
        if not old_fingerprint or len(old_fingerprint) < 32:
            results.append(RenderCheckResult(
                variant_index=vid, can_skip=True, reason="render_exists_unverified",
                existing_video_path=safe_path
            ))
            continue

        # Fingerprint exists but doesn't match → parameters changed
        results.append(RenderCheckResult(
            variant_index=vid, can_skip=False, reason="fingerprint_mismatch",
            existing_video_path=safe_path
        ))

    return RenderCheckResponse(
        results=results,
        any_skippable=any(r.can_skip for r in results)
    )


@router.post("/render/{pipeline_id}", response_model=PipelineRenderResponse)
@limiter.limit("5/minute")
async def render_variants(
    request: Request,
    pipeline_id: str,
    render_request: PipelineRenderRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Start batch rendering of selected variants.

    This is step 3 of the workflow: render the variants you want.
    Each variant renders independently in background. Poll /status for progress.
    """
    # Validate pipeline exists (with DB fallback)
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    # Validate ownership
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    # PIP-17: Validate variant_indices is non-empty
    if not render_request.variant_indices:
        raise HTTPException(status_code=400, detail="variant_indices must not be empty")

    # Validate all variant indices
    for idx in render_request.variant_indices:
        if idx < 0 or idx >= len(pipeline["scripts"]):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid variant_index: {idx}. Must be between 0 and {len(pipeline['scripts']) - 1}"
            )

    logger.info(
        f"[Profile {profile.profile_id}] Starting render for pipeline {pipeline_id}, "
        f"variants: {render_request.variant_indices}"
    )
    if render_request.interstitial_slides:
        logger.info(
            "[Profile %s] Received %d variant(s) with interstitial slides",
            profile.profile_id, len(render_request.interstitial_slides)
        )
    if render_request.pip_overlays:
        logger.info(
            "[Profile %s] Received %d segment(s) with PiP overlays",
            profile.profile_id, len(render_request.pip_overlays)
        )

    # Fetch preset data and build DEFAULT subtitle settings.
    # Per-variant overrides (render_request.subtitle_settings_by_key) are
    # resolved inside do_render via _get_subtitle_settings_for_key().
    preset_data, default_subtitle_settings = _fetch_preset_and_settings(render_request)

    # Persist subtitle overrides to the pipeline dict so reloads see them.
    # This mirrors how meta_multiplication is persisted a few lines below.
    # Defensive normalize: a stale browser tab from before this refactor
    # could still send legacy "0_A"/"1_B" keys. Normalize here so the
    # stored shape is always canonical — otherwise the first stale render
    # would poison the pipeline with keys the read path can't reach via
    # the primary lookup.
    if render_request.subtitle_settings_by_key is not None:
        pipeline["subtitle_settings_by_key"] = _normalize_overrides(
            dict(render_request.subtitle_settings_by_key)
        )

    # Clear any previous cancellation flag so re-renders work
    clear_pipeline_cancelled(pipeline_id)

    # Lock to guard concurrent writes to pipeline["render_jobs"]
    # PIP-02: Use meta lock to guard creation of new entries in _render_locks
    pipeline_id_str = str(pipeline_id)
    _evict_stale_render_locks()
    with _render_locks_meta_lock:
        if pipeline_id_str not in _render_locks:
            _render_locks[pipeline_id_str] = threading.Lock()
        render_jobs_lock = _render_locks[pipeline_id_str]

    # PIP-12: Snapshot script count for bound checks inside do_render
    _script_count_snapshot = len(pipeline["scripts"])

    # Meta render multiplication: expand variant list to include visual versions
    _meta_mul = render_request.meta_multiplication
    # Persist meta_multiplication flag in pipeline state so it survives reload/sync
    pipeline["meta_multiplication"] = bool(_meta_mul)
    _render_tasks = []  # List of (variant_index, version_index, job_key)

    for vid in render_request.variant_indices:
        if _meta_mul:
            for ver_idx in range(len(META_PROFILES)):
                job_key = f"{vid}_{get_version_label(ver_idx)}"
                _render_tasks.append((vid, ver_idx, job_key))
        else:
            _render_tasks.append((vid, None, vid))

    # Initialize render jobs for each variant and collect which ones to render
    state_lock = _get_pipeline_state_lock(pipeline_id)
    _render_tasks_to_run = []
    with state_lock:
        # Store source_video_ids in pipeline state for reference
        if render_request.source_video_ids:
            pipeline["source_video_ids"] = render_request.source_video_ids
        _skip_set = set(render_request.skip_variants or [])
        for vid, ver_idx, job_key in _render_tasks:
            # Skip variants that user chose to keep from previous render
            if vid in _skip_set:
                continue

            existing_job = pipeline["render_jobs"].get(job_key)
            if existing_job and existing_job.get("status") == "processing":
                # Treat as stale (orphan from a crashed/restarted run) when
                # started_at is older than STALE_PROCESSING_THRESHOLD_SEC and
                # no completed_at is recorded. Without this, any in-flight job
                # that died without cleanup blocks the key forever — silently,
                # since this continue used to log nothing.
                _stale = False
                _started_at = existing_job.get("started_at")
                if _started_at:
                    try:
                        _started_dt = datetime.fromisoformat(_started_at.replace("Z", "+00:00"))
                        _age = (datetime.now(timezone.utc) - _started_dt).total_seconds()
                        if _age > STALE_PROCESSING_THRESHOLD_SEC and not existing_job.get("completed_at"):
                            _stale = True
                    except (ValueError, TypeError):
                        _stale = True  # Unparseable timestamp → treat as stale
                else:
                    _stale = True  # No timestamp → treat as stale
                if not _stale:
                    logger.info(
                        f"Pipeline {pipeline_id}: skipping {job_key} — already rendering"
                    )
                    continue
                logger.warning(
                    f"Pipeline {pipeline_id}: overriding stale processing job "
                    f"{job_key} (started_at={_started_at}, no completed_at)"
                )

            _init_job: dict = {
                "status": "processing",
                "progress": 0,
                "current_step": "Initializing render",
                "final_video_path": None,
                "error": None,
                "started_at": datetime.now(timezone.utc).isoformat()
            }
            if ver_idx is not None:
                _init_job["visual_version"] = get_version_label(ver_idx)
                _init_job["meta_platform"] = META_PROFILES[ver_idx].name
            pipeline["render_jobs"][job_key] = _init_job
            # Clear any stale cancel flag from a previous render of this key, so
            # re-submitting the same variant after a Stop doesn't immediately
            # abort via the leftover flag.  Clears both the exact key form and
            # a bare-int fallback (for legacy clients that cancelled via "0").
            clear_variant_cancelled(pipeline_id, job_key)
            clear_variant_cancelled(pipeline_id, str(job_key))
            if isinstance(job_key, int):
                clear_variant_cancelled(pipeline_id, str(job_key))
            _render_tasks_to_run.append((vid, ver_idx, job_key))

    # Capture profile_id by value so the closure doesn't hold a mutable reference
    _profile_id = profile.profile_id

    # Define render function for a single variant (or variant+version when meta_multiplication is active)
    async def do_render(vid, version_index=None, job_key=None):
        # Import here to avoid module-load cycles
        from app.services.ffmpeg_registry import active_job_key as _active_job_key_ctx
        # When not using meta multiplication, job_key defaults to vid
        if job_key is None:
            job_key = vid
        # Cancellation is keyed by job_key (str form). Any "0_A" Stop targets
        # only that A/B version; a "0" Stop targets the bare variant.
        _cancel_scope = str(job_key)
        _registry_scope = f"{pipeline_id}:{_cancel_scope}"
        _ctx_token = _active_job_key_ctx.set(_registry_scope)
        try:
            # PIP-12: Bound check — ensure variant index is still valid
            if vid >= _script_count_snapshot:
                logger.warning(
                    f"Pipeline {pipeline_id} variant {vid} skipped: "
                    f"index >= script_count ({_script_count_snapshot})"
                )
                return

            # PIP-04: Check cancellation before starting render
            if is_pipeline_cancelled(pipeline_id) or is_variant_cancelled(pipeline_id, _cancel_scope):
                logger.info(f"Pipeline {pipeline_id} job {_cancel_scope} skipped: cancelled")
                return

            # ── Render fingerprint: SHA-256 hash of ALL render-affecting parameters ──
            # Pass job_key so per-key subtitle overrides AND per-key match-overrides
            # are factored in (otherwise A and B would share a fingerprint).
            script_text = pipeline["scripts"][vid]
            _ver_label_for_fp = get_version_label(version_index) if version_index is not None else None
            _render_fingerprint = _compute_render_fingerprint(
                render_request,
                vid,
                script_text,
                job_key=job_key,
                visual_version=_ver_label_for_fp,
            )
            # Include visual version in fingerprint when meta multiplication is active
            if version_index is not None:
                _ver_label = get_version_label(version_index)
                _fp_extra = hashlib.sha256(
                    f"{_render_fingerprint}:meta_ver={_ver_label}:offset={META_PROFILES[version_index].segment_offset}".encode()
                ).hexdigest()[:32]
                _render_fingerprint = _fp_extra

            _ver_tag = f" version={get_version_label(version_index)}" if version_index is not None else ""
            logger.info(
                f"[Profile {_profile_id}] ═══ RENDER START ═══ "
                f"pipeline={pipeline_id} variant={vid}{_ver_tag} fingerprint={_render_fingerprint}"
            )

            # PIP-04: pipeline is a mutable dict reference from _pipelines — all access
            # through pipeline[...] sees the latest state. Cancellation checks use
            # is_pipeline_cancelled() which reads from the separate _cancelled_pipelines dict.
            job = pipeline["render_jobs"][job_key]

            # Check for cancellation before starting
            if is_pipeline_cancelled(pipeline_id) or is_variant_cancelled(pipeline_id, _cancel_scope):
                with render_jobs_lock:
                    job["status"] = "cancelled"
                    job["current_step"] = "Cancelled by user"
                    job["progress"] = 0
                logger.info(f"Pipeline {pipeline_id} job {_cancel_scope} cancelled before start")
                return

            # Update progress
            with render_jobs_lock:
                job["current_step"] = "Generating TTS audio"
                job["progress"] = 10

            # M5: Pre-render disk space check (get_settings imported at module level)
            check_disk_space(get_settings().output_dir)

            assembly_service = get_assembly_service()

            # Extract match overrides for this variant (from timeline editor)
            variant_match_overrides = None
            if render_request.match_overrides:
                _override_key = str(job_key) if job_key is not None else str(vid)
                variant_match_overrides = (
                    render_request.match_overrides.get(_override_key)
                    or render_request.match_overrides.get(str(vid))
                )
                if variant_match_overrides:
                    logger.info(
                        f"[RENDER {_render_fingerprint}] Using {len(variant_match_overrides)} "
                        f"match overrides for variant {_override_key}"
                    )
                    # Log each match override for debugging
                    for _mi, _mo_entry in enumerate(variant_match_overrides[:10]):  # first 10
                        logger.info(
                            f"[RENDER {_render_fingerprint}]   override[{_mi}]: "
                            f"srt_idx={_mo_entry.get('srt_index')} "
                            f"seg_id={_mo_entry.get('segment_id', 'NONE')!r} "
                            f"text={_mo_entry.get('srt_text', '')[:40]!r} "
                            f"start={_mo_entry.get('srt_start', 0):.2f}-{_mo_entry.get('srt_end', 0):.2f}"
                        )
                else:
                    logger.warning(
                        f"[RENDER {_render_fingerprint}] match_overrides present but EMPTY "
                        f"for variant {_override_key} (keys: {list(render_request.match_overrides.keys())})"
                    )
            else:
                logger.warning(
                    f"[RENDER {_render_fingerprint}] NO match_overrides sent — "
                    f"render will use auto-matching (may differ from preview!)"
                )

            # PIP-07: Removed dead first assignment of variant_interstitial_slides
            # (was overwritten later in the function). The actual lookup is below.

            # Check for reusable TTS audio from pipeline state
            reuse_audio_path = None
            reuse_audio_duration = None
            reuse_srt_content = None

            # Hash comparison uses cleaned text (tags stripped) to match stored hash
            cleaned_render_text = strip_product_group_tags(script_text)
            # Normalize key lookup: prefer int key, fall back to str for legacy entries
            _tts_previews_render = pipeline.get("tts_previews", {})
            existing_tts = _tts_previews_render.get(vid) or _tts_previews_render.get(str(vid))
            if existing_tts:
                script_match = existing_tts.get("script_hash") == _stable_hash(cleaned_render_text)
                if script_match:
                    # For library audio: skip voice_settings check
                    # For generated audio: compare voice_settings
                    is_library = bool(existing_tts.get("library_asset_id"))
                    settings_match = is_library or _voice_settings_match(existing_tts.get("voice_settings"), render_request.voice_settings)

                    if settings_match:
                        audio_path_str = existing_tts.get("audio_path")
                        if audio_path_str and Path(audio_path_str).exists() and Path(audio_path_str).stat().st_size > 100:
                            reuse_audio_path = audio_path_str
                            reuse_audio_duration = existing_tts.get("audio_duration")

                            # ── SRT reuse guard ──────────────────────────────
                            # Only reuse cached SRT if words_per_subtitle hasn't
                            # changed since the preview generated it.  The SRT
                            # groups words into subtitle phrases using this param;
                            # reusing a stale SRT would show wrong subtitle grouping.
                            cached_wpf = existing_tts.get("words_per_subtitle")
                            render_wpf = render_request.words_per_subtitle
                            if cached_wpf is not None and cached_wpf != render_wpf:
                                logger.info(
                                    f"[RENDER {_render_fingerprint}] SRT reuse BLOCKED: "
                                    f"words_per_subtitle changed ({cached_wpf} -> {render_wpf})"
                                )
                                # Audio is still reusable, only SRT needs regeneration
                                reuse_srt_content = None
                            else:
                                reuse_srt_content = existing_tts.get("srt_content")

                            logger.info(
                                f"[RENDER {_render_fingerprint}] Reusing "
                                f"{'library' if is_library else 'cached'} TTS audio "
                                f"for variant {vid} "
                                f"(srt_reused={'YES' if reuse_srt_content else 'NO'})"
                            )
                            # Skip TTS generation step — jump to segment matching
                            with render_jobs_lock:
                                job["current_step"] = "Matching segments"
                                job["progress"] = 30
                    else:
                        logger.info(
                            f"[RENDER {_render_fingerprint}] TTS reuse BLOCKED: "
                            f"voice_settings mismatch"
                        )
                else:
                    logger.info(
                        f"[RENDER {_render_fingerprint}] TTS reuse BLOCKED: "
                        f"script_hash mismatch"
                    )
            else:
                logger.info(
                    f"[RENDER {_render_fingerprint}] No cached TTS found — "
                    f"will generate fresh audio"
                )

            # Progress callback: assembly_service calls this at each major step,
            # and (Wave 2.1) continuously during the final encode.
            _last_progress_persist = {"t": 0.0}

            def on_progress(step_name: str, pct: int):
                with render_jobs_lock:
                    job["current_step"] = step_name
                    job["progress"] = pct
                # Wave 2.3: persist progress DURING the long encode (throttled to
                # ~once/5s) so a crash mid-render leaves an accurate last-known
                # progress instead of a frozen/vanishing bar. Stage boundaries
                # still persist immediately below; this fills the encode gap.
                import time as _time
                now = _time.monotonic()
                if now - _last_progress_persist["t"] >= 5.0:
                    _last_progress_persist["t"] = now
                    with render_jobs_lock:
                        _snapshot = dict(pipeline.get("render_jobs", {}))
                    try:
                        _db_update_render_jobs(pipeline_id, _snapshot)
                    except Exception:
                        pass

            # Extract overlay params for this variant
            # PIP-07: interstitial_slides may be keyed by str(vid) or int(vid) — try both with `or` fallback
            variant_interstitial_slides = None
            if render_request.interstitial_slides:
                _slides_key = str(job_key) if job_key is not None else str(vid)
                variant_slides = (
                    render_request.interstitial_slides.get(_slides_key)
                    or render_request.interstitial_slides.get(str(vid))
                    or []
                )
                if variant_slides:
                    variant_interstitial_slides = variant_slides
                    logger.info(f"[Pipeline {pipeline_id}] Variant {_slides_key}: {len(variant_slides)} interstitial slides")

            variant_pip_overlays = render_request.pip_overlays if render_request.pip_overlays else None
            if variant_pip_overlays:
                logger.info(f"[Pipeline {pipeline_id}] Variant {vid}: {len(variant_pip_overlays)} PiP overlays")

            # Cross-variant deprioritization for render
            render_avoid_ids = set()
            with _get_pipeline_state_lock(pipeline_id):
                for other_idx, used_set in pipeline.get("segment_usage", {}).items():
                    if str(other_idx) != str(vid):
                        render_avoid_ids.update(used_set if isinstance(used_set, list) else list(used_set))

            # Persistent diversity: deprioritize segments with usage_count > 0
            try:
                _repo = get_repository()
                # Plan 81-02 Task 1.B — list_segments composes profile_id + gt(usage_count, 0) + optional in_(source_video_id).
                _seg_filter_eq: Dict[str, Any] = {}
                _seg_filter_in: Dict[str, List[Any]] = {}
                if render_request.source_video_ids:
                    _seg_filter_in["source_video_id"] = list(render_request.source_video_ids)
                _render_used = _repo.list_segments(
                    _profile_id,
                    QueryFilters(
                        eq=_seg_filter_eq,
                        gt={"usage_count": 0},
                        in_=_seg_filter_in,
                        select="id",
                    ),
                )
                if _render_used.data:
                    render_avoid_ids.update(s["id"] for s in _render_used.data)
            except Exception as e:
                logger.warning(f"Failed to load segment usage for render: {e}")

            # Check for cancellation before heavy render
            if is_pipeline_cancelled(pipeline_id) or is_variant_cancelled(pipeline_id, _cancel_scope):
                with render_jobs_lock:
                    job["status"] = "cancelled"
                    job["current_step"] = "Cancelled by user"
                    job["progress"] = 0
                logger.info(f"Pipeline {pipeline_id} job {_cancel_scope} cancelled before render")
                return

            # ── Resolve per-variant subtitle settings ──
            # job_key matches the PreviewKey the frontend uses ("0", "0_A"...).
            _job_key_str = str(job_key)
            _effective_subtitle_settings, _has_user_override = _get_subtitle_settings_for_key(
                render_request, _job_key_str, default_subtitle_settings
            )

            # ── Meta multiplication: compute effective variant_index and subtitle override ──
            _effective_vid = vid
            _subtitle_override = None
            if version_index is not None:
                _meta_profile = META_PROFILES[version_index]
                _effective_vid = vid + _meta_profile.segment_offset
                # User override wins: when the frontend set an explicit style
                # for this key, the Meta profile overlay is suppressed entirely.
                if _has_user_override:
                    _subtitle_override = None
                    logger.info(
                        f"[RENDER {_render_fingerprint}] Meta version {get_version_label(version_index)} "
                        f"({_meta_profile.name}): user override present for key {_job_key_str!r} — "
                        f"Meta subtitle profile suppressed. effective_vid={_effective_vid}, "
                        f"segment_offset={_meta_profile.segment_offset}"
                    )
                else:
                    _subtitle_override = _meta_profile.subtitle_style
                    logger.info(
                        f"[RENDER {_render_fingerprint}] Meta version {get_version_label(version_index)} "
                        f"({_meta_profile.name}): effective_vid={_effective_vid}, "
                        f"segment_offset={_meta_profile.segment_offset}"
                    )
                # Cross-version diversity: for version B, avoid segments used by version A
                if version_index > 0:
                    _ver_a_key = f"{vid}_{get_version_label(0)}"
                    _ver_a_job = pipeline["render_jobs"].get(_ver_a_key)
                    if _ver_a_job and _ver_a_job.get("segment_composition"):
                        _ver_a_seg_ids = [
                            s.get("segment_id") for s in _ver_a_job["segment_composition"]
                            if s.get("segment_id")
                        ]
                        render_avoid_ids.update(_ver_a_seg_ids)
                        logger.info(
                            f"[RENDER {_render_fingerprint}] Cross-version diversity: "
                            f"avoiding {len(_ver_a_seg_ids)} segments from version A"
                        )

            # Run full assembly (with 15-minute timeout)
            try:
                final_video_path, raw_assembly_path, _seg_composition = await asyncio.wait_for(
                    assembly_service.assemble_and_render(
                        script_text=script_text,
                        profile_id=_profile_id,
                        preset_data=preset_data,
                        subtitle_settings=_effective_subtitle_settings,
                        elevenlabs_model=render_request.elevenlabs_model,
                        voice_id=render_request.voice_id,
                        source_video_ids=render_request.source_video_ids,
                        match_overrides=variant_match_overrides,
                        enable_denoise=render_request.enable_denoise,
                        denoise_strength=render_request.denoise_strength,
                        enable_sharpen=render_request.enable_sharpen,
                        sharpen_amount=render_request.sharpen_amount,
                        enable_color=render_request.enable_color,
                        brightness=render_request.brightness,
                        contrast=render_request.contrast,
                        saturation=render_request.saturation,
                        voice_volume=render_request.voice_volume,
                        audio_fade_in=render_request.audio_fade_in,
                        audio_fade_out=render_request.audio_fade_out,
                        shadow_depth=render_request.shadow_depth,
                        enable_glow=render_request.enable_glow,
                        glow_blur=render_request.glow_blur,
                        adaptive_sizing=render_request.adaptive_sizing,
                        variant_index=_effective_vid,
                        voice_settings=render_request.voice_settings,
                        reuse_audio_path=reuse_audio_path,
                        reuse_audio_duration=reuse_audio_duration,
                        reuse_srt_content=reuse_srt_content,
                        on_progress=on_progress,
                        max_words_per_phrase=render_request.words_per_subtitle,
                        min_segment_duration=render_request.min_segment_duration,
                        preset=render_request.preset or "balanced",
                        ultra_rapid_intro=render_request.ultra_rapid_intro,
                        interstitial_slides=variant_interstitial_slides,
                        pip_overlays=variant_pip_overlays,
                        avoid_segment_ids=render_avoid_ids if render_avoid_ids else None,
                        subtitle_style_override=_subtitle_override,
                        visual_version_label=get_version_label(version_index) if version_index is not None else None,
                        output_project_label=(pipeline.get("name") or pipeline.get("idea") or "").strip(),
                        output_script_label=script_text,
                        output_created_at=datetime.now(timezone.utc),
                        force_cpu=render_request.force_cpu,
                    ),
                    timeout=1800 if preset_data.get("encoding_mode") == "vbr_2pass" else 900
                )
            except asyncio.TimeoutError:
                _timeout_mins = 30 if preset_data.get("encoding_mode") == "vbr_2pass" else 15
                raise Exception(f"Render timed out after {_timeout_mins} minutes")
            except RuntimeError as rt_err:
                # Catch specific assembly errors (e.g., "No segments found in library.")
                # so the job is marked failed with a clear message instead of stuck in "processing"
                # A RuntimeError here is also how safe_ffmpeg_run surfaces an external
                # kill (triggered by the cancel endpoint).  If the flag was set in the
                # meantime, honor the cancel and skip marking it "failed".
                _was_cancelled = (
                    is_pipeline_cancelled(pipeline_id)
                    or is_variant_cancelled(pipeline_id, _cancel_scope)
                    or job.get("status") == "cancelled"
                )
                if _was_cancelled:
                    with render_jobs_lock:
                        job["status"] = "cancelled"
                        job["progress"] = 0
                        job["current_step"] = "Cancelled by user"
                        job["cancelled_at"] = datetime.now(timezone.utc).isoformat()
                    _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
                    logger.info(
                        f"[Profile {_profile_id}] Pipeline {pipeline_id} "
                        f"job {_cancel_scope} cancelled during render ({rt_err})"
                    )
                    return
                logger.error(
                    f"[Profile {_profile_id}] Pipeline {pipeline_id} "
                    f"variant {vid} assembly error: {rt_err}"
                )
                with render_jobs_lock:
                    job["status"] = "failed"
                    job["progress"] = 0
                    job["current_step"] = "Assembly failed"
                    job["error"] = str(rt_err)
                    job["failed_at"] = datetime.now(timezone.utc).isoformat()
                # PIP-06: Persist failure to DB OUTSIDE the lock
                _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
                return

            # Success — acquire lock before writing shared render_jobs dict.
            # Guard: if the job was cancelled while the long ffmpeg pipeline was
            # running, do NOT overwrite the "cancelled" status with "completed".
            # Without this, a Stop click during the final encode would appear to
            # fail when the render returned a video file a few seconds later.
            if (
                is_pipeline_cancelled(pipeline_id)
                or is_variant_cancelled(pipeline_id, _cancel_scope)
                or job.get("status") == "cancelled"
            ):
                logger.info(
                    f"[Profile {_profile_id}] Pipeline {pipeline_id} "
                    f"job {_cancel_scope} finished but was cancelled — keeping cancelled state"
                )
                with render_jobs_lock:
                    job["status"] = "cancelled"
                    job["progress"] = 0
                    job["current_step"] = "Cancelled by user"
                    if "cancelled_at" not in job:
                        job["cancelled_at"] = datetime.now(timezone.utc).isoformat()
                _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
                # Attempt to clean up the stale output file produced after cancel
                try:
                    if final_video_path and Path(final_video_path).exists():
                        Path(final_video_path).unlink(missing_ok=True)
                except Exception:
                    pass
                return
            with render_jobs_lock:
                job["status"] = "completed"
                job["progress"] = 100
                job["current_step"] = "Render complete"
                job["final_video_path"] = str(final_video_path)
                job["raw_video_path"] = str(raw_assembly_path)
                job["render_fingerprint"] = _render_fingerprint
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
                # Store visual version label and segment composition for cross-version diversity
                if version_index is not None:
                    job["visual_version"] = get_version_label(version_index)
                    job["meta_platform"] = META_PROFILES[version_index].name
                if _seg_composition:
                    job["segment_composition"] = _seg_composition

            # Log final output for debugging stale-video reports
            _file_size_mb = 0
            try:
                _file_size_mb = final_video_path.stat().st_size / (1024 * 1024)
            except Exception:
                pass
            _ver_tag = f" version={get_version_label(version_index)}" if version_index is not None else ""
            logger.info(
                f"[RENDER {_render_fingerprint}] ═══ RENDER COMPLETE ═══ "
                f"output={final_video_path.name} size={_file_size_mb:.1f}MB{_ver_tag}"
            )

            logger.info(
                f"[Profile {_profile_id}] Pipeline {pipeline_id} "
                f"variant {vid}{_ver_tag} completed: {final_video_path}"
            )

            # PIP-01: Persist render result to DB OUTSIDE the lock (I/O should not hold lock)
            _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])

            # Save rendered clip to library (extracted helper)
            _visual_ver = get_version_label(version_index) if version_index is not None else None
            # Use the per-variant effective settings so editai_clip_content
            # records the actual style rendered (not the global default).
            await _save_clip_to_library(
                pipeline, pipeline_id, vid, final_video_path,
                _profile_id, _render_fingerprint, render_jobs_lock,
                raw_assembly_path=raw_assembly_path,
                subtitle_settings=_effective_subtitle_settings,
                segment_composition=_seg_composition,
                job_key=job_key,
                visual_version=_visual_ver,
                voice_settings=render_request.voice_settings,
            )

        except Exception as e:
            # Safety net for unexpected errors.  If the user cancelled mid-flight
            # we may land here because safe_ffmpeg_run raised after being killed;
            # keep the "cancelled" label instead of overwriting with "failed".
            _job_for_status = None
            try:
                _job_for_status = pipeline.get("render_jobs", {}).get(job_key)
            except Exception:
                _job_for_status = None
            _was_cancelled_now = (
                is_pipeline_cancelled(pipeline_id)
                or is_variant_cancelled(pipeline_id, _cancel_scope)
                or (isinstance(_job_for_status, dict) and _job_for_status.get("status") == "cancelled")
            )
            if _was_cancelled_now:
                logger.info(
                    f"[Profile {_profile_id}] Pipeline {pipeline_id} "
                    f"job {_cancel_scope} raised after cancel: {e}"
                )
                if isinstance(_job_for_status, dict):
                    with render_jobs_lock:
                        _job_for_status["status"] = "cancelled"
                        _job_for_status["progress"] = 0
                        _job_for_status["current_step"] = "Cancelled by user"
                        if "cancelled_at" not in _job_for_status:
                            _job_for_status["cancelled_at"] = datetime.now(timezone.utc).isoformat()
                    _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
                return
            logger.error(
                f"[Profile {_profile_id}] Pipeline {pipeline_id} "
                f"variant {vid} failed: {e}"
            )
            # Acquire lock before writing shared render_jobs dict
            with render_jobs_lock:
                job["status"] = "failed"
                job["progress"] = 0
                job["current_step"] = "Render failed"
                job["error"] = str(e)
                job["failed_at"] = datetime.now(timezone.utc).isoformat()

            # PIP-06: Persist failure to DB OUTSIDE the lock
            _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
        finally:
            # Clear the per-task job_key so follow-up cleanup (outside do_render)
            # does not inherit a stale association for this task's context.
            try:
                _active_job_key_ctx.reset(_ctx_token)
            except Exception:
                pass

    # Run all variant renders in parallel via asyncio.gather (throttled by semaphore)
    async def _render_all_variants():
        if _meta_mul:
            # Sequential per version (A then B), parallel across variants within each version.
            # Version B needs version A's segment data for cross-version diversity,
            # so all A renders must complete before B renders start.
            for ver_idx in range(len(META_PROFILES)):
                ver_tasks = [(v, vi, jk) for v, vi, jk in _render_tasks_to_run if vi == ver_idx]
                if not ver_tasks:
                    continue
                async def _throttled_meta_render(_vid, _ver_idx, _job_key):
                    # Short-circuit queued cancels BEFORE waiting for the render slot,
                    # so a user Stop on a not_started card doesn't need to wait for
                    # a semaphore slot to release before taking effect.
                    if is_pipeline_cancelled(pipeline_id) or is_variant_cancelled(pipeline_id, str(_job_key)):
                        _queued_job = pipeline.get("render_jobs", {}).get(_job_key)
                        if isinstance(_queued_job, dict) and _queued_job.get("status") != "cancelled":
                            with render_jobs_lock:
                                _queued_job["status"] = "cancelled"
                                _queued_job["progress"] = 0
                                _queued_job["current_step"] = "Cancelled by user"
                                _queued_job["cancelled_at"] = datetime.now(timezone.utc).isoformat()
                            _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
                        return
                    async with await acquire_render_slot():
                        await do_render(_vid, version_index=_ver_idx, job_key=_job_key)
                tasks = [_throttled_meta_render(v, vi, jk) for v, vi, jk in ver_tasks]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for i, result in enumerate(results):
                    if isinstance(result, Exception):
                        logger.error(f"Render {ver_tasks[i][2]} failed: {result}")
        else:
            # Original flow: parallel across variants
            async def _throttled_render(vid):
                if is_pipeline_cancelled(pipeline_id) or is_variant_cancelled(pipeline_id, str(vid)):
                    _queued_job = pipeline.get("render_jobs", {}).get(vid)
                    if isinstance(_queued_job, dict) and _queued_job.get("status") != "cancelled":
                        with render_jobs_lock:
                            _queued_job["status"] = "cancelled"
                            _queued_job["progress"] = 0
                            _queued_job["current_step"] = "Cancelled by user"
                            _queued_job["cancelled_at"] = datetime.now(timezone.utc).isoformat()
                        _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
                    return
                async with await acquire_render_slot():
                    await do_render(vid)
            tasks = [_throttled_render(v) for v, _, _ in _render_tasks_to_run]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    logger.error(f"Render variant {_render_tasks_to_run[i][0]} failed: {result}")
        # PIP-08: Cancellation flag is now cleared per-variant at render start,
        # not globally here, to prevent a stale flag from cancelling a new render
        # that starts while a previous one's gather is still wrapping up.

    if _render_tasks_to_run:
        # PIP-18: Only update render lock timestamp when we actually have variants to render
        # M4: Protect _render_locks_timestamps write with its meta lock
        with _render_locks_meta_lock:
            _render_locks_timestamps[pipeline_id_str] = _time_mod.monotonic()
        background_tasks.add_task(_render_all_variants)
    else:
        logger.info(f"Pipeline {pipeline_id}: all requested variants already rendering, nothing new to start")

    # PIP-16: Return actual rendering tasks, not the original request list
    _rendering_variant_indices = list(set(v for v, _, _ in _render_tasks_to_run))
    return PipelineRenderResponse(
        pipeline_id=pipeline_id,
        rendering_variants=_rendering_variant_indices,
        total_variants=len(pipeline["scripts"]),
        meta_multiplication=_meta_mul,
        visual_versions=[get_version_label(i) for i in range(len(META_PROFILES))] if _meta_mul else None,
        message="All requested variants are already rendering" if not _render_tasks_to_run else None
    )


# ── Remake variant with different segments ─────────────────────────────────

@router.post("/remake/{pipeline_id}/{variant_index}")
@limiter.limit("5/minute")
async def remake_variant(
    request: Request,
    pipeline_id: str,
    variant_index: int,
    render_request: PipelineRenderRequest,
    background_tasks: BackgroundTasks,
    visual_version: Optional[str] = Query(None),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Re-render a completed variant with the SAME voiceover but DIFFERENT video segments.

    The frontend sends the current render settings (subtitle, encoding, etc.).
    Full match_overrides are ignored (they may be stale after a script edit), so
    the backend auto-matches with a strong avoid set containing the variant's
    previous segments. F6: entries the user pinned in the saved preview ARE
    honored — they're passed into the re-match as pinned_assignments keyed by
    srt_index, so a locked clip survives a remake as long as that index exists.
    """
    # 1. Validate pipeline
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    vid = variant_index
    normalized_visual_version = _normalize_meta_version_label(visual_version)
    job_key: Any = f"{vid}_{normalized_visual_version}" if normalized_visual_version else vid
    version_index = (
        next((i for i in range(len(META_PROFILES)) if get_version_label(i) == normalized_visual_version), None)
        if normalized_visual_version else None
    )
    effective_vid = vid + META_PROFILES[version_index].segment_offset if version_index is not None else vid
    scripts = pipeline.get("scripts", [])
    if vid < 0 or vid >= len(scripts):
        raise HTTPException(status_code=400, detail=f"Variant index {vid} out of range (0-{len(scripts)-1})")

    # 2. Check variant is not currently processing
    existing_job = pipeline.get("render_jobs", {}).get(job_key)
    if existing_job and existing_job.get("status") == "processing":
        raise HTTPException(status_code=409, detail="Variant is currently rendering. Wait or cancel first.")

    # 3. Read TTS data for reuse
    _tts_previews = pipeline.get("tts_previews", {})
    existing_tts = _tts_previews.get(vid) or _tts_previews.get(str(vid))

    reuse_audio_path = None
    reuse_audio_duration = None
    reuse_srt_content = None

    if existing_tts:
        audio_path_str = existing_tts.get("audio_path")
        if audio_path_str and Path(audio_path_str).exists() and Path(audio_path_str).stat().st_size > 100:
            reuse_audio_path = audio_path_str
            reuse_audio_duration = existing_tts.get("audio_duration")
            reuse_srt_content = existing_tts.get("srt_content")
        else:
            raise HTTPException(
                status_code=400,
                detail="Voice-over audio no longer available on disk. Please regenerate TTS in Step 2."
            )
    else:
        raise HTTPException(
            status_code=400,
            detail="No TTS data found for this variant. Please generate TTS in Step 2 first."
        )

    # 4. Build strong avoid set (current variant's segments + cross-variant + DB usage)
    remake_avoid_ids: set = set()

    # Current variant's previous segments — these are what we want to REPLACE
    _seg_usage = pipeline.get("segment_usage", {})
    current_segs = _seg_usage.get(vid) or _seg_usage.get(str(vid)) or []
    remake_avoid_ids.update(current_segs)

    # Cross-variant segments (diversity)
    for other_idx, used_set in _seg_usage.items():
        if str(other_idx) != str(vid):
            if isinstance(used_set, list):
                remake_avoid_ids.update(used_set)
            else:
                remake_avoid_ids.update(list(used_set))

    # DB segments with usage_count > 0 (persistent diversity)
    try:
        _repo = get_repository()
        # Plan 81-02 Task 1.C — list_segments composes profile_id + gt(usage_count, 0) + optional in_(source_video_id).
        _seg_filter_in: Dict[str, List[Any]] = {}
        if render_request.source_video_ids:
            _seg_filter_in["source_video_id"] = list(render_request.source_video_ids)
        _used = _repo.list_segments(
            profile.profile_id,
            QueryFilters(
                gt={"usage_count": 0},
                in_=_seg_filter_in,
                select="id",
            ),
        )
        if _used.data:
            remake_avoid_ids.update(s["id"] for s in _used.data)
    except Exception as e:
        logger.warning(f"Failed to load segment usage for remake: {e}")

    # F6: honor user-pinned matches from the saved preview. Full overrides are
    # dropped (stale after script edits), but pinned entries keyed by srt_index
    # are passed into the re-match so the locked clip survives.
    remake_pinned_assignments: Dict[int, str] = {}
    try:
        _preview_key = _build_preview_key(vid, normalized_visual_version)
        _saved_preview = (
            pipeline.get("previews", {}).get(_preview_key)
            or pipeline.get("previews", {}).get(vid)
        )
        _saved_matches = (
            (_saved_preview or {}).get("preview_data", {}).get("matches", [])
            if isinstance(_saved_preview, dict) else []
        )
        for _m in _saved_matches:
            if _m.get("pinned") and _m.get("segment_id") and _m.get("srt_index") is not None:
                remake_pinned_assignments[int(_m["srt_index"])] = _m["segment_id"]
    except Exception as e:
        logger.warning(f"Failed to load pinned matches for remake: {e}")

    logger.info(
        f"[Profile {profile.profile_id}] ═══ REMAKE START ═══ "
        f"pipeline={pipeline_id} variant={vid} "
        f"avoid_segments={len(remake_avoid_ids)} "
        f"pinned={len(remake_pinned_assignments)} "
        f"(current_variant={len(current_segs)})"
    )

    # 5. Clear cancellation flags
    clear_pipeline_cancelled(pipeline_id)
    # Clear per-variant cancellation
    clear_variant_cancelled(pipeline_id, job_key)

    # 6. Fetch preset and DEFAULT subtitle settings. Per-Meta-version override
    # for this single remake is resolved inside do_remake below.
    preset_data, default_subtitle_settings = _fetch_preset_and_settings(render_request)
    # Persist override into the pipeline so subsequent reloads see it.
    # Defensive normalize (see the matching block in /render above) — stale
    # browser tabs sending legacy keys get canonicalized before storage.
    if render_request.subtitle_settings_by_key is not None:
        pipeline["subtitle_settings_by_key"] = _normalize_overrides(
            dict(render_request.subtitle_settings_by_key)
        )

    # 7. Acquire render lock and init job
    pipeline_id_str = str(pipeline_id)
    _evict_stale_render_locks()
    with _render_locks_meta_lock:
        if pipeline_id_str not in _render_locks:
            _render_locks[pipeline_id_str] = threading.Lock()
        render_jobs_lock = _render_locks[pipeline_id_str]

    state_lock = _get_pipeline_state_lock(pipeline_id)
    with state_lock:
        pipeline["render_jobs"][job_key] = {
            "status": "processing",
            "progress": 0,
            "current_step": "Remaking with new segments",
            "final_video_path": None,
            "error": None,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        if normalized_visual_version:
            pipeline["render_jobs"][job_key]["visual_version"] = normalized_visual_version
            if version_index is not None:
                pipeline["render_jobs"][job_key]["meta_platform"] = META_PROFILES[version_index].name

    _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])

    _profile_id = profile.profile_id
    script_text = scripts[vid]

    # Resolve effective subtitle settings for this remake (single variant, no
    # Meta). Key is just str(vid) because remake never goes through meta mul.
    _remake_effective_subtitle_settings, _ = _get_subtitle_settings_for_key(
        render_request, str(job_key), default_subtitle_settings
    )

    # 8. Background remake task
    async def do_remake():
        from app.services.ffmpeg_registry import active_job_key as _active_job_key_ctx
        _remake_scope = str(job_key)
        _registry_scope = f"{pipeline_id}:{_remake_scope}"
        _ctx_token = _active_job_key_ctx.set(_registry_scope)
        try:
            assembly_service = get_assembly_service()
            job = pipeline["render_jobs"][job_key]

            # Check for cancellation
            if is_pipeline_cancelled(pipeline_id) or is_variant_cancelled(pipeline_id, _remake_scope):
                with render_jobs_lock:
                    job["status"] = "cancelled"
                    job["current_step"] = "Cancelled by user"
                    job["progress"] = 0
                _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
                return

            # Disk space check
            check_disk_space(get_settings().output_dir)

            def on_progress(step_name: str, pct: int):
                with render_jobs_lock:
                    job["current_step"] = step_name
                    job["progress"] = pct

            # Extract overlay params
            variant_interstitial_slides = None
            if render_request.interstitial_slides:
                variant_slides = (
                    render_request.interstitial_slides.get(str(job_key))
                    or render_request.interstitial_slides.get(str(vid))
                    or render_request.interstitial_slides.get(vid)
                    or []
                )
                if variant_slides:
                    variant_interstitial_slides = variant_slides

            variant_pip_overlays = render_request.pip_overlays if render_request.pip_overlays else None

            # Render with NO match_overrides → auto-matching with strong avoid set
            try:
                final_video_path, raw_assembly_path, _seg_composition = await asyncio.wait_for(
                    assembly_service.assemble_and_render(
                        script_text=script_text,
                        profile_id=_profile_id,
                        preset_data=preset_data,
                        subtitle_settings=_remake_effective_subtitle_settings,
                        elevenlabs_model=render_request.elevenlabs_model,
                        voice_id=render_request.voice_id,
                        source_video_ids=render_request.source_video_ids,
                        match_overrides=None,  # Force auto-matching with new segments
                        enable_denoise=render_request.enable_denoise,
                        denoise_strength=render_request.denoise_strength,
                        enable_sharpen=render_request.enable_sharpen,
                        sharpen_amount=render_request.sharpen_amount,
                        enable_color=render_request.enable_color,
                        brightness=render_request.brightness,
                        contrast=render_request.contrast,
                        saturation=render_request.saturation,
                        voice_volume=render_request.voice_volume,
                        audio_fade_in=render_request.audio_fade_in,
                        audio_fade_out=render_request.audio_fade_out,
                        shadow_depth=render_request.shadow_depth,
                        enable_glow=render_request.enable_glow,
                        glow_blur=render_request.glow_blur,
                        adaptive_sizing=render_request.adaptive_sizing,
                        variant_index=effective_vid,
                        voice_settings=render_request.voice_settings,
                        reuse_audio_path=reuse_audio_path,
                        reuse_audio_duration=reuse_audio_duration,
                        reuse_srt_content=reuse_srt_content,
                        on_progress=on_progress,
                        max_words_per_phrase=render_request.words_per_subtitle,
                        min_segment_duration=render_request.min_segment_duration,
                        preset=render_request.preset or "balanced",
                        pinned_assignments=remake_pinned_assignments or None,
                        ultra_rapid_intro=render_request.ultra_rapid_intro,
                        interstitial_slides=variant_interstitial_slides,
                        pip_overlays=variant_pip_overlays,
                        avoid_segment_ids=remake_avoid_ids if remake_avoid_ids else None,
                        output_project_label=(pipeline.get("name") or pipeline.get("idea") or "").strip(),
                        output_script_label=script_text,
                        output_created_at=datetime.now(timezone.utc),
                        force_cpu=render_request.force_cpu,
                        visual_version_label=normalized_visual_version,
                    ),
                    timeout=1800 if preset_data.get("encoding_mode") == "vbr_2pass" else 900
                )
            except asyncio.TimeoutError:
                _timeout_mins = 30 if preset_data.get("encoding_mode") == "vbr_2pass" else 15
                raise Exception(f"Remake timed out after {_timeout_mins} minutes")

            # Guard: if the job was cancelled during the remake render, keep
            # the cancelled status instead of overwriting with "completed".
            if (
                is_pipeline_cancelled(pipeline_id)
                or is_variant_cancelled(pipeline_id, _remake_scope)
                or job.get("status") == "cancelled"
            ):
                with render_jobs_lock:
                    job["status"] = "cancelled"
                    job["progress"] = 0
                    job["current_step"] = "Cancelled by user"
                    if "cancelled_at" not in job:
                        job["cancelled_at"] = datetime.now(timezone.utc).isoformat()
                _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
                try:
                    if final_video_path and Path(final_video_path).exists():
                        Path(final_video_path).unlink(missing_ok=True)
                except Exception:
                    pass
                return

            # Success
            _remake_fingerprint = hashlib.sha256(
                f"remake_{job_key}_{datetime.now(timezone.utc).isoformat()}".encode()
            ).hexdigest()[:32]

            with render_jobs_lock:
                job["status"] = "completed"
                job["progress"] = 100
                job["current_step"] = "Remake complete"
                job["final_video_path"] = str(final_video_path)
                job["raw_video_path"] = str(raw_assembly_path)
                job["render_fingerprint"] = _remake_fingerprint
                job["completed_at"] = datetime.now(timezone.utc).isoformat()
                if normalized_visual_version:
                    job["visual_version"] = normalized_visual_version
                    if version_index is not None:
                        job["meta_platform"] = META_PROFILES[version_index].name

            _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])

            # Save/update clip in library
            await _save_clip_to_library(
                pipeline, pipeline_id, vid, final_video_path,
                _profile_id, _remake_fingerprint, render_jobs_lock,
                raw_assembly_path=raw_assembly_path,
                subtitle_settings=_remake_effective_subtitle_settings,
                segment_composition=_seg_composition,
                job_key=job_key,
                visual_version=normalized_visual_version,
                voice_settings=render_request.voice_settings,
            )

            logger.info(
                f"[Profile {_profile_id}] ═══ REMAKE COMPLETE ═══ "
                f"pipeline={pipeline_id} variant={vid} output={final_video_path}"
            )

        except Exception as e:
            _remake_job = pipeline.get("render_jobs", {}).get(job_key)
            _was_cancelled_remake = (
                is_pipeline_cancelled(pipeline_id)
                or is_variant_cancelled(pipeline_id, _remake_scope)
                or (isinstance(_remake_job, dict) and _remake_job.get("status") == "cancelled")
            )
            if _was_cancelled_remake:
                logger.info(
                    f"[Profile {_profile_id}] Pipeline {pipeline_id} "
                    f"remake {_remake_scope} raised after cancel: {e}"
                )
                if isinstance(_remake_job, dict):
                    with render_jobs_lock:
                        _remake_job["status"] = "cancelled"
                        _remake_job["progress"] = 0
                        _remake_job["current_step"] = "Cancelled by user"
                        if "cancelled_at" not in _remake_job:
                            _remake_job["cancelled_at"] = datetime.now(timezone.utc).isoformat()
                    _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
                return
            logger.error(
                f"[Profile {_profile_id}] Pipeline {pipeline_id} "
                f"variant {vid} remake failed: {e}"
            )
            with render_jobs_lock:
                job = pipeline["render_jobs"][job_key]
                job["status"] = "failed"
                job["progress"] = 0
                job["current_step"] = "Remake failed"
                job["error"] = str(e)
                job["failed_at"] = datetime.now(timezone.utc).isoformat()
            _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
        finally:
            try:
                _active_job_key_ctx.reset(_ctx_token)
            except Exception:
                pass

    # 9. Launch background task with render slot throttling
    async def _throttled_remake():
        async with await acquire_render_slot():
            await do_remake()

    with _render_locks_meta_lock:
        _render_locks_timestamps[pipeline_id_str] = _time_mod.monotonic()
    background_tasks.add_task(_throttled_remake)

    return {
        "status": "remaking",
        "pipeline_id": pipeline_id,
        "variant_index": variant_index,
        "job_key": str(job_key),
        "visual_version": normalized_visual_version,
    }


def _mark_stale_render_jobs(pipeline_id: str, pipeline: dict) -> None:
    """Flip 'processing' render jobs older than the stale threshold to 'failed'.

    A backend restart mid-render otherwise leaves them spinning forever in the
    UI and blocks resubmission (mirrors the stale check in the /render path).
    """
    changed = False
    for job in (pipeline.get("render_jobs") or {}).values():
        if not isinstance(job, dict) or job.get("status") != "processing":
            continue
        stale = True
        started_at = job.get("started_at")
        if started_at:
            try:
                started_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                stale = (datetime.now(timezone.utc) - started_dt).total_seconds() > STALE_PROCESSING_THRESHOLD_SEC
            except (ValueError, TypeError):
                pass  # unparseable timestamp → treat as stale
        if stale:
            job["status"] = "failed"
            job["progress"] = 0
            job["current_step"] = "Render failed (stale)"
            job["error"] = "Render did not survive a backend restart. Submit the render again."
            job["failed_at"] = datetime.now(timezone.utc).isoformat()
            changed = True
            logger.warning(f"Pipeline {pipeline_id}: marked stale 'processing' render job as failed")
    if changed:
        try:
            _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
        except Exception as db_err:
            logger.warning(f"Pipeline {pipeline_id}: failed to persist stale-job flip: {db_err}")


@router.get("/status/{pipeline_id}", response_model=PipelineStatusResponse)
async def get_pipeline_status(pipeline_id: str):
    """
    Get status of all variants in a pipeline.

    **Intentionally public** (no auth) — the pipeline UUID acts as an
    unguessable capability token, enabling status polling without
    re-authenticating on every request.  This is safe because:
    - UUIDs are 128-bit random (2^122 entropy with v4)
    - Pipeline IDs are never exposed in URLs visible to other users
    - Pipelines expire after 30 days (TTL enforced on read).
    """
    # Try in-memory first, then DB fallback
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    _restore_missing_tts_audio_paths(pipeline_id, pipeline)
    _mark_stale_render_jobs(pipeline_id, pipeline)

    # Enforce 30-day TTL
    created_at = pipeline.get("created_at", "")
    if created_at:
        try:
            created_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - created_dt).days > 30:
                raise HTTPException(status_code=404, detail="Pipeline expired")
        except (ValueError, TypeError):
            pass  # Can't parse date, skip TTL check

    # Build variants status list
    variants = []
    # Recovery: collect variant indices that need clip_id lookup
    _clip_id_recovery_needed: list[int] = []
    for idx in range(len(pipeline["scripts"])):
        if idx in pipeline["render_jobs"]:
            # Variant has a render job
            job = pipeline["render_jobs"][idx]
            # Sanitize error details for public endpoint
            sanitized_error = "Processing failed. Check server logs for details." if job.get("error") else None
            sanitized_lib_error = "Library save failed. Check server logs for details." if job.get("library_error") else None
            # M3: Strip absolute file paths — expose path relative to output_dir
            raw_video_path = job.get("final_video_path")
            raw_thumb_path = job.get("thumbnail_path")
            safe_video_path = _safe_relative_path(raw_video_path)
            safe_thumb_path = _safe_relative_path(raw_thumb_path)
            # Recovery: if completed but no clip_id, try to recover from editai_clips
            clip_id = job.get("clip_id")
            if job["status"] == "completed" and not clip_id:
                _clip_id_recovery_needed.append(idx)
            # BUG-PR-11: Sanitize public status — omit internal metadata (render_fingerprint, lock info)
            variants.append(VariantStatus(
                variant_index=idx,
                status=job["status"],
                progress=job["progress"],
                current_step=job["current_step"],
                final_video_path=safe_video_path,
                thumbnail_path=safe_thumb_path,
                clip_id=clip_id,
                error=sanitized_error,
                library_saved=job.get("library_saved"),
                library_error=sanitized_lib_error,
                render_fingerprint=job.get("render_fingerprint")
            ))
        else:
            # Variant not yet rendered
            variants.append(VariantStatus(
                variant_index=idx,
                status="not_started",
                progress=0,
                current_step="Not started",
                final_video_path=None,
                error=None
            ))

    # Meta multiplication: also include version-specific render entries (e.g. "0_A", "0_B")
    meta_variants = []
    for jk, job in pipeline.get("render_jobs", {}).items():
        if isinstance(jk, str) and "_" in jk:
            # Parse "0_A" → variant_index=0, visual_version="A"
            parts = str(jk).rsplit("_", 1)
            try:
                _meta_vid = int(parts[0])
            except (ValueError, TypeError):
                continue
            _meta_ver = parts[1] if len(parts) > 1 else None
            sanitized_error = "Processing failed. Check server logs for details." if job.get("error") else None
            sanitized_lib_error = "Library save failed. Check server logs for details." if job.get("library_error") else None
            raw_video_path = job.get("final_video_path")
            raw_thumb_path = job.get("thumbnail_path")
            safe_video_path = _safe_relative_path(raw_video_path)
            safe_thumb_path = _safe_relative_path(raw_thumb_path)
            meta_variants.append(VariantStatus(
                variant_index=_meta_vid,
                status=job["status"],
                progress=job["progress"],
                current_step=job["current_step"],
                final_video_path=safe_video_path,
                thumbnail_path=safe_thumb_path,
                clip_id=job.get("clip_id"),
                error=sanitized_error,
                library_saved=job.get("library_saved"),
                library_error=sanitized_lib_error,
                render_fingerprint=job.get("render_fingerprint"),
                visual_version=job.get("visual_version"),
                meta_platform=job.get("meta_platform"),
            ))

    # Force pair-by-pair order so the Step 4 grid renders A on the left and
    # B on the right within the same row (1A|1B, 2A|2B, ...). Without this,
    # render_jobs dict order can drift after Supabase JSONB round-trips and
    # produce A|A then B|B rows.
    meta_variants.sort(key=lambda v: (v.variant_index, v.visual_version or ""))

    # Recovery: look up missing clip_ids from editai_clips for completed variants.
    # Plan 81-02 Task 4 — migrated from the direct supabase import escape hatch
    # to repo.list_clips. The B-81-01 disposition closes the get_pipeline_status
    # escape hatch entirely.
    if _clip_id_recovery_needed:
        library_project_id = pipeline.get("library_project_id")
        if library_project_id:
            try:
                repo_status = get_repository()
                for vid in _clip_id_recovery_needed:
                    try:
                        # Query with visual_version=NULL for standard (non-meta) clips.
                        # list_clips eq does not natively support IS NULL, so we filter
                        # client-side for visual_version is None after fetching matching
                        # rows by project_id + variant_index + is_deleted=False.
                        _clip_result = repo_status.list_clips(
                            library_project_id,
                            QueryFilters(
                                eq={"variant_index": vid, "is_deleted": False},
                                select="id, visual_version",
                                limit=10,
                            ),
                        )
                        _matching = [
                            r for r in (_clip_result.data or [])
                            if r.get("visual_version") is None
                        ]
                        if _matching:
                            recovered_id = _matching[0]["id"]
                            # Update the variant in the response
                            for v in variants:
                                if v.variant_index == vid and not v.visual_version:
                                    v.clip_id = recovered_id
                                    break
                            # Persist recovery to render_jobs so future calls don't need lookup
                            if vid in pipeline.get("render_jobs", {}):
                                pipeline["render_jobs"][vid]["clip_id"] = recovered_id
                            logger.info(f"Recovered clip_id {recovered_id} for variant {vid}")
                    except Exception as clip_err:
                        logger.warning(f"clip_id recovery failed for variant {vid}: {clip_err}")

                # Also recover meta multiplication clip_ids
                for mv in meta_variants:
                    if mv.status == "completed" and not mv.clip_id and mv.visual_version:
                        try:
                            _meta_clip_result = repo_status.list_clips(
                                library_project_id,
                                QueryFilters(
                                    eq={
                                        "variant_index": mv.variant_index,
                                        "visual_version": mv.visual_version,
                                        "is_deleted": False,
                                    },
                                    select="id",
                                    limit=1,
                                ),
                            )
                            if _meta_clip_result.data:
                                _recovered_meta_id = _meta_clip_result.data[0]["id"]
                                mv.clip_id = _recovered_meta_id
                                _meta_jk = f"{mv.variant_index}_{mv.visual_version}"
                                if _meta_jk in pipeline.get("render_jobs", {}):
                                    pipeline["render_jobs"][_meta_jk]["clip_id"] = _recovered_meta_id
                                logger.info(f"Recovered meta clip_id {_recovered_meta_id} for variant {mv.variant_index} ver={mv.visual_version}")
                        except Exception as meta_clip_err:
                            logger.warning(f"Meta clip_id recovery failed for {mv.variant_index}_{mv.visual_version}: {meta_clip_err}")

                # Persist recovered clip_ids to DB
                _db_update_render_jobs(pipeline_id, pipeline.get("render_jobs", {}))
            except Exception as recovery_err:
                logger.warning(f"clip_id recovery batch failed: {recovery_err}")

    # Build preview_info from stored previews
    preview_info: Dict[str, VariantPreviewInfo] = {}
    for idx_key, preview_data in pipeline.get("previews", {}).items():
        pd = preview_data.get("preview_data", {}) if isinstance(preview_data, dict) else {}
        audio_path_str = pd.get("audio_path")
        has_audio = bool(audio_path_str and Path(audio_path_str).exists())
        audio_duration = pd.get("audio_duration", 0.0) if has_audio else 0.0
        has_srt = bool(pd.get("srt_content"))
        preview_info[str(idx_key)] = VariantPreviewInfo(
            has_audio=has_audio,
            audio_duration=audio_duration,
            has_srt=has_srt
        )

    # Build tts_info from stored tts_previews (Step 2 per-script TTS)
    tts_info: Dict[str, VariantTtsInfo] = {}
    for idx_key, tts_data in pipeline.get("tts_previews", {}).items():
        if isinstance(tts_data, dict):
            audio_path_str = tts_data.get("audio_path")
            has_audio = bool(audio_path_str and Path(audio_path_str).exists())
            audio_duration = tts_data.get("audio_duration", 0.0) if has_audio else 0.0
            tts_info[str(idx_key)] = VariantTtsInfo(
                has_audio=has_audio,
                audio_duration=audio_duration,
                approved=bool(tts_data.get("approved", False)),
            )

    # PIP-10: scripts removed from status polling response to reduce payload
    return PipelineStatusResponse(
        pipeline_id=pipeline_id,
        provider=pipeline["provider"],
        variant_count=len(pipeline["scripts"]),
        variants=variants,
        meta_variants=meta_variants if meta_variants else None,
        meta_multiplication=bool(pipeline.get("meta_multiplication", True)),
        preview_info=preview_info,
        tts_info=tts_info,
        library_project_id=pipeline.get("library_project_id"),
    )


@router.get("/scripts/{pipeline_id}")
async def get_pipeline_scripts(pipeline_id: str):
    """
    PIP-10: Dedicated endpoint for retrieving pipeline scripts.

    Separated from /status to keep polling responses lightweight.
    Intentionally public (same pattern as /status) — pipeline UUID
    acts as capability token.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    _restore_missing_tts_audio_paths(pipeline_id, pipeline)

    # Build preview_info from stored previews (needed for history restore)
    preview_info: Dict[str, dict] = {}
    for idx_key, preview_data in pipeline.get("previews", {}).items():
        pd = preview_data.get("preview_data", {}) if isinstance(preview_data, dict) else {}
        audio_path_str = pd.get("audio_path")
        has_audio = bool(audio_path_str and Path(audio_path_str).exists())
        audio_duration = pd.get("audio_duration", 0.0) if has_audio else 0.0
        has_srt = bool(pd.get("srt_content"))
        preview_info[str(idx_key)] = {
            "has_audio": has_audio,
            "audio_duration": audio_duration,
            "has_srt": has_srt,
        }

    # Build tts_info from stored tts_previews (Step 2 per-script TTS)
    tts_info: Dict[str, dict] = {}
    for idx_key, tts_data in pipeline.get("tts_previews", {}).items():
        if isinstance(tts_data, dict):
            audio_path_str = tts_data.get("audio_path")
            has_audio = bool(audio_path_str and Path(audio_path_str).exists())
            audio_duration = tts_data.get("audio_duration", 0.0) if has_audio else 0.0
            tts_info[str(idx_key)] = {
                "has_audio": has_audio,
                "audio_duration": audio_duration,
                "approved": bool(tts_data.get("approved", False)),
            }

    return {
        "pipeline_id": pipeline_id,
        "scripts": pipeline.get("scripts", []),
        "context_products": pipeline.get("context_products", []),
        "preview_info": preview_info,
        "tts_info": tts_info,
        "captions": pipeline.get("captions", {}),
        "selected_captions": pipeline.get("selected_captions", {}),
        "name": pipeline.get("name", ""),
        "idea": pipeline.get("idea", ""),
        "context": _strip_embedded_product_blocks(pipeline.get("context", "")),
        "provider": pipeline.get("provider", "gemini"),
        "variant_count": pipeline.get("variant_count", len(pipeline.get("scripts", []))),
        "meta_multiplication": bool(pipeline.get("meta_multiplication", True)),
        "library_project_id": pipeline.get("library_project_id"),
    }


@router.post("/sync-to-library/{pipeline_id}")
async def sync_pipeline_to_library(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Sync completed pipeline render jobs to the library.

    Creates a library project (if not exists) and inserts clips for each
    completed variant that doesn't already have a clip row.  This is a
    recovery mechanism for when the post-render library-save step failed
    silently.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    repo = get_repository()
    # Plan 81-02 Task 3 — repo is always usable under DATA_BACKEND=sqlite (FUNC-01);
    # the legacy bare-client guard and its 503 fallback were dead code and have
    # been removed (mirrors Phase 80's dead-503-guard pattern).
    # Load profile defaults so we can reconstruct the effective subtitle style
    # for clips that have no explicit per-key override. This mirrors what
    # do_render writes via _save_clip_to_library so recovery sync produces
    # the same clip_content shape as a fresh render.
    try:
        _profile_row = repo.get_profile(profile.profile_id) or {}
    except Exception as _prof_err:
        logger.warning(f"sync-to-library: failed to load profile defaults: {_prof_err}")
        _profile_row = {}
    _sync_default_subtitle: Dict[str, Any] = dict(_profile_row.get("subtitle_settings") or {})
    _sync_overrides_by_key: Dict[str, Any] = pipeline.get("subtitle_settings_by_key") or {}

    def _resolve_sync_subtitle_settings(_vid: int, _ver_label: Optional[str]) -> Optional[dict]:
        """Best-effort reconstruction of the effective subtitle_settings used at
        render time, for sync-to-library recovery. Precedence (mirrors do_render):
          1. user override for this Meta version (Meta overlay suppressed)
          2. profile default + Meta overlay (when version label present)
          3. profile default
        Returns None when no defaults are available at all (preserves whatever
        is already in editai_clip_content via the upsert merge semantics).

        Lookup key is the StyleKey ("A" / "B" / "default"), not the per-script
        PreviewKey — subtitle style is now shared across all scripts under
        the same Meta version.
        """
        _sync_key = _ver_label or "default"
        _override = _sync_overrides_by_key.get(_sync_key)
        if isinstance(_override, dict) and _override:
            # User override wins completely; Meta overlay suppressed.
            if not _sync_default_subtitle:
                return dict(_override)
            return {**_sync_default_subtitle, **_override}
        if not _sync_default_subtitle:
            return None
        # No override → start from profile default and apply Meta overlay if applicable.
        _resolved = dict(_sync_default_subtitle)
        if _ver_label:
            _meta_profile = META_PROFILES_BY_NAME.get(
                {"A": "instagram", "B": "facebook"}.get(_ver_label, "")
            )
            if _meta_profile is not None:
                _resolved.update(_meta_profile.subtitle_style)
        return _resolved

    render_jobs: dict = pipeline.get("render_jobs", {})
    completed_variants = {}
    for k, v in render_jobs.items():
        if not (isinstance(v, dict) and v.get("status") == "completed" and v.get("final_video_path")):
            continue
        # Meta multiplication keys are strings like "0_A"; standard keys are ints
        if isinstance(k, str) and "_" in k:
            completed_variants[k] = v
        else:
            try:
                completed_variants[int(k)] = v
            except (ValueError, TypeError):
                continue

    if not completed_variants:
        return {"synced": 0, "message": "No completed variants to sync"}

    # PIP-13: Lock the SELECT+INSERT for library project to prevent races
    pipeline_name = (pipeline.get("name") or pipeline.get("idea", ""))[:80].strip() or f"Pipeline {pipeline_id[:8]}"
    legacy_name = f"Pipeline: {pipeline.get('idea', '')[:80]}"
    with _library_project_lock:
        # Lookup-or-create the library project. Plan 81-02 Task 3.B —
        # repo.get_project_by_name composes profile_id + name; fall back to legacy
        # "Pipeline: {idea}" naming for older projects before attempting create.
        existing_proj = repo.get_project_by_name(profile.profile_id, pipeline_name)

        if not existing_proj and pipeline_name != legacy_name:
            existing_proj = repo.get_project_by_name(profile.profile_id, legacy_name)

        if existing_proj:
            library_project_id = existing_proj["id"]
        else:
            try:
                created_proj = repo.create_project({
                    "profile_id": profile.profile_id,
                    "name": pipeline_name,
                    "description": f"Auto-generated from pipeline {pipeline_id}",
                    "status": "completed",
                })
            except Exception as create_err:
                # Race: another worker created it between the lookup and insert.
                _retry_proj = repo.get_project_by_name(profile.profile_id, pipeline_name)
                if _retry_proj:
                    library_project_id = _retry_proj["id"]
                    created_proj = None
                else:
                    raise
            else:
                if not (created_proj and created_proj.get("id")):
                    raise HTTPException(status_code=500, detail="Failed to create library project")
                library_project_id = created_proj["id"]

    # Check which clips already exist (fetch id + variant_index + visual_version for update)
    # Plan 81-02 Task 3.C — repo.list_clips composes project_id + eq(is_deleted=False).
    clip_supports_visual_version = True
    try:
        existing_clips_result = repo.list_clips(
            library_project_id,
            QueryFilters(eq={"is_deleted": False}, select="id, variant_index, visual_version"),
        )
        existing_clips_data = existing_clips_result.data or []
    except Exception as existing_clips_err:
        if _is_missing_column_error(existing_clips_err, "visual_version"):
            clip_supports_visual_version = False
            logger.warning("visual_version column missing, retrying sync lookup without it")
            existing_clips_result = repo.list_clips(
                library_project_id,
                QueryFilters(eq={"is_deleted": False}, select="id, variant_index"),
            )
            existing_clips_data = existing_clips_result.data or []
        else:
            raise
    # Key by (variant_index, visual_version) to differentiate A/B versions
    existing_map = {}
    for c in existing_clips_data:
        _em_key = (c["variant_index"], c.get("visual_version") if clip_supports_visual_version else None)
        existing_map[_em_key] = c["id"]

    synced = 0
    for job_key, job in sorted(completed_variants.items(), key=lambda x: str(x[0])):
        # Parse job_key: integer for standard, "N_X" for meta multiplication
        _visual_ver = job.get("visual_version")  # "A", "B", or None
        if isinstance(job_key, str) and "_" in str(job_key):
            parts = str(job_key).rsplit("_", 1)
            try:
                vid = int(parts[0])
            except (ValueError, TypeError):
                continue
            if not _visual_ver:
                _visual_ver = parts[1] if len(parts) > 1 else None
        else:
            vid = int(job_key) if not isinstance(job_key, int) else job_key

        final_video_path = Path(job["final_video_path"])
        if not final_video_path.exists():
            logger.warning(f"Pipeline {pipeline_id} variant {vid}: video file not found at {final_video_path}")
            continue

        # Resolve raw assembly path (no subtitles) for voiceover regeneration
        _raw_path_str = job.get("raw_video_path")
        _raw_assembly_path = Path(_raw_path_str) if _raw_path_str and Path(_raw_path_str).exists() else None

        # Thumbnail
        thumb_path = None
        try:
            thumb_dir = final_video_path.parent / "thumbnails"
            thumb_dir.mkdir(parents=True, exist_ok=True)
            thumb_path = thumb_dir / f"{final_video_path.stem}_thumb.jpg"
            if not thumb_path.exists():
                await asyncio.to_thread(safe_ffmpeg_run, [
                    "ffmpeg", "-y", "-ss", "1", "-i", str(final_video_path),
                    "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "3",
                    str(thumb_path)
                ], 30, "sync thumbnail")
            if not thumb_path.exists():
                thumb_path = None
        except Exception:
            thumb_path = None

        # Duration
        duration = None
        try:
            dur_result = await asyncio.to_thread(safe_ffmpeg_run, [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(final_video_path)
            ], 30, "sync duration probe")
            if dur_result.returncode == 0:
                try:
                    duration = float(dur_result.stdout.strip())
                except ValueError:
                    logger.warning(f"ffprobe returned non-numeric duration: {dur_result.stdout.strip()!r}")
        except Exception:
            pass

        # Upsert clip keyed by (variant_index, visual_version) to prevent A overwriting B
        clip_id_to_set = None
        _em_lookup = (vid, _visual_ver)
        if _em_lookup in existing_map:
            existing_id = existing_map[_em_lookup]
            # Plan 81-02 Task 3.D — repo.update_clip migration.
            repo.update_clip(existing_id, {
                "raw_video_path": str(_raw_assembly_path) if _raw_assembly_path else str(final_video_path),
                "final_video_path": str(final_video_path),
                "thumbnail_path": str(thumb_path) if thumb_path else None,
                "duration": duration,
                "final_status": "completed",
                "is_deleted": False,
            })
            clip_id_to_set = existing_id
            logger.info(f"Pipeline {pipeline_id} variant {vid} ver={_visual_ver}: updated existing clip {existing_id}")
        else:
            clip_insert_payload = {
                "project_id": library_project_id,
                "profile_id": profile.profile_id,
                "variant_index": vid,
                "variant_name": f"variant_{vid + 1}" + (f"_{_visual_ver}" if _visual_ver else ""),
                "raw_video_path": str(_raw_assembly_path) if _raw_assembly_path else str(final_video_path),
                "final_video_path": str(final_video_path),
                "thumbnail_path": str(thumb_path) if thumb_path else None,
                "duration": duration,
                "is_selected": False,
                "is_deleted": False,
                "final_status": "completed"
            }
            if clip_supports_visual_version:
                clip_insert_payload["visual_version"] = _visual_ver
            # Plan 81-02 Task 3.E — repo.create_clip migration.
            try:
                created_clip = repo.create_clip(clip_insert_payload)
            except Exception as clip_insert_err:
                if _is_missing_column_error(clip_insert_err, "visual_version"):
                    clip_supports_visual_version = False
                    logger.warning("visual_version column missing, retrying sync INSERT without it")
                    clip_insert_payload.pop("visual_version", None)
                    created_clip = repo.create_clip(clip_insert_payload)
                else:
                    raise
            if created_clip and created_clip.get("id"):
                clip_id_to_set = created_clip["id"]

        # BUG-PR-15: Protect render_jobs mutations under state lock
        sync_state_lock = _get_pipeline_state_lock(pipeline_id)
        with sync_state_lock:
            if clip_id_to_set:
                job["clip_id"] = clip_id_to_set
            job["library_saved"] = True
            job.pop("library_error", None)

        # Save script text, SRT, caption, and subtitle_settings to clip_content
        if clip_id_to_set:
            try:
                _script_text = pipeline.get("scripts", [])[vid] if vid < len(pipeline.get("scripts", [])) else None
                _tts_data = pipeline.get("tts_previews", {}).get(vid) or pipeline.get("tts_previews", {}).get(str(vid), {})
                _srt = _tts_data.get("srt_content") if _tts_data else None
                _audio_path = _tts_data.get("audio_path") if _tts_data else None
                _caption = pipeline.get("selected_captions", {}).get(str(vid))
                _content_payload = {"clip_id": clip_id_to_set}
                if _script_text:
                    _content_payload["tts_text"] = _script_text
                if _srt:
                    _content_payload["srt_content"] = _srt
                if _audio_path:
                    _content_payload["tts_audio_path"] = _audio_path
                if str(vid) in pipeline.get("selected_captions", {}):
                    _content_payload["caption"] = _caption or ""
                # Per-variant subtitle settings: reconstruct the effective
                # style that the render produced (override > profile default
                # + Meta overlay > profile default). Mirrors the do_render
                # path so recovery sync writes the same clip_content shape.
                _ss_value = _resolve_sync_subtitle_settings(vid, _visual_ver)
                if isinstance(_ss_value, dict) and _ss_value:
                    _content_payload["subtitle_settings"] = _ss_value
                if len(_content_payload) > 1:
                    # Plan 81-02 Task 3.F — table_query upsert with on_conflict='clip_id'
                    # because update_clip_content is UPDATE-only on both backends (Phase 80 lesson).
                    repo.table_query(
                        "editai_clip_content",
                        "upsert",
                        data=_content_payload,
                        filters=QueryFilters(on_conflict="clip_id"),
                    )
                    logger.info(f"Pipeline {pipeline_id} variant {vid}: saved clip_content for clip {clip_id_to_set}")
            except Exception as cc_err:
                logger.warning(f"Pipeline {pipeline_id} variant {vid}: failed to save clip_content: {cc_err}")

        # Increment usage_count for segments used in this variant (skip if already done by render).
        # W-81-01 signature: first arg is None (ignored — helper goes through get_repository()).
        try:
            used_seg_ids = pipeline.get("segment_usage", {}).get(str(vid), [])
            if used_seg_ids and not job.get("usage_incremented"):
                _increment_segment_usage(None, used_seg_ids)
                job["usage_incremented"] = True
                logger.info(
                    f"Pipeline {pipeline_id} variant {vid}: incremented "
                    f"usage_count for {len(used_seg_ids)} segments"
                )
        except Exception as usage_err:
            logger.warning(
                f"Pipeline {pipeline_id} variant {vid}: failed to "
                f"increment segment usage_count: {usage_err}"
            )

        synced += 1
        logger.info(f"Pipeline {pipeline_id} variant {vid} synced to library project {library_project_id}")

    # Persist updated render_jobs (with library_saved flags)
    if synced > 0:
        _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])

    # Update project variants_count. Plan 81-02 Task 3.G — repo.count_clips composes
    # profile_id (outer scope) + eq(project_id, is_deleted). project_id alone uniquely
    # scopes clips since projects are owned by profiles, so the profile_id wrap is
    # consistent with the Supabase semantics.
    if synced > 0:
        total_clips_count = repo.count_clips(
            profile.profile_id,
            QueryFilters(eq={"project_id": library_project_id, "is_deleted": False}),
        )
        repo.update_project(library_project_id, {"variants_count": total_clips_count or synced})

    return {
        "synced": synced,
        "library_project_id": library_project_id,
        "message": f"Synced {synced} variant(s) to library"
    }


@router.get("/{pipeline_id}/restore-previews")
async def restore_previews(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Return stored preview match data for all variants in a pipeline.

    Used by the frontend to restore full preview state when importing a
    pipeline from history that already has previews generated. Returns
    the same shape as PipelinePreviewResponse keyed by variant index.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    stored_previews = pipeline.get("previews", {})
    if not stored_previews:
        return {"previews": {}, "available_segments": []}

    result_previews = {}
    all_available_segments = []

    for idx_key, preview_entry in stored_previews.items():
        pd = preview_entry.get("preview_data", {}) if isinstance(preview_entry, dict) else {}
        if not pd or not pd.get("matches"):
            continue

        # BUG-PR-17: Strip absolute paths — only return filenames
        matches = [
            {
                "srt_index": m.get("srt_index", 0),
                "srt_text": m.get("srt_text", ""),
                "srt_start": m.get("srt_start", 0),
                "srt_end": m.get("srt_end", 0),
                "segment_id": m.get("segment_id"),
                "segment_keywords": m.get("segment_keywords", []),
                "matched_keyword": m.get("matched_keyword"),
                "confidence": m.get("confidence", 0),
                "is_auto_filled": m.get("is_auto_filled", False),
                "source_video_id": m.get("source_video_id"),
                "segment_start_time": m.get("segment_start_time"),
                "segment_end_time": m.get("segment_end_time"),
                "thumbnail_path": Path(m["thumbnail_path"]).name if m.get("thumbnail_path") else None,
                "merge_group": m.get("merge_group"),
                "merge_group_duration": m.get("merge_group_duration"),
                "transforms": m.get("transforms"),
            }
            for m in pd.get("matches", [])
        ]

        result_previews[str(idx_key)] = {
            "audio_duration": pd.get("audio_duration", 0),
            "srt_content": pd.get("srt_content", ""),
            "matches": matches,
            "total_phrases": pd.get("total_phrases", len(matches)),
            "matched_count": pd.get("matched_count", 0),
            "unmatched_count": pd.get("unmatched_count", 0),
            "available_segments": pd.get("available_segments", []),
        }

        # Grab available_segments from the first preview that has them
        if not all_available_segments and pd.get("available_segments"):
            all_available_segments = pd["available_segments"]

    return {"previews": result_previews, "available_segments": all_available_segments}


class SaveMatchesRequest(BaseModel):
    """Persist Step-3 timeline edits (F3): the edited matches for one variant."""
    matches: List[dict]
    visual_version: Optional[str] = None


@router.put("/{pipeline_id}/matches/{variant_index}")
async def save_matches(
    pipeline_id: str,
    variant_index: int,
    body: SaveMatchesRequest,
    profile: ProfileContext = Depends(get_profile_context),
):
    """
    Persist edited timeline matches for a variant (F3 — pipeline persistence).

    Before this endpoint, Step-3 timeline edits lived only in frontend state and
    were lost on restart/navigation; the persisted previews kept the original
    auto-match. Writes into previews[key].preview_data.matches so the existing
    /restore-previews flow returns the edited timeline on resume.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    preview_key = _build_preview_key(variant_index, body.visual_version)
    state_lock = _get_pipeline_state_lock(pipeline_id, profile.profile_id)
    with state_lock:
        previews = pipeline.setdefault("previews", {})
        # DB-loaded plain-variant keys are ints, freshly computed ones are strings
        entry = previews.get(preview_key)
        if entry is None and body.visual_version is None:
            entry = previews.get(variant_index)
        if not isinstance(entry, dict) or "preview_data" not in entry:
            raise HTTPException(
                status_code=404,
                detail=f"No preview exists for variant {preview_key} — generate a preview first",
            )
        pd = entry["preview_data"]
        pd["matches"] = body.matches
        matched = sum(1 for m in body.matches if m.get("segment_id"))
        pd["matched_count"] = matched
        pd["unmatched_count"] = len(body.matches) - matched
        entry["timestamp"] = datetime.now(timezone.utc).isoformat()

    # Persist outside the lock (DB I/O should not hold the state lock)
    _db_save_pipeline(pipeline_id, pipeline)
    return {
        "status": "saved",
        "preview_key": preview_key,
        "match_count": len(body.matches),
    }


@router.get("/audio/{pipeline_id}/{variant_index}")
async def get_pipeline_audio(
    pipeline_id: str,
    variant_index: int,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Stream the preview audio MP3 for a specific pipeline variant.

    Requires authentication — only the owning profile can access audio.
    """
    # Fast path: check in-memory cache first, fall back to DB load via thread
    with _pipelines_lock:
        pipeline = _pipelines.get(pipeline_id)
    if not pipeline:
        pipeline = await asyncio.to_thread(_get_pipeline_or_load, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    _restore_missing_tts_audio_paths(pipeline_id, pipeline)

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    # Look up audio path from preview data
    preview = pipeline.get("previews", {}).get(variant_index)
    if not preview:
        # Fall back to Step 2 TTS preview audio
        tts_preview = pipeline.get("tts_previews", {}).get(variant_index) or \
                      pipeline.get("tts_previews", {}).get(str(variant_index))
        if tts_preview:
            audio_path_str = tts_preview.get("audio_path")
            if audio_path_str:
                audio_path = Path(audio_path_str)
                if audio_path.exists():
                    return FileResponse(path=str(audio_path), media_type="audio/mpeg",
                        content_disposition_type="inline",
                        headers={"Cache-Control": "no-cache"})
        raise HTTPException(status_code=404, detail="No preview available for this variant")

    preview_data = preview.get("preview_data", {})
    audio_path_str = preview_data.get("audio_path")

    if not audio_path_str:
        raise HTTPException(status_code=404, detail="No audio file for this variant")

    audio_path = Path(audio_path_str)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file no longer exists on disk")

    return FileResponse(
        path=str(audio_path),
        media_type="audio/mpeg",
        content_disposition_type="inline",
        headers={"Cache-Control": "no-cache"}
    )


# ============== SERVER-SIDE PREVIEW RENDER ENDPOINTS ==============

class PreviewRenderRequest(BaseModel):
    """Request model for server-side FFmpeg preview render."""
    match_overrides: List[dict]
    source_video_ids: Optional[List[str]] = None
    min_segment_duration: float = 3.0
    subtitle_settings: Optional[dict] = None
    words_per_subtitle: int = Field(default=2, ge=1, le=20)  # BUG-PR-19
    ultra_rapid_intro: bool = True  # Match PipelineRenderRequest default
    interstitial_slides: Optional[List[dict]] = None
    pip_overlays: Optional[Dict[str, dict]] = None
    enable_denoise: bool = False
    denoise_strength: float = 2.0
    enable_sharpen: bool = False
    sharpen_amount: float = 0.5
    enable_color: bool = False
    brightness: float = 0.0
    contrast: float = 1.0
    saturation: float = 1.0
    # Audio adjust
    voice_volume: float = Field(default=1.0, ge=0.0, le=3.0)
    audio_fade_in: float = Field(default=0.0, ge=0.0, le=10.0)
    audio_fade_out: float = Field(default=0.0, ge=0.0, le=10.0)
    visual_version: Optional[str] = None

    # BUG-PR-14: Validate source_video_ids are valid UUIDs
    @field_validator("source_video_ids")
    @classmethod
    def _validate_uuid_format(cls, values):
        if values is None:
            return values
        _uuid_re = _re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", _re.IGNORECASE)
        for value in values:
            if not isinstance(value, str) or not _uuid_re.match(value):
                raise ValueError(f"Invalid UUID format: {value!r}")
        return values


class PreviewRenderStatusResponse(BaseModel):
    """Response model for preview render status."""
    status: str  # "processing", "completed", "failed"
    progress: int = 0
    current_step: str = ""
    matches_fingerprint: Optional[str] = None
    error: Optional[str] = None
    preview_limitations: Optional[List[str]] = None


def _normalize_meta_version_label(visual_version: Optional[str]) -> Optional[str]:
    if visual_version is None:
        return None
    normalized = str(visual_version).strip().upper()
    if not normalized:
        return None
    if normalized not in {get_version_label(i) for i in range(len(META_PROFILES))}:
        raise HTTPException(status_code=400, detail=f"Invalid visual_version: {visual_version}")
    return normalized


def _build_preview_key(variant_index: int, visual_version: Optional[str] = None) -> str:
    normalized = _normalize_meta_version_label(visual_version)
    return f"{variant_index}_{normalized}" if normalized else str(variant_index)


def _resolve_meta_preview_variant(
    variant_index: int,
    visual_version: Optional[str] = None,
) -> tuple[str, int, Optional[Dict[str, object]], Optional[str], Optional[str]]:
    normalized = _normalize_meta_version_label(visual_version)
    if not normalized:
        return str(variant_index), variant_index, None, None, None

    version_index = next(
        (i for i in range(len(META_PROFILES)) if get_version_label(i) == normalized),
        None,
    )
    if version_index is None:
        raise HTTPException(status_code=400, detail=f"Invalid visual_version: {visual_version}")

    profile = META_PROFILES[version_index]
    preview_key = f"{variant_index}_{normalized}"
    effective_variant_index = variant_index + profile.segment_offset
    return preview_key, effective_variant_index, profile.subtitle_style, normalized, profile.name


@router.post("/render-preview/{pipeline_id}/{variant_index}")
@limiter.limit("10/minute")
async def render_preview(
    request: Request,
    pipeline_id: str,
    variant_index: int,
    render_request: PreviewRenderRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Start a fast server-side FFmpeg preview render for a variant.

    Uses 540x960, ultrafast encoding, CRF 32, no loudnorm.
    Produces a real MP4 that matches the final render's segment order.
    Requires TTS audio + SRT to already exist in pipeline["tts_previews"].
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    if variant_index < 0 or variant_index >= len(pipeline["scripts"]):
        raise HTTPException(status_code=400, detail=f"Invalid variant_index: {variant_index}")

    preview_key, effective_variant_index, subtitle_style_override, normalized_visual_version, _meta_platform = _resolve_meta_preview_variant(
        variant_index,
        render_request.visual_version,
    )

    # Validate TTS audio exists
    _tts = pipeline.get("tts_previews", {})
    tts_data = _tts.get(variant_index) or _tts.get(str(variant_index))
    if not tts_data:
        raise HTTPException(
            status_code=400,
            detail=f"No voice-over exists for variant {variant_index + 1}. Generate the voice-over first (Step 2).",
        )

    audio_path_str = tts_data.get("audio_path")
    if not audio_path_str or not Path(audio_path_str).exists():
        # Self-heal: temp file may be gone but a persistent library copy usually exists
        if _restore_missing_tts_audio_paths(pipeline_id, pipeline):
            _tts = pipeline.get("tts_previews", {})
            tts_data = _tts.get(variant_index) or _tts.get(str(variant_index)) or tts_data
            audio_path_str = tts_data.get("audio_path")
    if not audio_path_str or not Path(audio_path_str).exists():
        raise HTTPException(
            status_code=400,
            detail=f"Voice-over audio file for variant {variant_index + 1} is missing from disk. Regenerate the voice-over (Step 2).",
        )

    try:
        audio_mtime = str(Path(audio_path_str).stat().st_mtime)
    except OSError:
        audio_mtime = "0"

    preview_fingerprint_payload = {
        "variant_index": variant_index,
        "effective_variant_index": effective_variant_index,
        "visual_version": normalized_visual_version or "",
        "matches": [
            {
                "index": i,
                "srt_index": m.get("srt_index"),
                "segment_id": m.get("segment_id"),
                "source_video_id": m.get("source_video_id"),
                "segment_start_time": m.get("segment_start_time"),
                "segment_end_time": m.get("segment_end_time"),
                "duration_override": m.get("duration_override"),
                "merge_group": m.get("merge_group"),
                "merge_group_duration": m.get("merge_group_duration"),
                "transforms": m.get("transforms") or {},
            }
            for i, m in enumerate(render_request.match_overrides)
        ],
        "source_video_ids": sorted(render_request.source_video_ids or []),
        "min_segment_duration": render_request.min_segment_duration,
        "words_per_subtitle": render_request.words_per_subtitle,
        "ultra_rapid_intro": render_request.ultra_rapid_intro,
        "interstitial_slides": render_request.interstitial_slides or [],
        "pip_overlays": render_request.pip_overlays or {},
        "subtitle_settings": render_request.subtitle_settings or {},
        "subtitle_style_override": subtitle_style_override or {},
        "filters": {
            "enable_denoise": render_request.enable_denoise,
            "denoise_strength": render_request.denoise_strength,
            "enable_sharpen": render_request.enable_sharpen,
            "sharpen_amount": render_request.sharpen_amount,
            "enable_color": render_request.enable_color,
            "brightness": render_request.brightness,
            "contrast": render_request.contrast,
            "saturation": render_request.saturation,
            "voice_volume": render_request.voice_volume,
            "audio_fade_in": render_request.audio_fade_in,
            "audio_fade_out": render_request.audio_fade_out,
        },
        "audio_mtime": audio_mtime,
    }
    matches_fingerprint = hashlib.sha256(_json.dumps(
        preview_fingerprint_payload,
        sort_keys=True,
        default=str,
    ).encode()).hexdigest()[:16]

    # Initialize preview_renders dict if needed
    if "preview_renders" not in pipeline:
        pipeline["preview_renders"] = {}

    # Cache hit: if fingerprint matches + file exists, return completed immediately
    existing = pipeline["preview_renders"].get(preview_key)
    if existing:
        if (existing.get("matches_fingerprint") == matches_fingerprint
                and existing.get("status") == "completed"
                and existing.get("preview_video_path")
                and Path(existing["preview_video_path"]).exists()):
            return {"status": "completed", "matches_fingerprint": matches_fingerprint}

        # Clean up old preview file before starting new render
        old_path = existing.get("preview_video_path")
        if old_path and Path(old_path).exists():
            try:
                Path(old_path).unlink()
            except Exception:
                pass

    # PIP-05: Per-pipeline preview lock to prevent concurrent preview renders from racing
    preview_lock_key = f"{pipeline_id}:{preview_key}"
    with _preview_locks_meta_lock:
        if preview_lock_key not in _preview_locks:
            _preview_locks[preview_lock_key] = asyncio.Lock()
        preview_lock = _preview_locks[preview_lock_key]

    # Try to acquire preview lock non-blocking — if another preview is in progress, skip
    if preview_lock.locked():
        existing_state = pipeline.get("preview_renders", {}).get(preview_key)
        if existing_state and existing_state.get("status") == "processing":
            return {"status": "processing", "matches_fingerprint": existing_state.get("matches_fingerprint")}
        # Lock held but no processing state — a previous request died between
        # acquire and its background task's finally. Reclaim the orphan lock
        # instead of returning a permanent 409.
        logger.warning(
            f"Pipeline {pipeline_id}: reclaiming orphaned preview lock for {preview_key}"
        )
        try:
            preview_lock.release()
        except RuntimeError:
            pass  # released concurrently — fine, we acquire below
        await preview_lock.acquire()
    else:
        await preview_lock.acquire()

    # Initialize render state (we hold the lock — released inside background task)
    pipeline["preview_renders"][preview_key] = {
        "status": "processing",
        "progress": 0,
        "current_step": "Starting preview render",
        "preview_video_path": None,
        "matches_fingerprint": matches_fingerprint,
        "error": None,
        "visual_version": normalized_visual_version,
    }

    script_text = pipeline["scripts"][variant_index]
    # SRT reuse guard: only reuse cached SRT if words_per_subtitle hasn't changed
    # (mirrors the guard in render_variants to ensure preview matches final render)
    cached_wpf = tts_data.get("words_per_subtitle")
    render_wpf = render_request.words_per_subtitle
    if cached_wpf is not None and cached_wpf != render_wpf:
        logger.info(
            f"[Preview render] SRT reuse BLOCKED: words_per_subtitle changed "
            f"({cached_wpf} -> {render_wpf})"
        )
        reuse_srt_content = None
    else:
        reuse_srt_content = tts_data.get("srt_content")
    reuse_audio_duration = tts_data.get("audio_duration")

    _profile_id = profile.profile_id

    async def _do_preview_render():
        render_state = pipeline["preview_renders"][preview_key]
        _pr_state_lock = _get_pipeline_state_lock(pipeline_id)
        try:
            async with await acquire_preview_slot():
                assembly_service = get_assembly_service()

                def on_progress(step_name: str, pct: int):
                    render_state["current_step"] = step_name
                    render_state["progress"] = pct

                preview_path = await asyncio.wait_for(
                    assembly_service.assemble_and_render_preview(
                        script_text=script_text,
                        profile_id=_profile_id,
                        pipeline_id=pipeline_id,
                        variant_index=effective_variant_index,
                        match_overrides=render_request.match_overrides,
                        source_video_ids=render_request.source_video_ids,
                        reuse_audio_path=audio_path_str,
                        reuse_audio_duration=reuse_audio_duration,
                        reuse_srt_content=reuse_srt_content,
                        subtitle_settings=render_request.subtitle_settings,
                        min_segment_duration=render_request.min_segment_duration,
                        on_progress=on_progress,
                        max_words_per_phrase=render_request.words_per_subtitle,
                        ultra_rapid_intro=render_request.ultra_rapid_intro,
                        interstitial_slides=render_request.interstitial_slides,
                        pip_overlays=render_request.pip_overlays,
                        enable_denoise=render_request.enable_denoise,
                        denoise_strength=render_request.denoise_strength,
                        enable_sharpen=render_request.enable_sharpen,
                        sharpen_amount=render_request.sharpen_amount,
                        enable_color=render_request.enable_color,
                        brightness=render_request.brightness,
                        contrast=render_request.contrast,
                        saturation=render_request.saturation,
                        voice_volume=render_request.voice_volume,
                        audio_fade_in=render_request.audio_fade_in,
                        audio_fade_out=render_request.audio_fade_out,
                        subtitle_style_override=subtitle_style_override,
                        visual_version_label=normalized_visual_version,
                    ),
                    timeout=300  # 5-minute timeout for preview
                )

                # BUG-PR-18: Group state updates under single lock acquisition
                with _pr_state_lock:
                    render_state["status"] = "completed"
                    render_state["progress"] = 100
                    render_state["current_step"] = "Preview ready"
                    render_state["preview_video_path"] = str(preview_path)
                    render_state["preview_limitations"] = [
                        "Audio volume may differ from export (loudness normalization disabled)",
                        "Resolution is 540x960 (export will be 1080x1920)",
                    ]
                logger.info(f"Preview render completed: {preview_path}")

        except asyncio.TimeoutError:
            with _pr_state_lock:
                render_state["status"] = "failed"
                render_state["error"] = "Preview render timed out after 5 minutes"
                render_state["current_step"] = "Failed"
            logger.error(f"Preview render timeout for pipeline {pipeline_id} variant {preview_key}")
        except Exception as e:
            with _pr_state_lock:
                render_state["status"] = "failed"
                render_state["error"] = str(e)
                render_state["current_step"] = "Failed"
            logger.error(f"Preview render failed for pipeline {pipeline_id} variant {preview_key}: {e}")
        finally:
            preview_lock.release()

    background_tasks.add_task(_do_preview_render)

    return {"status": "processing", "matches_fingerprint": matches_fingerprint}


@router.get("/preview-status/{pipeline_id}/{variant_index}", response_model=PreviewRenderStatusResponse)
async def get_preview_status(
    pipeline_id: str,
    variant_index: int,
    visual_version: Optional[str] = None,
):
    """
    Get status of a server-side preview render.

    Intentionally public (same pattern as /status endpoint) — pipeline UUID
    acts as capability token.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    preview_key = _build_preview_key(variant_index, visual_version)
    render_state = pipeline.get("preview_renders", {}).get(preview_key)
    if not render_state:
        return PreviewRenderStatusResponse(
            status="not_started",
            progress=0,
            current_step="Not started",
        )

    return PreviewRenderStatusResponse(
        status=render_state.get("status", "not_started"),
        progress=render_state.get("progress", 0),
        current_step=render_state.get("current_step", ""),
        matches_fingerprint=render_state.get("matches_fingerprint"),
        error=render_state.get("error"),
        preview_limitations=render_state.get("preview_limitations"),
    )


@router.get("/preview-progress/{pipeline_id}/{variant_index}")
async def stream_preview_progress(
    pipeline_id: str,
    variant_index: int,
    visual_version: Optional[str] = None,
):
    """
    SSE stream of preview render progress (F2 — replaces 2s polling).

    Emits a ``progress`` event whenever the render state changes (checked every
    300ms) and closes after a terminal ``completed``/``failed`` event. Clients
    use ``EventSource``; intentionally public like /preview-status (the
    pipeline UUID acts as capability token).
    """
    from sse_starlette.sse import EventSourceResponse

    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    preview_key = _build_preview_key(variant_index, visual_version)

    async def _events():
        last_payload = None
        # Hard cap mirrors the 5-minute render timeout (+ margin) so a dead
        # render task can't hold the connection open forever.
        for _ in range(int(360 / 0.3)):
            render_state = pipeline.get("preview_renders", {}).get(preview_key) or {}
            payload = {
                "status": render_state.get("status", "not_started"),
                "progress": render_state.get("progress", 0),
                "current_step": render_state.get("current_step", ""),
                "matches_fingerprint": render_state.get("matches_fingerprint"),
                "error": render_state.get("error"),
                "preview_limitations": render_state.get("preview_limitations"),
            }
            if payload != last_payload:
                last_payload = payload
                yield {"event": "progress", "data": _json.dumps(payload)}
            if payload["status"] in ("completed", "failed"):
                return
            await asyncio.sleep(0.3)
        yield {"event": "error", "data": _json.dumps({"error": "progress stream timed out"})}

    return EventSourceResponse(_events())


@router.get("/preview-video/{pipeline_id}/{variant_index}")
async def get_preview_video(
    pipeline_id: str,
    variant_index: int,
    request: Request,
    visual_version: Optional[str] = None,
):
    """
    Stream the preview MP4 video for a variant.

    Supports HTTP Range requests for seeking. Intentionally public
    (same pattern as /status endpoint).
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    preview_key = _build_preview_key(variant_index, visual_version)
    render_state = pipeline.get("preview_renders", {}).get(preview_key)
    if not render_state or render_state.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Preview not ready")

    video_path_str = normalize_path(render_state.get("preview_video_path", ""))
    video_path = Path(video_path_str)
    if not video_path_str or not video_path.exists():
        raise HTTPException(status_code=404, detail="Preview video file not found")

    return FileResponse(
        path=video_path_str,
        media_type="video/mp4",
        content_disposition_type="inline",
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=300",
        }
    )


# ============== VIDEO CAPTION GENERATION ==============

class GenerateVideoCaptionsRequest(BaseModel):
    pipeline_id: str
    variant_indices: List[int]  # which variants to generate captions for
    tone: str = "professional"  # professional, casual, funny, luxury, urgenta
    language: str = "ro"  # ro, en
    include_hashtags: bool = True
    include_cta: bool = True
    template_id: Optional[str] = None
    custom_instructions: Optional[str] = None
    variants_per_clip: int = Field(default=3, ge=1, le=5)
    generate_youtube_titles: bool = False  # Also generate YouTube titles per variant


class VideoCaptionTemplateCreate(BaseModel):
    name: str
    prompt_template: str
    is_default: bool = False


class VideoCaptionTemplateUpdate(BaseModel):
    name: Optional[str] = None
    prompt_template: Optional[str] = None
    is_default: Optional[bool] = None


@router.post("/generate-video-captions")
async def generate_video_captions(
    req: GenerateVideoCaptionsRequest,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Generate AI social media caption variants for rendered pipeline clips using Gemini."""
    pipeline = _get_pipeline_or_load(req.pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    scripts = pipeline.get("scripts", [])
    pipeline_context = _strip_embedded_product_blocks(pipeline.get("context", ""))

    # Load template if provided
    template_text = ""
    if req.template_id:
        repo = get_repository()
        if repo:
            try:
                tpl = repo.table_query("video_caption_templates", "select",
                    filters=QueryFilters(
                        eq={"id": req.template_id, "profile_id": ctx.profile_id},
                        limit=1,
                    ))
                if tpl.data:
                    template_text = tpl.data[0]["prompt_template"]
            except Exception as e:
                logger.warning(f"Failed to load caption template: {e}")

    # Prepare tone instructions
    tone_instructions = {
        "professional": "Use a professional, polished tone suitable for business social media.",
        "casual": "Use a relaxed, friendly, conversational tone.",
        "funny": "Use humor, wit, and playful language to engage the audience.",
        "luxury": "Use an elegant, aspirational, premium tone that conveys exclusivity.",
        "urgenta": "Use urgency and scarcity language to drive immediate action (limited time, act now, etc.).",
    }
    tone_desc = tone_instructions.get(req.tone, f"Use a {req.tone} tone.")

    lang_map = {"ro": "Romanian", "en": "English"}
    language_name = lang_map.get(req.language, req.language)

    # Generate captions per variant
    results: Dict[int, List[str]] = {}
    yt_titles: Dict[int, List[str]] = {}
    errors: Dict[int, str] = {}

    try:
        from google import genai
        from app.services.credentials.vault import get_vault_manager
        settings = get_settings()
        gemini_key = get_vault_manager().get_api_key_or_default(ctx.profile_id, "gemini")
        if not gemini_key:
            raise HTTPException(status_code=503, detail="Gemini API key not configured")
        gemini_client = genai.Client(api_key=gemini_key)
        gemini_model_name = settings.gemini_model
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to initialize Gemini: {e}")

    for variant_idx in req.variant_indices:
        script_text = scripts[variant_idx] if variant_idx < len(scripts) else ""

        prompt_parts = []

        # Template prepended first
        if template_text:
            prompt_parts.append(template_text)

        prompt_parts.append(
            f"Generate exactly {req.variants_per_clip} distinct social media caption variants in {language_name}.\n"
            f"{tone_desc}"
        )

        # Structured product data (preferred over raw context)
        context_products = pipeline.get("context_products", [])
        if context_products:
            product_lines = []
            for p in context_products:
                title = p.get("title", "")
                desc = p.get("description", "")
                product_lines.append(f"- {title}: {desc}" if desc else f"- {title}")
            prompt_parts.append(f"Products featured in this video:\n" + "\n".join(product_lines))
        # Context from pipeline (includes product descriptions)
        elif pipeline_context:
            prompt_parts.append(f"Context:\n{pipeline_context}")

        # Script for this specific variant
        if script_text:
            prompt_parts.append(f"Video script:\n{script_text}")

        if req.include_hashtags:
            prompt_parts.append("Include relevant hashtags (5-10 hashtags) in each caption.")
        else:
            prompt_parts.append("Do NOT include any hashtags.")

        if req.include_cta:
            prompt_parts.append("Include a clear call to action in each caption.")
        else:
            prompt_parts.append("Do NOT include a call to action.")

        if req.custom_instructions:
            prompt_parts.append(f"Additional instructions: {req.custom_instructions}")

        if req.generate_youtube_titles:
            prompt_parts.append(
                f"\nReturn ONLY a JSON array of exactly {req.variants_per_clip} objects, "
                'each with "caption" (string) and "youtube_title" (string, max 100 chars, SEO-optimized, concise). '
                "The YouTube title must be DIFFERENT from the caption — short, direct, with relevant keywords. "
                "No explanations, no markdown, just the JSON array."
            )
        else:
            prompt_parts.append(
                f"\nReturn ONLY a JSON array of exactly {req.variants_per_clip} caption strings. "
                "Each caption should be distinct in style/angle while keeping the same message. "
                "No explanations, no markdown, just the JSON array."
            )

        full_prompt = "\n\n".join(prompt_parts)

        try:
            response = gemini_client.models.generate_content(model=gemini_model_name, contents=full_prompt)
            raw = response.text.strip()
            # Parse JSON array from response
            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
                if raw.endswith("```"):
                    raw = raw[:-3].strip()
                elif "```" in raw:
                    raw = raw[:raw.rfind("```")].strip()
            captions = _json.loads(raw)
            if isinstance(captions, list):
                if req.generate_youtube_titles and captions and isinstance(captions[0], dict):
                    results[variant_idx] = [c.get("caption", str(c)) for c in captions[:req.variants_per_clip]]
                    yt_titles[variant_idx] = [c.get("youtube_title", "")[:100] for c in captions[:req.variants_per_clip]]
                else:
                    results[variant_idx] = [str(c) for c in captions[:req.variants_per_clip]]
            else:
                # Gemini returned non-array — wrap single response
                results[variant_idx] = [str(captions)]
        except Exception as e:
            logger.error(f"Caption generation failed for variant {variant_idx}: {e}")
            errors[variant_idx] = str(e)

    # Persist captions in pipeline state and DB (merge with existing, don't overwrite)
    if results:
        existing_captions = pipeline.get("captions", {})
        merged_captions = {**existing_captions, **{str(k): v for k, v in results.items()}}
        pipeline["captions"] = merged_captions

        if yt_titles:
            existing_yt = pipeline.get("youtube_titles", {})
            merged_yt = {**existing_yt, **{str(k): v for k, v in yt_titles.items()}}
            pipeline["youtube_titles"] = merged_yt

        _db_save_pipeline(req.pipeline_id, pipeline)

    response_data: Dict[str, Any] = {
        "captions": {str(k): v for k, v in results.items()},
        "errors": {str(k): v for k, v in errors.items()},
    }
    if yt_titles:
        response_data["youtube_titles"] = {str(k): v for k, v in yt_titles.items()}
    return response_data


# ============== SAVE SELECTED/EDITED CAPTIONS ==============


class SaveSelectedCaptionsRequest(BaseModel):
    pipeline_id: str
    selected_captions: Dict[str, str]  # preferred: clip_id -> final caption text; legacy: variant_index -> text


@router.patch("/selected-captions")
@router.post("/selected-captions")  # POST alias for navigator.sendBeacon (only supports POST)
async def save_selected_captions(
    req: SaveSelectedCaptionsRequest,
):
    """
    Save the user's final caption selection/edits per variant.
    Stores in pipeline["selected_captions"] separately from the AI-generated arrays.
    """
    pipeline = _get_pipeline_or_load(req.pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    render_jobs = pipeline.get("render_jobs", {})
    normalized_captions: Dict[str, str] = {}
    legacy_captions: Dict[str, str] = {}
    for caption_key, caption_text in req.selected_captions.items():
        key = str(caption_key)
        if any(isinstance(job, dict) and job.get("clip_id") == key for job in render_jobs.values()):
            normalized_captions[key] = caption_text
            continue
        try:
            variant_index = int(key)
        except (TypeError, ValueError):
            normalized_captions[key] = caption_text
            continue

        legacy_captions[key] = caption_text
        for job_key, job in render_jobs.items():
            if not isinstance(job, dict) or not job.get("clip_id"):
                continue
            if job_key == variant_index or str(job_key) == key or (
                isinstance(job_key, str) and job_key.startswith(f"{variant_index}_")
            ):
                normalized_captions[str(job["clip_id"])] = caption_text

    if not normalized_captions:
        normalized_captions = {str(k): v for k, v in req.selected_captions.items()}

    pipeline["selected_captions"] = normalized_captions
    if legacy_captions:
        pipeline["selected_captions_legacy"] = legacy_captions
    _db_save_pipeline(req.pipeline_id, pipeline)

    # Keep existing library clips in sync so Smart Schedule V2 uses the latest
    # user-edited caption even when the clip was saved before this edit.
    try:
        repo = get_repository()
        if repo:
            for variant_key, caption_text in normalized_captions.items():
                clip_ids_to_update = set()
                if any(isinstance(job, dict) and job.get("clip_id") == variant_key for job in render_jobs.values()):
                    clip_ids_to_update.add(variant_key)
                else:
                    try:
                        variant_index = int(str(variant_key))
                    except (TypeError, ValueError):
                        variant_index = None
                    if variant_index is not None:
                        standard_job = render_jobs.get(variant_index)
                        if standard_job and standard_job.get("clip_id"):
                            clip_ids_to_update.add(standard_job["clip_id"])

                        for job_key, job in render_jobs.items():
                            if not isinstance(job_key, str) or not job_key.startswith(f"{variant_index}_"):
                                continue
                            if job.get("clip_id"):
                                clip_ids_to_update.add(job["clip_id"])

                for clip_id in clip_ids_to_update:
                    repo.table_query(
                        "editai_clip_content",
                        "upsert",
                        data={"clip_id": clip_id, "caption": caption_text or ""},
                        filters=QueryFilters(on_conflict="clip_id"),
                    )
            for variant_key, caption_text in legacy_captions.items():
                try:
                    variant_index = int(str(variant_key))
                except (TypeError, ValueError):
                    continue

                clip_ids_to_update = set()
                standard_job = render_jobs.get(variant_index)
                if standard_job and standard_job.get("clip_id"):
                    clip_ids_to_update.add(standard_job["clip_id"])

                for job_key, job in render_jobs.items():
                    if not isinstance(job_key, str) or not job_key.startswith(f"{variant_index}_"):
                        continue
                    if job.get("clip_id"):
                        clip_ids_to_update.add(job["clip_id"])

                for clip_id in clip_ids_to_update:
                    repo.table_query(
                        "editai_clip_content",
                        "upsert",
                        data={"clip_id": clip_id, "caption": caption_text or ""},
                        filters=QueryFilters(on_conflict="clip_id"),
                    )
    except Exception as e:
        logger.warning(f"Failed to sync selected captions to clip_content for pipeline {req.pipeline_id}: {e}")

    return {"ok": True}


# ============== VIDEO CAPTION TEMPLATE CRUD ==============

@router.get("/video-caption-templates")
async def list_video_caption_templates(
    ctx: ProfileContext = Depends(get_profile_context),
):
    """List video caption templates for this profile."""
    repo = get_repository()
    if not repo:
        return {"templates": []}

    try:
        result = repo.table_query("video_caption_templates", "select",
            filters=QueryFilters(
                eq={"profile_id": ctx.profile_id},
                order_by="created_at",
                order_desc=True,
            ))
        return {"templates": result.data or []}
    except Exception as e:
        logger.error(f"Failed to query video_caption_templates: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load templates: {e}")


@router.post("/video-caption-templates")
async def create_video_caption_template(
    req: VideoCaptionTemplateCreate,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Create a video caption template."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        template_id = str(uuid.uuid4())
        repo.table_query("video_caption_templates", "insert", data={
            "id": template_id,
            "profile_id": ctx.profile_id,
            "name": req.name,
            "prompt_template": req.prompt_template,
            "is_default": req.is_default,
        })

        if req.is_default:
            repo.table_query("video_caption_templates", "update",
                data={"is_default": False},
                filters=QueryFilters(
                    eq={"profile_id": ctx.profile_id},
                    neq={"id": template_id},
                ))

        return {"id": template_id, "name": req.name}
    except Exception as e:
        logger.error(f"Failed to create video caption template: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create template: {str(e)}")


@router.put("/video-caption-templates/{template_id}")
async def update_video_caption_template(
    template_id: str,
    req: VideoCaptionTemplateUpdate,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Update a video caption template."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        updates = {}
        if req.name is not None:
            updates["name"] = req.name
        if req.prompt_template is not None:
            updates["prompt_template"] = req.prompt_template
        if req.is_default is not None:
            updates["is_default"] = req.is_default
            if req.is_default:
                repo.table_query("video_caption_templates", "update",
                    data={"is_default": False},
                    filters=QueryFilters(
                        eq={"profile_id": ctx.profile_id},
                        neq={"id": template_id},
                    ))

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        repo.table_query("video_caption_templates", "update", data=updates,
            filters=QueryFilters(eq={"id": template_id, "profile_id": ctx.profile_id}))

        return {"updated": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update video caption template {template_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update template: {str(e)}")


@router.delete("/video-caption-templates/{template_id}")
async def delete_video_caption_template(
    template_id: str,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Delete a video caption template."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        repo.table_query("video_caption_templates", "delete",
            filters=QueryFilters(eq={"id": template_id, "profile_id": ctx.profile_id}))
        return {"deleted": True}
    except Exception as e:
        logger.error(f"Failed to delete video caption template {template_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete template: {str(e)}")


# ============== SUBTITLE FRAME PREVIEW ==============

class SubtitleFrameRequest(BaseModel):
    subtitle_settings: dict
    timestamp: float = 2.0
    sample_text: str = "Sample subtitle text"
    include_subtitles: bool = True


@router.post("/subtitle-frame-preview/{pipeline_id}/{variant_index}")
async def subtitle_frame_preview(
    pipeline_id: str,
    variant_index: int,
    request: SubtitleFrameRequest,
    visual_version: Optional[str] = None,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Render a single FFmpeg frame with optional subtitle overlay for preview.

    Optional query param `visual_version=A|B` applies the corresponding Meta
    profile subtitle overlay on top of request.subtitle_settings. The frontend
    should only pass this when there is NO explicit user override for that
    key — matching the render-time rule that user overrides suppress Meta.
    Invalid `visual_version` values raise 400 (matches /render-preview).
    """
    from app.services.video_effects.subtitle_styler import build_subtitle_filter

    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    # Ownership check — match the pattern used by other authenticated pipeline
    # routes. Without this any authenticated user can request preview frames
    # for someone else's pipeline by guessing the UUID.
    if pipeline.get("profile_id") != ctx.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    # Apply Meta overlay if requested. Shallow merge so the user-visible fields
    # (font/size) still come from request.subtitle_settings; only color/outline/
    # glow/shadow/opacity are replaced. Validation is shared with /render-preview
    # via _normalize_meta_version_label, which raises 400 on invalid values
    # instead of silently ignoring them.
    effective_subtitle_settings = dict(request.subtitle_settings or {})
    normalized_version = _normalize_meta_version_label(visual_version)
    if normalized_version:
        meta_profile = next(
            (META_PROFILES[i] for i in range(len(META_PROFILES))
             if get_version_label(i) == normalized_version),
            None,
        )
        if meta_profile is not None:
            effective_subtitle_settings.update(meta_profile.subtitle_style)

    # --- Find source video file path ---
    source_video_path: Optional[Path] = None
    source_video_ids = pipeline.get("source_video_ids", [])
    if source_video_ids:
        repo = get_repository()
        if repo:
            try:
                result = repo.table_query(
                    "editai_source_videos", "select",
                    filters=QueryFilters(select="file_path", eq={"id": source_video_ids[0]})
                )
                if result and result.data:
                    fp = result.data[0].get("file_path")
                    if fp:
                        source_video_path = Path(normalize_path(fp))
            except Exception as e:
                logger.warning(f"subtitle-frame-preview: failed to fetch source video: {e}")

    if not source_video_path or not source_video_path.exists():
        raise HTTPException(status_code=400, detail="No source video available for preview")

    settings = get_settings()
    output_dir = settings.output_dir
    preview_dir = output_dir / "subtitle_previews"
    preview_dir.mkdir(parents=True, exist_ok=True)

    sample_text = (request.sample_text or "").strip() or "Sample subtitle text"
    ts = max(float(request.timestamp or 0), 0.0)
    include_subtitles = bool(request.include_subtitles)

    # --- Build SRT content directly from the editor sample text ---
    # `-ss ts` is placed BEFORE `-i` (fast input seek), which resets output
    # PTS to 0. The `subtitles` filter compares SRT times against frame PTS,
    # so the SRT must be anchored at 00:00:00 — otherwise the single captured
    # frame (at output t=0) falls outside the subtitle window and no text
    # renders. Span 0..10s so the overlay is always visible regardless of
    # decoder boundary quirks.
    srt_content = f"1\n00:00:00,000 --> 00:00:10,000\n{sample_text}\n"

    # --- Compute cache fingerprint (include visual_version so A vs B differ) ---
    settings_json = _json.dumps(effective_subtitle_settings, sort_keys=True)
    fingerprint_input = (
        f"{settings_json}|{source_video_path}|{ts:.3f}|{visual_version or ''}|{sample_text}|subs={include_subtitles}"
    )
    fingerprint = hashlib.md5(fingerprint_input.encode()).hexdigest()[:16]
    output_path = preview_dir / f"{fingerprint}.jpg"

    # Return cached if exists
    if output_path.exists():
        return FileResponse(str(output_path), media_type="image/jpeg")

    # --- Write temp SRT ---
    srt_tmp = preview_dir / f"_tmp_{fingerprint}.srt"
    try:
        srt_tmp.write_text(srt_content, encoding="utf-8")

        # --- Build FFmpeg command ---
        vf = "scale=540:960:force_original_aspect_ratio=increase,crop=540:960"
        if include_subtitles:
            # Use PlayRes 1080x1920 so subtitles match final render proportionally
            subtitle_filter = build_subtitle_filter(
                srt_path=srt_tmp,
                subtitle_settings=effective_subtitle_settings,
                video_width=1080,
                video_height=1920,
            )
            vf = f"{vf},{subtitle_filter}"

        cmd = [
            "ffmpeg", "-y",
            "-ss", str(request.timestamp),
            "-i", str(source_video_path),
            "-vframes", "1",
            "-vf", vf,
            "-q:v", "3",
            str(output_path),
        ]

        # Execute with semaphore
        async with await acquire_preview_slot(timeout=30):
            result = await asyncio.to_thread(safe_ffmpeg_run, cmd, timeout=15, operation="subtitle-frame-preview")

        if result.returncode != 0:
            logger.error(f"subtitle-frame-preview FFmpeg failed: {result.stderr[:500]}")
            raise HTTPException(status_code=500, detail="FFmpeg frame render failed")

        if not output_path.exists():
            raise HTTPException(status_code=500, detail="FFmpeg produced no output")

        # --- Cache cleanup: limit to 200 files ---
        try:
            cached = sorted(preview_dir.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
            if len(cached) > 200:
                for old in cached[: len(cached) - 200]:
                    old.unlink(missing_ok=True)
        except Exception:
            pass

        return FileResponse(str(output_path), media_type="image/jpeg")

    finally:
        # Clean up temp SRT
        srt_tmp.unlink(missing_ok=True)
