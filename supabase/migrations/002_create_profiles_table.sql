-- =====================================================
-- Migration 002: Create Profiles Table
-- Purpose: Create profiles table with RLS for multi-profile support
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================
-- Phase: 01-database-foundation
-- Plan: 01-01
-- This migration establishes the profiles table that will hold profile-specific
-- TTS and Postiz settings. Each user can have multiple profiles (e.g., one per store).
-- =====================================================

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,

  -- TTS settings (profile-specific)
  default_tts_provider TEXT DEFAULT 'elevenlabs' CHECK (default_tts_provider IN ('elevenlabs', 'edge')),
  elevenlabs_voice_id TEXT,
  edge_tts_voice TEXT,
  tts_model TEXT,

  -- Postiz settings (profile-specific)
  postiz_integration_ids JSONB DEFAULT '[]',
  default_caption_template TEXT,

  -- Metadata
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: one default profile per user
-- Using partial unique index instead of EXCLUDE constraint for better compatibility
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_default
ON profiles(user_id)
WHERE (is_default = true);

-- Performance indexes for RLS policies
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);

-- Enable RLS immediately with policies (atomic operation)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (idempotent)
DROP POLICY IF EXISTS "Users can view own profiles" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profiles" ON profiles;
DROP POLICY IF EXISTS "Users can update own profiles" ON profiles;
DROP POLICY IF EXISTS "Users can delete own profiles" ON profiles;
DROP POLICY IF EXISTS "Service role bypass for profiles" ON profiles;

-- RLS policies with optimized (SELECT auth.uid()) wrapper for 95% perf improvement
CREATE POLICY "Users can view own profiles" ON profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own profiles" ON profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own profiles" ON profiles
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own profiles" ON profiles
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Service role bypass (for backend service operations)
CREATE POLICY "Service role bypass for profiles" ON profiles
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Create or replace trigger function for updated_at timestamp
-- Using CREATE OR REPLACE to make this migration idempotent
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to profiles table
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- =====================================================
-- Migration 002 Complete
-- Next: Run 003_add_profile_id_to_tables.sql
-- =====================================================
