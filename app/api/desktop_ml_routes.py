"""ML bundle download endpoint — fetches platform-specific GitHub Release asset,
streams SSE progress, verifies SHA256, unpacks atomically, writes .installed marker.
See .planning/phases/86-ml-bundle-download-endpoint-ui/86-01-PLAN.md for design.
"""
import asyncio
import hashlib
import io
import json
import logging
import os
import platform
import shutil
import sys
import tarfile
import time
from pathlib import Path
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from app.config import get_base_dir

# Module-level alias — tests patch this instead of httpx.AsyncClient directly
# so the patch stays scoped to this module and does not affect the test's own httpx usage.
_AsyncClient = httpx.AsyncClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/desktop/ml", tags=["Desktop ML"])

ML_BUNDLE_VERSION = "0.1.0"
CHUNK_SIZE = 1024 * 1024  # 1 MB
PROGRESS_THROTTLE_BYTES = 512 * 1024  # 512 KB
PROGRESS_THROTTLE_SECS = 0.25

_download_lock = asyncio.Lock()
_download_in_progress: bool = False


def _resolve_bundle_filename() -> str:
    """Return the platform-specific bundle filename. Raises HTTPException(400) on unknown platforms."""
    version = ML_BUNDLE_VERSION
    if sys.platform == "win32":
        return f"ml-bundle-win64-{version}.tar.gz"
    if sys.platform == "darwin":
        if platform.machine() == "arm64":
            return f"ml-bundle-darwin-arm64-{version}.tar.gz"
        return f"ml-bundle-darwin-x64-{version}.tar.gz"
    if sys.platform.startswith("linux"):
        return f"ml-bundle-linux-x64-{version}.tar.gz"
    raise HTTPException(status_code=400, detail=f"Unsupported platform: {sys.platform}")


def _resolve_base_url() -> str:
    """Return the bundle base URL with {version} substituted."""
    template = os.getenv(
        "ML_BUNDLE_BASE_URL",
        "https://github.com/wpt888/edit_factory/releases/download/ml-v{version}/",
    )
    return template.format(version=ML_BUNDLE_VERSION)


@router.post("/download")
async def download_ml_bundle():
    """POST /api/v1/desktop/ml/download — stream install progress as SSE."""
    global _download_in_progress
    # Resolve filename FIRST — unsupported platform must 400 before we set the flag.
    filename = _resolve_bundle_filename()
    base_url = _resolve_base_url()
    async with _download_lock:
        if _download_in_progress:
            return JSONResponse(status_code=409, content={"error": "download_in_progress"})
        _download_in_progress = True
    return EventSourceResponse(_event_stream(filename, base_url))


async def _event_stream(filename: str, base_url: str) -> AsyncIterator[dict]:
    """Drive the install pipeline: download → verify → unpack → mark."""
    global _download_in_progress
    try:
        install_root = get_base_dir() / "ml"
        partial_dir = install_root / ".partial"
        staging_dir = install_root / ".staging" / ML_BUNDLE_VERSION
        partial_path = partial_dir / filename
        partial_dir.mkdir(parents=True, exist_ok=True)

        # Stub bodies — populated in Task 2.
        yield {"event": "progress", "data": json.dumps({"stage": "download", "downloaded": 0, "total": 0, "percent": 0})}
        raise NotImplementedError("Task 2 implements the download/verify/unpack pipeline")
    except Exception as e:
        yield {"event": "error", "data": json.dumps({"error": str(e), "stage": "download"})}
    finally:
        _download_in_progress = False
