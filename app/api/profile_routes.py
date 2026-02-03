"""
Profile Management Routes
Handles CRUD operations for user profiles.
"""
import logging
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
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

class ProfileResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    is_default: bool
    created_at: str
    updated_at: str


# ============== ROUTES ==============

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
        # Create new profile
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
