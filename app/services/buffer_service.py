"""
Buffer Social Media Publishing Service.
Uses Buffer GraphQL API to publish videos (primarily TikTok).
Videos are temporarily uploaded to Supabase Storage to provide
a public URL that Buffer can download from, then cleaned up after posting.
"""
import os
import logging
import threading
import time
import uuid
import httpx
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime

from app.db import get_supabase
from app.config import get_settings
from app.repositories.factory import get_repository

logger = logging.getLogger(__name__)

BUFFER_GRAPHQL_URL = "https://api.buffer.com/graphql"
SUPABASE_BUCKET = "buffer-videos"


@dataclass
class BufferChannel:
    """A connected social media channel in Buffer."""
    id: str
    name: str
    service: str  # tiktok, instagram, facebook, etc.
    type: str  # account, page, business
    avatar: Optional[str] = None
    is_disconnected: bool = False


@dataclass
class BufferPostResult:
    """Result of a Buffer publish operation."""
    success: bool
    post_id: Optional[str] = None
    status: Optional[str] = None
    scheduled_date: Optional[str] = None
    channel_name: Optional[str] = None
    error: Optional[str] = None
    storage_path: Optional[str] = None  # Supabase Storage path for cleanup


class BufferPublisher:
    """
    Buffer GraphQL API client for social media publishing.

    Flow:
        1. Upload video to Supabase Storage (public URL)
        2. Create post via Buffer GraphQL with that URL
        3. Poll post status until sent
        4. Delete video from Supabase Storage
    """

    def __init__(
        self,
        api_key: str,
        organization_id: str,
    ):
        if not api_key:
            raise ValueError("Buffer API key is required")
        if not organization_id:
            raise ValueError("Buffer organization ID is required")

        self.api_key = api_key
        self.organization_id = organization_id
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        logger.info(f"BufferPublisher initialized (org: {organization_id[:8]}...)")

    async def _graphql(self, query: str, variables: Optional[Dict] = None, timeout: float = 30.0) -> Dict[str, Any]:
        """Execute a GraphQL request against Buffer API."""
        payload: Dict[str, Any] = {"query": query}
        if variables:
            payload["variables"] = variables

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                BUFFER_GRAPHQL_URL,
                headers=self.headers,
                json=payload,
            )

            if response.status_code == 429:
                retry_after = response.headers.get("retryAfter", "60")
                raise Exception(f"Buffer rate limit hit. Retry after {retry_after}s")

            if response.status_code != 200:
                raise Exception(f"Buffer API error {response.status_code}: {response.text[:300]}")

            data = response.json()
            if "errors" in data:
                error_msg = data["errors"][0].get("message", "Unknown GraphQL error")
                raise Exception(f"Buffer GraphQL error: {error_msg}")

            return data.get("data", {})

    async def get_channels(self) -> List[BufferChannel]:
        """Fetch all connected channels for this organization."""
        query = """
        query GetChannels($orgId: OrganizationId!) {
            channels(input: { organizationId: $orgId }) {
                id
                name
                service
                type
                avatar
                isDisconnected
            }
        }
        """
        data = await self._graphql(query, {"orgId": self.organization_id})
        channels = []
        for ch in data.get("channels", []):
            channels.append(BufferChannel(
                id=ch["id"],
                name=ch.get("name", "Unknown"),
                service=ch.get("service", "unknown"),
                type=ch.get("type", "unknown"),
                avatar=ch.get("avatar"),
                is_disconnected=ch.get("isDisconnected", False),
            ))
        logger.info(f"Fetched {len(channels)} Buffer channels")
        return channels

    async def get_daily_limits(self, channel_ids: List[str]) -> List[Dict[str, Any]]:
        """Check daily posting limits for channels."""
        query = """
        query CheckLimits($channelIds: [ChannelId!]!) {
            dailyPostingLimits(input: { channelIds: $channelIds }) {
                channelId
                sent
                scheduled
                limit
                isAtLimit
            }
        }
        """
        data = await self._graphql(query, {"channelIds": channel_ids})
        return data.get("dailyPostingLimits", [])

    def upload_to_storage(self, video_path: Path) -> Tuple[str, str]:
        """
        Upload video to Supabase Storage and return (storage_path, public_url).

        Uses a unique filename to avoid collisions.
        """
        sb = get_supabase()
        if not sb:
            raise Exception("Supabase client not available")

        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        ext = video_path.suffix.lower() or ".mp4"
        unique_name = f"{uuid.uuid4().hex}{ext}"
        file_size_mb = video_path.stat().st_size / 1024 / 1024

        logger.info(f"Uploading {video_path.name} ({file_size_mb:.1f}MB) to Supabase Storage as {unique_name}")

        content_types = {
            ".mp4": "video/mp4",
            ".mov": "video/quicktime",
            ".webm": "video/webm",
        }
        content_type = content_types.get(ext, "video/mp4")

        with open(video_path, "rb") as f:
            sb.storage.from_(SUPABASE_BUCKET).upload(
                path=unique_name,
                file=f,
                file_options={"content-type": content_type},
            )

        settings = get_settings()
        public_url = f"{settings.supabase_url}/storage/v1/object/public/{SUPABASE_BUCKET}/{unique_name}"

        logger.info(f"Uploaded to Storage: {public_url}")
        return unique_name, public_url

    def delete_from_storage(self, storage_path: str) -> bool:
        """Delete a video from Supabase Storage after Buffer has processed it."""
        sb = get_supabase()
        if not sb:
            logger.warning("Cannot delete from storage: Supabase not available")
            return False

        try:
            sb.storage.from_(SUPABASE_BUCKET).remove([storage_path])
            logger.info(f"Deleted from Storage: {storage_path}")
            return True
        except Exception as e:
            logger.warning(f"Failed to delete from Storage: {storage_path} - {e}")
            return False

    async def create_post(
        self,
        video_url: str,
        channel_id: str,
        caption: str,
        schedule_date: Optional[datetime] = None,
        tiktok_title: Optional[str] = None,
        thumbnail_url: Optional[str] = None,
    ) -> BufferPostResult:
        """
        Create a post on Buffer with a video.

        Args:
            video_url: Public URL to the video file
            channel_id: Buffer channel ID to post to
            caption: Post text/caption
            schedule_date: When to publish (None = add to queue)
            tiktok_title: Optional TikTok-specific title
            thumbnail_url: Optional thumbnail URL
        """
        # Build mode and timing
        if schedule_date:
            mode = "customScheduled"
            due_at = schedule_date.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        else:
            mode = "shareNow"
            due_at = None

        # Build metadata
        metadata_parts = []
        if tiktok_title:
            metadata_parts.append(f'tiktok: {{ title: "{tiktok_title}" }}')

        metadata_str = ""
        if metadata_parts:
            metadata_str = f"metadata: {{ {', '.join(metadata_parts)} }},"

        # Build video asset
        video_asset = f'{{ url: "{video_url}"'
        if thumbnail_url:
            video_asset += f', thumbnailUrl: "{thumbnail_url}"'
        video_asset += " }"

        # Build dueAt param
        due_at_str = f', dueAt: "{due_at}"' if due_at else ""

        query = f"""
        mutation CreatePost {{
            createPost(input: {{
                text: {_gql_string(caption)},
                channelId: "{channel_id}",
                schedulingType: automatic,
                mode: {mode}
                {due_at_str}
                {metadata_str}
                assets: {{
                    videos: [{video_asset}]
                }}
            }}) {{
                ... on PostActionSuccess {{
                    post {{
                        id
                        text
                        status
                        dueAt
                    }}
                }}
                ... on InvalidInputError {{ message }}
                ... on LimitReachedError {{ message }}
                ... on UnauthorizedError {{ message }}
                ... on UnexpectedError {{ message }}
                ... on NotFoundError {{ message }}
            }}
        }}
        """

        data = await self._graphql(query, timeout=60.0)
        result = data.get("createPost", {})

        # Check for error types
        if "message" in result:
            return BufferPostResult(
                success=False,
                error=result["message"],
            )

        post = result.get("post", {})
        return BufferPostResult(
            success=True,
            post_id=post.get("id"),
            status=post.get("status"),
            scheduled_date=post.get("dueAt"),
        )

    async def get_post_status(self, post_id: str) -> Dict[str, Any]:
        """Check the status of a Buffer post."""
        query = """
        query GetPost($postId: PostId!) {
            post(input: { id: $postId }) {
                id
                status
                dueAt
                sentAt
                error {
                    message
                }
                assets {
                    ... on VideoAsset {
                        video {
                            isVideoProcessing
                        }
                    }
                }
            }
        }
        """
        data = await self._graphql(query, {"postId": post_id})
        post = data.get("post", {})
        error = post.get("error")
        return {
            "post_id": post_id,
            "status": post.get("status", "unknown"),
            "due_at": post.get("dueAt"),
            "sent_at": post.get("sentAt"),
            "error": error.get("message") if error else None,
            "is_processing": any(
                a.get("video", {}).get("isVideoProcessing", False)
                for a in post.get("assets", [])
                if isinstance(a, dict) and "video" in a
            ),
        }

    async def wait_and_cleanup(self, post_id: str, storage_path: str, max_wait: int = 600, poll_interval: int = 15):
        """
        Poll post status and delete video from Storage once Buffer has processed it.

        Called as a background task after post creation.
        """
        elapsed = 0
        while elapsed < max_wait:
            try:
                status = await self.get_post_status(post_id)
                post_status = status.get("status", "")
                is_processing = status.get("is_processing", False)

                # Buffer has downloaded the video once status moves past 'draft'
                # Safe to delete once it's 'scheduled', 'sending', or 'sent'
                if post_status in ("sent", "error"):
                    logger.info(f"Post {post_id} reached final status '{post_status}', cleaning up storage")
                    self.delete_from_storage(storage_path)
                    return

                if post_status in ("scheduled", "sending") and not is_processing:
                    # Video has been ingested by Buffer, safe to delete
                    logger.info(f"Post {post_id} is '{post_status}' and video processed, cleaning up storage")
                    self.delete_from_storage(storage_path)
                    return

            except Exception as e:
                logger.warning(f"Error polling post {post_id}: {e}")

            await _async_sleep(poll_interval)
            elapsed += poll_interval

        # Timeout: clean up anyway to avoid storage bloat
        logger.warning(f"Post {post_id} cleanup timeout after {max_wait}s, deleting from storage anyway")
        self.delete_from_storage(storage_path)


def _gql_string(s: str) -> str:
    """Escape a string for inline GraphQL."""
    escaped = s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "")
    return f'"{escaped}"'


async def _async_sleep(seconds: int):
    """Async sleep helper."""
    import asyncio
    await asyncio.sleep(seconds)


# ── Profile-aware factory with instance caching ──

_buffer_instances: Dict[str, Tuple[BufferPublisher, float]] = {}
_buffer_lock = threading.Lock()
_BUFFER_CACHE_TTL = 300  # 5 minutes
_MAX_BUFFER_INSTANCES = 100


def get_buffer_publisher(profile_id: str) -> BufferPublisher:
    """
    Get Buffer publisher instance for a profile.

    Credentials are stored in profile.tts_settings.buffer:
        { "api_key": "...", "organization_id": "..." }
    """
    global _buffer_instances

    with _buffer_lock:
        if profile_id in _buffer_instances:
            instance, created_at = _buffer_instances[profile_id]
            if (time.time() - created_at) < _BUFFER_CACHE_TTL:
                return instance
            del _buffer_instances[profile_id]

    repo = get_repository()
    api_key = None
    org_id = None

    if repo:
        try:
            profile = repo.get_profile(profile_id)
            if profile:
                tts_settings = profile.get("tts_settings") or {}
                buffer_config = tts_settings.get("buffer") or {}
                api_key = buffer_config.get("api_key")
                org_id = buffer_config.get("organization_id")
                if api_key and org_id:
                    logger.info(f"[Profile {profile_id}] Loaded Buffer config from database")
        except Exception as e:
            logger.warning(f"[Profile {profile_id}] Failed to load Buffer config: {e}")

    if not api_key or not org_id:
        raise ValueError(
            f"Profile {profile_id} has no Buffer credentials configured. "
            "Configurează Buffer în Settings."
        )

    publisher = BufferPublisher(api_key=api_key, organization_id=org_id)
    with _buffer_lock:
        if profile_id in _buffer_instances:
            instance, created_at = _buffer_instances[profile_id]
            if (time.time() - created_at) < _BUFFER_CACHE_TTL:
                return instance
        if len(_buffer_instances) >= _MAX_BUFFER_INSTANCES:
            oldest_key = next(iter(_buffer_instances))
            _buffer_instances.pop(oldest_key, None)
        _buffer_instances[profile_id] = (publisher, time.time())

    return publisher


def reset_buffer_publisher(profile_id: Optional[str] = None):
    """Reset cached publisher instance(s) when credentials change."""
    global _buffer_instances
    with _buffer_lock:
        if profile_id:
            _buffer_instances.pop(profile_id, None)
            logger.info(f"[Profile {profile_id}] Reset Buffer publisher cache")
        else:
            _buffer_instances = {}
            logger.info("Reset all Buffer publisher caches")


def is_buffer_configured(profile_id: Optional[str] = None) -> bool:
    """Check if Buffer credentials are configured for a profile."""
    if profile_id:
        with _buffer_lock:
            if profile_id in _buffer_instances:
                _, created_at = _buffer_instances[profile_id]
                if (time.time() - created_at) < _BUFFER_CACHE_TTL:
                    return True

        repo = get_repository()
        if repo:
            try:
                profile = repo.get_profile(profile_id)
                if profile:
                    tts_settings = profile.get("tts_settings") or {}
                    buffer_config = tts_settings.get("buffer") or {}
                    if buffer_config.get("api_key") and buffer_config.get("organization_id"):
                        return True
            except Exception:
                pass

    return False
