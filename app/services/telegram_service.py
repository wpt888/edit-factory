"""Telegram Bot API service for sending images/documents."""

import logging
import threading
import time
from pathlib import Path
from typing import Optional, Tuple

import httpx

from app.db import get_supabase

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org"


class TelegramSender:
    """Send messages and files via Telegram Bot API."""

    def __init__(self, bot_token: str, chat_id: str):
        self.bot_token = bot_token
        self.chat_id = chat_id
        self._client = httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))

    def send_photo(
        self,
        file_path: str,
        caption: str = "",
        reply_markup: Optional[dict] = None,
    ) -> dict:
        """Send a photo to the configured chat."""
        url = f"{TELEGRAM_API_BASE}/bot{self.bot_token}/sendPhoto"

        with open(file_path, "rb") as f:
            data = {"chat_id": self.chat_id, "caption": caption}
            if reply_markup:
                import json
                data["reply_markup"] = json.dumps(reply_markup)

            response = self._client.post(url, data=data, files={"photo": f})

        response.raise_for_status()
        result = response.json()

        if not result.get("ok"):
            raise RuntimeError(f"Telegram API error: {result.get('description')}")

        logger.info(f"Telegram photo sent to chat {self.chat_id}")
        return result

    def send_document(
        self,
        file_path: str,
        caption: str = "",
        reply_markup: Optional[dict] = None,
    ) -> dict:
        """Send a document/file to the configured chat."""
        url = f"{TELEGRAM_API_BASE}/bot{self.bot_token}/sendDocument"

        with open(file_path, "rb") as f:
            data = {"chat_id": self.chat_id, "caption": caption}
            if reply_markup:
                import json
                data["reply_markup"] = json.dumps(reply_markup)

            response = self._client.post(url, data=data, files={"document": f})

        response.raise_for_status()
        result = response.json()

        if not result.get("ok"):
            raise RuntimeError(f"Telegram API error: {result.get('description')}")

        logger.info(f"Telegram document sent to chat {self.chat_id}")
        return result

    def close(self):
        self._client.close()


# --- Profile-aware factory ---

_telegram_instances: dict[str, Tuple[TelegramSender, float]] = {}
_telegram_lock = threading.Lock()
_TELEGRAM_CACHE_TTL = 300
_MAX_TELEGRAM_INSTANCES = 50


def get_telegram_sender(profile_id: str) -> TelegramSender:
    """Get Telegram sender for a specific profile (cached)."""
    global _telegram_instances

    with _telegram_lock:
        if profile_id in _telegram_instances:
            instance, created_at = _telegram_instances[profile_id]
            if (time.time() - created_at) < _TELEGRAM_CACHE_TTL:
                return instance
            del _telegram_instances[profile_id]

    # Load credentials from profile's tts_settings.telegram
    supabase = get_supabase()
    bot_token = None
    chat_id = None

    if supabase:
        try:
            result = (
                supabase.table("profiles")
                .select("tts_settings")
                .eq("id", profile_id)
                .single()
                .execute()
            )
            if result.data:
                tts_settings = result.data.get("tts_settings") or {}
                telegram_config = tts_settings.get("telegram") or {}
                bot_token = telegram_config.get("bot_token")
                chat_id = telegram_config.get("chat_id")
        except Exception as e:
            logger.warning(f"[Profile {profile_id}] Failed to load Telegram config: {e}")

    if not bot_token or not chat_id:
        raise ValueError(f"Profile {profile_id} has no Telegram credentials configured")

    sender = TelegramSender(bot_token=bot_token, chat_id=chat_id)

    with _telegram_lock:
        if len(_telegram_instances) >= _MAX_TELEGRAM_INSTANCES:
            oldest_key = next(iter(_telegram_instances))
            _telegram_instances.pop(oldest_key, None)
        _telegram_instances[profile_id] = (sender, time.time())

    return sender


def reset_telegram_sender(profile_id: Optional[str] = None):
    """Reset cached sender instance(s)."""
    global _telegram_instances
    with _telegram_lock:
        if profile_id:
            _telegram_instances.pop(profile_id, None)
        else:
            _telegram_instances = {}
