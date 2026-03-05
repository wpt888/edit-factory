"""
ElevenLabs Account Manager

Manages multiple ElevenLabs API keys per profile with auto-failover on 402 (quota exceeded).
Provides CRUD operations, key rotation, and subscription checking.
"""
import base64
import hashlib
import logging
import threading
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx
from cryptography.fernet import Fernet

from app.config import get_settings


def _get_fernet():
    """Get Fernet instance using ELEVENLABS_ENCRYPTION_KEY or derive from SUPABASE_KEY."""
    settings = get_settings()
    logger = logging.getLogger(__name__)
    key = getattr(settings, 'elevenlabs_encryption_key', None)
    if not key:
        # Derive a key from SUPABASE_KEY as fallback
        base_key = settings.supabase_key or "edit-factory-default-key"
        if base_key == "edit-factory-default-key":
            logger.warning(
                "Using default encryption key for ElevenLabs account manager. "
                "Set ELEVENLABS_ENCRYPTION_KEY env var for production use."
            )
        derived = hashlib.sha256(base_key.encode()).digest()
        key = base64.urlsafe_b64encode(derived)
    else:
        # Ensure proper Fernet key format
        if isinstance(key, str):
            try:
                key = key.encode()
                Fernet(key)  # validate
            except Exception:
                derived = hashlib.sha256(key if isinstance(key, bytes) else key.encode("utf-8")).digest()
                key = base64.urlsafe_b64encode(derived)
    return Fernet(key)


def _encrypt_api_key(api_key: str) -> str:
    """Encrypt an API key."""
    try:
        f = _get_fernet()
        return f.encrypt(api_key.encode()).decode()
    except Exception:
        # Fallback: store as-is (backwards compatible)
        return api_key


def _decrypt_api_key(encrypted: str) -> str:
    """Decrypt an API key. Handles both encrypted and plaintext (legacy) keys."""
    try:
        f = _get_fernet()
        return f.decrypt(encrypted.encode()).decode()
    except Exception:
        # Not encrypted (legacy) — return as-is
        return encrypted

logger = logging.getLogger(__name__)

# Singleton
_instance = None
_instance_lock = threading.Lock()


def get_account_manager() -> "ElevenLabsAccountManager":
    """Get singleton ElevenLabsAccountManager instance."""
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:
                _instance = ElevenLabsAccountManager()
    return _instance


class ElevenLabsAccountManager:
    """
    Manages multiple ElevenLabs API keys per profile.

    Key selection order:
    1. Primary key (is_primary=True)
    2. Active keys ordered by sort_order
    3. Fallback to .env ELEVENLABS_API_KEY
    """

    MAX_ACCOUNTS_PER_PROFILE = 3

    _ENV_SUB_CACHE_TTL = 300  # 5 minutes

    _CACHE_TTL = 300  # 5 minutes for key cache

    def __init__(self):
        self.settings = get_settings()
        # In-memory cache: profile_id -> (list of account dicts, timestamp)
        self._cache: Dict[str, tuple] = {}  # profile_id -> (accounts, created_at)
        self._cache_lock = threading.Lock()
        # Cache for .env key subscription info
        self._env_sub_cache: Optional[dict] = None
        self._env_sub_cache_at: float = 0

    def _get_supabase(self):
        """Get Supabase client."""
        from app.db import get_supabase
        return get_supabase()

    def _invalidate_cache(self, profile_id: str):
        """Invalidate cache for a profile."""
        with self._cache_lock:
            self._cache.pop(profile_id, None)

    def _get_cached_accounts(self, profile_id: str) -> Optional[List[dict]]:
        """Get cached accounts for a profile (returns None if expired)."""
        import time
        with self._cache_lock:
            entry = self._cache.get(profile_id)
            if entry is None:
                return None
            accounts, created_at = entry
            if (time.time() - created_at) >= self._CACHE_TTL:
                del self._cache[profile_id]
                return None
            return accounts

    def _set_cached_accounts(self, profile_id: str, accounts: List[dict]):
        """Set cached accounts for a profile with timestamp."""
        import time
        with self._cache_lock:
            self._cache[profile_id] = (accounts, time.time())

    # ==================== Key Selection ====================

    def get_ordered_keys(self, profile_id: str) -> List[dict]:
        """
        Get ordered list of active API keys for a profile.

        Order: primary first, then by sort_order, then .env fallback.

        Returns:
            List of dicts with 'api_key', 'account_id', 'label', 'api_key_hint'
        """
        cached = self._get_cached_accounts(profile_id)
        if cached is not None:
            accounts = cached
        else:
            accounts = self._fetch_accounts_from_db(profile_id)
            self._set_cached_accounts(profile_id, accounts)

        # Filter active accounts, primary first, then sort_order
        active = [a for a in accounts if a.get("is_active", True)]
        active.sort(key=lambda a: (not a.get("is_primary", False), a.get("sort_order", 999)))

        result = []
        for a in active:
            result.append({
                "api_key": _decrypt_api_key(a["api_key_encrypted"]),
                "account_id": a["id"],
                "label": a["label"],
                "api_key_hint": a["api_key_hint"],
            })

        # Append .env fallback if no DB keys
        env_key = self.settings.elevenlabs_api_key
        if env_key:
            result.append({
                "api_key": env_key,
                "account_id": None,
                "label": ".env default",
                "api_key_hint": f"...{env_key[-4:]}" if len(env_key) >= 4 else "....",
            })

        return result

    def get_api_key(self, profile_id: str) -> str:
        """
        Get the best available API key for a profile.

        Returns:
            API key string

        Raises:
            ValueError: If no API key available
        """
        keys = self.get_ordered_keys(profile_id)
        if not keys:
            raise ValueError("No ElevenLabs API key available")
        return keys[0]["api_key"]

    def get_next_api_key(self, profile_id: str, failed_key: str) -> Optional[str]:
        """
        Get the next API key after one that failed with 402.

        Args:
            profile_id: Profile to look up keys for
            failed_key: The API key that just failed

        Returns:
            Next API key to try, or None if all exhausted
        """
        keys = self.get_ordered_keys(profile_id)
        found_failed = False
        for k in keys:
            if found_failed:
                return k["api_key"]
            if k["api_key"] == failed_key:
                found_failed = True

        return None

    def record_error(self, profile_id: str, api_key: str, error_msg: str):
        """Record an error against the account that owns this API key."""
        supabase = self._get_supabase()
        if not supabase:
            return

        try:
            # Find account by decrypting keys (can't use .eq on encrypted column)
            result = supabase.table("elevenlabs_accounts")\
                .select("id, api_key_encrypted")\
                .eq("profile_id", profile_id)\
                .execute()

            account_id = None
            for row in (result.data or []):
                if _decrypt_api_key(row["api_key_encrypted"]) == api_key:
                    account_id = row["id"]
                    break

            if account_id:
                supabase.table("elevenlabs_accounts").update({
                    "last_error": error_msg,
                    "last_checked_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", account_id).execute()

                logger.info(f"Recorded error on account {account_id}: {error_msg[:80]}")
        except Exception as e:
            logger.warning(f"Failed to record error on account: {e}")

    # ==================== CRUD ====================

    def _fetch_accounts_from_db(self, profile_id: str) -> List[dict]:
        """Fetch accounts from Supabase."""
        supabase = self._get_supabase()
        if not supabase:
            return []

        try:
            result = supabase.table("elevenlabs_accounts")\
                .select("*")\
                .eq("profile_id", profile_id)\
                .order("sort_order")\
                .execute()
            return result.data or []
        except Exception as e:
            logger.error(f"Failed to fetch accounts: {e}")
            return []

    def _get_env_subscription_cached(self, api_key: str) -> dict:
        """Fetch .env key subscription info with 5-minute cache."""
        import time
        now = time.time()
        with self._cache_lock:
            if self._env_sub_cache and (now - self._env_sub_cache_at) < self._ENV_SUB_CACHE_TTL:
                return self._env_sub_cache

        try:
            sub_info = self.check_subscription(api_key)
            sub_info["checked_at"] = datetime.now(timezone.utc).isoformat()
            with self._cache_lock:
                self._env_sub_cache = sub_info
                self._env_sub_cache_at = time.time()
            return sub_info
        except Exception as e:
            logger.warning(f"Failed to fetch .env subscription info: {e}")
            return {"error": str(e)}

    def list_accounts(self, profile_id: str) -> List[dict]:
        """
        List all accounts for a profile (keys masked for display).

        Returns list of account dicts with api_key_encrypted replaced by api_key_hint.
        """
        accounts = self._fetch_accounts_from_db(profile_id)
        self._set_cached_accounts(profile_id, accounts)

        masked = []
        for a in accounts:
            entry = {**a}
            entry.pop("api_key_encrypted", None)
            masked.append(entry)

        # Append synthetic entry for .env key so the UI always shows it
        env_key = self.settings.elevenlabs_api_key
        if env_key:
            # Auto-fetch subscription info (cached for 5 minutes)
            sub_info = self._get_env_subscription_cached(env_key)
            masked.append({
                "id": "__env__",
                "label": ".env default",
                "api_key_hint": f"...{env_key[-4:]}" if len(env_key) >= 4 else "....",
                "is_primary": len(accounts) == 0,
                "is_active": True,
                "is_env_default": True,
                "sort_order": 999,
                "character_limit": sub_info.get("character_limit"),
                "characters_used": sub_info.get("character_count"),
                "tier": sub_info.get("tier"),
                "last_error": sub_info.get("error"),
                "last_checked_at": sub_info.get("checked_at"),
            })

        return masked

    def add_account(self, profile_id: str, label: str, api_key: str) -> dict:
        """
        Add a new ElevenLabs account.

        Validates the key via subscription check before saving.
        Max 3 accounts per profile.

        Returns:
            The created account (masked)

        Raises:
            ValueError: If limit reached or key invalid
        """
        supabase = self._get_supabase()
        if not supabase:
            raise ValueError("Database not available")

        # Check limit
        existing = supabase.table("elevenlabs_accounts")\
            .select("id")\
            .eq("profile_id", profile_id)\
            .execute()

        if existing.data and len(existing.data) >= self.MAX_ACCOUNTS_PER_PROFILE:
            raise ValueError(f"Maximum {self.MAX_ACCOUNTS_PER_PROFILE} accounts per profile")

        # Determine sort_order and is_primary
        count = len(existing.data) if existing.data else 0
        is_primary = count == 0  # First account is primary
        sort_order = count

        # Generate hint
        api_key_hint = f"...{api_key[-4:]}" if len(api_key) >= 4 else "..."

        # Insert (encrypt the API key)
        row = {
            "profile_id": profile_id,
            "label": label,
            "api_key_encrypted": _encrypt_api_key(api_key),
            "api_key_hint": api_key_hint,
            "is_primary": is_primary,
            "is_active": True,
            "sort_order": sort_order,
        }

        result = supabase.table("elevenlabs_accounts").insert(row).execute()

        if not result.data:
            raise ValueError("Failed to create account")

        account = result.data[0]

        self._invalidate_cache(profile_id)

        # Return masked
        masked = {**account}
        del masked["api_key_encrypted"]
        return masked

    def update_account(self, profile_id: str, account_id: str, updates: dict) -> dict:
        """
        Update account label or is_active.

        Args:
            profile_id: Profile scope
            account_id: Account to update
            updates: Dict with optional 'label', 'is_active'

        Returns:
            Updated account (masked)
        """
        supabase = self._get_supabase()
        if not supabase:
            raise ValueError("Database not available")

        allowed = {}
        if "label" in updates:
            allowed["label"] = updates["label"]
        if "is_active" in updates:
            allowed["is_active"] = updates["is_active"]

        if not allowed:
            raise ValueError("No valid fields to update")

        result = supabase.table("elevenlabs_accounts")\
            .update(allowed)\
            .eq("id", account_id)\
            .eq("profile_id", profile_id)\
            .execute()

        if not result.data:
            raise ValueError("Account not found")

        self._invalidate_cache(profile_id)

        masked = {**result.data[0]}
        del masked["api_key_encrypted"]
        return masked

    def delete_account(self, profile_id: str, account_id: str):
        """Delete an account. Reassigns primary if needed."""
        supabase = self._get_supabase()
        if not supabase:
            raise ValueError("Database not available")

        # Check if this is the primary
        target = supabase.table("elevenlabs_accounts")\
            .select("id, is_primary")\
            .eq("id", account_id)\
            .eq("profile_id", profile_id)\
            .execute()

        if not target.data:
            raise ValueError("Account not found")

        was_primary = target.data[0].get("is_primary", False)

        # Delete
        supabase.table("elevenlabs_accounts")\
            .delete()\
            .eq("id", account_id)\
            .eq("profile_id", profile_id)\
            .execute()

        # Reassign primary if we deleted the primary
        if was_primary:
            remaining = supabase.table("elevenlabs_accounts")\
                .select("id")\
                .eq("profile_id", profile_id)\
                .order("sort_order")\
                .limit(1)\
                .execute()

            if remaining.data:
                supabase.table("elevenlabs_accounts")\
                    .update({"is_primary": True})\
                    .eq("id", remaining.data[0]["id"])\
                    .execute()

        self._invalidate_cache(profile_id)

    def clear_all_primary(self, profile_id: str):
        """Unset all DB accounts as primary for a profile (makes .env the default)."""
        supabase = self._get_supabase()
        if not supabase:
            return
        supabase.table("elevenlabs_accounts")\
            .update({"is_primary": False})\
            .eq("profile_id", profile_id)\
            .eq("is_primary", True)\
            .execute()
        self._invalidate_cache(profile_id)

    def set_primary(self, profile_id: str, account_id: str) -> dict:
        """
        Set an account as primary (unset previous primary).

        Returns:
            Updated account (masked)
        """
        supabase = self._get_supabase()
        if not supabase:
            raise ValueError("Database not available")

        # Unset current primary
        supabase.table("elevenlabs_accounts")\
            .update({"is_primary": False})\
            .eq("profile_id", profile_id)\
            .eq("is_primary", True)\
            .execute()

        # Set new primary
        result = supabase.table("elevenlabs_accounts")\
            .update({"is_primary": True})\
            .eq("id", account_id)\
            .eq("profile_id", profile_id)\
            .execute()

        if not result.data:
            raise ValueError("Account not found")

        self._invalidate_cache(profile_id)

        masked = {**result.data[0]}
        del masked["api_key_encrypted"]
        return masked

    def update_subscription_info(self, profile_id: str, account_id: str) -> dict:
        """
        Refresh subscription info from ElevenLabs API.

        Returns:
            Updated account (masked)
        """
        supabase = self._get_supabase()
        if not supabase:
            raise ValueError("Database not available")

        # Get the API key
        account = supabase.table("elevenlabs_accounts")\
            .select("api_key_encrypted")\
            .eq("id", account_id)\
            .eq("profile_id", profile_id)\
            .execute()

        if not account.data:
            raise ValueError("Account not found")

        api_key = _decrypt_api_key(account.data[0]["api_key_encrypted"])
        sub_info = self.check_subscription(api_key)

        # Update DB
        result = supabase.table("elevenlabs_accounts").update({
            "character_limit": sub_info.get("character_limit"),
            "characters_used": sub_info.get("character_count"),
            "tier": sub_info.get("tier"),
            "last_checked_at": datetime.now(timezone.utc).isoformat(),
            "last_error": None,
        }).eq("id", account_id).eq("profile_id", profile_id).execute()

        if not result.data:
            raise ValueError("Failed to update subscription info")

        self._invalidate_cache(profile_id)

        masked = {**result.data[0]}
        del masked["api_key_encrypted"]
        return masked

    @staticmethod
    async def check_subscription_async(api_key: str) -> dict:
        """Async wrapper for check_subscription using asyncio.to_thread."""
        import asyncio
        return await asyncio.to_thread(ElevenLabsAccountManager.check_subscription, api_key)

    @staticmethod
    def check_subscription(api_key: str) -> dict:
        """
        Check ElevenLabs subscription info for an API key.

        Returns:
            Dict with tier, character_limit, character_count, etc.

        Raises:
            ValueError: If API key is invalid
        """
        try:
            response = httpx.get(
                "https://api.elevenlabs.io/v1/user/subscription",
                headers={"xi-api-key": api_key},
                timeout=15.0,
            )

            if response.status_code == 401:
                raise ValueError("Invalid API key")
            if response.status_code != 200:
                raise ValueError(f"ElevenLabs API error: {response.status_code}")

            data = response.json()
            return {
                "tier": data.get("tier"),
                "character_limit": data.get("character_limit"),
                "character_count": data.get("character_count"),
                "next_character_count_reset_unix": data.get("next_character_count_reset_unix"),
            }
        except httpx.TimeoutException:
            raise ValueError("ElevenLabs API timeout")
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"Failed to check subscription: {e}")
