"""
feed_routes.py - API routes for product feed management and sync.

Provides CRUD endpoints for product feeds (Google Shopping XML URLs)
and a sync endpoint that streams/parses the XML, upserts products,
and downloads product images in a background task.

Endpoints:
    POST   /feeds                    Create a feed
    GET    /feeds                    List feeds for current profile
    GET    /feeds/{feed_id}          Get single feed
    DELETE /feeds/{feed_id}          Delete feed (cascades products)
    POST   /feeds/{feed_id}/sync     Trigger async XML sync

Note: Product listing endpoints (GET /feeds/{feed_id}/products and
GET /feeds/{feed_id}/products/filters) are in product_routes.py.
"""
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.config import get_settings
from app.db import get_supabase
from app.services.feed_parser import parse_feed_xml, upsert_products

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feeds", tags=["Feeds"])

# User-Agent header for XML feed downloads
_FEED_USER_AGENT = "Mozilla/5.0 (compatible; EditFactory/1.0; +https://github.com/obsid/edit-factory)"


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class FeedCreate(BaseModel):
    name: str
    feed_url: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Background task: XML download + parse + upsert + image download
# ---------------------------------------------------------------------------

def _sync_feed_task(feed_id: str, feed_url: str) -> None:
    """Background task: download feed XML, parse products, upsert, download images."""
    supabase = get_supabase()
    settings = get_settings()

    try:
        logger.info("[Feed %s] Starting sync from %s", feed_id, feed_url)

        # 1. Download XML
        with httpx.Client(
            follow_redirects=True,
            timeout=httpx.Timeout(60.0, connect=10.0),
            headers={"User-Agent": _FEED_USER_AGENT},
        ) as client:
            response = client.get(feed_url)
            response.raise_for_status()
            xml_bytes = response.content

        logger.info("[Feed %s] Downloaded %d bytes", feed_id, len(xml_bytes))

        # 2. Parse XML
        products = parse_feed_xml(xml_bytes)
        logger.info("[Feed %s] Parsed %d products", feed_id, len(products))

        # 3. Upsert products
        upsert_products(supabase, products, feed_id)

        # 4. Download product images in parallel
        try:
            from app.services.image_fetcher import (
                download_product_images,
                update_local_image_paths,
            )

            cache_dir = Path(settings.output_dir) / "product_images"
            image_map = asyncio.run(
                download_product_images(products, cache_dir, feed_id)
            )
            update_local_image_paths(supabase, image_map, feed_id)
            logger.info("[Feed %s] Downloaded %d images", feed_id, len(image_map))

        except Exception as img_exc:
            # Image download failure is non-fatal — products are still persisted
            logger.warning("[Feed %s] Image download failed (non-fatal): %s", feed_id, img_exc)

        # 5. Update feed status to idle with product count
        supabase.table("product_feeds").update({
            "sync_status": "idle",
            "product_count": len(products),
            "last_synced_at": _utcnow_iso(),
            "sync_error": None,
        }).eq("id", feed_id).execute()

        logger.info("[Feed %s] Sync complete — %d products", feed_id, len(products))

    except Exception as exc:
        logger.error("[Feed %s] Sync failed: %s", feed_id, exc)
        try:
            supabase.table("product_feeds").update({
                "sync_status": "error",
                "sync_error": str(exc),
            }).eq("id", feed_id).execute()
        except Exception as update_exc:
            logger.error("[Feed %s] Failed to set error status: %s", feed_id, update_exc)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("")
async def create_feed(
    body: FeedCreate,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Create a new product feed for the current profile."""
    supabase = get_supabase()

    result = supabase.table("product_feeds").insert({
        "profile_id": profile.profile_id,
        "name": body.name,
        "feed_url": body.feed_url,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create feed")

    return result.data[0]


@router.get("")
async def list_feeds(
    profile: ProfileContext = Depends(get_profile_context),
):
    """List all product feeds for the current profile."""
    supabase = get_supabase()

    result = supabase.table("product_feeds")\
        .select("*")\
        .eq("profile_id", profile.profile_id)\
        .order("created_at", desc=True)\
        .execute()

    return result.data or []


@router.get("/{feed_id}")
async def get_feed(
    feed_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Get a single feed with its product_count."""
    supabase = get_supabase()

    result = supabase.table("product_feeds")\
        .select("*")\
        .eq("id", feed_id)\
        .eq("profile_id", profile.profile_id)\
        .single()\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    return result.data


@router.delete("/{feed_id}")
async def delete_feed(
    feed_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Delete a feed and all its products (CASCADE)."""
    supabase = get_supabase()

    # Verify ownership before deleting
    existing = supabase.table("product_feeds")\
        .select("id")\
        .eq("id", feed_id)\
        .eq("profile_id", profile.profile_id)\
        .single()\
        .execute()

    if not existing.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    supabase.table("product_feeds").delete().eq("id", feed_id).execute()

    return {"deleted": True, "feed_id": feed_id}


@router.post("/{feed_id}/sync")
async def sync_feed(
    feed_id: str,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Trigger an async feed sync. Returns immediately; parse runs in background."""
    supabase = get_supabase()

    # Verify feed exists and belongs to this profile
    result = supabase.table("product_feeds")\
        .select("id, feed_url, sync_status")\
        .eq("id", feed_id)\
        .eq("profile_id", profile.profile_id)\
        .single()\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    feed = result.data

    # Prevent concurrent syncs on the same feed
    if feed.get("sync_status") == "syncing":
        raise HTTPException(status_code=409, detail="Feed sync already in progress")

    # Set status to syncing immediately
    supabase.table("product_feeds").update({
        "sync_status": "syncing",
        "sync_error": None,
    }).eq("id", feed_id).execute()

    # Enqueue background task
    background_tasks.add_task(_sync_feed_task, feed_id, feed["feed_url"])

    return {
        "feed_id": feed_id,
        "status": "syncing",
        "message": "Feed sync started",
    }


