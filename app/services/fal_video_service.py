"""FAL queue client for Seedance 2.0 video generation."""

import logging
import time
from pathlib import Path

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

SEEDANCE_MODEL_ID = "bytedance/seedance-2.0/text-to-video"


class FalVideoGenerator:
    """Server-side client for Seedance's long-running FAL queue endpoint."""

    def __init__(self, api_key: str):
        self._model_id = get_settings().fal_seedance_model_id or SEEDANCE_MODEL_ID
        self._client = httpx.Client(
            timeout=httpx.Timeout(90.0, connect=10.0),
            headers={"Authorization": f"Key {api_key}", "Content-Type": "application/json"},
        )

    def generate(self, *, prompt: str, duration: str, aspect_ratio: str,
                 resolution: str, generate_audio: bool, bitrate_mode: str,
                 end_user_id: str) -> dict:
        """Submit and wait for a Seedance result, returning FAL's output payload."""
        payload = {
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "generate_audio": generate_audio,
            "bitrate_mode": bitrate_mode,
            "end_user_id": end_user_id,
        }
        submit = self._client.post(f"https://queue.fal.run/{self._model_id}", json=payload)
        submit.raise_for_status()
        queued = submit.json()
        status_url = queued.get("status_url")
        response_url = queued.get("response_url")
        if not status_url or not response_url:
            raise RuntimeError("FAL queue response did not include status and response URLs")

        # Seedance commonly takes tens of seconds. Poll with a bounded wait so a
        # stuck upstream job never occupies a background worker forever.
        deadline = time.monotonic() + 15 * 60
        while time.monotonic() < deadline:
            status = self._client.get(status_url).json()
            state = str(status.get("status", "")).upper()
            if state == "COMPLETED":
                result = self._client.get(response_url)
                result.raise_for_status()
                return result.json()
            if state in {"FAILED", "CANCELLED"}:
                detail = status.get("error") or status.get("detail") or "FAL generation failed"
                raise RuntimeError(str(detail))
            time.sleep(3)
        raise TimeoutError("Seedance generation timed out after 15 minutes")

    def download_video(self, url: str, destination: Path) -> str:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with self._client.stream("GET", url) as response:
            response.raise_for_status()
            with destination.open("wb") as file:
                for chunk in response.iter_bytes(1024 * 1024):
                    file.write(chunk)
        return str(destination)

    def close(self) -> None:
        self._client.close()


def get_fal_video_generator(profile_id: str = "") -> FalVideoGenerator:
    """Build a per-request generator using the profile vault key or FAL_API_KEY."""
    from app.services.credentials.vault import get_vault_manager

    api_key = get_vault_manager().get_api_key_or_default(profile_id, "fal") if profile_id else ""
    if not api_key:
        api_key = get_settings().fal_api_key
    if not api_key:
        raise ValueError("FAL_API_KEY not configured")
    return FalVideoGenerator(api_key)
