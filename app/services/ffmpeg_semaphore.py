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
import os
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

# =============================================================================
# Global semaphores — shared across ALL routes
# =============================================================================

# Max concurrent FINAL FFmpeg render processes (the heavy encode step).
# Library, Pipeline, and Product routes all share this single gate.
#
# Wave 2.1: the default now ADAPTS to hardware instead of being pinned to 1.
#   - explicit env MAX_CONCURRENT_RENDERS always wins (set "1" to force serial)
#   - GPU (NVENC) present -> 2, or 3 with >=12 GB VRAM: NVENC sessions are light
#     (~1.5-2 GB each) so a couple run comfortably in parallel
#   - CPU-only -> 1 (libx264 2-pass is heavy; parallel CPU encodes just thrash)
# 0 here means "decide lazily once the event loop / GPU probe is available".
_RENDER_CONCURRENCY_ENV = os.environ.get("MAX_CONCURRENT_RENDERS")
MAX_CONCURRENT_RENDERS = int(_RENDER_CONCURRENCY_ENV) if _RENDER_CONCURRENCY_ENV else 0
_ffmpeg_render_semaphore: asyncio.Semaphore | None = None

# Max concurrent PREPARATORY FFmpeg processes (trim, extend, silence removal,
# segment extraction, loudness measurement). These are lighter but still
# spawn real FFmpeg/ffprobe subprocesses.
MAX_CONCURRENT_PREP = int(os.environ.get("MAX_CONCURRENT_PREP", "2"))
_ffmpeg_prep_semaphore: asyncio.Semaphore | None = None

# Threading lock to prevent race condition during lazy semaphore creation.
# Without this, two concurrent coroutines could each create their own
# Semaphore instance, bypassing the concurrency limit entirely.
_semaphore_init_lock = asyncio.Lock()


async def init_semaphores() -> None:
    """Create all semaphores eagerly inside the running event loop.

    Call this once during FastAPI lifespan startup so that the semaphores
    are bound to the correct event loop before any request handler runs.
    """
    await _get_render_semaphore()
    await _get_prep_semaphore()
    await _get_preview_semaphore()
    await _get_preview_prep_semaphore()
    logger.info("FFmpeg semaphores initialized")


def _detect_gpu_vram_gb() -> float:
    """Best-effort total VRAM (GB) of the largest NVIDIA GPU; 0.0 if unknown."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode == 0 and out.stdout.strip():
            vals = [float(x) for x in out.stdout.split() if x.strip().replace(".", "").isdigit()]
            if vals:
                return max(vals) / 1024.0  # MiB -> GiB
    except Exception:
        pass
    return 0.0


def compute_render_concurrency() -> int:
    """Adaptive default for concurrent final renders (Wave 2.1).

    Honors an explicit MAX_CONCURRENT_RENDERS env override; otherwise scales with
    the GPU: NVENC present -> 2 (3 with big VRAM), CPU-only -> 1.
    """
    if _RENDER_CONCURRENCY_ENV:
        try:
            return max(1, int(_RENDER_CONCURRENCY_ENV))
        except ValueError:
            pass
    if is_nvenc_available():
        return 3 if _detect_gpu_vram_gb() >= 12.0 else 2
    return 1


async def _get_render_semaphore() -> asyncio.Semaphore:
    """Lazily create render semaphore in the running event loop."""
    global _ffmpeg_render_semaphore, MAX_CONCURRENT_RENDERS
    if _ffmpeg_render_semaphore is None:
        async with _semaphore_init_lock:
            if _ffmpeg_render_semaphore is None:
                if not MAX_CONCURRENT_RENDERS:
                    MAX_CONCURRENT_RENDERS = compute_render_concurrency()
                logger.info(
                    f"Render concurrency = {MAX_CONCURRENT_RENDERS} "
                    f"(NVENC={is_nvenc_available()})"
                )
                _ffmpeg_render_semaphore = asyncio.Semaphore(MAX_CONCURRENT_RENDERS)
    return _ffmpeg_render_semaphore


async def _get_prep_semaphore() -> asyncio.Semaphore:
    """Lazily create prep semaphore in the running event loop."""
    global _ffmpeg_prep_semaphore
    if _ffmpeg_prep_semaphore is None:
        async with _semaphore_init_lock:
            if _ffmpeg_prep_semaphore is None:
                _ffmpeg_prep_semaphore = asyncio.Semaphore(MAX_CONCURRENT_PREP)
    return _ffmpeg_prep_semaphore

# Timeout (seconds) waiting to acquire a semaphore slot before giving up.
SEMAPHORE_ACQUIRE_TIMEOUT = int(os.environ.get("SEMAPHORE_ACQUIRE_TIMEOUT", "600"))  # 10 minutes

# Minimum free disk space (bytes) required before starting a render.
MIN_FREE_DISK_BYTES = int(os.environ.get("MIN_FREE_DISK_BYTES", str(2 * 1024 * 1024 * 1024)))  # 2 GB


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


async def acquire_render_slot(timeout: float = SEMAPHORE_ACQUIRE_TIMEOUT):
    """Acquire a slot for a heavy FFmpeg render (final encode).

    Usage::

        async with await acquire_render_slot():
            await _render_with_preset(...)
    """
    sem = await _get_render_semaphore()
    return _SemaphoreWithTimeout(sem, timeout, "render")


async def acquire_prep_slot(timeout: float = SEMAPHORE_ACQUIRE_TIMEOUT):
    """Acquire a slot for a preparatory FFmpeg operation (trim/extend/silence).

    Usage::

        async with await acquire_prep_slot():
            await asyncio.to_thread(subprocess.run, cmd, ...)
    """
    sem = await _get_prep_semaphore()
    return _SemaphoreWithTimeout(sem, timeout, "prep")


# =============================================================================
# Safe FFmpeg subprocess runner (Popen + kill on timeout, no zombies)
# =============================================================================

# Background encodes must never starve the UI: on the desktop (Electron) the
# user plays a preview WHILE other variants render, and normal-priority FFmpeg
# saturating the cores makes playback stutter. Below-normal keeps encodes at
# full speed on idle cores but always yields to the foreground app.
_POPEN_PRIORITY: dict = (
    {"creationflags": subprocess.BELOW_NORMAL_PRIORITY_CLASS} if os.name == "nt" else {}
)


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
    from app.services.ffmpeg_registry import (
        register_process,
        unregister_process,
        was_killed_by_cancel,
    )

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        **_POPEN_PRIORITY,
    )
    register_process(proc)
    try:
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.communicate(timeout=10)  # Drain pipes & reap zombie (bounded wait)
            except subprocess.TimeoutExpired:
                logger.warning(f"{operation}: process did not exit within 10s after kill")
            raise RuntimeError(f"{operation} timed out after {timeout}s")
        # External user-cancel (via ffmpeg_registry.kill_job) shows up as a
        # non-zero exit — on POSIX the returncode is negative (signal), on
        # Windows TerminateProcess yields a positive code (e.g. 1).  We rely
        # on the explicit tag set by kill_job so the signal heuristic isn't
        # needed, making the check cross-platform.
        if was_killed_by_cancel(proc):
            raise RuntimeError(f"{operation} was cancelled by user")
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=proc.returncode,
            stdout=stdout,
            stderr=stderr,
        )
    finally:
        unregister_process(proc)


def safe_ffmpeg_run_with_progress(
    cmd: list,
    total_duration: float,
    on_progress=None,
    timeout: int = 1800,
    operation: str = "ffmpeg",
) -> subprocess.CompletedProcess:
    """Run an FFmpeg encode while streaming REAL progress.

    Injects ``-progress pipe:1 -nostats`` and parses ffmpeg's progress stream to
    invoke ``on_progress(fraction)`` (0.0-1.0) as the encode advances — this is
    what replaces the fake "jumps to 85% then freezes" progress bar.

    stderr is redirected to a temp file (not a pipe) so reading stdout cannot
    deadlock on a full stderr buffer; its contents are returned in the result
    for error reporting. A watchdog timer guarantees a hard timeout even though
    we read line-by-line instead of using ``communicate(timeout=...)``.

    Falls back to plain ``safe_ffmpeg_run`` when no usable duration/callback is
    supplied, so callers can pass ``on_progress=None`` unconditionally.
    """
    from app.services.ffmpeg_registry import (
        register_process,
        unregister_process,
        was_killed_by_cancel,
    )
    import time
    import tempfile
    import threading

    if on_progress is None or not total_duration or total_duration <= 0:
        return safe_ffmpeg_run(cmd, timeout=timeout, operation=operation)

    # Inject progress flags right after the executable (+ optional "-y"), before
    # inputs/output. Build a new list — never mutate the caller's cmd.
    insert_at = 2 if len(cmd) >= 2 and cmd[1] == "-y" else 1
    run_cmd = cmd[:insert_at] + ["-progress", "pipe:1", "-nostats"] + cmd[insert_at:]

    stderr_file = tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(
        run_cmd,
        stdout=subprocess.PIPE,
        stderr=stderr_file,
        text=True,
        **_POPEN_PRIORITY,
    )
    register_process(proc)

    timed_out = {"v": False}

    def _on_timeout():
        timed_out["v"] = True
        try:
            proc.kill()
        except Exception:
            pass

    watchdog = threading.Timer(timeout, _on_timeout)
    watchdog.daemon = True
    watchdog.start()

    last_frac = -1.0
    try:
        # ffmpeg emits a progress block (~every 0.5s while encoding); each ends
        # with a "progress=continue|end" line. Parse out_time to a fraction.
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                # Both keys are microseconds in ffmpeg's progress output.
                try:
                    secs = int(line.split("=", 1)[1]) / 1_000_000.0
                except ValueError:
                    continue
                frac = max(0.0, min(0.999, secs / total_duration))
                if frac - last_frac >= 0.01:  # throttle to ~1% steps
                    last_frac = frac
                    try:
                        on_progress(frac)
                    except Exception:
                        pass
        proc.wait(timeout=30)
        if timed_out["v"]:
            raise RuntimeError(f"{operation} timed out after {timeout}s")
        if was_killed_by_cancel(proc):
            raise RuntimeError(f"{operation} was cancelled by user")
        stderr_file.seek(0)
        stderr_text = stderr_file.read()
        return subprocess.CompletedProcess(
            args=run_cmd,
            returncode=proc.returncode,
            stdout="",
            stderr=stderr_text,
        )
    finally:
        watchdog.cancel()
        unregister_process(proc)
        try:
            stderr_file.close()
        except Exception:
            pass


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

# Dedicated prep semaphore for preview segment extraction — separate from
# production prep so previews never queue behind heavy production renders.
MAX_CONCURRENT_PREVIEW_PREP = int(os.environ.get("MAX_CONCURRENT_PREVIEW_PREP", "3"))
_ffmpeg_preview_prep_semaphore: asyncio.Semaphore | None = None


async def _get_preview_semaphore() -> asyncio.Semaphore:
    """Lazily create preview semaphore in the running event loop."""
    global _ffmpeg_preview_semaphore
    if _ffmpeg_preview_semaphore is None:
        async with _semaphore_init_lock:
            if _ffmpeg_preview_semaphore is None:
                _ffmpeg_preview_semaphore = asyncio.Semaphore(MAX_CONCURRENT_PREVIEW)
    return _ffmpeg_preview_semaphore


async def _get_preview_prep_semaphore() -> asyncio.Semaphore:
    """Lazily create preview prep semaphore in the running event loop."""
    global _ffmpeg_preview_prep_semaphore
    if _ffmpeg_preview_prep_semaphore is None:
        async with _semaphore_init_lock:
            if _ffmpeg_preview_prep_semaphore is None:
                _ffmpeg_preview_prep_semaphore = asyncio.Semaphore(MAX_CONCURRENT_PREVIEW_PREP)
    return _ffmpeg_preview_prep_semaphore


async def acquire_preview_slot(timeout: float = SEMAPHORE_ACQUIRE_TIMEOUT):
    """Acquire a slot for a preview FFmpeg render (fast, low-quality).

    Usage::

        async with await acquire_preview_slot():
            await assemble_and_render_preview(...)
    """
    sem = await _get_preview_semaphore()
    return _SemaphoreWithTimeout(sem, timeout, "preview")


async def acquire_preview_prep_slot(timeout: float = 120):
    """Acquire a slot for preview segment extraction.

    Uses a dedicated semaphore (not shared with production prep) so preview
    segment extractions never queue behind heavy production renders.
    Shorter default timeout (120s) since previews should be fast.
    """
    sem = await _get_preview_prep_semaphore()
    return _SemaphoreWithTimeout(sem, timeout, "preview-prep")


def get_preview_codec_params(use_gpu: bool = False) -> list[str]:
    """Return fast, low-quality codec params for preview renders (540x960, ultrafast)."""
    if use_gpu:
        return ["-c:v", "h264_nvenc", "-preset", "p1", "-cq", "40",
                "-profile:v", "baseline", "-level", "3.1",
                "-g", "60"]
    return ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "32",
            "-profile:v", "baseline", "-level", "3.1",
            "-g", "60", "-keyint_min", "60"]


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
        # BUG-6.2: Include sample rate and channels for both GPU and CPU paths
        params.extend(["-c:a", "aac", "-ar", "48000", "-ac", "2"])

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
