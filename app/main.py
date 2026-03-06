"""
Edit Factory - FastAPI Application
"""
import asyncio
import os
import logging
from pathlib import Path

# Add FFmpeg to PATH: check bundled location (desktop mode) then local dev location
def _setup_ffmpeg_path():
    desktop_mode = os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes")
    candidates = []
    if desktop_mode:
        # Primary: electron-builder extraResources places FFmpeg at resourcesPath/ffmpeg/bin
        resources_path = os.getenv("RESOURCES_PATH")
        if resources_path:
            candidates.append(Path(resources_path) / "ffmpeg" / "bin")
        # Fallback: legacy AppData path (kept for backwards compat)
        appdata = os.getenv("APPDATA")
        if appdata:
            candidates.append(Path(appdata) / "EditFactory" / "bundled" / "ffmpeg" / "bin")
    # Dev fallback: local win64-gpl checkout in project root
    candidates.append(Path(__file__).parent.parent / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin")
    for candidate in candidates:
        if candidate.exists():
            os.environ['PATH'] = str(candidate) + os.pathsep + os.environ.get('PATH', '')
            break

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
from app.rate_limit import limiter
from app.api.routes import router as api_router
from app.api.library_routes import router as library_router
from app.api.segments_routes import router as segments_router
from app.api.postiz_routes import router as postiz_router
from app.api.profile_routes import router as profile_router
from app.api import tts_routes
from app.api.pipeline_routes import router as pipeline_router
from app.api.elevenlabs_accounts_routes import router as elevenlabs_accounts_router
from app.api.feed_routes import router as feed_router
from app.api.product_routes import router as product_router
from app.api.product_generate_routes import router as product_generate_router
from app.api.catalog_routes import router as catalog_router
from app.api.association_routes import router as association_router
from app.api.tts_library_routes import router as tts_library_router
from app.api.image_generate_routes import router as image_generate_router

from app.logging_config import setup_logging
setup_logging()
logger = logging.getLogger(__name__)

# Get settings
settings = get_settings()

def _recover_stuck_projects_sync():
    """Synchronous version of stuck project recovery (runs in thread)."""
    try:
        from app.db import get_supabase
        supabase = get_supabase()
        if not supabase:
            return
        result = supabase.table("editai_projects").select("id").eq("status", "generating").execute()
        if result.data:
            for proj in result.data:
                supabase.table("editai_projects").update({
                    "status": "failed",
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }).eq("id", proj["id"]).execute()
            logger.info(f"Recovered {len(result.data)} stuck projects (generating -> failed)")
    except Exception as e:
        logger.warning(f"Failed to recover stuck projects: {e}")


def _recover_stuck_clips_sync():
    """Synchronous version of stuck clip recovery (runs in thread)."""
    try:
        from app.db import get_supabase
        supabase = get_supabase()
        if not supabase:
            return
        result = supabase.table("editai_clips").select("id").eq("final_status", "processing").execute()
        if result.data:
            for clip in result.data:
                supabase.table("editai_clips").update({
                    "final_status": "failed",
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }).eq("id", clip["id"]).execute()
            logger.info(f"Recovered {len(result.data)} stuck clips (processing -> failed)")
    except Exception as e:
        logger.warning(f"Failed to recover stuck clips: {e}")


def _recover_stuck_jobs_sync():
    """Synchronous version of stuck job recovery (runs in thread)."""
    try:
        from app.db import get_supabase
        supabase = get_supabase()
        if not supabase:
            return
        result = supabase.table("jobs").select("id").eq("status", "processing").execute()
        if result.data:
            for job in result.data:
                supabase.table("jobs").update({
                    "status": "failed",
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }).eq("id", job["id"]).execute()
            logger.info(f"Recovered {len(result.data)} stuck jobs (processing -> failed)")
    except Exception as e:
        logger.warning(f"Failed to recover stuck jobs: {e}")


async def _cleanup_expired_trash():
    """Permanently delete clips that have been in trash for more than 30 days."""
    def _do_cleanup():
        try:
            from app.db import get_supabase
            from app.api.library_routes import _delete_clip_files
            from datetime import timedelta
            supabase = get_supabase()
            if not supabase:
                return
            cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
            expired = supabase.table("editai_clips")\
                .select("id, raw_video_path, thumbnail_path, final_video_path")\
                .eq("is_deleted", True)\
                .lt("deleted_at", cutoff)\
                .execute()
            clips = expired.data or []
            for clip in clips:
                _delete_clip_files(clip)
            if clips:
                expired_ids = [c["id"] for c in clips]
                supabase.table("editai_clips").delete().in_("id", expired_ids).execute()
                supabase.table("editai_clip_content").delete().in_("clip_id", expired_ids).execute()
                logger.info(f"Cleaned up {len(clips)} expired trash clips")
        except Exception as e:
            logger.warning(f"Failed to cleanup expired trash: {e}")
    await asyncio.to_thread(_do_cleanup)


async def _cleanup_expired_pipelines():
    """Delete expired pipeline and assembly job rows from Supabase."""
    def _do_cleanup():
        try:
            from app.db import get_supabase
            supabase = get_supabase()
            if not supabase:
                return
            now = datetime.now(timezone.utc).isoformat()

            result1 = supabase.table("editai_pipelines")\
                .delete()\
                .lt("expires_at", now)\
                .execute()
            count1 = len(result1.data) if result1.data else 0

            result2 = supabase.table("editai_assembly_jobs")\
                .delete()\
                .lt("expires_at", now)\
                .execute()
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
    if settings.auth_disabled and not settings.debug and not getattr(settings, 'desktop_mode', False):
        raise RuntimeError("AUTH_DISABLED=true is not allowed in non-debug mode")
    if not settings.auth_disabled and not settings.supabase_jwt_secret:
        logger.error("SUPABASE_JWT_SECRET is empty — JWT auth will reject all tokens. Set the secret or AUTH_DISABLED=true for development.")
    if settings.desktop_mode:
        logger.info("Desktop mode active — auth bypassed, config from %s", settings.base_dir)
        if not settings.debug:
            logger.warning("desktop_mode=True in non-debug mode — auth is bypassed in production!")
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
    yield
    # Shutdown
    from app.db import close_supabase
    close_supabase()


# Cream aplicatia
app = FastAPI(
    title="Edit Factory",
    description="Video processing API pentru reels si short-form content",
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

# CORS - configurat din environment variables
# În producție: ALLOWED_ORIGINS=https://editai.obsid.ro
# NOTE: CORS must be added BEFORE SlowAPI so it wraps as the outermost middleware,
# ensuring CORS headers are present even on 429 rate-limit responses.
allowed_origins = [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]
logger.info(f"CORS allowed origins: {allowed_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With", "X-Profile-Id"],
    expose_headers=["Content-Disposition", "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
)

app.add_middleware(SlowAPIMiddleware)

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
app.include_router(postiz_router, prefix="/api/v1", tags=["Postiz Publishing"])
app.include_router(profile_router, prefix="/api/v1")
app.include_router(tts_routes.router, prefix="/api/v1")
app.include_router(pipeline_router, prefix="/api/v1", tags=["Multi-Variant Pipeline"])
app.include_router(elevenlabs_accounts_router, prefix="/api/v1", tags=["ElevenLabs Accounts"])
app.include_router(feed_router, prefix="/api/v1", tags=["feeds"])
app.include_router(product_router, prefix="/api/v1", tags=["Products"])
app.include_router(product_generate_router, prefix="/api/v1", tags=["Product Video Generation"])
app.include_router(catalog_router, prefix="/api/v1", tags=["Catalog"])
app.include_router(association_router, prefix="/api/v1", tags=["Associations"])
app.include_router(tts_library_router, prefix="/api/v1", tags=["TTS Library"])
app.include_router(image_generate_router, prefix="/api/v1", tags=["AI Image Generation"])

# Desktop-only routes (license, version, settings) — gated behind DESKTOP_MODE
if settings.desktop_mode:
    from app.api.desktop_routes import router as desktop_router
    app.include_router(desktop_router, prefix="/api/v1", tags=["Desktop"])

# Static files pentru frontend
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
