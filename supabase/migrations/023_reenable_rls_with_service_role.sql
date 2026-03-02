-- =====================================================
-- Migration 023: Re-enable RLS on all editai_* tables
-- Purpose: Restore Row Level Security with profile-based isolation
--          and service_role bypass so backend (using service_role key)
--          can bypass RLS while authenticated users see only their own data.
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================
-- Reverses migration 022 which disabled RLS.
-- The backend now uses SUPABASE_SERVICE_ROLE_KEY (not anon key),
-- so service_role bypass policies allow full backend access.
-- =====================================================

BEGIN;

-- =====================================================
-- STEP 1: Re-enable RLS on all 13 editai_* tables
-- =====================================================

ALTER TABLE editai_assembly_jobs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_clip_content    ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_clips           ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_export_presets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_exports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_pipelines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_postiz_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_product_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_project_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_segments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_source_videos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_tts_assets      ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- STEP 2: Drop all existing policies (idempotent)
-- Drop leftovers from migrations 001, 005, and 016
-- =====================================================

-- editai_projects (from 001 and 005)
DROP POLICY IF EXISTS "Users can view own projects" ON editai_projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON editai_projects;
DROP POLICY IF EXISTS "Users can update own projects" ON editai_projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON editai_projects;
DROP POLICY IF EXISTS "Service role bypass for projects" ON editai_projects;
DROP POLICY IF EXISTS "Users can view projects in owned profiles" ON editai_projects;
DROP POLICY IF EXISTS "Users can insert projects to owned profiles" ON editai_projects;
DROP POLICY IF EXISTS "Users can update projects in owned profiles" ON editai_projects;
DROP POLICY IF EXISTS "Users can delete projects in owned profiles" ON editai_projects;
DROP POLICY IF EXISTS "Service role full access" ON editai_projects;

-- editai_clips (from 001 and 005)
DROP POLICY IF EXISTS "Users can view clips of own projects" ON editai_clips;
DROP POLICY IF EXISTS "Users can insert clips to own projects" ON editai_clips;
DROP POLICY IF EXISTS "Users can update clips of own projects" ON editai_clips;
DROP POLICY IF EXISTS "Users can delete clips of own projects" ON editai_clips;
DROP POLICY IF EXISTS "Service role bypass for clips" ON editai_clips;
DROP POLICY IF EXISTS "Users can view clips in owned profiles" ON editai_clips;
DROP POLICY IF EXISTS "Users can insert clips to owned profiles" ON editai_clips;
DROP POLICY IF EXISTS "Users can update clips in owned profiles" ON editai_clips;
DROP POLICY IF EXISTS "Users can delete clips in owned profiles" ON editai_clips;
DROP POLICY IF EXISTS "Service role full access" ON editai_clips;

-- editai_clip_content (from 001 and 005)
DROP POLICY IF EXISTS "Users can view clip content of own projects" ON editai_clip_content;
DROP POLICY IF EXISTS "Users can insert clip content to own projects" ON editai_clip_content;
DROP POLICY IF EXISTS "Users can update clip content of own projects" ON editai_clip_content;
DROP POLICY IF EXISTS "Users can delete clip content of own projects" ON editai_clip_content;
DROP POLICY IF EXISTS "Service role bypass for clip content" ON editai_clip_content;
DROP POLICY IF EXISTS "Users can view clip content in owned profiles" ON editai_clip_content;
DROP POLICY IF EXISTS "Users can insert clip content to owned profiles" ON editai_clip_content;
DROP POLICY IF EXISTS "Users can update clip content in owned profiles" ON editai_clip_content;
DROP POLICY IF EXISTS "Users can delete clip content in owned profiles" ON editai_clip_content;
DROP POLICY IF EXISTS "Service role full access" ON editai_clip_content;

-- editai_project_segments (from 001 and 005)
DROP POLICY IF EXISTS "Users can view segments of own projects" ON editai_project_segments;
DROP POLICY IF EXISTS "Users can insert segments to own projects" ON editai_project_segments;
DROP POLICY IF EXISTS "Users can update segments of own projects" ON editai_project_segments;
DROP POLICY IF EXISTS "Users can delete segments of own projects" ON editai_project_segments;
DROP POLICY IF EXISTS "Service role bypass for segments" ON editai_project_segments;
DROP POLICY IF EXISTS "Users can view segments in owned profiles" ON editai_project_segments;
DROP POLICY IF EXISTS "Users can insert segments to owned profiles" ON editai_project_segments;
DROP POLICY IF EXISTS "Users can update segments in owned profiles" ON editai_project_segments;
DROP POLICY IF EXISTS "Users can delete segments in owned profiles" ON editai_project_segments;
DROP POLICY IF EXISTS "Service role full access" ON editai_project_segments;

-- editai_pipelines (from 016)
DROP POLICY IF EXISTS "Users can view own pipelines" ON editai_pipelines;
DROP POLICY IF EXISTS "Users can insert own pipelines" ON editai_pipelines;
DROP POLICY IF EXISTS "Users can update own pipelines" ON editai_pipelines;
DROP POLICY IF EXISTS "Users can delete own pipelines" ON editai_pipelines;
DROP POLICY IF EXISTS "Service role bypass for pipelines" ON editai_pipelines;
DROP POLICY IF EXISTS "Service role full access" ON editai_pipelines;

-- editai_assembly_jobs (from 016)
DROP POLICY IF EXISTS "Users can view own assembly jobs" ON editai_assembly_jobs;
DROP POLICY IF EXISTS "Users can insert own assembly jobs" ON editai_assembly_jobs;
DROP POLICY IF EXISTS "Users can update own assembly jobs" ON editai_assembly_jobs;
DROP POLICY IF EXISTS "Users can delete own assembly jobs" ON editai_assembly_jobs;
DROP POLICY IF EXISTS "Service role bypass for assembly jobs" ON editai_assembly_jobs;
DROP POLICY IF EXISTS "Service role full access" ON editai_assembly_jobs;

-- editai_tts_assets (no prior policies)
DROP POLICY IF EXISTS "Service role full access" ON editai_tts_assets;
DROP POLICY IF EXISTS "Users can view own tts assets" ON editai_tts_assets;
DROP POLICY IF EXISTS "Users can insert own tts assets" ON editai_tts_assets;
DROP POLICY IF EXISTS "Users can update own tts assets" ON editai_tts_assets;
DROP POLICY IF EXISTS "Users can delete own tts assets" ON editai_tts_assets;

-- editai_source_videos (no prior RLS policies set after 008)
DROP POLICY IF EXISTS "Service role full access" ON editai_source_videos;
DROP POLICY IF EXISTS "Users can view own source videos" ON editai_source_videos;
DROP POLICY IF EXISTS "Users can insert own source videos" ON editai_source_videos;
DROP POLICY IF EXISTS "Users can update own source videos" ON editai_source_videos;
DROP POLICY IF EXISTS "Users can delete own source videos" ON editai_source_videos;

-- editai_segments (no prior RLS policies set after 008)
DROP POLICY IF EXISTS "Service role full access" ON editai_segments;
DROP POLICY IF EXISTS "Users can view own segments" ON editai_segments;
DROP POLICY IF EXISTS "Users can insert own segments" ON editai_segments;
DROP POLICY IF EXISTS "Users can update own segments" ON editai_segments;
DROP POLICY IF EXISTS "Users can delete own segments" ON editai_segments;

-- editai_product_groups (no prior RLS policies)
DROP POLICY IF EXISTS "Service role full access" ON editai_product_groups;
DROP POLICY IF EXISTS "Users can view own product groups" ON editai_product_groups;
DROP POLICY IF EXISTS "Users can insert own product groups" ON editai_product_groups;
DROP POLICY IF EXISTS "Users can update own product groups" ON editai_product_groups;
DROP POLICY IF EXISTS "Users can delete own product groups" ON editai_product_groups;

-- editai_export_presets (no prior RLS policies)
DROP POLICY IF EXISTS "Service role full access" ON editai_export_presets;
DROP POLICY IF EXISTS "Authenticated users can view export presets" ON editai_export_presets;
DROP POLICY IF EXISTS "Authenticated users can insert export presets" ON editai_export_presets;
DROP POLICY IF EXISTS "Authenticated users can update export presets" ON editai_export_presets;
DROP POLICY IF EXISTS "Authenticated users can delete export presets" ON editai_export_presets;

-- editai_exports (no prior RLS policies)
DROP POLICY IF EXISTS "Service role full access" ON editai_exports;
DROP POLICY IF EXISTS "Users can view own exports" ON editai_exports;
DROP POLICY IF EXISTS "Users can insert own exports" ON editai_exports;
DROP POLICY IF EXISTS "Users can update own exports" ON editai_exports;
DROP POLICY IF EXISTS "Users can delete own exports" ON editai_exports;

-- editai_postiz_publications (no prior RLS policies)
DROP POLICY IF EXISTS "Service role full access" ON editai_postiz_publications;
DROP POLICY IF EXISTS "Users can view own publications" ON editai_postiz_publications;
DROP POLICY IF EXISTS "Users can insert own publications" ON editai_postiz_publications;
DROP POLICY IF EXISTS "Users can update own publications" ON editai_postiz_publications;
DROP POLICY IF EXISTS "Users can delete own publications" ON editai_postiz_publications;

-- =====================================================
-- STEP 3: Create service_role bypass policies for all tables
-- Uses TO service_role with USING (true) for full bypass.
-- =====================================================

CREATE POLICY "Service role full access" ON editai_projects
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_clips
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_clip_content
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_project_segments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_pipelines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_assembly_jobs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_tts_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_source_videos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_segments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_product_groups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_export_presets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_exports
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON editai_postiz_publications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================
-- STEP 4: Create profile-based isolation policies for authenticated role
-- Uses (SELECT auth.uid()) wrapper to avoid per-row re-evaluation.
-- =====================================================

-- ========== editai_projects: has direct profile_id ==========

CREATE POLICY "Users can view projects in owned profiles" ON editai_projects
  FOR SELECT TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert projects to owned profiles" ON editai_projects
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update projects in owned profiles" ON editai_projects
  FOR UPDATE TO authenticated
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

CREATE POLICY "Users can delete projects in owned profiles" ON editai_projects
  FOR DELETE TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_clips: inherits via project_id -> editai_projects ==========

CREATE POLICY "Users can view clips in owned profiles" ON editai_clips
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_projects p
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert clips to owned profiles" ON editai_clips
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM editai_projects p
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update clips in owned profiles" ON editai_clips
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_projects p
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete clips in owned profiles" ON editai_clips
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_projects p
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_clip_content: inherits via clip_id -> editai_clips -> editai_projects ==========

CREATE POLICY "Users can view clip content in owned profiles" ON editai_clip_content
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_clip_content.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert clip content to owned profiles" ON editai_clip_content
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_clip_content.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update clip content in owned profiles" ON editai_clip_content
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_clip_content.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete clip content in owned profiles" ON editai_clip_content
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_clip_content.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_project_segments: inherits via project_id -> editai_projects ==========

CREATE POLICY "Users can view segments in owned profiles" ON editai_project_segments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_projects p
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.id = editai_project_segments.project_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert segments to owned profiles" ON editai_project_segments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM editai_projects p
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.id = editai_project_segments.project_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update segments in owned profiles" ON editai_project_segments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_projects p
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.id = editai_project_segments.project_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete segments in owned profiles" ON editai_project_segments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_projects p
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.id = editai_project_segments.project_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_pipelines: has direct profile_id ==========

CREATE POLICY "Users can view own pipelines" ON editai_pipelines
  FOR SELECT TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own pipelines" ON editai_pipelines
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own pipelines" ON editai_pipelines
  FOR UPDATE TO authenticated
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
  FOR DELETE TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_assembly_jobs: has direct profile_id ==========

CREATE POLICY "Users can view own assembly jobs" ON editai_assembly_jobs
  FOR SELECT TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own assembly jobs" ON editai_assembly_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own assembly jobs" ON editai_assembly_jobs
  FOR UPDATE TO authenticated
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
  FOR DELETE TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_tts_assets: has direct profile_id ==========

CREATE POLICY "Users can view own tts assets" ON editai_tts_assets
  FOR SELECT TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own tts assets" ON editai_tts_assets
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own tts assets" ON editai_tts_assets
  FOR UPDATE TO authenticated
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

CREATE POLICY "Users can delete own tts assets" ON editai_tts_assets
  FOR DELETE TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_source_videos: has direct profile_id (added in migration 008) ==========

CREATE POLICY "Users can view own source videos" ON editai_source_videos
  FOR SELECT TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own source videos" ON editai_source_videos
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own source videos" ON editai_source_videos
  FOR UPDATE TO authenticated
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

CREATE POLICY "Users can delete own source videos" ON editai_source_videos
  FOR DELETE TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_segments: has direct profile_id (added in migration 008) ==========

CREATE POLICY "Users can view own segments" ON editai_segments
  FOR SELECT TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own segments" ON editai_segments
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own segments" ON editai_segments
  FOR UPDATE TO authenticated
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

CREATE POLICY "Users can delete own segments" ON editai_segments
  FOR DELETE TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_product_groups: has direct profile_id ==========

CREATE POLICY "Users can view own product groups" ON editai_product_groups
  FOR SELECT TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own product groups" ON editai_product_groups
  FOR INSERT TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own product groups" ON editai_product_groups
  FOR UPDATE TO authenticated
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

CREATE POLICY "Users can delete own product groups" ON editai_product_groups
  FOR DELETE TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_export_presets: global shared presets, all authenticated users can view ==========
-- Export presets are system-wide (no profile_id). Authenticated users can read all presets.
-- Only service_role (backend) can write/modify presets.

CREATE POLICY "Authenticated users can view export presets" ON editai_export_presets
  FOR SELECT TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE for authenticated role — managed by backend via service_role.

-- ========== editai_exports: inherits via clip_id -> editai_clips -> editai_projects ==========

CREATE POLICY "Users can view own exports" ON editai_exports
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_exports.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own exports" ON editai_exports
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_exports.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own exports" ON editai_exports
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_exports.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete own exports" ON editai_exports
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_exports.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

-- ========== editai_postiz_publications: inherits via clip_id -> editai_clips -> editai_projects ==========

CREATE POLICY "Users can view own publications" ON editai_postiz_publications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_postiz_publications.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own publications" ON editai_postiz_publications
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_postiz_publications.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own publications" ON editai_postiz_publications
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_postiz_publications.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete own publications" ON editai_postiz_publications
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_clips c
      JOIN editai_projects p ON p.id = c.project_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE c.id = editai_postiz_publications.clip_id
        AND pr.user_id = (SELECT auth.uid())
    )
  );

COMMIT;

-- =====================================================
-- STEP 5: Verify RLS is enabled on all 13 tables
-- =====================================================

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'editai_assembly_jobs',
    'editai_clip_content',
    'editai_clips',
    'editai_export_presets',
    'editai_exports',
    'editai_pipelines',
    'editai_postiz_publications',
    'editai_product_groups',
    'editai_project_segments',
    'editai_projects',
    'editai_segments',
    'editai_source_videos',
    'editai_tts_assets'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = tbl
        AND rowsecurity = true
    ) THEN
      RAISE EXCEPTION 'RLS NOT enabled on table: %', tbl;
    END IF;
    RAISE NOTICE 'RLS verified: %', tbl;
  END LOOP;
  RAISE NOTICE '=== Migration 023 complete: RLS enabled on all 13 editai_* tables ===';
END $$;
