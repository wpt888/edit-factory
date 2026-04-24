-- =====================================================
-- Migration 044: Create API Key Vault Table
-- Purpose: Unified per-profile API key storage for
--          Gemini, fal.ai, Anthropic, Postiz, Buffer, Telegram
--          with encryption, multi-key support, and auto-failover.
-- Mirrors the elevenlabs_accounts pattern (migration 011).
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================

-- Create api_key_vault table
CREATE TABLE IF NOT EXISTS public.api_key_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('gemini', 'fal', 'anthropic', 'postiz', 'buffer', 'telegram')),
  label TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  api_key_hint TEXT NOT NULL,         -- last 4 chars for display: "...xK9m"
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,

  -- Quota tracking (service-specific)
  quota_limit INTEGER,
  quota_used INTEGER,
  tier TEXT,

  -- Service-specific non-secret config (e.g. model IDs, base URLs)
  extra_config JSONB DEFAULT '{}',

  -- Error tracking
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one primary key per (profile, service)
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_key_vault_primary
ON api_key_vault(profile_id, service)
WHERE (is_primary = true);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_api_key_vault_profile_service
ON api_key_vault(profile_id, service);

CREATE INDEX IF NOT EXISTS idx_api_key_vault_sort_order
ON api_key_vault(profile_id, service, sort_order);

-- Enable RLS
ALTER TABLE api_key_vault ENABLE ROW LEVEL SECURITY;

-- RLS policies: profile-aware via profiles.user_id join
CREATE POLICY "Users can view own api keys" ON api_key_vault
  FOR SELECT
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own api keys" ON api_key_vault
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own api keys" ON api_key_vault
  FOR UPDATE
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete own api keys" ON api_key_vault
  FOR DELETE
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

-- Service role bypass (for backend operations)
CREATE POLICY "Service role bypass for api key vault" ON api_key_vault
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Auto-update updated_at trigger
DROP TRIGGER IF EXISTS api_key_vault_updated_at ON api_key_vault;
CREATE TRIGGER api_key_vault_updated_at
  BEFORE UPDATE ON api_key_vault
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- =====================================================
-- Migration 044 Complete
-- =====================================================
