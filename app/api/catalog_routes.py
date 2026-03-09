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
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters

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
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    eq_filters = {"is_active": True}
    or_filter = None

    if brand:
        eq_filters["brand"] = brand
    if category:
        eq_filters["category"] = category
    if on_sale:
        eq_filters["is_on_sale"] = True
    if search:
        # Escape PostgREST special characters in user input
        safe_search = search.replace("%", "\\%").replace("_", "\\_").replace("*", "\\*")
        or_filter = f"title.ilike.%{safe_search}%,sku.ilike.%{safe_search}%"

    # Pagination
    offset = (page - 1) * page_size

    try:
        result = repo.table_query(TABLE, "select",
            filters=QueryFilters(
                count="exact",
                eq=eq_filters,
                or_=or_filter,
                order_by="title",
                range_start=offset,
                range_end=offset + page_size - 1,
            ))
    except Exception as e:
        logger.error(f"Catalog query failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to query catalog")

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
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    brands: list[str] = []
    categories: list[str] = []

    try:
        brand_result = repo.table_query(TABLE, "select",
            filters=QueryFilters(
                select="brand",
                eq={"is_active": True},
                neq={"brand": ""},
                not_is={"brand": "null"},
                order_by="brand",
            ))

        if brand_result.data:
            brands = sorted(set(row["brand"] for row in brand_result.data if row.get("brand")))
    except Exception as exc:
        logger.warning("Failed to fetch catalog brands: %s", exc)

    try:
        cat_result = repo.table_query(TABLE, "select",
            filters=QueryFilters(
                select="category",
                eq={"is_active": True},
                neq={"category": ""},
                not_is={"category": "null"},
                order_by="category",
            ))

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
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    # Attempt to call the DB function for grouped variant images
    try:
        result = repo.table_query(
            "get_catalog_product_images", "rpc",
            data={"p_product_id": product_id},
        )
        images = [row["image_url"] for row in (result.data or []) if row.get("image_url")]
        if images:
            return {"product_id": product_id, "images": images}
    except Exception as exc:
        logger.warning("get_catalog_product_images RPC failed for %s: %s", product_id, exc)

    # Fallback: return the product's own image_link from the grouped view
    try:
        product_result = repo.table_query(TABLE, "select",
            filters=QueryFilters(
                select="image_link",
                eq={"id": product_id},
                limit=1,
            ))
        row = product_result.data[0] if product_result.data else None
        if row and row.get("image_link"):
            return {"product_id": product_id, "images": [row["image_link"]]}
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
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = repo.table_query(TABLE, "select",
            filters=QueryFilters(
                eq={"id": product_id},
                maybe_single=True,
            ))
    except Exception as e:
        logger.error(f"Failed to fetch catalog product {product_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch product")

    if not result.data:
        raise HTTPException(status_code=404, detail="Product not found in catalog")

    return result.data[0]
