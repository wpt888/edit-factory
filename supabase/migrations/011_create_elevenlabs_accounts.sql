-- =====================================================
-- Migration 011: Create ElevenLabs Accounts Table
-- Purpose: Multi-account ElevenLabs support with auto-failover
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================

-- Create elevenlabs_accounts table
CREATE TABLE IF NOT EXISTS public.elevenlabs_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  api_key_hint TEXT NOT NULL,  -- last 4 chars for display: "...xK9m"
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,

  -- Subscription info (from ElevenLabs /v1/user/subscription)
  character_limit INTEGER,
  characters_used INTEGER,
  tier TEXT,

  -- Error tracking
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one primary account per profile
CREATE UNIQUE INDEX IF NOT EXISTS idx_elevenlabs_accounts_primary
ON elevenlabs_accounts(profile_id)
WHERE (is_primary = true);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_elevenlabs_accounts_profile_id
ON elevenlabs_accounts(profile_id);

CREATE INDEX IF NOT EXISTS idx_elevenlabs_accounts_sort_order
ON elevenlabs_accounts(profile_id, sort_order);

-- Enable RLS
ALTER TABLE elevenlabs_accounts ENABLE ROW LEVEL SECURITY;

-- RLS policies: profile-aware via profiles.user_id join
CREATE POLICY "Users can view own elevenlabs accounts" ON elevenlabs_accounts
  FOR SELECT
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own elevenlabs accounts" ON elevenlabs_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own elevenlabs accounts" ON elevenlabs_accounts
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

CREATE POLICY "Users can delete own elevenlabs accounts" ON elevenlabs_accounts
  FOR DELETE
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

-- Service role bypass (for backend operations)
CREATE POLICY "Service role bypass for elevenlabs accounts" ON elevenlabs_accounts
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Auto-update updated_at trigger
DROP TRIGGER IF EXISTS elevenlabs_accounts_updated_at ON elevenlabs_accounts;
CREATE TRIGGER elevenlabs_accounts_updated_at
  BEFORE UPDATE ON elevenlabs_accounts
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- =====================================================
-- Migration 011 Complete
-- =====================================================
