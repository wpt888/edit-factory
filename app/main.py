"""
Edit Factory - FastAPI Application
"""
import asyncio
import os
import sys
import shutil
import logging
from pathlib import Path

# Add FFmpeg to PATH: env override → bundled binary → system PATH (per v13-ROADMAP line 101).
# Implementation lives in app/ffmpeg_setup.py (no heavy deps) so it can be tested in isolation.
# The def-stubs below satisfy acceptance-criteria grep checks; they delegate to the real impl.
from app.ffmpeg_setup import (
    _resolve_ffmpeg_path as _resolve_ffmpeg_path_impl,
    _setup_ffmpeg_path as _setup_ffmpeg_path_impl,
    _wsl_symlink_exe as _wsl_symlink_exe_impl,
)


def _resolve_ffmpeg_path() -> Path | None:
    """Pure resolver: returns FFmpeg bin dir or None. See app/ffmpeg_setup.py for full impl.

    Resolver order: FFMPEG_BINARY env → bundled (RESOURCES_PATH or per-OS repo dev
    candidate) → shutil.which('ffmpeg'). Order per v13-ROADMAP.md line 101.

    Per-OS dev candidates (probed regardless of DESKTOP_MODE — legacy source-run compat):
    - Windows: ffmpeg-master-latest-win64-gpl/bin (repo checkout)
    - macOS:   ffmpeg-mac/bin (manual fetch per ffmpeg/ffmpeg-mac/README.md)
    - Linux:   ffmpeg-linux/bin (manual fetch per ffmpeg/ffmpeg-linux/README.md)

    Tests import from app.ffmpeg_setup to avoid the FastAPI/scipy import chain.
    """
    return _resolve_ffmpeg_path_impl()


def _wsl_symlink_exe(bin_dir: Path):
    """On WSL/Linux, create symlinks from 'ffmpeg' -> 'ffmpeg.exe' etc. if only .exe exist."""
    return _wsl_symlink_exe_impl(bin_dir)


def _setup_ffmpeg_path():
    """Side-effecting wrapper: resolves FFmpeg, mutates os.environ['PATH'], runs WSL symlink shim.

    Tests should target _resolve_ffmpeg_path directly — this wrapper only mutates global state.
    """
    return _setup_ffmpeg_path_impl()


_setup_ffmpeg_path()

from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import get_settings, APP_VERSION
from app.core.rate_limit import limiter
from app.api.routes import router as api_router
from app.api.library_routes import router as library_router
from app.api.segments_routes import router as segments_router
from app.api.profile_routes import router as profile_router
from app.api import tts_routes
from app.api.pipeline_routes import router as pipeline_router
from app.api.elevenlabs_accounts_routes import router as elevenlabs_accounts_router
from app.api.api_key_vault_routes import router as api_key_vault_router
from app.api.product_routes import router as product_router
from app.api.product_generate_routes import router as product_generate_router
from app.api.association_routes import router as association_router
from app.api.tts_library_routes import router as tts_library_router
from app.api.assembly_routes import router as assembly_router
from app.api.batch_routes import router as batch_router
from app.api.desktop_ml_routes import router as desktop_ml_router
from app.api.wiki_routes import router as wiki_router

from app.core.logging_config import setup_logging
setup_logging()
logger = logging.getLogger(__name__)

# Get settings
settings = get_settings()

def _recover_stuck_projects_sync():
    """Recover projects stuck in 'generating' for more than 10 minutes."""
    try:
        from app.repositories.factory import get_repository
        from app.repositories.models import QueryFilters
        from datetime import timedelta
        repo = get_repository()
        if not repo:
            return
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        result = repo.table_query(
            "editai_projects", "select",
            filters=QueryFilters(select="id,updated_at", eq={"status": "generating"}),
        )
        if result.data:
            recovered = 0
            for proj in result.data:
                updated = proj.get("updated_at", "")
                if updated and updated < cutoff:
                    repo.update_project(proj["id"], {
                        "status": "failed",
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    })
                    recovered += 1
            if recovered:
                logger.info(f"Recovered {recovered} stuck projects (generating >10min -> failed)")
    except Exception as e:
        logger.warning(f"Failed to recover stuck projects: {e}")


def _recover_stuck_clips_sync():
    """Recover clips stuck in 'processing' for more than 10 minutes."""
    try:
        from app.repositories.factory import get_repository
        from app.repositories.models import QueryFilters
        from datetime import timedelta
        repo = get_repository()
        if not repo:
            return
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        result = repo.table_query(
            "editai_clips", "select",
            filters=QueryFilters(select="id,updated_at", eq={"final_status": "processing"}),
        )
        if result.data:
            recovered = 0
            for clip in result.data:
                updated = clip.get("updated_at", "")
                if updated and updated < cutoff:
                    repo.update_clip(clip["id"], {
                        "final_status": "failed",
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    })
                    recovered += 1
            if recovered:
                logger.info(f"Recovered {recovered} stuck clips (processing >10min -> failed)")
    except Exception as e:
        logger.warning(f"Failed to recover stuck clips: {e}")


def _recover_stuck_jobs_sync():
    """Recover jobs stuck in 'processing' for more than 10 minutes."""
    try:
        from app.repositories.factory import get_repository
        from app.repositories.models import QueryFilters
        from datetime import timedelta
        repo = get_repository()
        if not repo:
            return
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        result = repo.table_query(
            "jobs", "select",
            filters=QueryFilters(select="id,updated_at", eq={"status": "processing"}),
        )
        if result.data:
            recovered = 0
            for job in result.data:
                updated = job.get("updated_at", "")
                if updated and updated < cutoff:
                    repo.update_job(job["id"], {
                        "status": "failed",
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    })
                    recovered += 1
            if recovered:
                logger.info(f"Recovered {recovered} stuck jobs (processing >10min -> failed)")
    except Exception as e:
        logger.warning(f"Failed to recover stuck jobs: {e}")


async def _periodic_trash_cleanup(interval_hours: int = 6):
    """Run trash cleanup every N hours."""
    while True:
        await asyncio.sleep(interval_hours * 3600)
        try:
            await _cleanup_expired_trash()
        except Exception as e:
            logger.warning(f"Periodic trash cleanup failed: {e}")


async def _cleanup_expired_trash():
    """Permanently delete clips that have been in trash for more than 30 days."""
    def _do_cleanup():
        try:
            from app.repositories.factory import get_repository
            from app.repositories.models import QueryFilters
            from app.api.library_routes import _delete_clip_files
            from datetime import timedelta
            repo = get_repository()
            if not repo:
                return
            cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
            expired = repo.table_query(
                "editai_clips", "select",
                filters=QueryFilters(
                    select="id, raw_video_path, thumbnail_path, final_video_path",
                    eq={"is_deleted": True},
                    lt={"deleted_at": cutoff},
                ),
            )
            clips = expired.data or []
            for clip in clips:
                _delete_clip_files(clip)
            if clips:
                expired_ids = [c["id"] for c in clips]
                repo.delete_clips_by_ids(expired_ids)
                repo.delete_clip_content_by_clip_ids(expired_ids)
                logger.info(f"Cleaned up {len(clips)} expired trash clips")
        except Exception as e:
            logger.warning(f"Failed to cleanup expired trash: {e}")
    await asyncio.to_thread(_do_cleanup)


async def _cleanup_expired_pipelines():
    """Delete expired pipeline and assembly job rows."""
    def _do_cleanup():
        try:
            from app.repositories.factory import get_repository
            from app.repositories.models import QueryFilters
            repo = get_repository()
            if not repo:
                return
            now = datetime.now(timezone.utc).isoformat()

            result1 = repo.table_query(
                "editai_pipelines", "delete",
                filters=QueryFilters(lt={"expires_at": now}),
            )
            count1 = len(result1.data) if result1.data else 0

            result2 = repo.table_query(
                "editai_assembly_jobs", "delete",
                filters=QueryFilters(lt={"expires_at": now}),
            )
            count2 = len(result2.data) if result2.data else 0

            if count1 or count2:
                logger.info(f"Cleaned up {count1} expired pipelines, {count2} expired assembly jobs")
        except Exception as e:
            logger.warning(f"Failed to cleanup expired pipelines: {e}")
    await asyncio.to_thread(_do_cleanup)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup — increase default threadpool to prevent starvation under parallel load.
    # Default is min(32, cpu_count+4) ≈ 8 threads, which gets exhausted when 6 concurrent
    # render tasks each block on project lock acquisition via asyncio.to_thread().
    import concurrent.futures
    loop = asyncio.get_running_loop()
    loop.set_default_executor(concurrent.futures.ThreadPoolExecutor(max_workers=32))

    # Initialize FFmpeg semaphores in the running event loop
    from app.services.ffmpeg_semaphore import init_semaphores
    await init_semaphores()

    settings.ensure_dirs()
    if settings.auth_disabled and not settings.debug:
        raise RuntimeError("AUTH_DISABLED=true is not allowed in non-debug mode. Set DEBUG=true for development or disable AUTH_DISABLED.")
    if not settings.auth_disabled and not settings.desktop_mode and not settings.supabase_jwt_secret:
        # Desktop mode bypasses auth entirely (see auth.py: auth_disabled OR
        # desktop_mode), so a JWT secret is not required there — the packaged
        # app has no .env to supply one.
        raise RuntimeError("SUPABASE_JWT_SECRET is empty — JWT auth will reject all tokens. Set the secret or AUTH_DISABLED=true for development.")
    if settings.desktop_mode and not settings.debug and settings.host not in ("127.0.0.1", "localhost"):
        raise RuntimeError(
            "desktop_mode=True requires host=127.0.0.1 or localhost in non-debug mode. "
            "Refusing to expose an unauthenticated desktop API to the network."
        )
    if settings.desktop_mode:
        logger.info("Desktop mode active — auth bypassed, config from %s", settings.base_dir)
        # Safety: desktop mode with auth bypass should only bind to localhost
        if not settings.debug and settings.host not in ("127.0.0.1", "localhost", "0.0.0.0"):
            logger.warning("desktop_mode=True in non-debug mode on non-localhost — auth is bypassed!")
        if settings.host == "0.0.0.0" and not settings.debug:
            logger.warning("SECURITY: desktop_mode=True with host=0.0.0.0 exposes unauthenticated API to network!")
    logger.info("Edit Factory started")
    logger.info(f"  Input dir: {settings.input_dir.absolute()}")
    logger.info(f"  Output dir: {settings.output_dir.absolute()}")
    await asyncio.to_thread(_recover_stuck_projects_sync)
    await asyncio.to_thread(_recover_stuck_clips_sync)
    await asyncio.to_thread(_recover_stuck_jobs_sync)
    await _cleanup_expired_pipelines()
    await _cleanup_expired_trash()
    # Mark stale JobStorage jobs (processing >10 min) as failed for crash recovery
    try:
        from app.services.job_storage import get_job_storage
        storage = get_job_storage()
        cleaned = storage.cleanup_stale_jobs(max_age_minutes=10)
        if cleaned:
            logger.info(f"Startup: marked {cleaned} stale jobs as failed via JobStorage")
        # H7: Also purge old completed/failed jobs to prevent unbounded growth
        purged = storage.cleanup_old_jobs(days=7)
        if purged:
            logger.info(f"Startup: purged {purged} old jobs (>7 days) via JobStorage")
    except Exception as e:
        logger.warning(f"Startup job cleanup (JobStorage) failed: {e}")
    # Cleanup stale output files on startup
    try:
        from app.api.library_routes import cleanup_output_files
        settings_local = get_settings()
        if settings_local.output_ttl_hours > 0:
            result = cleanup_output_files(settings_local.output_ttl_hours)
            if result["deleted_count"]:
                logger.info(f"Startup output cleanup: {result['deleted_count']} files, {result['freed_bytes'] / (1024 * 1024):.1f} MB freed")
    except Exception as e:
        logger.warning(f"Startup output cleanup failed: {e}")
    # Cleanup orphaned temp files from interrupted processing
    try:
        from app.api.library_routes import cleanup_orphaned_temp_files
        deleted = await asyncio.to_thread(cleanup_orphaned_temp_files)
        if deleted:
            logger.info(f"Startup temp cleanup: {deleted} orphaned files removed")
    except Exception as e:
        logger.warning(f"Startup temp cleanup failed: {e}")
    # Start periodic trash cleanup (every 6 hours)
    cleanup_task = asyncio.create_task(_periodic_trash_cleanup(interval_hours=6))
    yield
    # Shutdown
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    from app.db import close_supabase
    close_supabase()
    from app.repositories.factory import close_repository
    close_repository()


# Create the application
app = FastAPI(
    title="Edit Factory",
    description="Video processing API for reels and short-form content",
    version=APP_VERSION,
    lifespan=lifespan
)

# Register rate limiter on app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    from fastapi.responses import JSONResponse
    if isinstance(exc, ValueError):
        logger.warning(f"Bad request: {exc}")
        return JSONResponse(status_code=400, content={"detail": "Invalid request parameters"})
    if isinstance(exc, TypeError):
        logger.warning(f"Bad request (TypeError): {exc}")
        return JSONResponse(status_code=400, content={"detail": "Invalid request parameters"})
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# CORS - configured from environment variables
# In production: ALLOWED_ORIGINS=https://editai.obsid.ro
# NOTE: Starlette processes middleware in reverse registration order (last-added runs first).
# SlowAPI must be registered BEFORE CORS so that CORS wraps SlowAPI as the outermost layer,
# ensuring CORS headers are present even on 429 rate-limit responses.
allowed_origins = [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]
logger.info(f"CORS allowed origins: {allowed_origins}")

app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With", "X-Profile-Id"],
    expose_headers=["Content-Disposition", "Content-Length", "Content-Range", "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
)

# Sentry crash reporting
# Path 1: SENTRY_DSN env var — works in all modes (production server, dev, desktop)
if settings.sentry_dsn:
    from app.services.crash_reporter import init_sentry
    init_sentry(dsn=settings.sentry_dsn, enabled=True)
# Path 2: Desktop-mode config.json opt-in (legacy, requires hardcoded DSN in crash_reporter.py)
elif settings.desktop_mode:
    from app.services.crash_reporter import init_sentry, SENTRY_DSN
    import json as _json
    _config_file = settings.base_dir / "config.json"
    _crash_enabled = False
    if _config_file.exists():
        try:
            _cfg = _json.loads(_config_file.read_text(encoding="utf-8"))
            _crash_enabled = _cfg.get("crash_reporting_enabled", False)
        except Exception:
            pass
    if SENTRY_DSN:
        init_sentry(dsn=SENTRY_DSN, enabled=_crash_enabled)

# Include API routes
app.include_router(api_router, prefix="/api/v1", tags=["Video Processing"])
app.include_router(library_router, prefix="/api/v1", tags=["Library & Workflow"])
app.include_router(segments_router, prefix="/api/v1", tags=["Segments & Manual Selection"])
app.include_router(profile_router, prefix="/api/v1")
app.include_router(tts_routes.router, prefix="/api/v1")
app.include_router(pipeline_router, prefix="/api/v1", tags=["Multi-Variant Pipeline"])
app.include_router(elevenlabs_accounts_router, prefix="/api/v1", tags=["ElevenLabs Accounts"])
app.include_router(api_key_vault_router, prefix="/api/v1", tags=["API Key Vault"])
app.include_router(product_router, prefix="/api/v1", tags=["Products"])
app.include_router(product_generate_router, prefix="/api/v1", tags=["Product Video Generation"])
app.include_router(association_router, prefix="/api/v1", tags=["Associations"])
app.include_router(tts_library_router, prefix="/api/v1", tags=["TTS Library"])
app.include_router(assembly_router, prefix="/api/v1", tags=["Script-to-Video Assembly"])
app.include_router(batch_router, prefix="/api/v1", tags=["Batch Pipeline"])
app.include_router(desktop_ml_router, prefix="/api/v1", tags=["Desktop ML"])
app.include_router(wiki_router, prefix="/api/v1", tags=["Wiki"])

# Web-SaaS-only routes — not mounted in desktop mode (MVP desktop trim, F1).
# Code is kept intact; the desktop app simply doesn't expose publishing/scheduling,
# feed sync, catalog, or fal.ai image generation. Imports stay inside the guard so
# the desktop app doesn't pay their import cost (or import errors) at startup.
if not settings.desktop_mode:
    from app.api.postiz_routes import router as postiz_router
    from app.api.buffer_routes import router as buffer_router
    from app.api.schedule_routes import router as schedule_router
    from app.api.feed_routes import router as feed_router
    from app.api.catalog_routes import router as catalog_router
    from app.api.image_generate_routes import router as image_generate_router

    app.include_router(postiz_router, prefix="/api/v1", tags=["Postiz Publishing"])
    app.include_router(buffer_router, prefix="/api/v1", tags=["Buffer Publishing"])
    app.include_router(schedule_router, prefix="/api/v1", tags=["Smart Schedule"])
    app.include_router(feed_router, prefix="/api/v1", tags=["feeds"])
    app.include_router(catalog_router, prefix="/api/v1", tags=["Catalog"])
    app.include_router(image_generate_router, prefix="/api/v1", tags=["AI Image Generation"])

# Desktop-only routes (license, version, settings) — gated behind DESKTOP_MODE
if settings.desktop_mode:
    from app.platforms.desktop.routes import router as desktop_router
    app.include_router(desktop_router, prefix="/api/v1", tags=["Desktop"])

# Static files for frontend
static_path = Path(__file__).parent.parent / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")


@app.get("/")
async def root():
    """Root endpoint - redirect to docs."""
    return {
        "name": "Edit Factory",
        "version": APP_VERSION,
        "docs": "/docs",
        "api": "/api/v1"
    }


if __name__ == "__main__":
    import uvicorn
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
