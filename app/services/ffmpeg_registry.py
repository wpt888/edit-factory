"""
Live FFmpeg process registry — enables cancelling in-flight renders.

Each top-level task (e.g. a pipeline render for variant "0_A") sets a
``job_key`` via the ``active_job_key`` ContextVar before it starts calling
``safe_ffmpeg_run``.  The runner then registers the live ``subprocess.Popen``
under that job key, so an external cancel request can terminate the actual
FFmpeg processes instead of waiting for them to finish naturally.

ContextVar propagates through ``asyncio.to_thread`` automatically (the
runtime copies the current context into the worker thread), so individual
FFmpeg calls inside assembly_service do not need to thread a job_key
argument through every helper.
"""
from __future__ import annotations

import logging
import subprocess
import threading
from contextvars import ContextVar
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


active_job_key: ContextVar[Optional[str]] = ContextVar("ffmpeg_active_job_key", default=None)

_processes_by_job: Dict[str, List[subprocess.Popen]] = {}
_processes_lock = threading.Lock()


def register_process(proc: subprocess.Popen) -> None:
    """Associate ``proc`` with the current task's job_key (no-op if unset)."""
    job_key = active_job_key.get()
    if job_key is None:
        return
    with _processes_lock:
        _processes_by_job.setdefault(job_key, []).append(proc)


def unregister_process(proc: subprocess.Popen) -> None:
    """Remove ``proc`` from the registry (no-op if unknown)."""
    job_key = active_job_key.get()
    if job_key is None:
        return
    with _processes_lock:
        procs = _processes_by_job.get(job_key)
        if not procs:
            return
        try:
            procs.remove(proc)
        except ValueError:
            return
        if not procs:
            _processes_by_job.pop(job_key, None)


def kill_job(job_key: str) -> int:
    """Kill every live FFmpeg process registered under ``job_key``.

    Also tags each process with ``_ef_killed_by_cancel = True`` so that
    ``safe_ffmpeg_run`` can distinguish a user-initiated kill from a regular
    non-zero FFmpeg exit.  This matters on Windows where ``TerminateProcess``
    yields a positive exit code (typically 1), making signal-based detection
    (``returncode < 0``) unreliable.

    Returns the number of processes we attempted to kill.  Safe to call
    even if no processes are registered — returns 0 in that case.
    """
    key = str(job_key)
    with _processes_lock:
        procs = list(_processes_by_job.get(key, []))
    killed = 0
    for proc in procs:
        try:
            if proc.poll() is None:
                setattr(proc, "_ef_killed_by_cancel", True)
                proc.kill()
                killed += 1
        except Exception as e:
            logger.warning(f"kill_job({key}): failed to kill PID {getattr(proc, 'pid', '?')}: {e}")
    if killed:
        logger.info(f"kill_job({key}): killed {killed} ffmpeg process(es)")
    return killed


def was_killed_by_cancel(proc) -> bool:
    """True iff ``kill_job`` tagged this process before terminating it."""
    return bool(getattr(proc, "_ef_killed_by_cancel", False))


def has_active_processes(job_key: str) -> bool:
    with _processes_lock:
        return bool(_processes_by_job.get(str(job_key)))
