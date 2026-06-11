"""
Wiki / Knowledge Base Routes

Internal per-profile Markdown knowledge base. Pages are plain Markdown
(content_md is the single source of truth, rendered client-side) grouped by a
free-text category for the sidebar. No publish workflow, no SEO — this is
documentation/notes for the operator, available in both web and desktop builds.

Storage goes through the generic ``repo.table_query("editai_wiki_pages", ...)``
escape hatch (works on both Supabase and SQLite), so no new repository methods
are required. Mirrors the auth + ownership pattern of profile_routes.py.
"""
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/wiki", tags=["Wiki"])

TABLE = "editai_wiki_pages"


# ============== PYDANTIC MODELS ==============

class WikiPageCreate(BaseModel):
    title: str
    category: Optional[str] = None
    content_md: str = ""


class WikiPageUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    content_md: Optional[str] = None
    sort_order: Optional[int] = None


class WikiPageSummary(BaseModel):
    """List item — metadata only (no content_md) for the sidebar/search."""
    id: str
    title: str
    slug: str
    category: Optional[str] = None
    sort_order: int = 0
    updated_at: Optional[str] = None


class WikiPageResponse(WikiPageSummary):
    content_md: str = ""
    created_at: Optional[str] = None


# ============== HELPERS ==============

def _slugify(text: str) -> str:
    """Lower-case, ASCII-ish, hyphen-separated slug. No external dependency."""
    text = (text or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text or "page"


def _unique_slug(repo, profile_id: str, base: str) -> str:
    """Return a slug unique within the profile, appending -2, -3, ... on clash."""
    existing = repo.table_query(
        TABLE,
        "select",
        filters=QueryFilters(select="slug", eq={"profile_id": profile_id}),
    )
    taken = {row["slug"] for row in (existing.data or []) if row.get("slug")}
    if base not in taken:
        return base
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"


def _get_owned_page(repo, page_id: str, profile_id: str) -> Dict[str, Any]:
    """Fetch a page by id and enforce profile ownership (404/403)."""
    result = repo.table_query(
        TABLE, "select", filters=QueryFilters(eq={"id": page_id}, limit=1)
    )
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Wiki page not found")
    page = rows[0]
    if page.get("profile_id") != profile_id:
        logger.warning(f"[Wiki {page_id}] Access denied for profile {profile_id}")
        raise HTTPException(status_code=403, detail="Access denied to this wiki page")
    return page


# ============== ROUTES ==============

@router.get("", response_model=List[WikiPageSummary])
@router.get("/", response_model=List[WikiPageSummary])
async def list_wiki_pages(ctx: ProfileContext = Depends(get_profile_context)):
    """List wiki pages for the current profile (metadata only, no content)."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = repo.table_query(
            TABLE,
            "select",
            filters=QueryFilters(
                select="id, title, slug, category, sort_order, updated_at",
                eq={"profile_id": ctx.profile_id},
            ),
        )
        pages = result.data or []
        # Sort client-of-DB-agnostic: category (None last), then sort_order, then title.
        pages.sort(
            key=lambda p: (
                (p.get("category") or "￿").lower(),
                p.get("sort_order") or 0,
                (p.get("title") or "").lower(),
            )
        )
        return pages
    except Exception as e:
        logger.error(f"Failed to list wiki pages for profile {ctx.profile_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch wiki pages")


@router.get("/{page_id}", response_model=WikiPageResponse)
async def get_wiki_page(
    page_id: str, ctx: ProfileContext = Depends(get_profile_context)
):
    """Get a single wiki page (full content) by ID."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        return _get_owned_page(repo, page_id, ctx.profile_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get wiki page {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch wiki page")


@router.post("", response_model=WikiPageResponse)
@router.post("/", response_model=WikiPageResponse)
async def create_wiki_page(
    body: WikiPageCreate, ctx: ProfileContext = Depends(get_profile_context)
):
    """Create a new wiki page. Slug is auto-derived from the title (unique per profile)."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    title = (body.title or "").strip() or "Untitled"
    category = (body.category or "").strip() or None

    try:
        slug = _unique_slug(repo, ctx.profile_id, _slugify(title))
        now = datetime.now(timezone.utc).isoformat()
        data = {
            "id": str(uuid.uuid4()),
            "profile_id": ctx.profile_id,
            "title": title,
            "slug": slug,
            "category": category,
            "content_md": body.content_md or "",
            "sort_order": 0,
            "created_at": now,
            "updated_at": now,
        }
        result = repo.table_query(TABLE, "insert", data=data)
        created = (result.data or [data])[0]
        logger.info(f"[Wiki {created['id']}] Created for profile {ctx.profile_id}: {title}")
        return created
    except Exception as e:
        logger.error(f"Failed to create wiki page for profile {ctx.profile_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to create wiki page")


@router.put("/{page_id}", response_model=WikiPageResponse)
async def update_wiki_page(
    page_id: str,
    body: WikiPageUpdate,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Update a wiki page (partial). Re-slugs only when the title changes."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        page = _get_owned_page(repo, page_id, ctx.profile_id)

        update: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if body.title is not None:
            new_title = body.title.strip() or "Untitled"
            update["title"] = new_title
            if new_title != page.get("title"):
                update["slug"] = _unique_slug(repo, ctx.profile_id, _slugify(new_title))
        if body.category is not None:
            update["category"] = body.category.strip() or None
        if body.content_md is not None:
            update["content_md"] = body.content_md
        if body.sort_order is not None:
            update["sort_order"] = body.sort_order

        repo.table_query(
            TABLE, "update", data=update, filters=QueryFilters(eq={"id": page_id})
        )
        # Return the merged, current row.
        return {**page, **update}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update wiki page {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update wiki page")


@router.delete("/{page_id}")
async def delete_wiki_page(
    page_id: str, ctx: ProfileContext = Depends(get_profile_context)
):
    """Delete a wiki page by ID (profile-scoped)."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        _get_owned_page(repo, page_id, ctx.profile_id)
        repo.table_query(
            TABLE, "delete", filters=QueryFilters(eq={"id": page_id})
        )
        logger.info(f"[Wiki {page_id}] Deleted for profile {ctx.profile_id}")
        return {"status": "deleted", "id": page_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete wiki page {page_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete wiki page")
