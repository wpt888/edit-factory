"""product_library_routes.py - Local per-user product library (Phase D1).

CRUD over the local SQLite store (app/repositories/product_library.py) plus
Gemini Vision auto-description. Replaces the hardcoded Gomag catalog as the
default product source; the Google Shopping feed import path is untouched.

Endpoints:
    POST   /product-library                          Create product (multipart)
    GET    /product-library                          List products (per-profile)
    GET    /product-library/{id}                     One product
    PUT    /product-library/{id}                     Update title/description, add/remove images
    DELETE /product-library/{id}                     Delete product + image files
    GET    /product-library/{id}/image/{idx}         Serve a product image (for <img> tags)
    POST   /product-library/generate-description     Suggest description from uploaded title+images
    POST   /product-library/{id}/generate-description  Same, from the product's stored images
"""
import asyncio
import base64
import logging
import mimetypes
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.api.auth import ProfileContext, get_profile_context
from app.repositories.product_library import get_product_library

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/product-library", tags=["product-library"])

_ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
_MAX_IMAGES_PER_PRODUCT = 10
_MAX_VISION_IMAGES = 3  # cap images sent to Gemini per request


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize(product: dict) -> dict:
    """Add image_urls (API-relative) so the frontend can render thumbnails."""
    pid = product["id"]
    return {
        **product,
        "image_urls": [
            f"/product-library/{pid}/image/{i}"
            for i in range(len(product.get("image_paths") or []))
        ],
    }


async def _save_images(product_id: str, images: List[UploadFile]) -> List[str]:
    """Persist uploaded images; return their store-relative paths."""
    store = get_product_library()
    dest_dir = store.image_dir(product_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    rel_paths: List[str] = []
    for upload in images:
        ext = Path(upload.filename or "").suffix.lower()
        if ext not in _ALLOWED_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported image type '{ext}' — use jpg, png or webp",
            )
        filename = f"{uuid.uuid4().hex[:12]}{ext}"
        data = await upload.read()
        if not data:
            continue
        (dest_dir / filename).write_bytes(data)
        rel_paths.append(f"images/{product_id}/{filename}")
    return rel_paths


def _generate_description_sync(title: str, images: List[tuple], profile_id: str) -> str:
    """Call Gemini Vision with product images + title, return suggested copy.

    Reuses the existing genai client pattern (gemini_analyzer/script_generator),
    per-profile key resolution via api_key_vault, and cost logging.
    """
    from google import genai

    from app.config import get_settings
    from app.services.credentials.vault import get_vault_manager

    settings = get_settings()
    api_key = get_vault_manager().get_api_key_or_default(profile_id, "gemini") or settings.gemini_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="No Gemini API key configured")

    prompt = (
        f"Ai imaginea unui produs și titlul «{title}». "
        "Scrie o descriere de produs concisă (2-3 fraze), potrivită pentru reels/TikTok, "
        "care evidențiază beneficiile. Fără emoji, fără hashtag-uri. "
        "Răspunde doar cu textul descrierii."
    )
    contents: list = [prompt]
    for mime, data in images[:_MAX_VISION_IMAGES]:
        contents.append({
            "inline_data": {
                "mime_type": mime or "image/jpeg",
                "data": base64.b64encode(data).decode(),
            }
        })

    client = genai.Client(api_key=api_key, http_options={"timeout": 60_000})
    try:
        response = client.models.generate_content(model=settings.gemini_model, contents=contents)
    except Exception as exc:  # noqa: BLE001 — surface upstream errors cleanly, not as 500
        logger.warning("Gemini description generation failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=f"Gemini is unavailable right now — try again shortly ({type(exc).__name__})",
        )
    text = (response.text or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="Gemini returned an empty description")

    try:
        from app.services.cost_tracker import get_cost_tracker
        get_cost_tracker().log_gemini_analysis(
            job_id=f"prodlib_desc_{uuid.uuid4().hex[:8]}",
            frames_analyzed=min(len(images), _MAX_VISION_IMAGES),
            profile_id=profile_id,
        )
    except Exception as exc:  # noqa: BLE001 — cost logging must never fail the request
        logger.warning("Cost logging failed for product description: %s", exc)

    return text


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("")
async def create_product(
    title: str = Form(...),
    description: str = Form(default=""),
    images: List[UploadFile] = File(default=[]),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Create a local product with 0..N images."""
    title = title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    if len(images) > _MAX_IMAGES_PER_PRODUCT:
        raise HTTPException(status_code=400, detail=f"Max {_MAX_IMAGES_PER_PRODUCT} images per product")

    store = get_product_library()
    product = store.create(profile.profile_id, title, description.strip())
    if images:
        rel_paths = await _save_images(product["id"], images)
        product = store.update(product["id"], profile.profile_id, image_paths=rel_paths)
    return _serialize(product)


@router.get("")
async def list_products(profile: ProfileContext = Depends(get_profile_context)):
    store = get_product_library()
    return {"products": [_serialize(p) for p in store.list(profile.profile_id)]}


@router.post("/generate-description")
async def generate_description_from_upload(
    title: str = Form(...),
    images: List[UploadFile] = File(default=[]),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Suggest a description before the product is saved (Add-product dialog)."""
    if not images:
        raise HTTPException(status_code=400, detail="At least one image is required")
    image_bytes = [
        (img.content_type, await img.read()) for img in images[:_MAX_VISION_IMAGES]
    ]
    image_bytes = [(m, b) for m, b in image_bytes if b]
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded images are empty")
    description = await asyncio.to_thread(
        _generate_description_sync, title.strip(), image_bytes, profile.profile_id
    )
    return {"description": description}


@router.get("/{product_id}")
async def get_product(
    product_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    product = get_product_library().get(product_id, profile.profile_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return _serialize(product)


@router.put("/{product_id}")
async def update_product(
    product_id: str,
    title: Optional[str] = Form(default=None),
    description: Optional[str] = Form(default=None),
    remove_paths: Optional[str] = Form(default=None),  # JSON array of relative paths
    images: List[UploadFile] = File(default=[]),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Update title/description; optionally add new images and/or remove existing ones."""
    import json as _json

    store = get_product_library()
    product = store.get(product_id, profile.profile_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    image_paths: List[str] = list(product.get("image_paths") or [])

    if remove_paths:
        try:
            to_remove = set(_json.loads(remove_paths))
        except _json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="remove_paths must be a JSON array")
        for rel in to_remove:
            if rel in image_paths:
                image_paths.remove(rel)
                abs_path = store.abs_image_path(rel)
                if abs_path:
                    abs_path.unlink(missing_ok=True)

    if images:
        if len(image_paths) + len(images) > _MAX_IMAGES_PER_PRODUCT:
            raise HTTPException(status_code=400, detail=f"Max {_MAX_IMAGES_PER_PRODUCT} images per product")
        image_paths.extend(await _save_images(product_id, images))

    updated = store.update(
        product_id,
        profile.profile_id,
        title=title.strip() if title is not None and title.strip() else None,
        description=description if description is not None else None,
        image_paths=image_paths,
    )
    return _serialize(updated)


@router.delete("/{product_id}")
async def delete_product(
    product_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    if not get_product_library().delete(product_id, profile.profile_id):
        raise HTTPException(status_code=404, detail="Product not found")
    return {"deleted": True}


@router.get("/{product_id}/image/{idx}")
async def serve_product_image(product_id: str, idx: int):
    """Serve a product image for <img> tags.

    No auth — same pattern as /image-gen/{id}/file: product IDs are unguessable
    UUIDs and the resolved path is confined to the library's images directory.
    """
    store = get_product_library()
    cur = store._conn.execute(  # read-only lookup without profile scoping
        "SELECT image_paths FROM local_products WHERE id = ?", (product_id,)
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    import json as _json
    paths = _json.loads(row["image_paths"] or "[]")
    if idx < 0 or idx >= len(paths):
        raise HTTPException(status_code=404, detail="Image not found")
    abs_path = store.abs_image_path(paths[idx])
    if not abs_path:
        raise HTTPException(status_code=404, detail="Image file not available")
    media_type = mimetypes.guess_type(str(abs_path))[0] or "image/jpeg"
    return FileResponse(abs_path, media_type=media_type,
                        headers={"Cache-Control": "private, max-age=3600"})


@router.post("/{product_id}/generate-description")
async def generate_description_for_product(
    product_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Suggest a description from the product's stored images + title.

    Returns the suggestion only — the user accepts it in the UI; nothing is
    overwritten automatically.
    """
    store = get_product_library()
    product = store.get(product_id, profile.profile_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    image_bytes: List[tuple] = []
    for rel in (product.get("image_paths") or [])[:_MAX_VISION_IMAGES]:
        abs_path = store.abs_image_path(rel)
        if abs_path:
            mime = mimetypes.guess_type(str(abs_path))[0] or "image/jpeg"
            image_bytes.append((mime, abs_path.read_bytes()))
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Product has no images")

    description = await asyncio.to_thread(
        _generate_description_sync, product["title"], image_bytes, profile.profile_id
    )
    return {"description": description}
