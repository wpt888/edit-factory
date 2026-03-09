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
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters
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

async def _sync_feed_task(feed_id: str, feed_url: str, profile_id: str) -> None:
    """Background task: download feed XML, parse products, upsert, download images."""
    repo = get_repository()
    if not repo:
        logger.error("[Feed %s] Repository not available", feed_id)
        return
    settings = get_settings()

    try:
        logger.info("[Feed %s] Starting sync from %s", feed_id, feed_url)

        # 1. Download XML
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(60.0, connect=10.0),
            headers={"User-Agent": _FEED_USER_AGENT},
        ) as client:
            response = await client.get(feed_url)
            response.raise_for_status()
            xml_bytes = response.content

        logger.info("[Feed %s] Downloaded %d bytes", feed_id, len(xml_bytes))

        # 2. Parse XML
        products = parse_feed_xml(xml_bytes)
        logger.info("[Feed %s] Parsed %d products", feed_id, len(products))

        # 3. Upsert products via repository
        _upsert_products_via_repo(repo, products, feed_id)

        # 4. Download product images in parallel
        try:
            from app.services.image_fetcher import (
                download_product_images,
            )

            cache_dir = Path(settings.output_dir) / "product_images"
            image_map = await download_product_images(products, cache_dir, feed_id)
            _update_local_image_paths_via_repo(repo, image_map, feed_id)
            logger.info("[Feed %s] Downloaded %d images", feed_id, len(image_map))

        except Exception as img_exc:
            # Image download failure is non-fatal — products are still persisted
            logger.warning("[Feed %s] Image download failed (non-fatal): %s", feed_id, img_exc)

        # 5. Update feed status to idle with product count
        repo.table_query("product_feeds", "update", data={
            "sync_status": "idle",
            "product_count": len(products),
            "last_synced_at": _utcnow_iso(),
            "sync_error": None,
        }, filters=QueryFilters(eq={"id": feed_id, "profile_id": profile_id}))

        logger.info("[Feed %s] Sync complete — %d products", feed_id, len(products))

    except Exception as exc:
        logger.error("[Feed %s] Sync failed: %s", feed_id, exc)
        try:
            repo.table_query("product_feeds", "update", data={
                "sync_status": "error",
                "sync_error": "Feed sync failed",
            }, filters=QueryFilters(eq={"id": feed_id, "profile_id": profile_id}))
        except Exception as update_exc:
            logger.error("[Feed %s] Failed to set error status: %s", feed_id, update_exc)


def _upsert_products_via_repo(repo, products: list[dict], feed_id: str) -> None:
    """Upsert products into DB in batches of 500 via repository."""
    if not products:
        logger.info("No products to upsert")
        return

    _BATCH_SIZE = 500
    total = len(products)
    inserted = 0

    for start in range(0, total, _BATCH_SIZE):
        batch = products[start : start + _BATCH_SIZE]
        rows = [{**p, "feed_id": feed_id} for p in batch]
        try:
            repo.table_query("products", "upsert", data=rows,
                             filters=QueryFilters(on_conflict="feed_id,external_id"))
            inserted += len(batch)
            logger.info(
                "Upserted products %d-%d / %d for feed %s",
                start + 1, min(start + _BATCH_SIZE, total), total, feed_id,
            )
        except Exception as exc:
            logger.error(
                "Failed to upsert batch %d-%d for feed %s: %s",
                start + 1, min(start + _BATCH_SIZE, total), feed_id, exc,
            )
            raise

    logger.info("Upsert complete: %d products for feed %s", inserted, feed_id)


def _update_local_image_paths_via_repo(repo, image_map: dict[str, str], feed_id: str) -> None:
    """Update products table with local image paths via repository."""
    for external_id, local_path in image_map.items():
        if local_path is None:
            continue
        try:
            repo.table_query("products", "update", data={"local_image_path": local_path},
                             filters=QueryFilters(eq={"feed_id": feed_id, "external_id": external_id}))
        except Exception as exc:
            logger.warning("Failed to update local_image_path for product %s: %s", external_id, exc)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("")
async def create_feed(
    body: FeedCreate,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Create a new product feed for the current profile."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        result = repo.table_query("product_feeds", "insert", data={
            "profile_id": profile.profile_id,
            "name": body.name,
            "feed_url": body.feed_url,
        })
    except Exception as e:
        logger.error(f"Failed to create feed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create feed")

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create feed")

    return result.data[0]


@router.get("")
async def list_feeds(
    profile: ProfileContext = Depends(get_profile_context),
):
    """List all product feeds for the current profile."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        result = repo.table_query("product_feeds", "select",
            filters=QueryFilters(
                eq={"profile_id": profile.profile_id},
                order_by="created_at",
                order_desc=True,
            ))
    except Exception as e:
        logger.error(f"Failed to list feeds: {e}")
        raise HTTPException(status_code=500, detail="Failed to list feeds")

    return result.data or []


@router.get("/{feed_id}")
async def get_feed(
    feed_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Get a single feed with its product_count."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        result = repo.table_query("product_feeds", "select",
            filters=QueryFilters(
                eq={"id": feed_id, "profile_id": profile.profile_id},
                limit=1,
            ))
    except Exception as e:
        logger.error(f"Failed to fetch feed {feed_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch feed")

    if not result.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    return result.data[0]


@router.delete("/{feed_id}")
async def delete_feed(
    feed_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Delete a feed and all its products (CASCADE)."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Verify ownership before deleting
    try:
        existing = repo.table_query("product_feeds", "select",
            filters=QueryFilters(
                select="id",
                eq={"id": feed_id, "profile_id": profile.profile_id},
                limit=1,
            ))
    except Exception as e:
        logger.error(f"Failed to verify feed {feed_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to verify feed ownership")

    if not existing.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    # Clean up product images before deleting
    try:
        products = repo.table_query("editai_products", "select",
            filters=QueryFilters(
                select="local_image_path",
                eq={"feed_id": feed_id},
            ))
        if products.data:
            for p in products.data:
                if p.get("local_image_path"):
                    try:
                        Path(p["local_image_path"]).unlink(missing_ok=True)
                    except Exception:
                        pass
    except Exception as e:
        logger.warning(f"Failed to clean up product images for feed {feed_id}: {e}")

    repo.table_query("product_feeds", "delete",
        filters=QueryFilters(eq={"id": feed_id}))

    return {"deleted": True, "feed_id": feed_id}


@router.post("/{feed_id}/sync")
async def sync_feed(
    feed_id: str,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Trigger an async feed sync. Returns immediately; parse runs in background."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Verify feed exists and belongs to this profile
    result = repo.table_query("product_feeds", "select",
        filters=QueryFilters(
            select="id, feed_url, sync_status",
            eq={"id": feed_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    if not result.data:
        raise HTTPException(status_code=404, detail="Feed not found")

    feed = result.data[0]

    # Prevent concurrent syncs on the same feed
    if feed.get("sync_status") == "syncing":
        raise HTTPException(status_code=409, detail="Feed sync already in progress")

    # Set status to syncing immediately (optimistic concurrency)
    try:
        repo.table_query("product_feeds", "update", data={
            "sync_status": "syncing",
            "sync_error": None,
        }, filters=QueryFilters(eq={"id": feed_id, "sync_status": feed.get("sync_status", "idle")}))
    except Exception as e:
        logger.warning(f"Failed to set feed {feed_id} to syncing: {e}")
        raise HTTPException(status_code=409, detail="Feed sync status changed concurrently")

    # Enqueue background task
    background_tasks.add_task(_sync_feed_task, feed_id, feed["feed_url"], profile.profile_id)

    return {
        "feed_id": feed_id,
        "status": "syncing",
        "message": "Feed sync started",
    }
