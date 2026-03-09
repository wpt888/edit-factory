"""Data repository abstraction layer.

Provides the DataRepository ABC, shared types, and a factory function
for obtaining the configured repository backend.
"""

from app.repositories.base import DataRepository
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters, QueryResult
from app.repositories.supabase_repo import SupabaseRepository

__all__ = [
    "DataRepository",
    "QueryFilters",
    "QueryResult",
    "SupabaseRepository",
    "get_repository",
]
