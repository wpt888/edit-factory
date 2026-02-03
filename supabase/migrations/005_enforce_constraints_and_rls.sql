-- =====================================================
-- Migration 005: Enforce Constraints and Profile-Aware RLS
-- Purpose: Validate FKs, enforce NOT NULL, enable profile-based isolation
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================
-- Phase: 01-database-foundation
-- Plan: 01-01
-- This migration completes the profile migration by:
-- 1. Validating NOT VALID foreign keys
-- 2. Making profile_id NOT NULL on editai_projects (zero downtime pattern)
-- 3. Replacing user-only RLS policies with profile-aware policies
-- 4. Verifying the migration was successful
-- =====================================================

-- ============== PART 1: Validate Foreign Keys ==============
-- Validate the NOT VALID foreign keys from migration 003
-- This step scans tables but only acquires SHARE UPDATE EXCLUSIVE lock
-- Compatible with INSERT/UPDATE/DELETE operations (no downtime)

ALTER TABLE editai_projects VALIDATE CONSTRAINT fk_projects_profile_id;

-- Validate jobs FK if table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'jobs'
  ) THEN
    ALTER TABLE jobs VALIDATE CONSTRAINT fk_jobs_profile_id;
    RAISE NOTICE '✓ Jobs foreign key validated';
  END IF;
END $$;

-- Validate api_costs FK if table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'api_costs'
  ) THEN
    ALTER TABLE api_costs VALIDATE CONSTRAINT fk_costs_profile_id;
    RAISE NOTICE '✓ API costs foreign key validated';
  END IF;
END $$;

-- ============== PART 2: Add NOT NULL Constraint (Zero Downtime) ==============
-- Using PostgreSQL 12+ optimization pattern for zero-downtime NOT NULL
-- CRITICAL: Each step MUST be a separate ALTER TABLE statement

-- Step 1: Add check constraint without validation (fast, no table scan)
ALTER TABLE editai_projects
ADD CONSTRAINT projects_profile_id_not_null
CHECK (profile_id IS NOT NULL) NOT VALID;

-- Step 2: Validate constraint (SHARE UPDATE EXCLUSIVE lock, allows writes)
ALTER TABLE editai_projects
VALIDATE CONSTRAINT projects_profile_id_not_null;

-- Step 3: Set NOT NULL (fast because constraint proves no nulls exist)
ALTER TABLE editai_projects
ALTER COLUMN profile_id SET NOT NULL;

-- Step 4: Drop redundant check constraint
ALTER TABLE editai_projects
DROP CONSTRAINT projects_profile_id_not_null;

RAISE NOTICE '✓ NOT NULL constraint enforced on editai_projects.profile_id';

-- ============== PART 3: Enable Profile-Aware RLS ==============
-- Replace user-only RLS policies with profile-aware policies
-- All policy changes in a single transaction to avoid gaps

BEGIN;

  -- ========== editai_projects policies ==========
  -- Drop old user-only policies from migration 001
  DROP POLICY IF EXISTS "Users can view own projects" ON editai_projects;
  DROP POLICY IF EXISTS "Users can insert own projects" ON editai_projects;
  DROP POLICY IF EXISTS "Users can update own projects" ON editai_projects;
  DROP POLICY IF EXISTS "Users can delete own projects" ON editai_projects;

  -- Create new profile-aware policies using (SELECT auth.uid()) wrapper
  CREATE POLICY "Users can view projects in owned profiles" ON editai_projects
    FOR SELECT
    TO authenticated
    USING (
      profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can insert projects to owned profiles" ON editai_projects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can update projects in owned profiles" ON editai_projects
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

  CREATE POLICY "Users can delete projects in owned profiles" ON editai_projects
    FOR DELETE
    TO authenticated
    USING (
      profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    );

  -- Service role bypass remains unchanged
  -- (already exists from migration 001, no need to recreate)

  -- ========== editai_clips policies ==========
  -- Drop old user-only policies
  DROP POLICY IF EXISTS "Users can view clips of own projects" ON editai_clips;
  DROP POLICY IF EXISTS "Users can insert clips to own projects" ON editai_clips;
  DROP POLICY IF EXISTS "Users can update clips of own projects" ON editai_clips;
  DROP POLICY IF EXISTS "Users can delete clips of own projects" ON editai_clips;

  -- Create new profile-aware policies (inherit through projects)
  CREATE POLICY "Users can view clips in owned profiles" ON editai_clips
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can insert clips to owned profiles" ON editai_clips
    FOR INSERT
    TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can update clips in owned profiles" ON editai_clips
    FOR UPDATE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can delete clips in owned profiles" ON editai_clips
    FOR DELETE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  -- ========== editai_clip_content policies ==========
  -- Drop old user-only policies
  DROP POLICY IF EXISTS "Users can view clip content of own projects" ON editai_clip_content;
  DROP POLICY IF EXISTS "Users can insert clip content to own projects" ON editai_clip_content;
  DROP POLICY IF EXISTS "Users can update clip content of own projects" ON editai_clip_content;
  DROP POLICY IF EXISTS "Users can delete clip content of own projects" ON editai_clip_content;

  -- Create new profile-aware policies (inherit through clips -> projects)
  CREATE POLICY "Users can view clip content in owned profiles" ON editai_clip_content
    FOR SELECT
    TO authenticated
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
    FOR INSERT
    TO authenticated
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
    FOR UPDATE
    TO authenticated
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
    FOR DELETE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM editai_clips c
        JOIN editai_projects p ON p.id = c.project_id
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE c.id = editai_clip_content.clip_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  -- ========== editai_project_segments policies ==========
  -- Drop old user-only policies
  DROP POLICY IF EXISTS "Users can view segments of own projects" ON editai_project_segments;
  DROP POLICY IF EXISTS "Users can insert segments to own projects" ON editai_project_segments;
  DROP POLICY IF EXISTS "Users can update segments of own projects" ON editai_project_segments;
  DROP POLICY IF EXISTS "Users can delete segments of own projects" ON editai_project_segments;

  -- Create new profile-aware policies (inherit through projects)
  CREATE POLICY "Users can view segments in owned profiles" ON editai_project_segments
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_project_segments.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can insert segments to owned profiles" ON editai_project_segments
    FOR INSERT
    TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_project_segments.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can update segments in owned profiles" ON editai_project_segments
    FOR UPDATE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_project_segments.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can delete segments in owned profiles" ON editai_project_segments
    FOR DELETE
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_project_segments.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

COMMIT;

RAISE NOTICE '✓ Profile-aware RLS policies activated';

-- ============== PART 4: Verification ==============
-- Verify migration was successful

DO $$
BEGIN
  -- Verify indexes exist
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_projects_profile_id') THEN
    RAISE EXCEPTION 'Missing index: idx_projects_profile_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_projects_user_profile') THEN
    RAISE EXCEPTION 'Missing index: idx_projects_user_profile';
  END IF;

  -- Verify constraints exist
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_projects_profile_id') THEN
    RAISE EXCEPTION 'Missing constraint: fk_projects_profile_id';
  END IF;

  -- Verify RLS enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = 'editai_projects'
    AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS not enabled on editai_projects';
  END IF;

  -- Verify profile-aware policies exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'editai_projects'
    AND policyname = 'Users can view projects in owned profiles'
  ) THEN
    RAISE EXCEPTION 'Missing policy: Users can view projects in owned profiles';
  END IF;

  -- Verify no projects with user_id have NULL profile_id
  IF EXISTS (
    SELECT 1 FROM editai_projects
    WHERE user_id IS NOT NULL
    AND profile_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Data integrity violation: projects exist with user_id but no profile_id';
  END IF;

  RAISE NOTICE '✓✓✓ Migration 005 verification passed. Profile isolation active. ✓✓✓';
END $$;

-- =====================================================
-- Migration 005 Complete
-- All migrations applied successfully!
-- Database now has complete profile-based data isolation.
-- =====================================================
