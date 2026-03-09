"""Repository factory — returns the configured DataRepository implementation.

Uses a thread-safe singleton pattern (like get_supabase() in db.py).
The backend is selected via `get_settings().data_backend`.
"""

import threading
from typing import Optional

from app.repositories.base import DataRepository

_repository: Optional[DataRepository] = None
_repo_lock = threading.Lock()


def get_repository() -> DataRepository:
    """Return the singleton DataRepository instance.

    Creates the repository on first call based on the ``data_backend``
    config setting.  Thread-safe via double-checked locking.

    Raises:
        NotImplementedError: If data_backend is "sqlite" (not yet built).
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
                    raise NotImplementedError(
                        "SQLite backend not yet implemented — see Phase 65"
                    )
                else:
                    raise ValueError(
                        f"Unknown data_backend: {settings.data_backend}"
                    )
    return _repository


def close_repository() -> None:
    """Reset the singleton so a new instance is created on next call."""
    global _repository
    with _repo_lock:
        _repository = None
