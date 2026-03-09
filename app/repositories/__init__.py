"""Data repository abstraction layer.

Provides the DataRepository ABC and shared types for implementing
database backends (Supabase, SQLite).
"""

from app.repositories.base import DataRepository
from app.repositories.models import QueryFilters, QueryResult

__all__ = ["DataRepository", "QueryFilters", "QueryResult"]
