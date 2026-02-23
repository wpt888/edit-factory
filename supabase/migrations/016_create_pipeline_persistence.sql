-- =====================================================
-- Migration 016: Pipeline & Assembly Persistence
-- Purpose: Persist pipeline and assembly job state in Supabase
--          so data survives server restarts/crashes
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================

-- =====================================================
-- TABLE: editai_pipelines
-- Stores multi-variant pipeline state (scripts, previews, render jobs)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.editai_pipelines (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idea TEXT NOT NULL,
  context TEXT DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'gemini',
  variant_count INTEGER NOT NULL DEFAULT 3,
  keyword_count INTEGER NOT NULL DEFAULT 0,
  scripts JSONB NOT NULL DEFAULT '[]'::jsonb,
  previews JSONB NOT NULL DEFAULT '{}'::jsonb,
  render_jobs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
);

-- =====================================================
-- TABLE: editai_assembly_jobs
-- Stores individual assembly render job state
-- =====================================================
CREATE TABLE IF NOT EXISTS public.editai_assembly_jobs (
  id UUID PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'processing',
  progress INTEGER NOT NULL DEFAULT 0,
  current_step TEXT DEFAULT 'Initializing assembly',
  final_video_path TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_editai_pipelines_profile_id
  ON editai_pipelines(profile_id);

CREATE INDEX IF NOT EXISTS idx_editai_pipelines_expires_at
  ON editai_pipelines(expires_at);

CREATE INDEX IF NOT EXISTS idx_editai_assembly_jobs_profile_id
  ON editai_assembly_jobs(profile_id);

CREATE INDEX IF NOT EXISTS idx_editai_assembly_jobs_expires_at
  ON editai_assembly_jobs(expires_at);

-- =====================================================
-- ROW LEVEL SECURITY: editai_pipelines
-- =====================================================
ALTER TABLE editai_pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own pipelines" ON editai_pipelines
  FOR SELECT
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own pipelines" ON editai_pipelines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own pipelines" ON editai_pipelines
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

CREATE POLICY "Users can delete own pipelines" ON editai_pipelines
  FOR DELETE
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Service role bypass for pipelines" ON editai_pipelines
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================
-- ROW LEVEL SECURITY: editai_assembly_jobs
-- =====================================================
ALTER TABLE editai_assembly_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own assembly jobs" ON editai_assembly_jobs
  FOR SELECT
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own assembly jobs" ON editai_assembly_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own assembly jobs" ON editai_assembly_jobs
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

CREATE POLICY "Users can delete own assembly jobs" ON editai_assembly_jobs
  FOR DELETE
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Service role bypass for assembly jobs" ON editai_assembly_jobs
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================
-- UPDATED_AT TRIGGERS
-- =====================================================
DROP TRIGGER IF EXISTS editai_pipelines_updated_at ON editai_pipelines;
CREATE TRIGGER editai_pipelines_updated_at
  BEFORE UPDATE ON editai_pipelines
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

DROP TRIGGER IF EXISTS editai_assembly_jobs_updated_at ON editai_assembly_jobs;
CREATE TRIGGER editai_assembly_jobs_updated_at
  BEFORE UPDATE ON editai_assembly_jobs
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- =====================================================
-- Migration 016 Complete
-- =====================================================
