-- =====================================================
-- Migration 017: Generation Progress Persistence
-- Purpose: Persist generation progress to Supabase so it
--          survives server restarts and reports accurate
--          prior progress after restart.
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================

-- =====================================================
-- TABLE: editai_generation_progress
-- Tracks video generation progress per project.
-- project_id is TEXT (not UUID) matching editai_projects.id
-- which is UUID stored as text in the backend.
-- =====================================================
CREATE TABLE IF NOT EXISTS public.editai_generation_progress (
  project_id TEXT PRIMARY KEY,
  percentage INTEGER NOT NULL DEFAULT 0,
  current_step TEXT NOT NULL DEFAULT '',
  estimated_remaining INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast expiry cleanup (rows older than 24h can be pruned)
CREATE INDEX IF NOT EXISTS idx_editai_generation_progress_updated_at
  ON editai_generation_progress(updated_at);

-- =====================================================
-- ROW LEVEL SECURITY
-- This table is keyed by project_id (TEXT), not profile_id.
-- Backend (service role) manages all writes. Authenticated
-- users can read their own project's progress via the API.
-- Use a permissive policy since the backend always uses the
-- service role key for writes and the API validates ownership
-- before returning progress to the user.
-- =====================================================
ALTER TABLE editai_generation_progress ENABLE ROW LEVEL SECURITY;

-- Permissive read policy: authenticated users can read any progress row.
-- Ownership check is enforced at the API layer (project must belong to profile).
CREATE POLICY "Authenticated users can read generation progress" ON editai_generation_progress
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role handles all writes (insert/update/delete) from backend
CREATE POLICY "Service role manages generation progress" ON editai_generation_progress
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================
-- Migration 017 Complete
-- =====================================================
