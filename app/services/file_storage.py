"""
File Storage Abstraction Layer (Phase 58-02)

Provides a backend-agnostic interface for storing and retrieving output files.
The default backend is local filesystem — fully transparent, no behavior change.
Setting FILE_STORAGE_BACKEND=supabase routes final video outputs through Supabase Storage.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class FileStorage(ABC):
    """Abstract interface for file storage backends.

    Only covers *output* files (rendered videos, thumbnails, audio).
    Input/temp/intermediate FFmpeg files always remain local.
    """

    @abstractmethod
    def store(self, local_path: Path, remote_key: str) -> str:
        """Upload/move a file and return a reference (local path or remote key).

        Args:
            local_path: Path to the local file to store.
            remote_key: Logical key/path for the stored object (e.g. 'output/{profile}/{clip}_final.mp4').

        Returns:
            A string reference that can later be passed to retrieve() or get_url().
            For local backend this is the original local path string.
            For Supabase backend this is the remote_key.
        """

    @abstractmethod
    def retrieve(self, remote_key: str, local_path: Path) -> Path:
        """Download/copy a stored file to a local path.

        Args:
            remote_key: The reference returned by store().
            local_path: Where to write the file locally.

        Returns:
            Path to the local file (may be same as local_path or the original path).
        """

    @abstractmethod
    def get_url(self, remote_key: str) -> str:
        """Return a URL or path for serving the stored file.

        Args:
            remote_key: The reference returned by store().

        Returns:
            A URL string (for remote backends) or local file path string (for local backend).
        """

    @abstractmethod
    def delete(self, remote_key: str) -> bool:
        """Delete a stored file.

        Args:
            remote_key: The reference returned by store().

        Returns:
            True if deleted successfully, False otherwise.
        """

    @abstractmethod
    def exists(self, remote_key: str) -> bool:
        """Check whether a stored file exists.

        Args:
            remote_key: The reference returned by store().

        Returns:
            True if the file exists, False otherwise.
        """


class LocalFileStorage(FileStorage):
    """No-op local filesystem storage backend (default).

    All operations work directly on local paths. store() returns the original
    local path unchanged so all existing behavior is fully preserved.
    """

    def store(self, local_path: Path, remote_key: str) -> str:
        """Return the original local path unchanged — no copy or move."""
        return str(local_path)

    def retrieve(self, remote_key: str, local_path: Path) -> Path:
        """For local backend, remote_key is the actual file path."""
        return Path(remote_key)

    def get_url(self, remote_key: str) -> str:
        """Return the path as-is (served by FastAPI FileResponse)."""
        return remote_key

    def delete(self, remote_key: str) -> bool:
        """Delete the file at the given path."""
        try:
            p = Path(remote_key)
            if p.exists():
                p.unlink()
                return True
            return False
        except Exception as e:
            logger.warning(f"LocalFileStorage.delete failed for {remote_key}: {e}")
            return False

    def exists(self, remote_key: str) -> bool:
        """Check whether the file exists at the given path."""
        return Path(remote_key).exists()


class SupabaseFileStorage(FileStorage):
    """Supabase Storage backend.

    Uploads output files to the 'editai-output' bucket in Supabase Storage.
    If Supabase is unavailable or upload fails, falls back to LocalFileStorage
    gracefully — the local file remains accessible.

    OOM protection: Files larger than 500 MB are not read into memory and fall
    back to local storage with a warning logged.
    """

    BUCKET_NAME = "editai-output"
    MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB

    def __init__(self):
        self._supabase = None
        self._fallback = LocalFileStorage()
        self._init_client()

    def _init_client(self):
        """Lazily initialize Supabase client and create bucket if missing."""
        try:
            from app.db import get_supabase
            client = get_supabase()
            if client is None:
                logger.warning("SupabaseFileStorage: Supabase client unavailable — falling back to local storage")
                return
            # Ensure bucket exists (create if missing)
            try:
                client.storage.create_bucket(self.BUCKET_NAME, options={"public": False})
                logger.info(f"SupabaseFileStorage: Created bucket '{self.BUCKET_NAME}'")
            except Exception:
                # Bucket already exists — that's fine
                pass
            self._supabase = client
            logger.info("SupabaseFileStorage: initialized successfully")
        except Exception as e:
            logger.warning(f"SupabaseFileStorage: init failed, using local fallback: {e}")

    def store(self, local_path: Path, remote_key: str) -> str:
        """Upload file to Supabase Storage with OOM guard (max 500 MB).

        If the file exceeds the size limit or upload fails, falls back to
        local storage with a warning. The original local file is never deleted.
        """
        if not self._supabase:
            return self._fallback.store(local_path, remote_key)
        try:
            file_size = local_path.stat().st_size
            if file_size > self.MAX_UPLOAD_BYTES:
                logger.warning(
                    f"File too large for Supabase upload ({file_size} bytes > {self.MAX_UPLOAD_BYTES} bytes limit), "
                    f"using local storage: {local_path}"
                )
                return self._fallback.store(local_path, remote_key)

            with open(local_path, "rb") as f:
                self._supabase.storage.from_(self.BUCKET_NAME).upload(remote_key, f.read())
            logger.info(f"Uploaded {local_path} to Supabase Storage: {remote_key}")
            return remote_key
        except Exception as e:
            logger.warning(f"Supabase Storage upload failed, using local fallback: {e}")
            return self._fallback.store(local_path, remote_key)

    def retrieve(self, remote_key: str, local_path: Path) -> Path:
        """Download from Supabase Storage to local_path.

        Falls back to interpreting remote_key as a local path if download fails.
        """
        if not self._supabase:
            return self._fallback.retrieve(remote_key, local_path)
        # If the key looks like an absolute local path, it was stored by the fallback
        if remote_key.startswith("/") or (len(remote_key) > 1 and remote_key[1] == ":"):
            return Path(remote_key)
        try:
            data = self._supabase.storage.from_(self.BUCKET_NAME).download(remote_key)
            local_path.parent.mkdir(parents=True, exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(data)
            return local_path
        except Exception as e:
            logger.warning(f"Supabase Storage download failed for {remote_key}: {e}")
            # Fallback: maybe it's stored locally
            return Path(remote_key)

    def get_url(self, remote_key: str) -> str:
        """Return a signed URL for the stored object."""
        if not self._supabase:
            return remote_key
        # Local fallback path stored as key
        if remote_key.startswith("/") or (len(remote_key) > 1 and remote_key[1] == ":"):
            return remote_key
        try:
            result = self._supabase.storage.from_(self.BUCKET_NAME).create_signed_url(remote_key, 3600)
            return result.get("signedURL", remote_key)
        except Exception as e:
            logger.warning(f"Supabase Storage get_url failed for {remote_key}: {e}")
            return remote_key

    def delete(self, remote_key: str) -> bool:
        """Delete from Supabase Storage."""
        if not self._supabase:
            return self._fallback.delete(remote_key)
        if remote_key.startswith("/") or (len(remote_key) > 1 and remote_key[1] == ":"):
            return self._fallback.delete(remote_key)
        try:
            self._supabase.storage.from_(self.BUCKET_NAME).remove([remote_key])
            return True
        except Exception as e:
            logger.warning(f"Supabase Storage delete failed for {remote_key}: {e}")
            return False

    def exists(self, remote_key: str) -> bool:
        """Check if object exists in Supabase Storage."""
        if not self._supabase:
            return self._fallback.exists(remote_key)
        if remote_key.startswith("/") or (len(remote_key) > 1 and remote_key[1] == ":"):
            return self._fallback.exists(remote_key)
        try:
            # List objects with matching prefix and check for the key
            result = self._supabase.storage.from_(self.BUCKET_NAME).list(path=str(Path(remote_key).parent))
            files = result or []
            target_name = Path(remote_key).name
            return any(f.get("name") == target_name for f in files)
        except Exception as e:
            logger.warning(f"Supabase Storage exists check failed for {remote_key}: {e}")
            return False


_file_storage_instance: Optional[FileStorage] = None
_file_storage_lock = threading.Lock()


def get_file_storage() -> FileStorage:
    """Singleton factory — returns backend based on FILE_STORAGE_BACKEND setting.

    Returns:
        LocalFileStorage if backend is 'local' (default).
        SupabaseFileStorage if backend is 'supabase'.
        Falls back to LocalFileStorage for unknown values.
    """
    global _file_storage_instance
    if _file_storage_instance is None:
        with _file_storage_lock:
            if _file_storage_instance is None:
                from app.config import get_settings
                settings = get_settings()
                backend = settings.file_storage_backend.lower()

                if backend == "supabase":
                    logger.info("FileStorage: using Supabase Storage backend")
                    _file_storage_instance = SupabaseFileStorage()
                else:
                    if backend != "local":
                        logger.warning(f"FileStorage: unknown backend '{backend}', falling back to local")
                    logger.info("FileStorage: using local filesystem backend")
                    _file_storage_instance = LocalFileStorage()
    return _file_storage_instance


def reset_file_storage() -> None:
    """Reset the singleton (useful for testing/reloading)."""
    global _file_storage_instance
    _file_storage_instance = None
