"""ML bundle download endpoint — fetches platform-specific GitHub Release asset,
streams SSE progress, verifies SHA256, unpacks atomically, writes .installed marker.
See .planning/phases/86-ml-bundle-download-endpoint-ui/86-01-PLAN.md for design.
"""
import asyncio
import hashlib
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
    # [Rule 1 - Bug] Moved filename resolution before flag-set to prevent _download_in_progress
    # leaking to True when the platform is unsupported (HTTPException path).
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

        # ---- DOWNLOAD STAGE ----
        try:
            downloaded_total = 0
            expected_total = 0
            async for evt in _download_with_progress(base_url + filename, partial_path):
                if evt.get("event") == "__complete__":
                    downloaded_total = evt["downloaded"]
                    expected_total = evt["total"]
                else:
                    yield evt
            # Emit final 100% progress event
            yield {
                "event": "progress",
                "data": json.dumps({
                    "stage": "download",
                    "downloaded": downloaded_total,
                    "total": expected_total,
                    "percent": 100,
                }),
            }
        except Exception as e:
            logger.exception("ML bundle download failed")
            yield {"event": "error", "data": json.dumps({"error": str(e), "stage": "download"})}
            return

        # ---- VERIFY STAGE ----
        yield {"event": "progress", "data": json.dumps({"stage": "verify"})}
        try:
            expected_hex = await _fetch_expected_sha256(base_url + filename + ".sha256")
            actual_hex = await asyncio.to_thread(_hash_file_sha256, partial_path)
            if actual_hex.lower() != expected_hex.lower():
                if partial_path.exists():
                    partial_path.unlink()
                yield {
                    "event": "error",
                    "data": json.dumps({
                        "error": f"sha256 mismatch: expected {expected_hex}, got {actual_hex}",
                        "stage": "verify",
                    }),
                }
                return
        except Exception as e:
            logger.exception("ML bundle verify failed")
            yield {"event": "error", "data": json.dumps({"error": str(e), "stage": "verify"})}
            return

        # ---- UNPACK STAGE ----
        yield {"event": "progress", "data": json.dumps({"stage": "unpack"})}
        try:
            await asyncio.to_thread(_unpack_and_promote, partial_path, staging_dir, install_root)
            (install_root / ".installed").write_text(f"{ML_BUNDLE_VERSION}\n", encoding="utf-8")
            if partial_path.exists():
                partial_path.unlink()
        except Exception as e:
            logger.exception("ML bundle unpack failed")
            yield {"event": "error", "data": json.dumps({"error": str(e), "stage": "unpack"})}
            return

        # ---- DONE ----
        yield {
            "event": "done",
            "data": json.dumps({"status": "installed", "version": ML_BUNDLE_VERSION}),
        }
    finally:
        _download_in_progress = False


async def _download_with_progress(url: str, partial_path: Path) -> AsyncIterator[dict]:
    """Async generator. Yields SSE progress dicts and a final sentinel dict.

    Implements 3-branch HTTP Range resume per LD-06:
    - No existing partial: send no Range header, open "wb"
    - Existing partial > 0: send Range: bytes=N-, then:
        * 206: append mode
        * 200: restart (ignore Range, delete partial, restart)
        * 416: file already complete, skip download
    - Any other status: raise RuntimeError

    Yields a SINGLE sentinel at the end: {"event": "__complete__", "downloaded": N, "total": M}.
    Caller should filter it out and use the values to emit the final 100% progress event.
    """
    existing_size = partial_path.stat().st_size if partial_path.exists() else 0
    headers = {}
    mode = "wb"
    if existing_size > 0:
        headers["Range"] = f"bytes={existing_size}-"

    timeout = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=None)
    async with _AsyncClient(follow_redirects=True, timeout=timeout) as client:
        async with client.stream("GET", url, headers=headers) as response:
            status = response.status_code

            if status == 416:
                # File already complete — skip download, proceed to verify
                yield {"event": "__complete__", "downloaded": existing_size, "total": existing_size}
                return

            if status == 206:
                mode = "ab"
                content_length = int(response.headers.get("Content-Length", "0") or "0")
                expected_total = existing_size + content_length
                downloaded = existing_size
            elif status == 200:
                # Server ignored Range. Restart from byte 0.
                if partial_path.exists():
                    partial_path.unlink()
                mode = "wb"
                content_length = int(response.headers.get("Content-Length", "0") or "0")
                expected_total = content_length
                downloaded = 0
            else:
                raise RuntimeError(f"Unexpected status {status} from {url}")

            last_emit_bytes = downloaded
            last_emit_time = time.monotonic()
            # Emit start-of-download progress (0% or resume point)
            yield {
                "event": "progress",
                "data": json.dumps({
                    "stage": "download",
                    "downloaded": downloaded,
                    "total": expected_total,
                    "percent": int((downloaded / expected_total * 100) if expected_total else 0),
                }),
            }

            with open(partial_path, mode) as f:
                async for chunk in response.aiter_bytes(CHUNK_SIZE):
                    f.write(chunk)
                    downloaded += len(chunk)
                    now = time.monotonic()
                    bytes_since_last = downloaded - last_emit_bytes
                    time_since_last = now - last_emit_time
                    if bytes_since_last >= PROGRESS_THROTTLE_BYTES and time_since_last >= PROGRESS_THROTTLE_SECS:
                        yield {
                            "event": "progress",
                            "data": json.dumps({
                                "stage": "download",
                                "downloaded": downloaded,
                                "total": expected_total,
                                "percent": int((downloaded / expected_total * 100) if expected_total else 0),
                            }),
                        }
                        last_emit_bytes = downloaded
                        last_emit_time = now

            yield {"event": "__complete__", "downloaded": downloaded, "total": expected_total}


async def _fetch_expected_sha256(url: str) -> str:
    """Fetch a .sha256 sibling file and return the hex digest (first whitespace-delimited token)."""
    timeout = httpx.Timeout(connect=30.0, read=60.0, write=30.0, pool=None)
    async with _AsyncClient(follow_redirects=True, timeout=timeout) as client:
        response = await client.get(url)
        response.raise_for_status()
        text = response.text.strip()
        if not text:
            raise RuntimeError("empty sha256 file")
        return text.split()[0]


def _hash_file_sha256(path: Path) -> str:
    """Compute SHA256 of a file incrementally. Returns hex digest."""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


def _unpack_and_promote(partial_path: Path, staging_dir: Path, install_root: Path) -> None:
    """Extract tarball to staging_dir, then atomically promote into install_root.

    Steps:
    1. Remove existing staging_dir contents (idempotent retry).
    2. Extract tarball into staging_dir.
    3. Remove any existing install_root contents EXCEPT .partial, .staging, .installed.
    4. Move every entry from staging_dir into install_root.
    5. Remove staging_dir.
    """
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)

    with tarfile.open(partial_path, "r:gz") as tar:
        tar.extractall(staging_dir)

    # Promote: remove existing install_root entries except managed dirs/marker
    for entry in install_root.iterdir():
        if entry.name in (".partial", ".staging", ".installed"):
            continue
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()

    # Move staging contents into install_root
    for entry in staging_dir.iterdir():
        shutil.move(str(entry), str(install_root / entry.name))

    shutil.rmtree(staging_dir)
