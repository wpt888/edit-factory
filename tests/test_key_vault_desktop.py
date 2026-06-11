"""Key vault F7: desktop mode uses a machine-local key, never SUPABASE_KEY,
and legacy SUPABASE_KEY-encrypted vaults migrate transparently on read."""
import base64
import hashlib

from cryptography.fernet import Fernet

from app.services.key_vault import KeyVault


class _Settings:
    def __init__(self, desktop_mode, supabase_key="", elevenlabs_encryption_key=""):
        self.desktop_mode = desktop_mode
        self.supabase_key = supabase_key
        self.elevenlabs_encryption_key = elevenlabs_encryption_key


def _patch_settings(monkeypatch, settings):
    import app.services.key_vault as kv
    monkeypatch.setattr(kv, "get_settings", lambda: settings)


def test_desktop_mode_ignores_supabase_key(tmp_path, monkeypatch):
    _patch_settings(monkeypatch, _Settings(desktop_mode=True, supabase_key="cloud-secret"))
    vault = KeyVault(tmp_path)
    vault.store_key("gemini_api_key", "g-12345678")

    # Decrypts with the machine-local key
    assert vault.get_key("gemini_api_key") == "g-12345678"

    # The SUPABASE_KEY-derived Fernet must NOT decrypt the stored entry
    supa_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"cloud-secret").digest()))
    import json
    raw = json.loads((tmp_path / "keys.vault").read_text())["keys"]["gemini_api_key"]
    try:
        supa_fernet.decrypt(raw.encode())
        decrypted_with_cloud_key = True
    except Exception:
        decrypted_with_cloud_key = False
    assert not decrypted_with_cloud_key, "desktop vault must not be coupled to SUPABASE_KEY"


def test_legacy_supabase_vault_migrates_on_read(tmp_path, monkeypatch):
    # Vault written under the OLD derivation (web mode with SUPABASE_KEY)
    _patch_settings(monkeypatch, _Settings(desktop_mode=False, supabase_key="cloud-secret"))
    old_vault = KeyVault(tmp_path)
    old_vault.store_key("elevenlabs_api_key", "el-abcdef")

    # Same machine switches to desktop mode (machine-local key becomes primary)
    _patch_settings(monkeypatch, _Settings(desktop_mode=True, supabase_key="cloud-secret"))
    new_vault = KeyVault(tmp_path)

    # First read decrypts via the legacy fernet and re-encrypts in place
    assert new_vault.get_key("elevenlabs_api_key") == "el-abcdef"

    # After migration, even without SUPABASE_KEY the key is readable
    _patch_settings(monkeypatch, _Settings(desktop_mode=True, supabase_key=""))
    assert KeyVault(tmp_path).get_key("elevenlabs_api_key") == "el-abcdef"


def test_web_mode_still_uses_supabase_derivation(tmp_path, monkeypatch):
    _patch_settings(monkeypatch, _Settings(desktop_mode=False, supabase_key="cloud-secret"))
    vault = KeyVault(tmp_path)
    vault.store_key("fal_api_key", "fal-xyz")
    assert vault.get_key("fal_api_key") == "fal-xyz"
