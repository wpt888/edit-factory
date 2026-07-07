"""
API Key Vault Manager

Unified per-profile API key storage for Gemini, fal.ai, Anthropic, Postiz,
Buffer, and Telegram. Provides encrypted storage, multi-key support with
priority selection, and environment variable fallback.

Mirrors the ElevenLabs account manager pattern but generalized for all services.
"""
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from app.config import get_settings
from app.services.elevenlabs_account_manager import (
    _decrypt_api_key,
    _encrypt_api_key,
)

logger = logging.getLogger(__name__)

# Valid services for the vault
VAULT_SERVICES = frozenset({"gemini", "fal", "anthropic", "postiz", "buffer", "telegram", "blipost_platform"})

# Singleton
_instance: Optional["ApiKeyVaultManager"] = None
_instance_lock = threading.Lock()


def get_vault_manager() -> "ApiKeyVaultManager":
    """Get singleton ApiKeyVaultManager instance."""
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:
                _instance = ApiKeyVaultManager()
    return _instance


class ApiKeyVaultManager:
    """
    Manages per-profile API keys for multiple services.

    Key selection order per (profile, service):
    1. Primary key (is_primary=True)
    2. Active keys ordered by sort_order
    3. Fallback to environment variable
    """

    MAX_KEYS_PER_SERVICE = 3
    _CACHE_TTL = 300  # 5 minutes

    # Maps service name → settings attribute for env fallback
    _ENV_FALLBACK_MAP = {
        "gemini": "gemini_api_key",
        "fal": "fal_api_key",
        "anthropic": "anthropic_api_key",
        "postiz": "postiz_api_key",
    }

    def __init__(self):
        self.settings = get_settings()
        # Cache: (profile_id, service) -> (list of rows, timestamp)
        self._cache: Dict[Tuple[str, str], Tuple[List[dict], float]] = {}
        self._cache_lock = threading.Lock()

    def _get_repo(self):
        from app.repositories.factory import get_repository
        return get_repository()

    def _cache_key(self, profile_id: str, service: str) -> Tuple[str, str]:
        return (profile_id, service)

    def _invalidate_cache(self, profile_id: str, service: str):
        with self._cache_lock:
            self._cache.pop(self._cache_key(profile_id, service), None)

    def _get_cached(self, profile_id: str, service: str) -> Optional[List[dict]]:
        with self._cache_lock:
            entry = self._cache.get(self._cache_key(profile_id, service))
            if entry is None:
                return None
            rows, created_at = entry
            if (time.time() - created_at) >= self._CACHE_TTL:
                del self._cache[self._cache_key(profile_id, service)]
                return None
            return rows

    def _set_cached(self, profile_id: str, service: str, rows: List[dict]):
        with self._cache_lock:
            self._cache[self._cache_key(profile_id, service)] = (rows, time.time())

    def _get_env_fallback(self, service: str) -> str:
        """Get the env-var fallback key for a service, or empty string."""
        attr = self._ENV_FALLBACK_MAP.get(service)
        if attr:
            return getattr(self.settings, attr, "") or ""
        return ""

    # ==================== Key Selection ====================

    def _fetch_keys_from_db(self, profile_id: str, service: str) -> List[dict]:
        repo = self._get_repo()
        if not repo:
            return []
        try:
            from app.repositories.models import QueryFilters
            result = repo.list_vault_keys(
                profile_id, service,
                filters=QueryFilters(order_by="sort_order", order_desc=False),
            )
            return result.data or []
        except Exception as e:
            logger.error(f"Failed to fetch vault keys for {service}: {e}")
            return []

    def get_ordered_keys(self, profile_id: str, service: str) -> List[dict]:
        """
        Get ordered list of active API keys for a (profile, service).

        Order: primary first, then by sort_order, then env fallback.

        Returns:
            List of dicts with 'api_key', 'key_id', 'label', 'api_key_hint'
        """
        cached = self._get_cached(profile_id, service)
        if cached is not None:
            rows = cached
        else:
            rows = self._fetch_keys_from_db(profile_id, service)
            self._set_cached(profile_id, service, rows)

        active = [r for r in rows if r.get("is_active", True)]
        active.sort(key=lambda r: (not r.get("is_primary", False), r.get("sort_order", 999)))

        result = []
        for r in active:
            result.append({
                "api_key": _decrypt_api_key(r["api_key_encrypted"]),
                "key_id": r["id"],
                "label": r["label"],
                "api_key_hint": r["api_key_hint"],
            })

        # Append env fallback
        env_key = self._get_env_fallback(service)
        if env_key:
            result.append({
                "api_key": env_key,
                "key_id": None,
                "label": ".env default",
                "api_key_hint": f"...{env_key[-4:]}" if len(env_key) >= 4 else "....",
            })

        return result

    def get_api_key(self, profile_id: str, service: str) -> str:
        """
        Get the best available API key for a (profile, service).

        Raises:
            ValueError: If no API key available (neither vault nor env)
        """
        keys = self.get_ordered_keys(profile_id, service)
        if not keys:
            raise ValueError(f"No API key available for service '{service}'")
        return keys[0]["api_key"]

    def get_api_key_or_default(self, profile_id: str, service: str) -> str:
        """
        Get the best available API key, falling back to env var silently.

        Returns empty string if nothing configured at all.
        """
        try:
            return self.get_api_key(profile_id, service)
        except ValueError:
            return self._get_env_fallback(service)

    def get_key_secret(self, profile_id: str, service: str, key_id: str) -> str:
        """
        Return the decrypted API key for a specific vault entry.

        Supports the synthetic ``__env__`` entry used by the Settings UI.

        Raises:
            ValueError: If the key does not exist or does not belong to the profile.
        """
        if key_id == "__env__":
            env_key = self._get_env_fallback(service)
            if not env_key:
                raise ValueError("No .env default key configured")
            return env_key

        repo = self._get_repo()
        if not repo:
            raise ValueError("Database not available")

        existing = repo.get_vault_key(key_id)
        if not existing or existing.get("profile_id") != profile_id or existing.get("service") != service:
            raise ValueError("Key not found")

        encrypted = existing.get("api_key_encrypted")
        if not encrypted:
            raise ValueError("Stored key is empty")

        return _decrypt_api_key(encrypted)

    def get_next_api_key(self, profile_id: str, service: str, failed_key: str) -> Optional[str]:
        """Get the next API key after one that failed (e.g. quota exceeded)."""
        keys = self.get_ordered_keys(profile_id, service)
        found_failed = False
        for k in keys:
            if found_failed:
                return k["api_key"]
            if k["api_key"] == failed_key:
                found_failed = True
        return None

    def record_error(self, profile_id: str, service: str, api_key: str, error_msg: str):
        """Record an error against the vault key that owns this API key."""
        repo = self._get_repo()
        if not repo:
            return
        try:
            from app.repositories.models import QueryFilters
            result = repo.list_vault_keys(
                profile_id, service,
                filters=QueryFilters(select="id, api_key_encrypted"),
            )
            for row in (result.data or []):
                if _decrypt_api_key(row["api_key_encrypted"]) == api_key:
                    repo.update_vault_key(row["id"], {
                        "last_error": error_msg,
                        "last_checked_at": datetime.now(timezone.utc).isoformat(),
                    })
                    logger.info(f"Recorded error on vault key {row['id']}: {error_msg[:80]}")
                    break
        except Exception as e:
            logger.warning(f"Failed to record vault error: {e}")

    # ==================== CRUD ====================

    def list_keys(self, profile_id: str, service: str) -> List[dict]:
        """
        List all keys for a (profile, service), masked for display.

        Includes a synthetic __env__ entry for the env-var fallback.
        """
        rows = self._fetch_keys_from_db(profile_id, service)
        self._set_cached(profile_id, service, rows)

        masked = []
        for r in rows:
            entry = {**r}
            entry.pop("api_key_encrypted", None)
            masked.append(entry)

        env_key = self._get_env_fallback(service)
        if env_key:
            masked.append({
                "id": "__env__",
                "service": service,
                "label": ".env default",
                "api_key_hint": f"...{env_key[-4:]}" if len(env_key) >= 4 else "....",
                "is_primary": len(rows) == 0,
                "is_active": True,
                "is_env_default": True,
                "sort_order": 999,
            })

        return masked

    def add_key(self, profile_id: str, service: str, label: str, api_key: str) -> dict:
        """
        Add a new API key to the vault.

        Returns:
            The created row (masked).

        Raises:
            ValueError: If limit reached or service invalid.
        """
        if service not in VAULT_SERVICES:
            raise ValueError(f"Invalid service: {service}")

        repo = self._get_repo()
        if not repo:
            raise ValueError("Database not available")

        from app.repositories.models import QueryFilters
        existing = repo.list_vault_keys(
            profile_id, service,
            filters=QueryFilters(select="id"),
        )

        if existing.data and len(existing.data) >= self.MAX_KEYS_PER_SERVICE:
            raise ValueError(f"Maximum {self.MAX_KEYS_PER_SERVICE} keys per service per profile")

        count = len(existing.data) if existing.data else 0
        is_primary = count == 0
        sort_order = count

        api_key_hint = f"...{api_key[-4:]}" if len(api_key) >= 4 else "..."

        row = {
            "profile_id": profile_id,
            "service": service,
            "label": label,
            "api_key_encrypted": _encrypt_api_key(api_key),
            "api_key_hint": api_key_hint,
            "is_primary": is_primary,
            "is_active": True,
            "sort_order": sort_order,
        }

        created = repo.create_vault_key(row)
        self._invalidate_cache(profile_id, service)

        masked = {**created}
        masked.pop("api_key_encrypted", None)
        return masked

    def update_key(self, profile_id: str, key_id: str, updates: dict) -> dict:
        """
        Update a vault key (label, is_active only).

        Returns:
            The updated row (masked).

        Raises:
            ValueError: If key not found or not owned by profile.
        """
        repo = self._get_repo()
        if not repo:
            raise ValueError("Database not available")

        existing = repo.get_vault_key(key_id)
        if not existing or existing.get("profile_id") != profile_id:
            raise ValueError("Key not found")

        allowed = {}
        if "label" in updates:
            allowed["label"] = updates["label"]
        if "is_active" in updates:
            allowed["is_active"] = updates["is_active"]

        if not allowed:
            raise ValueError("No valid fields to update")

        updated = repo.update_vault_key(key_id, allowed)
        self._invalidate_cache(profile_id, existing["service"])

        masked = {**updated}
        masked.pop("api_key_encrypted", None)
        return masked

    def delete_key(self, profile_id: str, key_id: str):
        """
        Delete a vault key.

        If deleting the primary, promotes the next key.

        Raises:
            ValueError: If key not found or not owned by profile.
        """
        repo = self._get_repo()
        if not repo:
            raise ValueError("Database not available")

        existing = repo.get_vault_key(key_id)
        if not existing or existing.get("profile_id") != profile_id:
            raise ValueError("Key not found")

        service = existing["service"]
        was_primary = existing.get("is_primary", False)

        repo.delete_vault_key(key_id)

        # Promote next key if we deleted the primary
        if was_primary:
            from app.repositories.models import QueryFilters
            remaining = repo.list_vault_keys(
                profile_id, service,
                filters=QueryFilters(order_by="sort_order", order_desc=False),
            )
            if remaining.data:
                repo.update_vault_key(remaining.data[0]["id"], {"is_primary": True})

        self._invalidate_cache(profile_id, service)

    def set_primary(self, profile_id: str, service: str, key_id: str) -> dict:
        """
        Set a key as primary for a (profile, service).

        Returns:
            The updated row (masked).

        Raises:
            ValueError: If key not found or not owned by profile.
        """
        repo = self._get_repo()
        if not repo:
            raise ValueError("Database not available")

        target = repo.get_vault_key(key_id)
        if not target or target.get("profile_id") != profile_id or target.get("service") != service:
            raise ValueError("Key not found")

        # Unset current primary
        from app.repositories.models import QueryFilters
        current = repo.list_vault_keys(
            profile_id, service,
            filters=QueryFilters(select="id, is_primary"),
        )
        for row in (current.data or []):
            if row.get("is_primary"):
                repo.update_vault_key(row["id"], {"is_primary": False})

        # Set new primary
        updated = repo.update_vault_key(key_id, {"is_primary": True})
        self._invalidate_cache(profile_id, service)

        masked = {**updated}
        masked.pop("api_key_encrypted", None)
        return masked
