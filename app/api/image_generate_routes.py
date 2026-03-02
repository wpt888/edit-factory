"""
AI Image Generation Routes
Generates images via FAL AI, applies logo overlays, sends to Telegram/Postiz.
"""

import uuid
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import get_settings
from app.db import get_supabase
from app.api.auth import ProfileContext, get_profile_context

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/image-gen", tags=["AI Image Generation"])

# ============== In-memory generation progress ==============
_generation_progress: dict[str, dict] = {}

GENERATED_IMAGES_DIR = Path("output/generated_images")
LOGOS_DIR = Path("output/logos")


# ============== Pydantic models ==============

class GenerateRequest(BaseModel):
    prompt: str
    template_id: Optional[str] = None
    product_id: Optional[str] = None
    aspect_ratio: str = "1:1"
    user_text: Optional[str] = None


class LogoOverlayRequest(BaseModel):
    x: int = 0
    y: int = 0
    scale: float = 1.0


class SendTelegramRequest(BaseModel):
    caption: str = ""


class SendPostizRequest(BaseModel):
    caption: str = ""


class TemplateCreate(BaseModel):
    name: str
    prompt_template: str
    is_default: bool = False


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    prompt_template: Optional[str] = None
    is_default: Optional[bool] = None


# ============== Background task ==============

def _generate_image_task(
    image_id: str,
    prompt: str,
    aspect_ratio: str,
    profile_id: str,
    product_id: Optional[str],
    template_name: Optional[str],
):
    """Background task: generate image via FAL AI, download, update DB."""
    supabase = get_supabase()

    try:
        _generation_progress[image_id] = {"status": "generating", "progress": 0}

        # Update DB status
        if supabase:
            supabase.table("generated_images").update({
                "status": "generating",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", image_id).execute()

        # Generate via FAL
        from app.services.fal_image_service import get_fal_generator
        fal = get_fal_generator()
        result = fal.generate(prompt=prompt, aspect_ratio=aspect_ratio, num_images=1)

        images = result.get("images", [])
        if not images:
            raise RuntimeError("FAL returned no images")

        image_url = images[0].get("url")
        if not image_url:
            raise RuntimeError("FAL image has no URL")

        _generation_progress[image_id] = {"status": "downloading", "progress": 50}

        # Download to local
        dest_dir = GENERATED_IMAGES_DIR / profile_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        local_path = str(dest_dir / f"{image_id}.png")
        fal.download_image(image_url, local_path)

        _generation_progress[image_id] = {"status": "completed", "progress": 100}

        # Track cost
        try:
            from app.services.cost_tracker import get_cost_tracker
            tracker = get_cost_tracker()
            from app.services.fal_image_service import FAL_COST_PER_IMAGE
            from app.services.cost_tracker import CostEntry
            entry = CostEntry(
                timestamp=datetime.now(timezone.utc).isoformat(),
                job_id=image_id,
                service="fal_ai",
                operation="image_generation",
                input_units=1,
                cost_usd=FAL_COST_PER_IMAGE,
                details={"profile_id": profile_id, "prompt_preview": prompt[:100]},
            )
            tracker._add_entry(entry)
            tracker._save_to_supabase(entry, profile_id=profile_id)
        except Exception as e:
            logger.warning(f"Cost tracking failed: {e}")

        # Update DB with results
        if supabase:
            supabase.table("generated_images").update({
                "status": "completed",
                "image_url": image_url,
                "image_local_path": local_path,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", image_id).execute()

    except Exception as e:
        logger.error(f"Image generation failed for {image_id}: {e}")
        _generation_progress[image_id] = {"status": "failed", "progress": 0, "error": str(e)}
        if supabase:
            try:
                supabase.table("generated_images").update({
                    "status": "failed",
                    "error_message": str(e)[:500],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", image_id).execute()
            except Exception:
                pass


# ============== Generation endpoints ==============

@router.post("/generate")
async def generate_image(
    req: GenerateRequest,
    background_tasks: BackgroundTasks,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Start AI image generation (background task)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Build final prompt from template + user text
    final_prompt = req.prompt
    template_name = None

    if req.template_id:
        try:
            tpl = supabase.table("image_prompt_templates")\
                .select("*").eq("id", req.template_id).single().execute()
            if tpl.data:
                template_name = tpl.data["name"]
                final_prompt = tpl.data["prompt_template"]
                # Substitute placeholders if product provided
                if req.product_id:
                    product = supabase.table("v_catalog_products_grouped")\
                        .select("title,brand,price,description")\
                        .eq("id", req.product_id).single().execute()
                    if product.data:
                        p = product.data
                        final_prompt = final_prompt.format(
                            title=p.get("title", ""),
                            brand=p.get("brand", ""),
                            price=p.get("price", ""),
                            description=p.get("description", ""),
                        )
        except Exception as e:
            logger.warning(f"Template resolution failed: {e}")

    # Append user-specific text
    if req.user_text:
        final_prompt = f"{final_prompt}\n{req.user_text}"

    # Create DB record
    image_id = str(uuid.uuid4())
    supabase.table("generated_images").insert({
        "id": image_id,
        "profile_id": ctx.profile_id,
        "product_id": req.product_id,
        "prompt": final_prompt,
        "template_name": template_name,
        "status": "pending",
    }).execute()

    # Start background generation
    background_tasks.add_task(
        _generate_image_task,
        image_id=image_id,
        prompt=final_prompt,
        aspect_ratio=req.aspect_ratio,
        profile_id=ctx.profile_id,
        product_id=req.product_id,
        template_name=template_name,
    )

    return {"image_id": image_id, "status": "pending"}


@router.get("/{image_id}/status")
async def get_generation_status(
    image_id: str,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Poll generation status."""
    # Check in-memory first (faster)
    if image_id in _generation_progress:
        progress = _generation_progress[image_id]
        if progress["status"] in ("completed", "failed"):
            # Clean up after client reads final status
            cached = dict(progress)
            del _generation_progress[image_id]
            # Fetch DB record for full data
            supabase = get_supabase()
            if supabase:
                row = supabase.table("generated_images")\
                    .select("*").eq("id", image_id).single().execute()
                if row.data:
                    return row.data
            return cached
        return progress

    # Fallback to DB
    supabase = get_supabase()
    if supabase:
        row = supabase.table("generated_images")\
            .select("*").eq("id", image_id).single().execute()
        if row.data:
            return row.data

    raise HTTPException(status_code=404, detail="Image not found")


@router.get("/history")
async def get_generation_history(
    ctx: ProfileContext = Depends(get_profile_context),
    limit: int = 50,
    offset: int = 0,
):
    """List generated images for this profile."""
    supabase = get_supabase()
    if not supabase:
        return {"images": [], "total": 0}

    result = supabase.table("generated_images")\
        .select("*", count="exact")\
        .eq("profile_id", ctx.profile_id)\
        .order("created_at", desc=True)\
        .range(offset, offset + limit - 1)\
        .execute()

    return {"images": result.data or [], "total": result.count or 0}


# ============== Logo endpoints ==============

@router.post("/{image_id}/logo")
async def apply_logo(
    image_id: str,
    req: LogoOverlayRequest,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Apply logo overlay to a generated image."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Get image record
    img = supabase.table("generated_images")\
        .select("*").eq("id", image_id).eq("profile_id", ctx.profile_id)\
        .single().execute()
    if not img.data:
        raise HTTPException(status_code=404, detail="Image not found")

    base_path = img.data.get("image_local_path")
    if not base_path or not Path(base_path).exists():
        raise HTTPException(status_code=400, detail="Source image not available locally")

    # Get profile logo
    profile = supabase.table("profiles")\
        .select("logo_path").eq("id", ctx.profile_id).single().execute()
    logo_path = profile.data.get("logo_path") if profile.data else None
    if not logo_path or not Path(logo_path).exists():
        raise HTTPException(status_code=400, detail="No logo uploaded for this profile")

    # Apply overlay
    from app.services.logo_overlay_service import apply_logo_overlay

    output_dir = GENERATED_IMAGES_DIR / ctx.profile_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = str(output_dir / f"{image_id}_logo.png")

    apply_logo_overlay(
        base_path=base_path,
        logo_path=logo_path,
        output_path=output_path,
        x=req.x,
        y=req.y,
        scale=req.scale,
    )

    # Update DB
    supabase.table("generated_images").update({
        "final_image_path": output_path,
        "logo_config": {"x": req.x, "y": req.y, "scale": req.scale, "logo_path": logo_path},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", image_id).execute()

    return {"final_image_path": output_path, "logo_config": {"x": req.x, "y": req.y, "scale": req.scale}}


@router.post("/logo/upload")
async def upload_logo(
    file: UploadFile = File(...),
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Upload profile logo image."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    logo_dir = LOGOS_DIR / ctx.profile_id
    logo_dir.mkdir(parents=True, exist_ok=True)

    # Determine extension from content type
    ext_map = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg"}
    ext = ext_map.get(file.content_type, ".png")
    logo_path = str(logo_dir / f"logo{ext}")

    with open(logo_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Update profile
    supabase = get_supabase()
    if supabase:
        supabase.table("profiles").update({
            "logo_path": logo_path,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", ctx.profile_id).execute()

    return {"logo_path": logo_path}


@router.get("/logo")
async def get_logo_info(ctx: ProfileContext = Depends(get_profile_context)):
    """Get current logo info for profile."""
    supabase = get_supabase()
    if not supabase:
        return {"logo_path": None}

    profile = supabase.table("profiles")\
        .select("logo_path").eq("id", ctx.profile_id).single().execute()

    logo_path = profile.data.get("logo_path") if profile.data else None
    exists = logo_path and Path(logo_path).exists()

    return {"logo_path": logo_path if exists else None, "exists": exists}


@router.get("/logo/file")
async def serve_logo_file(ctx: ProfileContext = Depends(get_profile_context)):
    """Serve the profile logo as an image file (for <img> tags in the frontend)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    profile = supabase.table("profiles")\
        .select("logo_path").eq("id", ctx.profile_id).single().execute()

    logo_path = profile.data.get("logo_path") if profile.data else None
    if not logo_path or not Path(logo_path).exists():
        raise HTTPException(status_code=404, detail="No logo uploaded for this profile")

    return FileResponse(logo_path)


@router.delete("/logo")
async def delete_logo(ctx: ProfileContext = Depends(get_profile_context)):
    """Delete profile logo."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    profile = supabase.table("profiles")\
        .select("logo_path").eq("id", ctx.profile_id).single().execute()

    if profile.data and profile.data.get("logo_path"):
        try:
            Path(profile.data["logo_path"]).unlink(missing_ok=True)
        except Exception:
            pass

    supabase.table("profiles").update({
        "logo_path": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", ctx.profile_id).execute()

    return {"deleted": True}


# ============== Send endpoints ==============

@router.post("/{image_id}/send/telegram")
async def send_to_telegram(
    image_id: str,
    req: SendTelegramRequest,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Send generated image to Telegram."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    img = supabase.table("generated_images")\
        .select("*").eq("id", image_id).eq("profile_id", ctx.profile_id)\
        .single().execute()
    if not img.data:
        raise HTTPException(status_code=404, detail="Image not found")

    # Use final (with logo) if available, otherwise base image
    file_path = img.data.get("final_image_path") or img.data.get("image_local_path")
    if not file_path or not Path(file_path).exists():
        raise HTTPException(status_code=400, detail="Image file not available locally")

    from app.services.telegram_service import get_telegram_sender

    try:
        sender = get_telegram_sender(ctx.profile_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Send with inline keyboard for approval
    inline_keyboard = {
        "inline_keyboard": [
            [
                {"text": "Approve", "callback_data": f"approve_{image_id}"},
                {"text": "Reject", "callback_data": f"reject_{image_id}"},
            ]
        ]
    }

    result = sender.send_photo(
        file_path=file_path,
        caption=req.caption or f"AI Generated Image - {img.data.get('template_name', 'custom')}",
        reply_markup=inline_keyboard,
    )

    return {"sent": True, "telegram_message_id": result.get("result", {}).get("message_id")}


@router.post("/{image_id}/send/postiz")
async def send_to_postiz(
    image_id: str,
    req: SendPostizRequest,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Send generated image to Postiz (upload then publish to all integrations)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    img = supabase.table("generated_images")\
        .select("*").eq("id", image_id).eq("profile_id", ctx.profile_id)\
        .single().execute()
    if not img.data:
        raise HTTPException(status_code=404, detail="Image not found")

    file_path = img.data.get("final_image_path") or img.data.get("image_local_path")
    if not file_path or not Path(file_path).exists():
        raise HTTPException(status_code=400, detail="Image file not available locally")

    from app.services.postiz_service import get_postiz_publisher

    try:
        publisher = get_postiz_publisher(ctx.profile_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        # Step 1: Upload image to Postiz (upload_video handles image files too)
        media = await publisher.upload_video(
            video_path=Path(file_path),
            profile_id=ctx.profile_id,
        )

        # Step 2: Fetch available integrations
        integrations = await publisher.get_integrations(profile_id=ctx.profile_id)
        if not integrations:
            raise HTTPException(status_code=400, detail="No Postiz integrations configured")

        integration_ids = [i.id for i in integrations if not i.disabled]
        if not integration_ids:
            raise HTTPException(status_code=400, detail="No active Postiz integrations found")

        integrations_info = {i.id: i.type for i in integrations}

        # Step 3: Create post
        caption = req.caption or f"AI Generated Image — {img.data.get('template_name', 'custom')}"
        result = await publisher.create_post(
            media_id=media.id,
            media_path=media.path,
            caption=caption,
            integration_ids=integration_ids,
            integrations_info=integrations_info,
            profile_id=ctx.profile_id,
        )

        return {"sent": True, "postiz_result": {"success": result.success, "post_id": result.post_id}}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Postiz send failed for image {image_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Postiz error: {str(e)[:200]}")


# ============== Template endpoints ==============

@router.post("/templates")
async def create_template(
    req: TemplateCreate,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Create a prompt template."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    template_id = str(uuid.uuid4())
    supabase.table("image_prompt_templates").insert({
        "id": template_id,
        "profile_id": ctx.profile_id,
        "name": req.name,
        "prompt_template": req.prompt_template,
        "is_default": req.is_default,
    }).execute()

    # If setting as default, unset others
    if req.is_default:
        supabase.table("image_prompt_templates")\
            .update({"is_default": False})\
            .eq("profile_id", ctx.profile_id)\
            .neq("id", template_id)\
            .execute()

    return {"id": template_id, "name": req.name}


@router.get("/templates")
async def list_templates(ctx: ProfileContext = Depends(get_profile_context)):
    """List prompt templates for this profile."""
    supabase = get_supabase()
    if not supabase:
        return {"templates": []}

    result = supabase.table("image_prompt_templates")\
        .select("*")\
        .eq("profile_id", ctx.profile_id)\
        .order("created_at", desc=True)\
        .execute()

    return {"templates": result.data or []}


@router.put("/templates/{template_id}")
async def update_template(
    template_id: str,
    req: TemplateUpdate,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Update a prompt template."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    updates = {}
    if req.name is not None:
        updates["name"] = req.name
    if req.prompt_template is not None:
        updates["prompt_template"] = req.prompt_template
    if req.is_default is not None:
        updates["is_default"] = req.is_default
        if req.is_default:
            supabase.table("image_prompt_templates")\
                .update({"is_default": False})\
                .eq("profile_id", ctx.profile_id)\
                .neq("id", template_id)\
                .execute()

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    supabase.table("image_prompt_templates").update(updates)\
        .eq("id", template_id).eq("profile_id", ctx.profile_id).execute()

    return {"updated": True}


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: str,
    ctx: ProfileContext = Depends(get_profile_context),
):
    """Delete a prompt template."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    supabase.table("image_prompt_templates")\
        .delete()\
        .eq("id", template_id)\
        .eq("profile_id", ctx.profile_id)\
        .execute()

    return {"deleted": True}
