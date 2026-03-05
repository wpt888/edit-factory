"""
Postiz Social Media Publishing Service.
Handles video uploads and post scheduling via Postiz API.
"""
import os
import logging
import threading
import time
import httpx
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
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

    API_BASE_PATH = "/api/public/v1"

    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None
    ):
        raw_url = (api_url or os.getenv("POSTIZ_API_URL", "")).rstrip("/")
        self.api_key = api_key or os.getenv("POSTIZ_API_KEY", "")

        if not raw_url:
            raise ValueError("POSTIZ_API_URL is required")
        if not self.api_key:
            raise ValueError("POSTIZ_API_KEY is required")

        # Normalize: accept domain-only, domain/api/public/v1, or domain/public/v1
        if raw_url.endswith("/api/public/v1"):
            self.base_url = raw_url.removesuffix("/api/public/v1")
        elif raw_url.endswith("/public/v1"):
            self.base_url = raw_url.removesuffix("/public/v1")
        else:
            self.base_url = raw_url

        self.api_url = f"{self.base_url}{self.API_BASE_PATH}"

        self.headers = {
            "Authorization": self.api_key,
            "Accept": "application/json"
        }

        logger.info(f"PostizPublisher initialized with base: {self.base_url}, API: {self.api_url}")

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
        profile_id: Optional[str] = None,
        captions_per_platform: Optional[Dict[str, str]] = None
    ) -> PublishResult:
        """
        Create a post on selected platforms.

        Args:
            media_id: Media ID from upload_video
            media_path: Media path from upload_video
            caption: Post caption/description (default for all platforms)
            integration_ids: List of integration IDs to post to
            schedule_date: Optional datetime to schedule post (None = post now)
            integrations_info: Dict mapping integration_id to platform type for settings
            profile_id: Optional profile ID for logging context
            captions_per_platform: Optional dict mapping integration_id to specific caption

        Returns:
            PublishResult with success status and post details
        """
        if not integration_ids:
            raise ValueError("At least one integration must be selected")

        integrations_info = integrations_info or {}
        captions_per_platform = captions_per_platform or {}

        # Build posts array for each integration
        posts = []
        for int_id in integration_ids:
            platform_type = integrations_info.get(int_id, "")
            settings = self._get_platform_settings(platform_type)
            # Use platform-specific caption if provided, otherwise fall back to default
            post_caption = captions_per_platform.get(int_id, caption)

            posts.append({
                "integration": {"id": int_id},
                "value": [{
                    "content": post_caption,
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

            try:
                data = response.json()
            except Exception as e:
                logger.error(f"Failed to parse Postiz create_post response: {e}, raw: {response.text[:500]}")
                return PublishResult(
                    success=False,
                    error=f"Postiz returned invalid JSON: {response.text[:200]}"
                )

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


    async def get_post_status(self, post_id: str, profile_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Get the status of a published post from Postiz API.

        Args:
            post_id: The Postiz post ID
            profile_id: Optional profile ID for logging context

        Returns:
            Dict with post status info (state, platforms, scheduled date, etc.)
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.api_url}/posts/{post_id}",
                headers=self.headers
            )

            if response.status_code == 404:
                return {"status": "not_found", "post_id": post_id}

            if response.status_code != 200:
                logger.error(f"Failed to get post status: {response.status_code} - {response.text}")
                return {"status": "error", "post_id": post_id, "error": f"API error: {response.status_code}"}

            data = response.json()
            # integration can be a list of dicts or a single dict
            integration_raw = data.get("integration", [])
            if isinstance(integration_raw, dict):
                integration_raw = [integration_raw]
            platforms = [
                p.get("identifier", "unknown")
                for p in integration_raw
                if isinstance(p, dict)
            ]
            return {
                "status": "found",
                "post_id": post_id,
                "state": data.get("state", "unknown"),
                "scheduled_date": data.get("publishDate"),
                "platforms": platforms,
            }


# Profile-aware factory pattern with instance caching + TTL
_postiz_instances: Dict[str, Tuple[PostizPublisher, float]] = {}  # profile_id -> (instance, created_at)
_postiz_lock = threading.Lock()
_POSTIZ_CACHE_TTL = 300  # 5 minutes
_MAX_POSTIZ_INSTANCES = 100


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

    # Return cached instance if exists and not expired
    with _postiz_lock:
        if profile_id in _postiz_instances:
            instance, created_at = _postiz_instances[profile_id]
            if (time.time() - created_at) < _POSTIZ_CACHE_TTL:
                return instance
            else:
                logger.debug(f"[Profile {profile_id}] Postiz cache expired, recreating")
                del _postiz_instances[profile_id]

    # Load profile's Postiz settings from database (outside lock — DB call is slow)
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
                if api_url and api_key:
                    logger.info(f"[Profile {profile_id}] Loaded Postiz config from database")
                else:
                    logger.debug(f"[Profile {profile_id}] Profile found but Postiz credentials not set")
        except Exception as e:
            logger.warning(f"[Profile {profile_id}] Failed to load Postiz config: {e}")

    if not api_url or not api_key:
        raise ValueError(
            f"Profile {profile_id} has no Postiz credentials configured. "
            "Configurează Postiz în Settings."
        )

    # Create and cache instance with timestamp
    publisher = PostizPublisher(api_url=api_url, api_key=api_key)
    with _postiz_lock:
        # Evict oldest entry if cache is full
        if len(_postiz_instances) >= _MAX_POSTIZ_INSTANCES:
            oldest_key = next(iter(_postiz_instances))
            _postiz_instances.pop(oldest_key, None)

        _postiz_instances[profile_id] = (publisher, time.time())

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
    with _postiz_lock:
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
        # Fast path: if we already have a cached instance, it's configured
        if profile_id in _postiz_instances:
            _, created_at = _postiz_instances[profile_id]
            if (time.time() - created_at) < _POSTIZ_CACHE_TTL:
                return True

        # Check profile's tts_settings.postiz
        supabase = get_supabase()
        if supabase:
            try:
                result = supabase.table("profiles")\
                    .select("tts_settings")\
                    .eq("id", profile_id)\
                    .limit(1)\
                    .execute()

                if result.data:
                    tts_settings = result.data[0].get("tts_settings") or {}
                    postiz_config = tts_settings.get("postiz") or {}
                    api_url = postiz_config.get("api_url")
                    api_key = postiz_config.get("api_key")
                    if api_url and api_key:
                        return True
            except Exception:
                pass

    return False
