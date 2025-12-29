#!/usr/bin/env python3
"""
Edit Factory - Run Script
Porneste serverul FastAPI.
"""
import os
from pathlib import Path

# Add local FFmpeg to PATH if exists
ffmpeg_bin = Path(__file__).parent / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin"
if ffmpeg_bin.exists():
    os.environ['PATH'] = str(ffmpeg_bin) + os.pathsep + os.environ.get('PATH', '')
    print(f"[FFmpeg] Added to PATH: {ffmpeg_bin}")

import uvicorn
from app.config import get_settings

if __name__ == "__main__":
    settings = get_settings()

    print(f"""
    ===============================================
              EDIT FACTORY v1.0.0
    ===============================================
      Server: http://{settings.host}:{settings.port}
      Docs:   http://localhost:{settings.port}/docs
      UI:     http://localhost:{settings.port}/static
    ===============================================
    """)

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
