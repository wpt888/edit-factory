"""
Lightweight provider-ping validators for API keys.

Each function constructs a one-off client, makes the cheapest possible
auth-verifying request, and returns a dict suitable for a validate endpoint.
Nothing is persisted.
"""
import logging
from typing import Any, Dict

import httpx

logger = logging.getLogger(__name__)


async def validate_gemini(api_key: str) -> Dict[str, Any]:
    """Ping Google Gemini by listing models — zero generation cost."""
    try:
        from google import genai
        import asyncio

        def _list_models() -> int:
            client = genai.Client(api_key=api_key)
            models = list(client.models.list())
            return len(models)

        count = await asyncio.to_thread(_list_models)
        return {"connected": True, "models_count": count}
    except Exception as e:
        msg = str(e)
        logger.debug(f"Gemini validation failed: {msg}")
        # Surface a clean message — Google errors are often verbose
        if "API_KEY_INVALID" in msg or "invalid" in msg.lower():
            return {"connected": False, "error": "Invalid API key"}
        return {"connected": False, "error": msg[:200]}


async def validate_fal(api_key: str) -> Dict[str, Any]:
    """Ping fal.ai billing endpoint — 200 = valid key, 401 = bad key."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://rest.alpha.fal.ai/billing/user_balance",
                headers={"Authorization": f"Key {api_key}"},
            )
        if response.status_code == 200:
            data = response.json()
            return {"connected": True, "balance": data.get("balance")}
        if response.status_code in (401, 403):
            return {"connected": False, "error": "Invalid API key"}
        return {"connected": False, "error": f"Unexpected status {response.status_code}"}
    except Exception as e:
        logger.debug(f"fal.ai validation failed: {e}")
        return {"connected": False, "error": str(e)[:200]}
