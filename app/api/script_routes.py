"""
AI Script Generation Routes
Generate TTS-safe scripts using Gemini or Claude with segment keyword awareness.
"""
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.db import get_supabase
from app.services.script_generator import get_script_generator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scripts", tags=["scripts"])

# ============== PYDANTIC MODELS ==============

class ScriptGenerateRequest(BaseModel):
    """Request model for script generation."""
    idea: str                           # User's video idea/concept
    context: str = ""                   # Product/brand context
    variant_count: int = 3              # Number of script variants (1-10)
    provider: str = "gemini"            # "gemini" or "claude"


class ScriptGenerateResponse(BaseModel):
    """Response model for script generation."""
    scripts: List[str]                  # Generated script texts
    provider: str                       # Which AI provider was used
    keyword_count: int                  # How many keywords were sent to AI


class KeywordsResponse(BaseModel):
    """Response model for keywords endpoint."""
    keywords: List[str]                 # Unique segment keywords
    count: int                          # Total keyword count


# ============== ENDPOINTS ==============

@router.post("/generate", response_model=ScriptGenerateResponse)
async def generate_scripts(
    request: ScriptGenerateRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Generate N script variants using AI (Gemini or Claude).

    The AI receives segment keywords from the user's library so it can write
    scripts that reference available visual content naturally.

    Returns TTS-safe scripts: plain text, proper punctuation, no emojis,
    no markdown, no stage directions.
    """
    # Validate input
    if request.variant_count < 1 or request.variant_count > 10:
        raise HTTPException(
            status_code=400,
            detail="variant_count must be between 1 and 10"
        )

    if request.provider not in ["gemini", "claude"]:
        raise HTTPException(
            status_code=400,
            detail="provider must be 'gemini' or 'claude'"
        )

    if not request.idea.strip():
        raise HTTPException(
            status_code=400,
            detail="idea cannot be empty"
        )

    # Fetch unique keywords from editai_segments table for current profile
    supabase = get_supabase()
    unique_keywords = []

    if supabase:
        try:
            result = supabase.table("editai_segments")\
                .select("keywords")\
                .eq("profile_id", profile.profile_id)\
                .execute()

            # Flatten and deduplicate keywords
            all_keywords = set()
            for seg in result.data:
                keywords_list = seg.get("keywords") or []
                for kw in keywords_list:
                    all_keywords.add(kw)

            unique_keywords = sorted(all_keywords)

            logger.info(
                f"[Profile {profile.profile_id}] Fetched {len(unique_keywords)} unique keywords "
                f"from {len(result.data)} segments"
            )
        except Exception as e:
            logger.warning(f"Failed to fetch keywords from database: {e}")
            # Continue with empty keywords - not a fatal error
    else:
        logger.warning("Supabase not available, continuing without keywords")

    # Generate scripts
    logger.info(
        f"[Profile {profile.profile_id}] Generating {request.variant_count} scripts "
        f"with {request.provider}, {len(unique_keywords)} keywords available"
    )

    try:
        generator = get_script_generator()
        scripts = generator.generate_scripts(
            idea=request.idea,
            context=request.context,
            keywords=unique_keywords,
            variant_count=request.variant_count,
            provider=request.provider
        )

        logger.info(
            f"[Profile {profile.profile_id}] Generated {len(scripts)} scripts successfully"
        )

        return ScriptGenerateResponse(
            scripts=scripts,
            provider=request.provider,
            keyword_count=len(unique_keywords)
        )

    except ValueError as e:
        # API key missing or invalid input
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # AI service error
        logger.error(f"Script generation failed: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"Script generation service unavailable: {str(e)}"
        )


@router.get("/keywords", response_model=KeywordsResponse)
async def get_available_keywords(
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Get all unique keywords from the current profile's segment library.

    This lets the frontend show users what visual content is available
    before they generate scripts.
    """
    supabase = get_supabase()

    if not supabase:
        raise HTTPException(
            status_code=503,
            detail="Database not available"
        )

    try:
        result = supabase.table("editai_segments")\
            .select("keywords")\
            .eq("profile_id", profile.profile_id)\
            .execute()

        # Flatten and deduplicate keywords
        all_keywords = set()
        for seg in result.data:
            keywords_list = seg.get("keywords") or []
            for kw in keywords_list:
                all_keywords.add(kw)

        unique_keywords = sorted(all_keywords)

        logger.info(
            f"[Profile {profile.profile_id}] Returning {len(unique_keywords)} unique keywords"
        )

        return KeywordsResponse(
            keywords=unique_keywords,
            count=len(unique_keywords)
        )

    except Exception as e:
        logger.error(f"Failed to fetch keywords: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch keywords: {str(e)}"
        )
