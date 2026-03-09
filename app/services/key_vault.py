"""
Encrypted Key Vault Service

Stores API keys encrypted on disk using Fernet symmetric encryption.
Keys are stored in {base_dir}/keys.vault as encrypted JSON.

Encryption key derivation priority:
1. ELEVENLABS_ENCRYPTION_KEY setting (explicit Fernet key)
2. SUPABASE_KEY setting (derived via SHA-256)
3. Machine-specific fallback (hostname + vault_salt.bin)
"""
import base64
import hashlib
import json
import logging
import os
import platform
import threading
from pathlib import Path
from typing import List, Optional

from cryptography.fernet import Fernet

from app.config import get_settings

logger = logging.getLogger(__name__)


class KeyVault:
    """Encrypted API key storage backed by a JSON vault file on disk."""

    # Key names this vault manages
    MANAGED_KEYS = frozenset({
        "gemini_api_key",
        "elevenlabs_api_key",
        "elevenlabs_voice_id",
        "supabase_url",
        "supabase_key",
    })

    def __init__(self, base_dir: Path):
        self._base_dir = base_dir
        self._vault_file = base_dir / "keys.vault"
        self._salt_file = base_dir / "vault_salt.bin"
        self._lock = threading.Lock()

    # ---- Fernet key derivation ----

    def _get_fernet(self) -> Fernet:
        """Get Fernet instance for encryption/decryption.

        Priority:
        1. ELEVENLABS_ENCRYPTION_KEY setting
        2. Derive from SUPABASE_KEY setting
        3. Machine-specific fallback (hostname + salt file)
        """
        try:
            settings = get_settings()
        except Exception:
            settings = None

        # 1. Explicit encryption key
        enc_key = getattr(settings, "elevenlabs_encryption_key", "") if settings else ""
        if enc_key:
            if isinstance(enc_key, str):
                try:
                    key_bytes = enc_key.encode()
                    Fernet(key_bytes)  # validate
                    return Fernet(key_bytes)
                except Exception:
                    derived = hashlib.sha256(enc_key.encode("utf-8")).digest()
                    return Fernet(base64.urlsafe_b64encode(derived))

        # 2. Derive from SUPABASE_KEY
        supa_key = getattr(settings, "supabase_key", "") if settings else ""
        if supa_key:
            derived = hashlib.sha256(supa_key.encode()).digest()
            return Fernet(base64.urlsafe_b64encode(derived))

        # 3. Machine-specific fallback (desktop mode without Supabase)
        return self._get_machine_fernet()

    def _get_machine_fernet(self) -> Fernet:
        """Derive Fernet key from machine hostname + a persisted random salt."""
        salt = self._get_or_create_salt()
        hostname = platform.node() or "edit-factory-local"
        material = hostname.encode("utf-8") + salt
        derived = hashlib.sha256(material).digest()
        return Fernet(base64.urlsafe_b64encode(derived))

    def _get_or_create_salt(self) -> bytes:
        """Read or create vault_salt.bin for machine-specific key derivation."""
        if self._salt_file.exists():
            return self._salt_file.read_bytes()
        salt = os.urandom(32)
        try:
            self._salt_file.parent.mkdir(parents=True, exist_ok=True)
            self._salt_file.write_bytes(salt)
        except OSError as e:
            logger.warning(f"Could not persist vault salt: {e}")
        return salt

    # ---- Vault file I/O ----

    def _read_vault(self) -> dict:
        """Read the vault file. Returns dict with 'keys' and 'hints' sub-dicts."""
        if not self._vault_file.exists():
            return {"keys": {}, "hints": {}}
        try:
            data = json.loads(self._vault_file.read_text(encoding="utf-8"))
            if "keys" not in data:
                data = {"keys": data, "hints": {}}
            return data
        except (json.JSONDecodeError, OSError) as e:
            logger.error(f"Failed to read vault file: {e}")
            return {"keys": {}, "hints": {}}

    def _write_vault(self, data: dict) -> None:
        """Write the vault data to disk."""
        try:
            self._vault_file.parent.mkdir(parents=True, exist_ok=True)
            self._vault_file.write_text(
                json.dumps(data, indent=2), encoding="utf-8"
            )
        except OSError as e:
            logger.error(f"Failed to write vault file: {e}")
            raise

    # ---- Public API ----

    def store_key(self, name: str, plaintext: str) -> None:
        """Encrypt and store an API key by name."""
        if not plaintext:
            return
        f = self._get_fernet()
        encrypted = f.encrypt(plaintext.encode("utf-8")).decode("utf-8")
        hint = f"***{plaintext[-4:]}" if len(plaintext) >= 4 else "***"

        with self._lock:
            vault = self._read_vault()
            vault["keys"][name] = encrypted
            vault["hints"][name] = hint
            self._write_vault(vault)

    def get_key(self, name: str) -> Optional[str]:
        """Retrieve and decrypt an API key by name.

        Falls back to config.json for backward compatibility, migrating
        plaintext keys to the vault on first access.
        """
        with self._lock:
            vault = self._read_vault()

        encrypted = vault["keys"].get(name)
        if encrypted:
            try:
                f = self._get_fernet()
                return f.decrypt(encrypted.encode("utf-8")).decode("utf-8")
            except Exception as e:
                logger.warning(f"Failed to decrypt key '{name}': {e}")
                return None

        # Backward compat: check config.json for plaintext keys
        config_file = self._base_dir / "config.json"
        if config_file.exists():
            try:
                config = json.loads(config_file.read_text(encoding="utf-8"))
                plaintext = config.get(name)
                if plaintext and isinstance(plaintext, str) and plaintext.strip():
                    # Migrate to vault
                    logger.info(f"Migrating key '{name}' from config.json to vault")
                    self.store_key(name, plaintext)
                    return plaintext
            except (json.JSONDecodeError, OSError):
                pass

        return None

    def get_key_hint(self, name: str) -> str:
        """Return a redacted hint like '***last4' for display purposes."""
        with self._lock:
            vault = self._read_vault()
        return vault["hints"].get(name, "")

    def has_key(self, name: str) -> bool:
        """Check if a key exists in the vault."""
        with self._lock:
            vault = self._read_vault()
        return name in vault["keys"]

    def delete_key(self, name: str) -> None:
        """Remove a key from the vault."""
        with self._lock:
            vault = self._read_vault()
            vault["keys"].pop(name, None)
            vault["hints"].pop(name, None)
            self._write_vault(vault)

    def list_keys(self) -> List[str]:
        """Return the names of all stored keys (not values)."""
        with self._lock:
            vault = self._read_vault()
        return list(vault["keys"].keys())


# ---- Singleton factory ----

_vault_instance: Optional[KeyVault] = None
_vault_lock = threading.Lock()


def get_key_vault() -> KeyVault:
    """Get singleton KeyVault instance."""
    global _vault_instance
    if _vault_instance is None:
        with _vault_lock:
            if _vault_instance is None:
                settings = get_settings()
                _vault_instance = KeyVault(settings.base_dir)
    return _vault_instance
