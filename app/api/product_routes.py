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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feeds", tags=["Products"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_supabase():
    """Lazy-init Supabase client (same pattern as library_routes and feed_routes)."""
    from supabase import create_client
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_key)


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
    supabase = _get_supabase()

    # Verify feed ownership
    feed_check = supabase.table("product_feeds")\
        .select("id")\
        .eq("id", feed_id)\
        .eq("profile_id", profile.profile_id)\
        .single()\
        .execute()

    if not feed_check.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    # Fetch all brand values for this feed
    brands_result = supabase.table("products")\
        .select("brand")\
        .eq("feed_id", feed_id)\
        .execute()

    # Fetch all product_type values for this feed
    types_result = supabase.table("products")\
        .select("product_type")\
        .eq("feed_id", feed_id)\
        .execute()

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
    supabase = _get_supabase()

    # Verify feed ownership and get stored product_count for unfiltered totals
    feed_check = supabase.table("product_feeds")\
        .select("id, product_count")\
        .eq("id", feed_id)\
        .eq("profile_id", profile.profile_id)\
        .single()\
        .execute()

    if not feed_check.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    # Clamp page_size and page
    page_size = max(1, min(page_size, 200))
    page = max(1, page)
    offset = (page - 1) * page_size

    # Determine if any filter is active
    any_filter = bool(search or on_sale is True or category or brand)

    # Build base query
    query = supabase.table("products")\
        .select("*")\
        .eq("feed_id", feed_id)

    # Apply filters conditionally
    if search:
        query = query.ilike("title", f"%{search}%")
    if on_sale is True:
        query = query.eq("is_on_sale", True)
    if category:
        query = query.eq("product_type", category)
    if brand:
        query = query.eq("brand", brand)

    # Fetch page of results
    result = query\
        .order("created_at", desc=False)\
        .range(offset, offset + page_size - 1)\
        .execute()

    products = result.data or []

    # Accurate total count:
    # - No filters: use stored product_count (cheap, no extra query)
    # - Filters active: run a separate count query with same filters applied
    if any_filter:
        count_query = supabase.table("products")\
            .select("id", count="exact")\
            .eq("feed_id", feed_id)
        if search:
            count_query = count_query.ilike("title", f"%{search}%")
        if on_sale is True:
            count_query = count_query.eq("is_on_sale", True)
        if category:
            count_query = count_query.eq("product_type", category)
        if brand:
            count_query = count_query.eq("brand", brand)
        count_result = count_query.execute()
        total = count_result.count or 0
    else:
        total = feed_check.data.get("product_count", 0) or 0

    return {
        "products": products,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": max(1, -(-total // page_size)),  # ceiling division
        },
    }
