"""
Global FFmpeg concurrency control.

Provides a single shared semaphore for ALL FFmpeg render processes across
all routes (library, pipeline, product) to prevent CPU/RAM exhaustion.

Also provides:
- A secondary semaphore for preparatory FFmpeg operations (trim, extend, etc.)
- A safe subprocess runner that properly kills processes on timeout
- A disk space pre-check before rendering
"""
import asyncio
import logging
import shutil
import subprocess
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

# =============================================================================
# Global semaphores — shared across ALL routes
# =============================================================================

# Max concurrent FINAL FFmpeg render processes (the heavy encode step).
# Library, Pipeline, and Product routes all share this single gate.
# Set to 1 to prevent WSL2 OOM crashes — renders queue instead of running in parallel.
MAX_CONCURRENT_RENDERS = 1
_ffmpeg_render_semaphore: asyncio.Semaphore | None = None

# Max concurrent PREPARATORY FFmpeg processes (trim, extend, silence removal,
# segment extraction, loudness measurement). These are lighter but still
# spawn real FFmpeg/ffprobe subprocesses.
MAX_CONCURRENT_PREP = 2
_ffmpeg_prep_semaphore: asyncio.Semaphore | None = None

# Threading lock to prevent race condition during lazy semaphore creation.
# Without this, two concurrent coroutines could each create their own
# Semaphore instance, bypassing the concurrency limit entirely.
_semaphore_init_lock = threading.Lock()


def init_semaphores() -> None:
    """Create all semaphores eagerly inside the running event loop.

    Call this once during FastAPI lifespan startup so that the semaphores
    are bound to the correct event loop before any request handler runs.
    """
    _get_render_semaphore()
    _get_prep_semaphore()
    _get_preview_semaphore()
    logger.info("FFmpeg semaphores initialized")


def _get_render_semaphore() -> asyncio.Semaphore:
    """Lazily create render semaphore in the running event loop."""
    global _ffmpeg_render_semaphore
    if _ffmpeg_render_semaphore is None:
        with _semaphore_init_lock:
            if _ffmpeg_render_semaphore is None:
                _ffmpeg_render_semaphore = asyncio.Semaphore(MAX_CONCURRENT_RENDERS)
    return _ffmpeg_render_semaphore


def _get_prep_semaphore() -> asyncio.Semaphore:
    """Lazily create prep semaphore in the running event loop."""
    global _ffmpeg_prep_semaphore
    if _ffmpeg_prep_semaphore is None:
        with _semaphore_init_lock:
            if _ffmpeg_prep_semaphore is None:
                _ffmpeg_prep_semaphore = asyncio.Semaphore(MAX_CONCURRENT_PREP)
    return _ffmpeg_prep_semaphore

# Timeout (seconds) waiting to acquire a semaphore slot before giving up.
SEMAPHORE_ACQUIRE_TIMEOUT = 600  # 10 minutes

# Minimum free disk space (bytes) required before starting a render.
MIN_FREE_DISK_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB


# =============================================================================
# Semaphore context managers with timeout
# =============================================================================

class _SemaphoreWithTimeout:
    """Async context manager that acquires a semaphore with a timeout."""

    def __init__(self, semaphore: asyncio.Semaphore, timeout: float, name: str):
        self._semaphore = semaphore
        self._timeout = timeout
        self._name = name

    async def __aenter__(self):
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=self._timeout)
        except asyncio.TimeoutError:
            raise RuntimeError(
                f"FFmpeg {self._name} queue full — could not acquire slot "
                f"within {self._timeout}s. Try again later."
            )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        self._semaphore.release()
        return False


def acquire_render_slot(timeout: float = SEMAPHORE_ACQUIRE_TIMEOUT):
    """Acquire a slot for a heavy FFmpeg render (final encode).

    Usage::

        async with acquire_render_slot():
            await _render_with_preset(...)
    """
    return _SemaphoreWithTimeout(_get_render_semaphore(), timeout, "render")


def acquire_prep_slot(timeout: float = SEMAPHORE_ACQUIRE_TIMEOUT):
    """Acquire a slot for a preparatory FFmpeg operation (trim/extend/silence).

    Usage::

        async with acquire_prep_slot():
            await asyncio.to_thread(subprocess.run, cmd, ...)
    """
    return _SemaphoreWithTimeout(_get_prep_semaphore(), timeout, "prep")


# =============================================================================
# Safe FFmpeg subprocess runner (Popen + kill on timeout, no zombies)
# =============================================================================

def safe_ffmpeg_run(
    cmd: list,
    timeout: int = 300,
    operation: str = "ffmpeg",
) -> subprocess.CompletedProcess:
    """Run an FFmpeg/ffprobe command safely with proper zombie prevention.

    Unlike ``subprocess.run(..., timeout=N)`` which leaves the child alive
    after ``TimeoutExpired``, this function explicitly kills the process and
    drains its pipes before re-raising.

    Args:
        cmd: Command list (e.g. ["ffmpeg", "-y", ...]).
        timeout: Maximum seconds to wait for the process.
        operation: Human-readable label for error messages.

    Returns:
        subprocess.CompletedProcess with stdout/stderr captured.

    Raises:
        RuntimeError: On timeout (process is killed first).
    """
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.communicate(timeout=10)  # Drain pipes & reap zombie (bounded wait)
        except subprocess.TimeoutExpired:
            logger.warning(f"{operation}: process did not exit within 10s after kill")
        raise RuntimeError(f"{operation} timed out after {timeout}s")
    return subprocess.CompletedProcess(
        args=cmd,
        returncode=proc.returncode,
        stdout=stdout,
        stderr=stderr,
    )


# =============================================================================
# GPU (NVENC) detection — cached after first check
# =============================================================================

_nvenc_available: bool | None = None


def is_nvenc_available() -> bool:
    """Check if NVIDIA NVENC hardware encoder is available.

    Result is cached after the first call so FFmpeg is only spawned once.
    """
    global _nvenc_available
    if _nvenc_available is not None:
        return _nvenc_available
    try:
        result = subprocess.run(
            ["ffmpeg", "-encoders"],
            capture_output=True, text=True, timeout=5,
        )
        _nvenc_available = "h264_nvenc" in result.stdout
    except Exception:
        _nvenc_available = False
    if _nvenc_available:
        logger.info("NVENC hardware encoder detected — GPU rendering enabled")
    else:
        logger.info("NVENC not available — using CPU encoding")
    return _nvenc_available


# =============================================================================
# Preview semaphore — separate from production, lighter limit
# =============================================================================

MAX_CONCURRENT_PREVIEW = 2
_ffmpeg_preview_semaphore: asyncio.Semaphore | None = None


def _get_preview_semaphore() -> asyncio.Semaphore:
    """Lazily create preview semaphore in the running event loop."""
    global _ffmpeg_preview_semaphore
    if _ffmpeg_preview_semaphore is None:
        with _semaphore_init_lock:
            if _ffmpeg_preview_semaphore is None:
                _ffmpeg_preview_semaphore = asyncio.Semaphore(MAX_CONCURRENT_PREVIEW)
    return _ffmpeg_preview_semaphore


def acquire_preview_slot(timeout: float = SEMAPHORE_ACQUIRE_TIMEOUT):
    """Acquire a slot for a preview FFmpeg render (fast, low-quality).

    Usage::

        async with acquire_preview_slot():
            await assemble_and_render_preview(...)
    """
    return _SemaphoreWithTimeout(_get_preview_semaphore(), timeout, "preview")


def get_preview_codec_params(use_gpu: bool = False) -> list[str]:
    """Return fast, low-quality codec params for preview renders (540x960, ultrafast)."""
    if use_gpu:
        return ["-c:v", "h264_nvenc", "-preset", "p1", "-cq", "40"]
    return ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "32"]


def get_prep_codec_params(
    preset: str = "fast",
    crf: int = 23,
    include_audio: bool = True,
) -> list[str]:
    """Return codec params for preparatory FFmpeg operations.

    Uses NVENC when available, falls back to libx264.
    """
    if is_nvenc_available():
        params = ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", str(crf)]
    else:
        params = ["-c:v", "libx264", "-preset", preset, "-crf", str(crf)]

    if include_audio:
        params.extend(["-c:a", "aac"])

    return params


# =============================================================================
# Disk space check
# =============================================================================

def check_disk_space(path: Path, min_bytes: int = MIN_FREE_DISK_BYTES) -> None:
    """Raise RuntimeError if free disk space at *path* is below *min_bytes*.

    Call this before starting any render to fail fast instead of producing
    a corrupt partial file and a cryptic FFmpeg error.
    """
    try:
        usage = shutil.disk_usage(path)
        if usage.free < min_bytes:
            free_gb = usage.free / (1024 ** 3)
            required_gb = min_bytes / (1024 ** 3)
            raise RuntimeError(
                f"Insufficient disk space: {free_gb:.1f} GB free, "
                f"need at least {required_gb:.1f} GB"
            )
    except OSError as e:
        logger.warning(f"Could not check disk space at {path}: {e}")
        # Don't block renders if we can't stat the filesystem
