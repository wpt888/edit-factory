"""FAL AI image generation service using NanoBanana Pro model."""

import logging
import threading
import time
from pathlib import Path
from typing import Optional, Tuple

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

FAL_API_URL = "https://fal.run/fal-ai/nano-banana-pro"
FAL_COST_PER_IMAGE = 0.01  # approximate cost per generation


class FalImageGenerator:
    """Client for FAL AI image generation."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._client = httpx.Client(
            timeout=httpx.Timeout(120.0, connect=10.0),
            headers={
                "Authorization": f"Key {api_key}",
                "Content-Type": "application/json",
            },
        )

    def generate(
        self,
        prompt: str,
        aspect_ratio: str = "1:1",
        num_images: int = 1,
    ) -> dict:
        """Generate image(s) via FAL AI.

        Returns dict with 'images' list containing {url, content_type} items.
        """
        payload = {
            "prompt": prompt,
            "num_images": num_images,
            "image_size": self._aspect_to_size(aspect_ratio),
        }

        logger.info(f"FAL generate: aspect={aspect_ratio}, prompt={prompt[:80]}...")

        response = self._client.post(FAL_API_URL, json=payload)
        response.raise_for_status()
        data = response.json()

        logger.info(f"FAL returned {len(data.get('images', []))} image(s)")
        return data

    def download_image(self, url: str, dest_path: str) -> str:
        """Download generated image from FAL CDN to local path."""
        dest = Path(dest_path)
        dest.parent.mkdir(parents=True, exist_ok=True)

        response = self._client.get(url)
        response.raise_for_status()

        dest.write_bytes(response.content)
        logger.info(f"Downloaded FAL image to {dest_path}")
        return str(dest)

    def close(self):
        self._client.close()

    @staticmethod
    def _aspect_to_size(aspect_ratio: str) -> str:
        """Map aspect ratio string to FAL size parameter."""
        mapping = {
            "1:1": "square",
            "9:16": "portrait_16_9",
            "16:9": "landscape_16_9",
            "4:3": "landscape_4_3",
            "3:4": "portrait_4_3",
        }
        return mapping.get(aspect_ratio, "square")


# --- Singleton factory ---

_fal_instance: Optional[Tuple[FalImageGenerator, float]] = None
_fal_lock = threading.Lock()
_FAL_CACHE_TTL = 600  # 10 minutes


def get_fal_generator() -> FalImageGenerator:
    """Get singleton FAL image generator instance."""
    global _fal_instance

    if _fal_instance is not None:
        instance, created_at = _fal_instance
        if (time.time() - created_at) < _FAL_CACHE_TTL:
            return instance

    settings = get_settings()
    if not settings.fal_api_key:
        raise ValueError("FAL_API_KEY not configured")

    with _fal_lock:
        # Double-check after acquiring lock
        if _fal_instance is not None:
            instance, created_at = _fal_instance
            if (time.time() - created_at) < _FAL_CACHE_TTL:
                return instance
            instance.close()

        gen = FalImageGenerator(api_key=settings.fal_api_key)
        _fal_instance = (gen, time.time())
        return gen
