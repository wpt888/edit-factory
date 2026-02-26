"""
catalog_routes.py - Catalog product browsing endpoints.

Provides paginated access to products from the uf.products_catalog table
via the public.v_catalog_products VIEW.

Endpoints:
    GET /catalog/products                   Paginated list with filters
    GET /catalog/products/filters           Distinct brands + categories for dropdowns
    GET /catalog/products/{id}              Single product by ID
    GET /catalog/products/{id}/images       All variant images for a product
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from app.api.auth import ProfileContext, get_profile_context
from app.db import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/catalog", tags=["catalog"])

TABLE = "v_catalog_products_grouped"


@router.get("/products")
async def list_catalog_products(
    search: str = Query(default="", max_length=200),
    brand: str = Query(default=""),
    category: str = Query(default=""),
    on_sale: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Paginated catalog products with optional filters."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    query = supabase.table(TABLE).select("*", count="exact")

    # Only active products
    query = query.eq("is_active", True)

    if search:
        query = query.or_(f"title.ilike.%{search}%,sku.ilike.%{search}%")
    if brand:
        query = query.eq("brand", brand)
    if category:
        query = query.eq("category", category)
    if on_sale:
        query = query.eq("is_on_sale", True)

    # Pagination
    offset = (page - 1) * page_size
    query = query.order("title").range(offset, offset + page_size - 1)

    result = query.execute()

    total = result.count if result.count is not None else 0
    total_pages = max(1, (total + page_size - 1) // page_size)

    return {
        "products": result.data or [],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }


@router.get("/products/filters")
async def get_catalog_filters(
    profile: ProfileContext = Depends(get_profile_context),
):
    """Return distinct brands and categories for filter dropdowns."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    brands: list[str] = []
    categories: list[str] = []

    try:
        brand_result = supabase.table(TABLE)\
            .select("brand")\
            .eq("is_active", True)\
            .neq("brand", "")\
            .not_.is_("brand", "null")\
            .order("brand")\
            .execute()

        if brand_result.data:
            brands = sorted(set(row["brand"] for row in brand_result.data if row.get("brand")))
    except Exception as exc:
        logger.warning("Failed to fetch catalog brands: %s", exc)

    try:
        cat_result = supabase.table(TABLE)\
            .select("category")\
            .eq("is_active", True)\
            .neq("category", "")\
            .not_.is_("category", "null")\
            .order("category")\
            .execute()

        if cat_result.data:
            categories = sorted(set(row["category"] for row in cat_result.data if row.get("category")))
    except Exception as exc:
        logger.warning("Failed to fetch catalog categories: %s", exc)

    return {"brands": brands, "categories": categories}


@router.get("/products/{product_id}/images")
async def get_product_images(
    product_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Return all variant images for a catalog product.

    Uses the get_catalog_product_images() DB function which groups products
    by their shared group_key (or gomag_product_id when no group key exists)
    and returns all distinct image_url values for that group.

    Falls back to the product's own image_link if the RPC call fails.

    Returns:
        {"product_id": "...", "images": ["https://...", ...]}
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Attempt to call the DB function for grouped variant images
    try:
        result = supabase.rpc(
            "get_catalog_product_images",
            {"p_product_id": product_id},
        ).execute()
        images = [row["image_url"] for row in (result.data or []) if row.get("image_url")]
        if images:
            return {"product_id": product_id, "images": images}
    except Exception as exc:
        logger.warning("get_catalog_product_images RPC failed for %s: %s", product_id, exc)

    # Fallback: return the product's own image_link from the grouped view
    try:
        product_result = supabase.table(TABLE)\
            .select("image_link")\
            .eq("id", product_id)\
            .maybe_single()\
            .execute()
        if product_result.data and product_result.data.get("image_link"):
            return {"product_id": product_id, "images": [product_result.data["image_link"]]}
    except Exception as exc:
        logger.warning("Fallback image fetch failed for %s: %s", product_id, exc)

    # Nothing found
    raise HTTPException(status_code=404, detail="Product not found or has no images")


@router.get("/products/{product_id}")
async def get_catalog_product(
    product_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Fetch a single catalog product by ID."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table(TABLE)\
        .select("*")\
        .eq("id", product_id)\
        .maybe_single()\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Product not found in catalog")

    return result.data
