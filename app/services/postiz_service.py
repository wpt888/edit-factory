"""
Postiz Social Media Publishing Service.
Handles video uploads and post scheduling via Postiz API.
"""
import os
import logging
import httpx
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
from datetime import datetime

from app.db import get_supabase

logger = logging.getLogger(__name__)


@dataclass
class PostizIntegration:
    """Represents a connected social media account in Postiz."""
    id: str
    name: str
    type: str  # instagram, tiktok, youtube, facebook, linkedin, x, bluesky, threads
    identifier: Optional[str] = None  # username/handle
    picture: Optional[str] = None  # profile picture URL
    disabled: bool = False


@dataclass
class PostizMedia:
    """Uploaded media reference."""
    id: str
    path: str


@dataclass
class PublishResult:
    """Result of a publish operation."""
    success: bool
    post_id: Optional[str] = None
    scheduled_date: Optional[str] = None
    platforms: Optional[List[str]] = None
    error: Optional[str] = None


class PostizPublisher:
    """
    Postiz API client for social media publishing.

    Usage:
        publisher = PostizPublisher()
        integrations = await publisher.get_integrations()
        media = await publisher.upload_video(Path("video.mp4"))
        result = await publisher.create_post(
            media_id=media.id,
            media_path=media.path,
            caption="My video!",
            integration_ids=["int_123", "int_456"],
            schedule_date=datetime(2024, 1, 15, 10, 0)
        )
    """

    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None
    ):
        self.api_url = (api_url or os.getenv("POSTIZ_API_URL", "")).rstrip("/")
        self.api_key = api_key or os.getenv("POSTIZ_API_KEY", "")

        if not self.api_url:
            raise ValueError("POSTIZ_API_URL is required")
        if not self.api_key:
            raise ValueError("POSTIZ_API_KEY is required")

        self.headers = {
            "Authorization": self.api_key,
            "Accept": "application/json"
        }

        logger.info(f"PostizPublisher initialized with URL: {self.api_url}")

    async def get_integrations(self, profile_id: Optional[str] = None) -> List[PostizIntegration]:
        """
        Fetch all connected social media accounts from Postiz.

        Args:
            profile_id: Optional profile ID for logging context

        Returns:
            List of PostizIntegration objects representing connected platforms
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.api_url}/integrations",
                headers=self.headers
            )

            if response.status_code != 200:
                logger.error(f"Failed to fetch integrations: {response.status_code} - {response.text}")
                raise Exception(f"Postiz API error: {response.status_code}")

            data = response.json()
            integrations = []

            for item in data:
                # Note: Postiz uses "identifier" for platform type (bluesky, x, instagram-standalone, etc.)
                platform_type = item.get("identifier", item.get("type", "unknown"))
                integrations.append(PostizIntegration(
                    id=item.get("id"),
                    name=item.get("name", "Unknown"),
                    type=platform_type,
                    identifier=item.get("profile"),  # username/handle
                    picture=item.get("picture"),
                    disabled=item.get("disabled", False)
                ))

            if profile_id:
                logger.info(f"[Profile {profile_id}] Fetched {len(integrations)} integrations from Postiz")
            else:
                logger.info(f"Fetched {len(integrations)} integrations from Postiz")
            return integrations

    async def upload_video(self, video_path: Path, profile_id: Optional[str] = None) -> PostizMedia:
        """
        Upload a video file to Postiz.

        Args:
            video_path: Path to the video file
            profile_id: Optional profile ID for logging context

        Returns:
            PostizMedia object with id and path for use in create_post
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        file_size = video_path.stat().st_size
        upload_url = f"{self.api_url}/upload"
        if profile_id:
            logger.info(f"[Profile {profile_id}] Uploading video to Postiz: {video_path.name} ({file_size / 1024 / 1024:.2f} MB)")
        else:
            logger.info(f"Uploading video to Postiz: {video_path.name} ({file_size / 1024 / 1024:.2f} MB)")
        logger.info(f"Upload URL: {upload_url}")

        # Determine content type based on file extension
        ext = video_path.suffix.lower()
        content_type_map = {
            ".mp4": "video/mp4",
            ".mov": "video/quicktime",
            ".avi": "video/x-msvideo",
            ".webm": "video/webm",
            ".mkv": "video/x-matroska",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".gif": "image/gif",
        }
        content_type = content_type_map.get(ext, "video/mp4")

        async with httpx.AsyncClient(timeout=300.0) as client:  # 5 min timeout for upload
            with open(video_path, "rb") as f:
                files = {"file": (video_path.name, f, content_type)}
                # Use Authorization header with Bearer prefix if needed
                headers = {"Authorization": self.api_key}

                logger.info(f"Sending request to Postiz with content-type: {content_type}")

                response = await client.post(
                    upload_url,
                    headers=headers,
                    files=files
                )

            logger.info(f"Postiz response status: {response.status_code}")

            if response.status_code not in [200, 201]:
                logger.error(f"Failed to upload video: {response.status_code} - {response.text}")
                raise Exception(f"Postiz upload error: {response.status_code} - {response.text[:500]}")

            try:
                data = response.json()
            except Exception as e:
                logger.error(f"Failed to parse Postiz response: {e}, raw: {response.text[:500]}")
                raise Exception(f"Invalid Postiz response: {response.text[:200]}")

            media = PostizMedia(
                id=data.get("id", ""),
                path=data.get("path", "")
            )

            if profile_id:
                logger.info(f"[Profile {profile_id}] Uploaded video to Postiz: id={media.id}")
            else:
                logger.info(f"Uploaded video to Postiz: id={media.id}, path={media.path}")
            return media

    def _get_platform_settings(self, platform_type: str) -> Dict[str, Any]:
        """Get platform-specific settings for post creation."""
        settings_map = {
            "x": {"community": "", "who_can_reply_post": "everyone"},
            "twitter": {"community": "", "who_can_reply_post": "everyone"},
            "instagram": {"post_type": "post"},
            "instagram-standalone": {"post_type": "post"},
            "linkedin": {"title": "", "visibility": "PUBLIC", "reshareDisabled": False, "commentingDisabled": False},
            "linkedin-page": {"title": "", "visibility": "PUBLIC", "reshareDisabled": False, "commentingDisabled": False},
            "bluesky": {"title": ""},
            "threads": {"title": ""},
            "facebook": {"title": "", "post_as_story": False},
            "tiktok": {},
            "youtube": {"title": "", "visibility": "public"}
        }
        return settings_map.get(platform_type.lower(), {})

    async def create_post(
        self,
        media_id: str,
        media_path: str,
        caption: str,
        integration_ids: List[str],
        schedule_date: Optional[datetime] = None,
        integrations_info: Optional[Dict[str, str]] = None,
        profile_id: Optional[str] = None
    ) -> PublishResult:
        """
        Create a post on selected platforms.

        Args:
            media_id: Media ID from upload_video
            media_path: Media path from upload_video
            caption: Post caption/description
            integration_ids: List of integration IDs to post to
            schedule_date: Optional datetime to schedule post (None = post now)
            integrations_info: Dict mapping integration_id to platform type for settings
            profile_id: Optional profile ID for logging context

        Returns:
            PublishResult with success status and post details
        """
        if not integration_ids:
            raise ValueError("At least one integration must be selected")

        integrations_info = integrations_info or {}

        # Build posts array for each integration
        posts = []
        for int_id in integration_ids:
            platform_type = integrations_info.get(int_id, "")
            settings = self._get_platform_settings(platform_type)

            posts.append({
                "integration": {"id": int_id},
                "value": [{
                    "content": caption,
                    "image": [{"id": media_id, "path": media_path}]
                }],
                "settings": settings
            })

        # Build request body
        body: Dict[str, Any] = {
            "type": "schedule" if schedule_date else "now",
            "tags": [],
            "shortLink": False,
            "posts": posts
        }

        if schedule_date:
            body["date"] = schedule_date.isoformat()

        if profile_id:
            logger.info(f"[Profile {profile_id}] Creating Postiz post for {len(integration_ids)} platforms")
        else:
            logger.info(f"Creating Postiz post for {len(integration_ids)} platforms, scheduled: {schedule_date}")

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.api_url}/posts",
                headers={**self.headers, "Content-Type": "application/json"},
                json=body
            )

            if response.status_code not in [200, 201]:
                if profile_id:
                    logger.error(f"[Profile {profile_id}] Failed to create post: {response.status_code} - {response.text}")
                else:
                    logger.error(f"Failed to create post: {response.status_code} - {response.text}")
                return PublishResult(
                    success=False,
                    error=f"Postiz API error: {response.status_code} - {response.text[:200]}"
                )

            data = response.json()

            if profile_id:
                logger.info(f"[Profile {profile_id}] Created Postiz post: {data.get('id')}")
            else:
                logger.info(f"Created Postiz post successfully: {data}")
            return PublishResult(
                success=True,
                post_id=data.get("id"),
                scheduled_date=schedule_date.isoformat() if schedule_date else None,
                platforms=[integrations_info.get(i, "unknown") for i in integration_ids]
            )


# Profile-aware factory pattern with instance caching
_postiz_instances: Dict[str, PostizPublisher] = {}


def get_postiz_publisher(profile_id: str) -> PostizPublisher:
    """
    Get Postiz publisher instance for specific profile.

    Args:
        profile_id: Profile UUID to load credentials for

    Returns:
        PostizPublisher configured with profile's Postiz credentials

    Raises:
        ValueError: If profile has no Postiz credentials configured
    """
    global _postiz_instances

    # Return cached instance if exists
    if profile_id in _postiz_instances:
        return _postiz_instances[profile_id]

    # Load profile's Postiz settings from database
    supabase = get_supabase()
    api_url = None
    api_key = None

    if supabase:
        try:
            result = supabase.table("profiles")\
                .select("tts_settings")\
                .eq("id", profile_id)\
                .single()\
                .execute()

            if result.data:
                tts_settings = result.data.get("tts_settings") or {}
                postiz_config = tts_settings.get("postiz") or {}
                api_url = postiz_config.get("api_url")
                api_key = postiz_config.get("api_key")
                logger.info(f"[Profile {profile_id}] Loaded Postiz config from database")
        except Exception as e:
            logger.warning(f"[Profile {profile_id}] Failed to load Postiz config: {e}")

    # Fallback to global env vars if profile doesn't have Postiz configured
    if not api_url:
        api_url = os.getenv("POSTIZ_API_URL")
    if not api_key:
        api_key = os.getenv("POSTIZ_API_KEY")

    if not api_url or not api_key:
        raise ValueError(
            f"Profile {profile_id} has no Postiz credentials configured. "
            "Configure in Settings page or set POSTIZ_API_URL and POSTIZ_API_KEY environment variables."
        )

    # Create and cache instance
    publisher = PostizPublisher(api_url=api_url, api_key=api_key)
    _postiz_instances[profile_id] = publisher
    logger.info(f"[Profile {profile_id}] Created Postiz publisher instance")

    return publisher


def reset_postiz_publisher(profile_id: Optional[str] = None):
    """
    Reset cached publisher instance(s).
    Call this when profile's Postiz credentials change.

    Args:
        profile_id: Reset specific profile's instance, or None to reset all
    """
    global _postiz_instances
    if profile_id:
        if profile_id in _postiz_instances:
            del _postiz_instances[profile_id]
            logger.info(f"[Profile {profile_id}] Reset Postiz publisher cache")
    else:
        _postiz_instances = {}
        logger.info("Reset all Postiz publisher caches")


def is_postiz_configured(profile_id: Optional[str] = None) -> bool:
    """
    Check if Postiz credentials are configured.

    Args:
        profile_id: Check specific profile's config, or None for global env vars

    Returns:
        True if Postiz API URL and key are configured
    """
    if profile_id:
        # Check profile's tts_settings.postiz
        supabase = get_supabase()
        if supabase:
            try:
                result = supabase.table("profiles")\
                    .select("tts_settings")\
                    .eq("id", profile_id)\
                    .single()\
                    .execute()

                if result.data:
                    tts_settings = result.data.get("tts_settings") or {}
                    postiz_config = tts_settings.get("postiz") or {}
                    api_url = postiz_config.get("api_url")
                    api_key = postiz_config.get("api_key")
                    if api_url and api_key:
                        return True
            except Exception:
                pass

        # Fall through to check global env vars

    # Check global env vars
    api_url = os.getenv("POSTIZ_API_URL", "")
    api_key = os.getenv("POSTIZ_API_KEY", "")
    return bool(api_url and api_key)
