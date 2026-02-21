"""
Profile Management Routes
Handles CRUD operations for user profiles.
"""
import logging
import uuid
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel

from app.api.auth import get_current_user, AuthUser
from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/profiles", tags=["profiles"])

# Supabase client for profile operations
_supabase_client = None

def get_supabase():
    """Get Supabase client with lazy initialization."""
    global _supabase_client
    if _supabase_client is None:
        try:
            from supabase import create_client
            settings = get_settings()
            if settings.supabase_url and settings.supabase_key:
                _supabase_client = create_client(settings.supabase_url, settings.supabase_key)
                logger.info("Supabase client initialized for profiles")
            else:
                logger.warning("Supabase credentials not configured")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase: {e}")
    return _supabase_client


# ============== PYDANTIC MODELS ==============

class ProfileCreate(BaseModel):
    name: str
    description: Optional[str] = None

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class ProfileSettingsUpdate(BaseModel):
    """Model for PATCH endpoint - supports partial updates including tts_settings and video_template_settings."""
    name: Optional[str] = None
    description: Optional[str] = None
    tts_settings: Optional[Dict[str, Any]] = None
    monthly_quota_usd: Optional[float] = None
    video_template_settings: Optional[Dict[str, Any]] = None

class ProfileResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    is_default: bool
    tts_settings: Optional[Dict[str, Any]] = None
    monthly_quota_usd: Optional[float] = None
    created_at: str
    updated_at: str


# ============== ROUTES ==============

@router.get("/templates")
async def list_templates():
    """Return available video template presets.

    Public read-only endpoint — no auth required.
    Returns the 3 built-in template names and display names for UI enumeration.
    Must be placed before /{profile_id} routes to avoid FastAPI treating 'templates' as a profile_id.
    """
    from app.services.product_video_compositor import TEMPLATES
    return [
        {"name": t.name, "display_name": t.display_name}
        for t in TEMPLATES.values()
    ]


@router.get("/", response_model=List[ProfileResponse])
async def list_profiles(current_user: AuthUser = Depends(get_current_user)):
    """
    List all profiles for the current user.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = supabase.table("profiles")\
            .select("*")\
            .eq("user_id", current_user.id)\
            .order("is_default", desc=True)\
            .order("created_at", desc=False)\
            .execute()

        profiles = result.data or []
        logger.info(f"[User {current_user.id}] Listed {len(profiles)} profiles")
        return profiles

    except Exception as e:
        logger.error(f"Failed to list profiles for user {current_user.id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch profiles")


@router.post("/", response_model=ProfileResponse)
async def create_profile(
    profile: ProfileCreate,
    current_user: AuthUser = Depends(get_current_user)
):
    """
    Create a new profile for the current user.
    New profiles are created with is_default=False.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        now = datetime.utcnow().isoformat()
        profile_data = {
            "user_id": current_user.id,
            "name": profile.name,
            "description": profile.description,
            "is_default": False,
            "created_at": now,
            "updated_at": now
        }

        result = supabase.table("profiles")\
            .insert(profile_data)\
            .execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create profile")

        created_profile = result.data[0]
        logger.info(f"[Profile {created_profile['id']}] Created by user {current_user.id}: {profile.name}")
        return created_profile

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create profile for user {current_user.id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to create profile")


@router.get("/{profile_id}", response_model=ProfileResponse)
async def get_profile(
    profile_id: str,
    current_user: AuthUser = Depends(get_current_user)
):
    """
    Get a single profile by ID.
    Returns 404 if not found, 403 if belongs to another user.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = supabase.table("profiles")\
            .select("*")\
            .eq("id", profile_id)\
            .single()\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Profile not found")

        profile = result.data

        # Check ownership
        if profile["user_id"] != current_user.id:
            logger.warning(f"[Profile {profile_id}] Access denied for user {current_user.id}")
            raise HTTPException(status_code=403, detail="Access denied to this profile")

        logger.info(f"[Profile {profile_id}] Retrieved by user {current_user.id}")
        return profile

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get profile {profile_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch profile")


@router.put("/{profile_id}", response_model=ProfileResponse)
async def update_profile(
    profile_id: str,
    profile_update: ProfileUpdate,
    current_user: AuthUser = Depends(get_current_user)
):
    """
    Update a profile's name and/or description.
    Returns 404 if not found, 403 if belongs to another user.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # First check ownership
        result = supabase.table("profiles")\
            .select("id, user_id")\
            .eq("id", profile_id)\
            .single()\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Profile not found")

        if result.data["user_id"] != current_user.id:
            logger.warning(f"[Profile {profile_id}] Update denied for user {current_user.id}")
            raise HTTPException(status_code=403, detail="Access denied to this profile")

        # Build update data
        update_data = {"updated_at": datetime.utcnow().isoformat()}
        if profile_update.name is not None:
            update_data["name"] = profile_update.name
        if profile_update.description is not None:
            update_data["description"] = profile_update.description

        # Update profile
        result = supabase.table("profiles")\
            .update(update_data)\
            .eq("id", profile_id)\
            .execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to update profile")

        updated_profile = result.data[0]
        logger.info(f"[Profile {profile_id}] Updated by user {current_user.id}")
        return updated_profile

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update profile {profile_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update profile")


@router.patch("/{profile_id}")
async def patch_profile(
    profile_id: str,
    updates: ProfileSettingsUpdate,
    current_user: AuthUser = Depends(get_current_user)
):
    """
    Partially update a profile including tts_settings.
    Invalidates Postiz publisher cache when tts_settings change.
    Returns 404 if not found, 403 if belongs to another user.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # First check ownership
        result = supabase.table("profiles")\
            .select("id, user_id")\
            .eq("id", profile_id)\
            .single()\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Profile not found")

        if result.data["user_id"] != current_user.id:
            logger.warning(f"[Profile {profile_id}] PATCH denied for user {current_user.id}")
            raise HTTPException(status_code=403, detail="Access denied to this profile")

        # Build update data from non-None fields
        update_data = {"updated_at": datetime.utcnow().isoformat()}
        tts_settings_updated = False

        if updates.name is not None:
            update_data["name"] = updates.name
        if updates.description is not None:
            update_data["description"] = updates.description
        if updates.tts_settings is not None:
            update_data["tts_settings"] = updates.tts_settings
            tts_settings_updated = True
        if updates.monthly_quota_usd is not None:
            update_data["monthly_quota_usd"] = updates.monthly_quota_usd
        if updates.video_template_settings is not None:
            update_data["video_template_settings"] = updates.video_template_settings

        # Update profile
        result = supabase.table("profiles")\
            .update(update_data)\
            .eq("id", profile_id)\
            .execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to update profile")

        # Invalidate Postiz cache if tts_settings changed
        if tts_settings_updated:
            try:
                from app.services.postiz_service import reset_postiz_publisher
                reset_postiz_publisher(profile_id)
                logger.info(f"[Profile {profile_id}] Reset Postiz publisher cache after settings update")
            except Exception as e:
                logger.warning(f"[Profile {profile_id}] Failed to reset Postiz cache: {e}")

        updated_profile = result.data[0]
        logger.info(f"[Profile {profile_id}] PATCH by user {current_user.id}, tts_settings_updated={tts_settings_updated}")
        return updated_profile

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to patch profile {profile_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to update profile")


@router.delete("/{profile_id}")
async def delete_profile(
    profile_id: str,
    current_user: AuthUser = Depends(get_current_user)
):
    """
    Delete a profile.
    Cannot delete if is_default=True. Set another profile as default first.
    CASCADE delete handled by database (deletes all associated projects/clips).
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Check ownership and default status
        result = supabase.table("profiles")\
            .select("id, user_id, is_default")\
            .eq("id", profile_id)\
            .single()\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Profile not found")

        profile = result.data

        if profile["user_id"] != current_user.id:
            logger.warning(f"[Profile {profile_id}] Delete denied for user {current_user.id}")
            raise HTTPException(status_code=403, detail="Access denied to this profile")

        if profile["is_default"]:
            logger.warning(f"[Profile {profile_id}] Delete denied: is default profile")
            raise HTTPException(
                status_code=400,
                detail="Cannot delete default profile. Set another profile as default first."
            )

        # Delete profile (CASCADE will delete associated projects/clips)
        supabase.table("profiles")\
            .delete()\
            .eq("id", profile_id)\
            .execute()

        logger.info(f"[Profile {profile_id}] Deleted by user {current_user.id}")
        return {"status": "deleted", "profile_id": profile_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete profile {profile_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete profile")


@router.post("/{profile_id}/set-default", response_model=ProfileResponse)
async def set_default_profile(
    profile_id: str,
    current_user: AuthUser = Depends(get_current_user)
):
    """
    Set a profile as the default profile for the user.
    Automatically unsets is_default on other profiles.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Check ownership
        result = supabase.table("profiles")\
            .select("id, user_id")\
            .eq("id", profile_id)\
            .single()\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Profile not found")

        if result.data["user_id"] != current_user.id:
            logger.warning(f"[Profile {profile_id}] Set-default denied for user {current_user.id}")
            raise HTTPException(status_code=403, detail="Access denied to this profile")

        # Unset default on all user's profiles
        supabase.table("profiles")\
            .update({"is_default": False, "updated_at": datetime.utcnow().isoformat()})\
            .eq("user_id", current_user.id)\
            .execute()

        # Set this profile as default
        result = supabase.table("profiles")\
            .update({"is_default": True, "updated_at": datetime.utcnow().isoformat()})\
            .eq("id", profile_id)\
            .execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to set default profile")

        updated_profile = result.data[0]
        logger.info(f"[Profile {profile_id}] Set as default by user {current_user.id}")
        return updated_profile

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to set default profile {profile_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to set default profile")


@router.get("/{profile_id}/dashboard")
async def get_profile_dashboard(
    profile_id: str,
    current_user: AuthUser = Depends(get_current_user),
    time_range: str = Query(default="30d", pattern="^(7d|30d|90d|all)$")
):
    """
    Get profile activity dashboard data.
    Returns video counts, API costs, and recent activity.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Verify ownership
        profile_result = supabase.table("profiles")\
            .select("user_id, monthly_quota_usd")\
            .eq("id", profile_id)\
            .single()\
            .execute()

        if not profile_result.data:
            raise HTTPException(status_code=404, detail="Profile not found")

        if profile_result.data["user_id"] != current_user.id:
            logger.warning(f"[Profile {profile_id}] Dashboard access denied for user {current_user.id}")
            raise HTTPException(status_code=403, detail="Access denied to this profile")

        monthly_quota = float(profile_result.data.get("monthly_quota_usd", 0) or 0)

        # Calculate date filter
        now = datetime.now()
        if time_range == "7d":
            start_date = now - timedelta(days=7)
        elif time_range == "30d":
            start_date = now - timedelta(days=30)
        elif time_range == "90d":
            start_date = now - timedelta(days=90)
        else:
            start_date = None  # All time

        # Project count
        projects_query = supabase.table("editai_projects")\
            .select("id", count="exact")\
            .eq("profile_id", profile_id)
        if start_date:
            projects_query = projects_query.gte("created_at", start_date.isoformat())
        projects_result = projects_query.execute()

        # Clip count
        clips_query = supabase.table("editai_clips")\
            .select("id, final_status", count="exact")\
            .eq("profile_id", profile_id)
        if start_date:
            clips_query = clips_query.gte("created_at", start_date.isoformat())
        clips_result = clips_query.execute()

        # Count rendered clips (final_status = 'completed')
        rendered_count = sum(1 for c in clips_result.data if c.get("final_status") == "completed")

        # Get costs summary
        from app.services.cost_tracker import get_cost_tracker
        tracker = get_cost_tracker()
        costs = tracker.get_summary(profile_id=profile_id)

        # Get monthly costs for quota display
        monthly_costs = tracker.get_monthly_costs(profile_id)

        logger.info(f"[Profile {profile_id}] Dashboard retrieved: {projects_result.count} projects, {clips_result.count} clips")

        return {
            "profile_id": profile_id,
            "time_range": time_range,
            "stats": {
                "projects_count": projects_result.count or 0,
                "clips_count": clips_result.count or 0,
                "rendered_count": rendered_count
            },
            "costs": {
                "elevenlabs": costs.get("totals", {}).get("elevenlabs", 0),
                "gemini": costs.get("totals", {}).get("gemini", 0),
                "total": costs.get("total_all", 0),
                "monthly": monthly_costs,
                "monthly_quota": monthly_quota,
                "quota_remaining": max(0, monthly_quota - monthly_costs) if monthly_quota > 0 else None
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get dashboard for profile {profile_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch dashboard data")
