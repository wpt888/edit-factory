"""
association_routes.py - Segment-product association CRUD endpoints.

Manages which catalog product is linked to each video segment, including
the selection of specific product images for overlay use.

Endpoints:
    POST   /associations                              Associate a product with a segment (upsert)
    GET    /associations/segment/{segment_id}         Get association for a single segment
    GET    /associations/segments                     Batch get associations for multiple segments
    PATCH  /associations/{association_id}             Update selected image URLs on an association
    PATCH  /associations/{association_id}/pip-config  Update PiP overlay configuration on an association
    DELETE /associations/segment/{segment_id}         Remove product association from a segment
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.db import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/associations", tags=["associations"])

ASSOC_TABLE = "segment_product_associations"
CATALOG_TABLE = "v_catalog_products_grouped"
SEGMENTS_TABLE = "editai_segments"


# ============== PYDANTIC MODELS ==============

class AssociationCreate(BaseModel):
    segment_id: str
    catalog_product_id: str
    selected_image_urls: list[str] = []


class AssociationUpdate(BaseModel):
    selected_image_urls: list[str]


class PipConfigUpdate(BaseModel):
    enabled: bool = False
    position: str = "bottom-right"  # top-left, top-right, bottom-left, bottom-right
    size: str = "medium"            # small, medium, large
    animation: str = "static"       # static, fade, kenburns


class AssociationResponse(BaseModel):
    id: str
    segment_id: str
    catalog_product_id: str
    selected_image_urls: list[str]
    pip_config: Optional[dict] = None
    slide_config: Optional[dict] = None
    created_at: str
    updated_at: str
    # Joined product info
    product_title: Optional[str] = None
    product_image: Optional[str] = None
    product_brand: Optional[str] = None


# ============== HELPER FUNCTIONS ==============

def _enrich_association(assoc_row: dict, product_row: Optional[dict]) -> dict:
    """Merge product info into association dict for response."""
    enriched = dict(assoc_row)
    if product_row:
        enriched["product_title"] = product_row.get("title")
        enriched["product_image"] = product_row.get("image_link")
        enriched["product_brand"] = product_row.get("brand")
    else:
        enriched["product_title"] = None
        enriched["product_image"] = None
        enriched["product_brand"] = None
    return enriched


def _fetch_product(supabase, product_id: str) -> Optional[dict]:
    """Fetch product details from catalog view. Returns None on error."""
    try:
        result = supabase.table(CATALOG_TABLE)\
            .select("id, title, image_link, brand")\
            .eq("id", product_id)\
            .limit(1)\
            .execute()
        return result.data[0] if result.data else None
    except Exception as exc:
        logger.warning("Failed to fetch product %s from catalog: %s", product_id, exc)
        return None


# ============== ENDPOINTS ==============

@router.post("")
async def create_association(
    body: AssociationCreate,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Associate a catalog product with a segment (ASSOC-01).

    Upserts on segment_id — calling POST again with a different product_id
    replaces the previous association for that segment.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Validate segment belongs to the current profile
    try:
        seg_result = supabase.table(SEGMENTS_TABLE)\
            .select("id, profile_id")\
            .eq("id", body.segment_id)\
            .limit(1)\
            .execute()
    except Exception as exc:
        logger.error("DB error validating segment %s: %s", body.segment_id, exc)
        raise HTTPException(status_code=500, detail="Database error validating segment")

    if not seg_result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    seg = seg_result.data[0]
    if seg.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Segment does not belong to your profile")

    # Validate product exists in catalog
    product = _fetch_product(supabase, body.catalog_product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found in catalog")

    # Upsert association (ON CONFLICT on segment_id → replace)
    try:
        assoc_data = {
            "segment_id": body.segment_id,
            "catalog_product_id": body.catalog_product_id,
            "selected_image_urls": body.selected_image_urls,
        }
        upsert_result = supabase.table(ASSOC_TABLE)\
            .upsert(assoc_data, on_conflict="segment_id")\
            .execute()
    except Exception as exc:
        logger.error("DB error upserting association for segment %s: %s", body.segment_id, exc)
        raise HTTPException(status_code=500, detail="Database error creating association")

    if not upsert_result.data:
        raise HTTPException(status_code=500, detail="Association creation returned no data")

    enriched = _enrich_association(upsert_result.data[0], product)
    return enriched


@router.get("/segments")
async def get_associations_batch(
    segment_ids: str = Query(..., description="Comma-separated segment UUIDs"),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Batch-fetch associations for multiple segments (ASSOC-03 batch).

    Returns a mapping of segment_id → AssociationResponse (or null if no association).
    Prevents N+1 queries when loading the segments page.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    ids = [s.strip() for s in segment_ids.split(",") if s.strip()]
    if not ids:
        return {"associations": {}}

    # Fetch all associations in one query
    try:
        assoc_result = supabase.table(ASSOC_TABLE)\
            .select("*")\
            .in_("segment_id", ids)\
            .execute()
    except Exception as exc:
        logger.error("DB error fetching batch associations: %s", exc)
        raise HTTPException(status_code=500, detail="Database error fetching associations")

    associations = assoc_result.data or []

    # Collect unique product IDs to fetch in bulk
    product_ids = list({a["catalog_product_id"] for a in associations if a.get("catalog_product_id")})
    products_by_id: dict[str, dict] = {}
    if product_ids:
        try:
            prod_result = supabase.table(CATALOG_TABLE)\
                .select("id, title, image_link, brand")\
                .in_("id", product_ids)\
                .execute()
            for p in (prod_result.data or []):
                products_by_id[p["id"]] = p
        except Exception as exc:
            logger.warning("Failed to fetch products for batch associations: %s", exc)

    # Build response map
    result_map: dict[str, Optional[dict]] = {sid: None for sid in ids}
    for assoc in associations:
        sid = assoc["segment_id"]
        product = products_by_id.get(assoc.get("catalog_product_id", ""))
        result_map[sid] = _enrich_association(assoc, product)

    return {"associations": result_map}


@router.get("/segment/{segment_id}")
async def get_association_for_segment(
    segment_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Get the product association for a single segment (ASSOC-03)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Validate segment belongs to current profile
    try:
        seg_result = supabase.table(SEGMENTS_TABLE)\
            .select("id, profile_id")\
            .eq("id", segment_id)\
            .limit(1)\
            .execute()
    except Exception as exc:
        logger.error("DB error validating segment %s: %s", segment_id, exc)
        raise HTTPException(status_code=500, detail="Database error validating segment")

    if not seg_result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    seg = seg_result.data[0]
    if seg.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Segment does not belong to your profile")

    # Fetch association
    try:
        assoc_result = supabase.table(ASSOC_TABLE)\
            .select("*")\
            .eq("segment_id", segment_id)\
            .limit(1)\
            .execute()
    except Exception as exc:
        logger.error("DB error fetching association for segment %s: %s", segment_id, exc)
        raise HTTPException(status_code=500, detail="Database error fetching association")

    if not assoc_result.data:
        raise HTTPException(status_code=404, detail="No product associated with this segment")

    assoc = assoc_result.data[0]
    product = _fetch_product(supabase, assoc["catalog_product_id"])
    return _enrich_association(assoc, product)


@router.patch("/{association_id}")
async def update_association_images(
    association_id: str,
    body: AssociationUpdate,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Update the selected image URLs on an existing association (ASSOC-04)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Fetch the association to verify it exists and belongs to the profile's segment
    try:
        assoc_result = supabase.table(ASSOC_TABLE)\
            .select("*, editai_segments!segment_id(profile_id)")\
            .eq("id", association_id)\
            .limit(1)\
            .execute()
    except Exception as exc:
        logger.error("DB error fetching association %s: %s", association_id, exc)
        raise HTTPException(status_code=500, detail="Database error fetching association")

    if not assoc_result.data:
        raise HTTPException(status_code=404, detail="Association not found")

    assoc = assoc_result.data[0]

    # Profile scoping via joined segment
    joined_segment = assoc.get("editai_segments") or {}
    if isinstance(joined_segment, list):
        # supabase-py may return a list for joined tables
        joined_segment = joined_segment[0] if joined_segment else {}
    if joined_segment.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Association does not belong to your profile")

    # Update selected_image_urls
    try:
        update_result = supabase.table(ASSOC_TABLE)\
            .update({"selected_image_urls": body.selected_image_urls})\
            .eq("id", association_id)\
            .execute()
    except Exception as exc:
        logger.error("DB error updating association %s: %s", association_id, exc)
        raise HTTPException(status_code=500, detail="Database error updating association")

    if not update_result.data:
        raise HTTPException(status_code=500, detail="Update returned no data")

    updated_assoc = update_result.data[0]
    product = _fetch_product(supabase, updated_assoc["catalog_product_id"])
    return _enrich_association(updated_assoc, product)


@router.patch("/{association_id}/pip-config")
async def update_pip_config(
    association_id: str,
    body: PipConfigUpdate,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Update the PiP overlay configuration on an existing association (OVRL-01)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Fetch the association to verify it exists and belongs to the profile's segment
    try:
        assoc_result = supabase.table(ASSOC_TABLE)\
            .select("*, editai_segments!segment_id(profile_id)")\
            .eq("id", association_id)\
            .limit(1)\
            .execute()
    except Exception as exc:
        logger.error("DB error fetching association %s: %s", association_id, exc)
        raise HTTPException(status_code=500, detail="Database error fetching association")

    if not assoc_result.data:
        raise HTTPException(status_code=404, detail="Association not found")

    assoc = assoc_result.data[0]

    # Profile scoping via joined segment
    joined_segment = assoc.get("editai_segments") or {}
    if isinstance(joined_segment, list):
        joined_segment = joined_segment[0] if joined_segment else {}
    if joined_segment.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Association does not belong to your profile")

    # Update pip_config
    try:
        update_result = supabase.table(ASSOC_TABLE)\
            .update({"pip_config": body.model_dump()})\
            .eq("id", association_id)\
            .execute()
    except Exception as exc:
        logger.error("DB error updating pip_config for association %s: %s", association_id, exc)
        raise HTTPException(status_code=500, detail="Database error updating pip config")

    if not update_result.data:
        raise HTTPException(status_code=500, detail="Update returned no data")

    updated_assoc = update_result.data[0]
    product = _fetch_product(supabase, updated_assoc["catalog_product_id"])
    return _enrich_association(updated_assoc, product)


@router.delete("/segment/{segment_id}")
async def delete_association_for_segment(
    segment_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Remove the product association from a segment (ASSOC-02)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Validate segment belongs to current profile
    try:
        seg_result = supabase.table(SEGMENTS_TABLE)\
            .select("id, profile_id")\
            .eq("id", segment_id)\
            .limit(1)\
            .execute()
    except Exception as exc:
        logger.error("DB error validating segment %s: %s", segment_id, exc)
        raise HTTPException(status_code=500, detail="Database error validating segment")

    if not seg_result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    seg = seg_result.data[0]
    if seg.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Segment does not belong to your profile")

    # Verify association exists before deleting
    try:
        check_result = supabase.table(ASSOC_TABLE)\
            .select("id")\
            .eq("segment_id", segment_id)\
            .limit(1)\
            .execute()
    except Exception as exc:
        logger.error("DB error checking association for segment %s: %s", segment_id, exc)
        raise HTTPException(status_code=500, detail="Database error checking association")

    if not check_result.data:
        raise HTTPException(status_code=404, detail="No product associated with this segment")

    # Delete the association
    try:
        supabase.table(ASSOC_TABLE)\
            .delete()\
            .eq("segment_id", segment_id)\
            .execute()
    except Exception as exc:
        logger.error("DB error deleting association for segment %s: %s", segment_id, exc)
        raise HTTPException(status_code=500, detail="Database error deleting association")

    return {"deleted": True, "segment_id": segment_id}
