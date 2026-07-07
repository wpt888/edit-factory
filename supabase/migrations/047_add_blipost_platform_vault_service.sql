-- U1 desktop bridge: allow the vault to store the Blipost platform token.
-- The api_key_vault.service CHECK constraint (migration 044) enumerates the
-- allowed services; add 'blipost_platform' so the desktop can persist the
-- pasted platform token (Fernet-encrypted, like every other vault key).
ALTER TABLE api_key_vault
  DROP CONSTRAINT IF EXISTS api_key_vault_service_check;

ALTER TABLE api_key_vault
  ADD CONSTRAINT api_key_vault_service_check
  CHECK (service IN ('gemini', 'fal', 'anthropic', 'postiz', 'buffer', 'telegram', 'blipost_platform'));

-- Reload PostgREST schema cache so the change takes effect immediately.
NOTIFY pgrst, 'reload schema';
