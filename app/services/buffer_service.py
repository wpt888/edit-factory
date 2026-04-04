"""
Buffer Social Media Publishing Service.
Uses Buffer GraphQL API to publish videos (primarily TikTok).
Videos are uploaded to MinIO via HTTP PUT through the Kong API gateway,
which provides a public URL that Buffer can download from.
After Buffer ingests the video, it is deleted from MinIO.
"""
import os
import logging
import threading
import time
import uuid
import asyncio
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


def _truncate_response_body(body: str, limit: int = 300) -> str:
    """Keep third-party error payloads short and log-safe."""
    compact = " ".join((body or "").split())
    if not compact:
        return "<empty>"
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit]}..."


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
        1. Upload video to MinIO/S3 (public URL)
        2. Create post via Buffer GraphQL with that URL
        3. Poll post status until sent
        4. Delete video from MinIO/S3
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
        Upload video to MinIO via HTTP PUT through the Kong gateway.

        Returns (object_key, public_url).
        The MinIO bucket has public anonymous access, so no S3 auth is needed.
        Kong proxies /s3/* → MinIO:9000/* on the same Docker network.
        """
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        settings = get_settings()
        base_url = settings.minio_public_url.rstrip("/")
        if not base_url:
            raise ValueError(
                "MINIO_PUBLIC_URL not configured. "
                "Set it to the Kong S3 proxy URL, e.g. https://supabase.nortia.ro/s3/buffer-videos"
            )

        file_size_mb = video_path.stat().st_size / 1024 / 1024
        object_key = f"{uuid.uuid4().hex}{video_path.suffix.lower() or '.mp4'}"
        upload_url = f"{base_url}/{object_key}"

        logger.info(f"Uploading {video_path.name} ({file_size_mb:.1f}MB) to MinIO: {upload_url}")

        with open(video_path, "rb") as f:
            resp = httpx.put(
                upload_url,
                content=f,
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Length": str(video_path.stat().st_size),
                    "Content-Disposition": f'inline; filename="{video_path.name}"',
                    "Cache-Control": "public, max-age=86400",
                },
                timeout=300.0,
            )

        if resp.status_code not in (200, 201):
            body_preview = _truncate_response_body(resp.text)
            raise Exception(f"MinIO upload failed: HTTP {resp.status_code} - {body_preview}")

        diagnostics = self.verify_public_video_url(
            upload_url,
            expected_size=video_path.stat().st_size,
        )
        logger.info(f"Uploaded to MinIO: {upload_url}")
        logger.info(
            "Verified Buffer video URL: status=%s, content_type=%s, content_length=%s, accept_ranges=%s",
            diagnostics.get("status_code"),
            diagnostics.get("content_type"),
            diagnostics.get("content_length"),
            diagnostics.get("accept_ranges"),
        )
        return object_key, upload_url

    def verify_public_video_url(self, public_url: str, expected_size: Optional[int] = None) -> Dict[str, Any]:
        """
        Verify that the uploaded object is reachable as a public video URL.

        Some storage proxies do not respond correctly to HEAD, so we fall back to
        a ranged GET to confirm third-party fetchability before asking Buffer to
        ingest the asset.
        """
        timeout = httpx.Timeout(30.0, connect=10.0)
        last_error: Optional[str] = None

        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            try:
                response = client.head(public_url)
                if response.status_code == 200:
                    return _validate_public_video_response(response, expected_size)
                last_error = f"HEAD returned HTTP {response.status_code}"
            except Exception as exc:
                last_error = f"HEAD failed: {exc}"

            try:
                response = client.get(
                    public_url,
                    headers={"Range": "bytes=0-0"},
                )
                if response.status_code in (200, 206):
                    return _validate_public_video_response(response, expected_size)
                last_error = f"Range GET returned HTTP {response.status_code}"
            except Exception as exc:
                last_error = f"Range GET failed: {exc}"

        raise Exception(f"Public video URL verification failed for {public_url}: {last_error}")

    def delete_from_storage(self, storage_path: str) -> bool:
        """Delete a video from MinIO via HTTP DELETE through the Kong gateway."""
        try:
            settings = get_settings()
            base_url = settings.minio_public_url.rstrip("/")
            delete_url = f"{base_url}/{storage_path}"

            resp = httpx.delete(delete_url, timeout=30.0)
            if resp.status_code in (200, 204):
                logger.info(f"Deleted from MinIO: {storage_path}")
                return True
            else:
                logger.warning(f"MinIO delete returned {resp.status_code} for {storage_path}")
                return False
        except Exception as e:
            logger.warning(f"Failed to delete {storage_path} from MinIO: {e}")
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
            # Convert to UTC before formatting — Buffer expects UTC with Z suffix
            from datetime import timezone as tz
            utc_date = schedule_date.astimezone(tz.utc)
            due_at = utc_date.strftime("%Y-%m-%dT%H:%M:%S.000Z")
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
        Best-effort early cleanup: poll post status and delete video once Buffer
        has ingested it. If the app shuts down before this completes, the MinIO
        lifecycle policy (7-day auto-expiry) handles cleanup on the server side.
        """
        elapsed = 0
        while elapsed < max_wait:
            try:
                status = await self.get_post_status(post_id)
                post_status = status.get("status", "")
                is_processing = status.get("is_processing", False)

                if post_status in ("sent", "error"):
                    logger.info(f"Post {post_id} reached final status '{post_status}', cleaning up storage")
                    self.delete_from_storage(storage_path)
                    return

                if post_status in ("scheduled", "sending") and not is_processing:
                    logger.info(f"Post {post_id} is '{post_status}' and video processed, cleaning up storage")
                    self.delete_from_storage(storage_path)
                    return

            except Exception as e:
                logger.warning(f"Error polling post {post_id}: {e}")

            await _async_sleep(poll_interval)
            elapsed += poll_interval

        # Timeout — don't force-delete; the video might still be needed for a
        # scheduled post days from now. MinIO lifecycle will clean it up in 7 days.
        logger.info(f"Post {post_id} cleanup timeout after {max_wait}s — MinIO lifecycle will handle expiry")


    def schedule_cleanup_monitor(self, post_id: str, storage_path: str, max_wait: int = 7200, poll_interval: int = 30):
        """
        Start a best-effort monitor that deletes the storage object only after
        Buffer indicates the media finished processing.
        """
        if not post_id or not storage_path:
            return

        def _runner():
            try:
                asyncio.run(self.wait_and_cleanup(
                    post_id=post_id,
                    storage_path=storage_path,
                    max_wait=max_wait,
                    poll_interval=poll_interval,
                ))
            except Exception as exc:
                logger.warning(f"Cleanup monitor failed for post {post_id}: {exc}")

        thread = threading.Thread(
            target=_runner,
            name=f"buffer-cleanup-{post_id[:8]}",
            daemon=True,
        )
        thread.start()
        logger.info(f"Started Buffer cleanup monitor for post {post_id}")


def _gql_string(s: str) -> str:
    """Escape a string for inline GraphQL."""
    escaped = s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "")
    return f'"{escaped}"'


async def _async_sleep(seconds: int):
    """Async sleep helper."""
    await asyncio.sleep(seconds)


def _validate_public_video_response(response: httpx.Response, expected_size: Optional[int] = None) -> Dict[str, Any]:
    """Validate the key response headers on the public video URL."""
    headers = response.headers
    content_type = (headers.get("content-type") or "").split(";")[0].strip().lower()
    content_length = headers.get("content-length")
    accept_ranges = headers.get("accept-ranges")

    if content_type and not (content_type.startswith("video/") or content_type == "application/octet-stream"):
        raise Exception(f"Unexpected Content-Type for public video URL: {content_type}")

    if expected_size is not None and content_length:
        try:
            actual_size = int(content_length)
            if actual_size <= 0:
                raise Exception("Content-Length is zero")
            if response.status_code == 200 and actual_size != expected_size:
                logger.warning(
                    "Public video URL size mismatch: expected=%s actual=%s",
                    expected_size,
                    actual_size,
                )
        except ValueError:
            logger.warning(f"Invalid Content-Length header on public video URL: {content_length}")

    return {
        "status_code": response.status_code,
        "content_type": content_type or None,
        "content_length": content_length,
        "accept_ranges": accept_ranges,
    }


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
