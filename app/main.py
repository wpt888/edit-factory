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

# Configurare logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Cream aplicatia
app = FastAPI(
    title="Edit Factory",
    description="Video processing API pentru reels si short-form content",
    version="1.0.0"
)

# CORS - permitem toate originile pentru development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router, prefix="/api/v1", tags=["Video Processing"])
app.include_router(library_router, prefix="/api/v1", tags=["Library & Workflow"])

# Static files pentru frontend
static_path = Path(__file__).parent.parent / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")


@app.on_event("startup")
async def startup_event():
    """Initialize on startup."""
    settings = get_settings()
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
