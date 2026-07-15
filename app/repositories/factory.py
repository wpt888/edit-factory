"""Repository factory — returns the configured DataRepository implementation.

Uses a thread-safe singleton pattern (like get_supabase() in db.py).
The backend is selected via `get_settings().data_backend`.
"""

import logging
import threading
from typing import Optional

from app.repositories.base import DataRepository

logger = logging.getLogger(__name__)

_repository: Optional[DataRepository] = None
_repo_lock = threading.Lock()


def get_repository() -> DataRepository:
    """Return the singleton DataRepository instance.

    Creates the repository on first call based on the ``data_backend``
    config setting.  Thread-safe via double-checked locking.

    Raises:
        ValueError: If data_backend is an unknown value.
    """
    global _repository
    if _repository is None:
        with _repo_lock:
            if _repository is None:
                from app.config import get_settings

                settings = get_settings()
                if settings.data_backend == "supabase":
                    from app.repositories.supabase_repo import SupabaseRepository

                    _repository = SupabaseRepository()
                elif settings.data_backend == "sqlite":
                    from app.repositories.sqlite_repo import SQLiteRepository

                    _repository = SQLiteRepository()
                else:
                    raise ValueError(
                        f"Unknown data_backend: {settings.data_backend}"
                    )
    return _repository


def close_repository() -> None:
    """Reset the singleton so a new instance is created on next call.

    Closes the current repository's SQLite connection first so its file locks
    are released deterministically instead of being left to garbage collection.
    Otherwise an orphaned connection keeps a ``data.db`` write lock until GC
    finalizes it — and when GC is delayed (e.g. under coverage across the full
    test suite) the next connection's schema init fails with
    ``sqlite3.OperationalError: database is locked``.

    Reaches into the SQLite backend's ``_conn`` directly (guarded) because the
    repository interface exposes no close hook; SupabaseRepository has no
    connection and is skipped by the ``getattr`` guard.
    """
    global _repository
    with _repo_lock:
        if _repository is not None:
            conn = getattr(_repository, "_conn", None)
            if conn is not None:
                try:
                    conn.close()
                except Exception:  # pragma: no cover - defensive
                    logger.warning("Error closing repository connection during reset")
        _repository = None
