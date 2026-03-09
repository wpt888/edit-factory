"""
product_routes.py - API routes for product listing and filter options.

Provides paginated, filtered product listing and a filter-options endpoint
for dropdown population. The list_products endpoint moved here from
feed_routes.py and extended with four filter params.

Endpoints:
    GET /feeds/{feed_id}/products         List products with pagination + filters
    GET /feeds/{feed_id}/products/filters Return distinct brands and categories
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import ProfileContext, get_profile_context
from app.config import get_settings
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feeds", tags=["Products"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/{feed_id}/products/filters")
async def get_product_filters(
    feed_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Return distinct brands and categories for a feed's products.

    Used to populate filter dropdowns in the product browser. NULLs are
    excluded from both lists. Returns sorted lists.
    """
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify feed ownership
    feed_check = repo.table_query("product_feeds", "select",
        filters=QueryFilters(
            select="id",
            eq={"id": feed_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    if not feed_check.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    # Fetch all brand values for this feed
    brands_result = repo.table_query("products", "select",
        filters=QueryFilters(select="brand", eq={"feed_id": feed_id}))

    # Fetch all product_type values for this feed
    types_result = repo.table_query("products", "select",
        filters=QueryFilters(select="product_type", eq={"feed_id": feed_id}))

    # Deduplicate in Python — supabase-py v2 has no native DISTINCT
    brands = sorted(set(r["brand"] for r in (brands_result.data or []) if r.get("brand")))
    categories = sorted(set(r["product_type"] for r in (types_result.data or []) if r.get("product_type")))

    return {"brands": brands, "categories": categories}


@router.get("/{feed_id}/products")
async def list_products(
    feed_id: str,
    page: int = 1,
    page_size: int = 50,
    search: Optional[str] = None,
    on_sale: Optional[bool] = None,
    category: Optional[str] = None,
    brand: Optional[str] = None,
    profile: ProfileContext = Depends(get_profile_context),
):
    """List products for a feed with pagination and optional filters.

    Query params:
        page: Page number (1-based, default 1)
        page_size: Items per page (default 50, max 200)
        search: Case-insensitive substring match on product title
        on_sale: If true, return only products with is_on_sale=True
        category: Filter by product_type (exact match)
        brand: Filter by brand (exact match)
    """
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify feed ownership and get stored product_count for unfiltered totals
    feed_check = repo.table_query("product_feeds", "select",
        filters=QueryFilters(
            select="id, product_count",
            eq={"id": feed_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    if not feed_check.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    # Clamp page_size and page
    page_size = max(1, min(page_size, 200))
    page = max(1, page)
    offset = (page - 1) * page_size

    # Determine if any filter is active
    any_filter = bool(search or on_sale is True or category or brand)

    # Build filters
    eq_filters = {"feed_id": feed_id}
    like_filters = {}
    if on_sale is True:
        eq_filters["is_on_sale"] = True
    if category:
        eq_filters["product_type"] = category
    if brand:
        eq_filters["brand"] = brand
    if search:
        like_filters["title"] = f"%{search}%"

    # Fetch page of results
    result = repo.table_query("products", "select",
        filters=QueryFilters(
            eq=eq_filters,
            like=like_filters,
            order_by="created_at",
            order_desc=False,
            range_start=offset,
            range_end=offset + page_size - 1,
        ))

    products = result.data or []

    # Accurate total count:
    # - No filters: use stored product_count (cheap, no extra query)
    # - Filters active: run a separate count query with same filters applied
    if any_filter:
        count_result = repo.table_query("products", "select",
            filters=QueryFilters(
                select="id",
                count="exact",
                eq=eq_filters,
                like=like_filters,
                limit=0,
            ))
        total = count_result.count or 0
    else:
        total = feed_check.data[0].get("product_count", 0) or 0

    return {
        "products": products,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": max(1, -(-total // page_size)),  # ceiling division
        },
    }
