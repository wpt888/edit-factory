"""
MediaManager - Project-scoped local media directory management.

Provides structured path resolution for all media files (uploads, renders,
thumbnails, TTS audio) under a per-project directory tree:

    {media_root}/{project_id}/
        uploads/
        renders/
        thumbnails/
        tts/
        temp/
"""
import logging
import re
import shutil
import threading
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)


def _sanitize_filename(name: str) -> str:
    """Strip path separators, limit length, replace spaces with underscores."""
    # Remove directory separators and null bytes
    name = re.sub(r'[/\\:\x00]', '', name)
    # Replace spaces with underscores
    name = name.replace(' ', '_')
    # Remove any other potentially problematic characters
    name = re.sub(r'[<>"|?*]', '', name)
    # Limit length to 100 chars (preserve extension)
    if len(name) > 100:
        stem = Path(name).stem[:90]
        suffix = Path(name).suffix[:10]
        name = stem + suffix
    return name


class MediaManager:
    """Project-scoped media directory manager.

    All path methods create parent directories automatically so callers
    never need to worry about missing directories.
    """

    def __init__(self, media_root: Path):
        self._root = media_root
        self._root.mkdir(parents=True, exist_ok=True)

    def project_dir(self, project_id: str) -> Path:
        """Return {media_root}/{project_id}/, creating it if needed."""
        d = self._root / project_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def upload_path(self, project_id: str, job_id: str, filename: str) -> Path:
        """Return {project_dir}/uploads/{job_id}_{sanitized_filename}."""
        safe_name = _sanitize_filename(filename)
        p = self.project_dir(project_id) / "uploads" / f"{job_id}_{safe_name}"
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def render_path(self, project_id: str, clip_id: str, preset_name: str) -> Path:
        """Return {project_dir}/renders/final_{clip_id}_{preset_name}.mp4."""
        p = self.project_dir(project_id) / "renders" / f"final_{clip_id}_{preset_name}.mp4"
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def thumbnail_path(self, project_id: str, video_stem: str) -> Path:
        """Return {project_dir}/thumbnails/thumb_{video_stem}.jpg."""
        p = self.project_dir(project_id) / "thumbnails" / f"thumb_{video_stem}.jpg"
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def tts_path(self, project_id: str, clip_id: str) -> Path:
        """Return {project_dir}/tts/clip_{clip_id}.mp3."""
        p = self.project_dir(project_id) / "tts" / f"clip_{clip_id}.mp3"
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    def temp_path(self, project_id: str) -> Path:
        """Return {project_dir}/temp/ for intermediate FFmpeg files."""
        p = self.project_dir(project_id) / "temp"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def delete_project_media(self, project_id: str) -> int:
        """Delete entire {project_dir}/ recursively.

        Returns count of files deleted. Uses shutil.rmtree with onerror
        handler to log but not crash on permission errors.
        """
        project_path = self._root / project_id
        if not project_path.exists():
            return 0

        count = sum(1 for _ in project_path.rglob("*") if _.is_file())

        def _on_error(func, path, exc_info):
            logger.warning(f"Could not remove {path}: {exc_info[1]}")

        shutil.rmtree(str(project_path), onerror=_on_error)
        logger.info(f"Deleted project media for {project_id}: {count} files removed")
        return count

    def list_project_files(self, project_id: str) -> List[Path]:
        """List all files under project_dir (for debugging/audit)."""
        project_path = self._root / project_id
        if not project_path.exists():
            return []
        return sorted(p for p in project_path.rglob("*") if p.is_file())


# ---------------------------------------------------------------------------
# Singleton factory
# ---------------------------------------------------------------------------

_instance: Optional[MediaManager] = None
_lock = threading.Lock()


def get_media_manager() -> MediaManager:
    """Singleton factory using settings.media_dir."""
    global _instance
    if _instance is None:
        with _lock:
            if _instance is None:
                from app.config import get_settings
                settings = get_settings()
                _instance = MediaManager(settings.media_dir)
    return _instance
