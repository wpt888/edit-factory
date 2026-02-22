"""
Edit Factory - FastAPI Application
"""
import os
import logging
from pathlib import Path

# Add local FFmpeg to PATH if exists
_ffmpeg_bin = Path(__file__).parent.parent / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin"
if _ffmpeg_bin.exists():
    os.environ['PATH'] = str(_ffmpeg_bin) + os.pathsep + os.environ.get('PATH', '')

from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import get_settings
from app.api.routes import router as api_router
from app.api.library_routes import router as library_router
from app.api.segments_routes import router as segments_router
from app.api.postiz_routes import router as postiz_router
from app.api.profile_routes import router as profile_router
from app.api import tts_routes
from app.api.script_routes import router as script_router
from app.api.assembly_routes import router as assembly_router
from app.api.pipeline_routes import router as pipeline_router
from app.api.tts_library_routes import router as tts_library_router
from app.api.elevenlabs_accounts_routes import router as elevenlabs_accounts_router
from app.api.feed_routes import router as feed_router
from app.api.product_routes import router as product_router
from app.api.product_generate_routes import router as product_generate_router

from app.logging_config import setup_logging
setup_logging()
logger = logging.getLogger(__name__)

# Get settings
settings = get_settings()

# Rate limiter - 60 requests/minute per IP (default limit for all routes)
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])

async def _recover_stuck_projects():
    """Recover projects stuck in 'generating' status (e.g. from server crash)."""
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
                    "updated_at": datetime.now().isoformat()
                }).eq("id", proj["id"]).execute()
            logger.info(f"Recovered {len(result.data)} stuck projects (generating -> failed)")
    except Exception as e:
        logger.warning(f"Failed to recover stuck projects: {e}")


async def _cleanup_expired_pipelines():
    """Delete expired pipeline and assembly job rows from Supabase."""
    try:
        from app.db import get_supabase
        supabase = get_supabase()
        if not supabase:
            return
        now = datetime.now().isoformat()

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    settings.ensure_dirs()
    logger.info("Edit Factory started")
    logger.info(f"  Input dir: {settings.input_dir.absolute()}")
    logger.info(f"  Output dir: {settings.output_dir.absolute()}")
    await _recover_stuck_projects()
    await _cleanup_expired_pipelines()
    yield
    # Shutdown (nothing needed)


# Cream aplicatia
app = FastAPI(
    title="Edit Factory",
    description="Video processing API pentru reels si short-form content",
    version="1.0.0",
    lifespan=lifespan
)

# Register rate limiter on app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# CORS - configurat din environment variables
# În producție: ALLOWED_ORIGINS=https://editai.obsid.ro
allowed_origins = [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]
logger.info(f"CORS allowed origins: {allowed_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With", "X-Profile-Id"],
    expose_headers=["Content-Disposition"],
)

# Include API routes
app.include_router(api_router, prefix="/api/v1", tags=["Video Processing"])
app.include_router(library_router, prefix="/api/v1", tags=["Library & Workflow"])
app.include_router(segments_router, prefix="/api/v1", tags=["Segments & Manual Selection"])
app.include_router(postiz_router, prefix="/api/v1", tags=["Postiz Publishing"])
app.include_router(profile_router, prefix="/api/v1")
app.include_router(tts_routes.router, prefix="/api/v1")
app.include_router(script_router, prefix="/api/v1", tags=["AI Script Generation"])
app.include_router(assembly_router, prefix="/api/v1", tags=["Script-to-Video Assembly"])
app.include_router(pipeline_router, prefix="/api/v1", tags=["Multi-Variant Pipeline"])
app.include_router(tts_library_router, prefix="/api/v1", tags=["TTS Library"])
app.include_router(elevenlabs_accounts_router, prefix="/api/v1", tags=["ElevenLabs Accounts"])
app.include_router(feed_router, prefix="/api/v1", tags=["feeds"])
app.include_router(product_router, prefix="/api/v1", tags=["Products"])
app.include_router(product_generate_router, prefix="/api/v1", tags=["Product Video Generation"])

# Static files pentru frontend
static_path = Path(__file__).parent.parent / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")


@app.get("/")
async def root():
    """Root endpoint - redirect to docs."""
    return {
        "name": "Edit Factory",
        "version": "1.0.0",
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
