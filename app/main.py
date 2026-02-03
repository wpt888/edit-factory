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

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes import router as api_router
from app.api.library_routes import router as library_router
from app.api.segments_routes import router as segments_router
from app.api.postiz_routes import router as postiz_router
from app.api.profile_routes import router as profile_router

# Configurare logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Get settings
settings = get_settings()

# Cream aplicatia
app = FastAPI(
    title="Edit Factory",
    description="Video processing API pentru reels si short-form content",
    version="1.0.0"
)

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

# Static files pentru frontend
static_path = Path(__file__).parent.parent / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")


@app.on_event("startup")
async def startup_event():
    """Initialize on startup."""
    settings.ensure_dirs()
    logger.info("Edit Factory started")
    logger.info(f"  Input dir: {settings.input_dir.absolute()}")
    logger.info(f"  Output dir: {settings.output_dir.absolute()}")


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
