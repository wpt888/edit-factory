"""
FFmpeg path discovery — cross-platform resolver.

Extracted from app/main.py so it can be imported and tested without pulling in
the full FastAPI/scipy stack (app/main.py imports app.api.routes which imports
app.services.video_processor which depends on scipy/cv2).

Resolver order: FFMPEG_BINARY env → bundled binary (RESOURCES_PATH or per-OS
repo dev candidates) → shutil.which("ffmpeg") for system PATH discovery.
Order is authoritative per v13-ROADMAP.md line 101.

app/main.py re-exports _resolve_ffmpeg_path and _setup_ffmpeg_path from here
and calls _setup_ffmpeg_path() at module import as before.
"""
import os
import sys
import shutil
import logging
from pathlib import Path


def _resolve_ffmpeg_path() -> Path | None:
    """Resolve the FFmpeg bin directory using the env → bundled → PATH order.

    Returns:
        Path of the directory containing the ffmpeg binary, or None if no
        ffmpeg is locatable. Returning None signals the caller that PATH
        discovery already failed and subprocess calls will rely on whatever
        PATH inheritance provides (which is also None).
    """
    _logger = logging.getLogger(__name__)

    # 1. Environment override (highest priority — power-user / CI / debugging)
    env_binary = os.getenv("FFMPEG_BINARY")
    if env_binary:
        env_path = Path(env_binary)
        # Existence + executability check. On Windows, accept ending in .exe.
        if env_path.exists() and env_path.is_file():
            if sys.platform == "win32":
                # Windows: any existing .exe is acceptable; PATH lookup does not require os.access X bit
                _logger.info(f"FFmpeg resolved via FFMPEG_BINARY env: {env_binary}")
                return env_path.parent
            else:
                # POSIX: require executable bit
                if os.access(str(env_path), os.X_OK):
                    _logger.info(f"FFmpeg resolved via FFMPEG_BINARY env: {env_binary}")
                    return env_path.parent
                else:
                    _logger.warning(f"FFMPEG_BINARY={env_binary} exists but is not executable — falling through")
        else:
            _logger.warning(f"FFMPEG_BINARY={env_binary} does not exist or is not a file — falling through")

    # 2. Bundled binary (desktop mode — electron-builder extraResources)
    desktop_mode = os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes")
    candidates: list[Path] = []
    if desktop_mode:
        resources_path = os.getenv("RESOURCES_PATH")
        if resources_path:
            candidates.append(Path(resources_path) / "ffmpeg" / "bin")
        # Legacy AppData path (Windows backwards compat)
        appdata = os.getenv("APPDATA")
        if appdata and sys.platform == "win32":
            candidates.append(Path(appdata) / "EditFactory" / "bundled" / "ffmpeg" / "bin")

    # Dev fallback: per-platform repo candidate (ALWAYS probed regardless of DESKTOP_MODE)
    repo_root = Path(__file__).parent.parent
    if sys.platform == "win32":
        candidates.append(repo_root / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin")
    elif sys.platform == "darwin":
        candidates.append(repo_root / "ffmpeg" / "ffmpeg-mac" / "bin")
    elif sys.platform.startswith("linux"):
        candidates.append(repo_root / "ffmpeg" / "ffmpeg-linux" / "bin")

    for candidate in candidates:
        if candidate.exists() and candidate.is_dir():
            _logger.info(f"FFmpeg resolved via bundled binary: {candidate}")
            return candidate

    # 3. System PATH (lowest priority — Homebrew on Mac, apt on Linux, manual install on Win)
    which_result = shutil.which("ffmpeg")
    if which_result:
        _logger.info(f"FFmpeg resolved via system PATH: {which_result}")
        return Path(which_result).parent

    _logger.warning("FFmpeg not found in FFMPEG_BINARY env, bundled candidates, or system PATH")
    return None


def _wsl_symlink_exe(bin_dir: Path):
    """On WSL/Linux, create symlinks from 'ffmpeg' -> 'ffmpeg.exe' etc. if only .exe exist."""
    if sys.platform == "win32":
        return
    for exe in ("ffmpeg", "ffprobe", "ffplay"):
        exe_path = bin_dir / f"{exe}.exe"
        link_path = bin_dir / exe
        if exe_path.exists() and not link_path.exists():
            try:
                link_path.symlink_to(exe_path)
            except OSError:
                pass


def _setup_ffmpeg_path():
    """Side-effecting wrapper: resolves FFmpeg, mutates os.environ['PATH'], runs WSL symlink shim.

    This is the function called at module import in app/main.py. Tests should target
    _resolve_ffmpeg_path directly — _setup_ffmpeg_path is just a thin wrapper that
    mutates global state.
    """
    bin_dir = _resolve_ffmpeg_path()
    if bin_dir is not None:
        os.environ['PATH'] = str(bin_dir) + os.pathsep + os.environ.get('PATH', '')
        # WSL symlink shim: only relevant when bundled Windows .exe binaries are seen from Linux
        _wsl_symlink_exe(bin_dir)
