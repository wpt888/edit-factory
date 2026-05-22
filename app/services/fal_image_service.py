"""FAL AI image generation service with multi-model support."""

import logging
import threading
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_settings

logger = logging.getLogger(__name__)

# ============== Model Configurations ==============

MODEL_CONFIGS = {
    "nano-banana": {
        "fal_model_id": "fal-ai/nano-banana",
        "url": "https://fal.run/fal-ai/nano-banana",
        "display_name": "NanoBanana",
        "aspect_ratios": ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"],
        "resolutions": [],  # Does not support resolution parameter
        "default_resolution": None,
        "param_style": "image_size",  # Uses image_size mapped from aspect ratio
        "cost_per_image": {
            "default": 0.04,
        },
    },
    "nano-banana-2": {
        "fal_model_id": "fal-ai/nano-banana-2",
        "url": "https://fal.run/fal-ai/nano-banana-2",
        "display_name": "NanoBanana 2",
        "aspect_ratios": ["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"],
        "resolutions": ["0.5K", "1K", "2K", "4K"],
        "default_resolution": "1K",
        "param_style": "aspect_ratio",  # Uses aspect_ratio string directly + resolution
        "cost_per_image": {
            "0.5K": 0.04,
            "1K": 0.08,
            "2K": 0.12,
            "4K": 0.16,
            "default": 0.08,
        },
    },
    "nano-banana-pro": {
        "fal_model_id": "fal-ai/nano-banana-pro",
        "url": "https://fal.run/fal-ai/nano-banana-pro",
        "display_name": "NanoBanana Pro",
        "aspect_ratios": ["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"],
        "resolutions": ["1K", "2K", "4K"],
        "default_resolution": "1K",
        "param_style": "aspect_ratio",  # Uses aspect_ratio string directly + resolution
        "cost_per_image": {
            "1K": 0.10,
            "2K": 0.15,
            "4K": 0.20,
            "default": 0.10,
        },
    },
}

DEFAULT_MODEL = "nano-banana-pro"

# Concurrency limiter — at most 3 concurrent FAL API calls
_fal_semaphore = threading.Semaphore(3)


def get_cost_for_model(model: str, resolution: Optional[str] = None) -> float:
    """Get the cost per image for a given model and resolution."""
    config = MODEL_CONFIGS.get(model, MODEL_CONFIGS[DEFAULT_MODEL])
    costs = config["cost_per_image"]
    if resolution and resolution in costs:
        return costs[resolution]
    return costs.get("default", 0.10)


class FalImageGenerator:
    """Client for FAL AI image generation with multi-model support."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._client = httpx.Client(
            timeout=httpx.Timeout(120.0, connect=10.0),
            headers={
                "Authorization": f"Key {api_key}",
                "Content-Type": "application/json",
            },
        )

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=30), reraise=True)
    def generate(
        self,
        prompt: str,
        aspect_ratio: str = "1:1",
        num_images: int = 1,
        model: str = DEFAULT_MODEL,
        resolution: Optional[str] = None,
        image_urls: Optional[list[str]] = None,
    ) -> dict:
        """Generate image(s) via FAL AI.

        Args:
            prompt: The image generation prompt.
            aspect_ratio: Desired aspect ratio (e.g. "1:1", "9:16").
            num_images: Number of images to generate.
            model: Model key from MODEL_CONFIGS.
            resolution: Resolution for models that support it (e.g. "1K", "2K", "4K").
            image_urls: Reference image URLs. When provided, uses the /edit endpoint.

        Returns:
            dict with 'images' list containing {url, content_type} items.
        """
        config = MODEL_CONFIGS.get(model)
        if not config:
            logger.warning(f"Unknown model '{model}', falling back to {DEFAULT_MODEL}")
            config = MODEL_CONFIGS[DEFAULT_MODEL]
            model = DEFAULT_MODEL

        # Use /edit endpoint when reference images are provided
        if image_urls:
            api_url = config["url"] + "/edit"
        else:
            api_url = config["url"]

        # Build payload based on model's param_style
        payload = {
            "prompt": prompt,
            "num_images": num_images,
        }

        # Add reference images for edit mode
        if image_urls:
            payload["image_urls"] = image_urls

        if config["param_style"] == "image_size":
            # NanoBanana v1: uses image_size mapped from aspect ratio
            payload["image_size"] = self._aspect_to_size(aspect_ratio)
        elif config["param_style"] == "aspect_ratio":
            # NanoBanana 2 & Pro: uses aspect_ratio string directly + resolution
            payload["aspect_ratio"] = aspect_ratio

            # Resolve resolution
            effective_resolution = resolution or config["default_resolution"]
            if effective_resolution:
                # Validate resolution is supported by this model
                if config["resolutions"] and effective_resolution not in config["resolutions"]:
                    logger.warning(
                        f"Resolution '{effective_resolution}' not supported by {model}, "
                        f"using default '{config['default_resolution']}'"
                    )
                    effective_resolution = config["default_resolution"]
                if effective_resolution:
                    payload["resolution"] = effective_resolution

        mode = "edit" if image_urls else "generate"
        logger.info(
            f"FAL {mode}: model={model}, aspect={aspect_ratio}, "
            f"resolution={payload.get('resolution', 'N/A')}, "
            f"ref_images={len(image_urls) if image_urls else 0}, "
            f"prompt={prompt[:80]}..."
        )

        with _fal_semaphore:
            try:
                response = self._client.post(api_url, json=payload)
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                logger.error(
                    f"FAL API error {exc.response.status_code}: {exc.response.text[:500]}"
                )
                raise
        data = response.json()

        logger.info(f"FAL returned {len(data.get('images', []))} image(s)")
        return data

    def download_image(self, url: str, dest_path: str) -> str:
        """Download generated image from FAL CDN to local path (streaming)."""
        dest = Path(dest_path)
        dest.parent.mkdir(parents=True, exist_ok=True)

        with self._client.stream("GET", url) as response:
            response.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in response.iter_bytes(65536):
                    f.write(chunk)
        logger.info(f"Downloaded FAL image to {dest_path}")
        return str(dest)

    def close(self):
        self._client.close()

    @staticmethod
    def _aspect_to_size(aspect_ratio: str) -> str:
        """Map aspect ratio string to FAL image_size parameter (NanoBanana v1 only)."""
        mapping = {
            "1:1": "square",
            "9:16": "portrait_16_9",
            "16:9": "landscape_16_9",
            "4:3": "landscape_4_3",
            "3:4": "portrait_4_3",
            "3:2": "landscape_4_3",
            "2:3": "portrait_4_3",
            "5:4": "square",
            "4:5": "square",
            "21:9": "landscape_16_9",
        }
        return mapping.get(aspect_ratio, "square")


# --- Singleton factory ---

_fal_instances: Dict[str, Tuple[FalImageGenerator, float]] = {}  # cache_key -> (instance, created_at)
_fal_lock = threading.Lock()
_FAL_CACHE_TTL = 600  # 10 minutes


def reset_fal_generator(profile_id: Optional[str] = None) -> None:
    """Drop the cached FAL generator so the next call rebuilds with fresh keys.

    Call after a vault mutation so API-key changes take effect immediately
    instead of after the 10-minute TTL expires.
    """
    to_close: list[FalImageGenerator] = []
    with _fal_lock:
        if profile_id is None:
            for entry in _fal_instances.values():
                to_close.append(entry[0])
            _fal_instances.clear()
        else:
            entry = _fal_instances.pop(profile_id, None)
            if entry is not None:
                to_close.append(entry[0])
            # Env-key fallback lives under "__global__" — drop it as well since
            # a vault change can flip which key is active.
            entry_global = _fal_instances.pop("__global__", None)
            if entry_global is not None:
                to_close.append(entry_global[0])
    for inst in to_close:
        try:
            inst.close()
        except Exception:
            pass


def get_fal_generator(profile_id: str = "") -> FalImageGenerator:
    """Get FAL image generator instance, per-profile if vault key exists."""
    from app.services.credentials.vault import get_vault_manager

    api_key = get_vault_manager().get_api_key_or_default(profile_id, "fal") if profile_id else ""
    if not api_key:
        settings = get_settings()
        api_key = settings.fal_api_key
    if not api_key:
        raise ValueError("FAL_API_KEY not configured")

    cache_key = profile_id or "__global__"
    old_instance = None

    with _fal_lock:
        entry = _fal_instances.get(cache_key)
        if entry is not None:
            instance, created_at = entry
            if (time.time() - created_at) < _FAL_CACHE_TTL:
                return instance
            old_instance = instance

        gen = FalImageGenerator(api_key=api_key)
        _fal_instances[cache_key] = (gen, time.time())

    if old_instance is not None:
        try:
            old_instance.close()
        except Exception:
            pass

    return gen
