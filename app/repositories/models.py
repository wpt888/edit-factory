"""Shared data models for repository method signatures.

These lightweight types provide a consistent return shape across
SupabaseRepository and SQLiteRepository implementations.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class QueryResult:
    """Mirrors the Supabase `.execute()` response shape.

    Attributes:
        data: List of row dictionaries returned by the query.
        count: Optional total count when a count query is performed.
    """

    data: List[Dict[str, Any]] = field(default_factory=list)
    count: Optional[int] = None


@dataclass
class QueryFilters:
    """Common filter parameters for list/query operations.

    Attributes:
        eq: Equality filters as {column: value}.
        neq: Not-equal filters as {column: value}.
        gt: Greater-than filters as {column: value}.
        lt: Less-than filters as {column: value}.
        gte: Greater-than-or-equal filters as {column: value}.
        lte: Less-than-or-equal filters as {column: value}.
        in_: IN filters as {column: [values]}.
        is_: IS filters as {column: value} (for NULL checks).
        like: LIKE/ILIKE filters as {column: pattern}.
        contains: Array/JSON containment filters as {column: value}.
        order_by: Column to sort by.
        order_desc: Whether to sort descending.
        limit: Max rows to return.
        offset: Number of rows to skip.
        select: Columns to select (default "*").
    """

    eq: Dict[str, Any] = field(default_factory=dict)
    neq: Dict[str, Any] = field(default_factory=dict)
    gt: Dict[str, Any] = field(default_factory=dict)
    lt: Dict[str, Any] = field(default_factory=dict)
    gte: Dict[str, Any] = field(default_factory=dict)
    lte: Dict[str, Any] = field(default_factory=dict)
    in_: Dict[str, List[Any]] = field(default_factory=dict)
    is_: Dict[str, Any] = field(default_factory=dict)
    like: Dict[str, str] = field(default_factory=dict)
    contains: Dict[str, Any] = field(default_factory=dict)
    order_by: Optional[str] = None
    order_desc: bool = False
    limit: Optional[int] = None
    offset: Optional[int] = None
    select: str = "*"
