-- =====================================================
-- Migration 004: Backfill Default Profiles
-- Purpose: Create default profiles and assign existing data
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================
-- Phase: 01-database-foundation
-- Plan: 01-01
-- This migration creates a default profile for each user that has projects,
-- then backfills all existing projects with their user's default profile_id.
-- Also attempts to backfill jobs and api_costs if they have user tracking.
-- =====================================================

-- ============== Step 1: Create default profiles ==============
-- Create one default profile for each user that has projects
-- Uses ON CONFLICT to be idempotent (safe to re-run)

INSERT INTO profiles (user_id, name, description, is_default, created_at)
SELECT DISTINCT
  p.user_id,
  'Default Profile' AS name,
  'Auto-created during profile migration' AS description,
  true AS is_default,
  NOW() AS created_at
FROM editai_projects p
WHERE p.user_id IS NOT NULL
ON CONFLICT (user_id) WHERE (is_default = true) DO NOTHING;

-- Log how many profiles were created
DO $$
DECLARE
  profile_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO profile_count FROM profiles WHERE is_default = true;
  RAISE NOTICE 'Default profiles exist: %', profile_count;
END $$;

-- ============== Step 2: Backfill editai_projects ==============
-- Assign each project to its user's default profile

UPDATE editai_projects p
SET profile_id = (
  SELECT pr.id
  FROM profiles pr
  WHERE pr.user_id = p.user_id
  AND pr.is_default = true
  LIMIT 1
)
WHERE profile_id IS NULL
AND user_id IS NOT NULL;

-- Log backfill results
DO $$
DECLARE
  updated_count INTEGER;
  remaining_null INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM editai_projects
  WHERE profile_id IS NOT NULL;

  SELECT COUNT(*) INTO remaining_null
  FROM editai_projects
  WHERE profile_id IS NULL AND user_id IS NOT NULL;

  RAISE NOTICE 'Projects assigned to profiles: %', updated_count;
  RAISE NOTICE 'Projects still without profile (with user_id): %', remaining_null;
END $$;

-- ============== Step 3: Backfill jobs table (if exists and has user context) ==============
-- Attempt to extract user_id from jobs.data JSONB field and backfill

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'jobs'
  ) THEN
    -- Try to backfill jobs using data->>'user_id' field
    UPDATE jobs j
    SET profile_id = (
      SELECT pr.id
      FROM profiles pr
      WHERE pr.user_id::TEXT = j.data->>'user_id'
      AND pr.is_default = true
      LIMIT 1
    )
    WHERE profile_id IS NULL
    AND j.data->>'user_id' IS NOT NULL;

    RAISE NOTICE 'Jobs table backfill attempted (based on data.user_id)';
  ELSE
    RAISE NOTICE 'Jobs table does not exist, skipping backfill';
  END IF;
END $$;

-- ============== Step 4: Backfill api_costs table (if exists and has user context) ==============
-- Attempt to extract user_id from api_costs.metadata JSONB field and backfill

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'api_costs'
  ) THEN
    -- Try to backfill api_costs using metadata->>'user_id' field
    UPDATE api_costs ac
    SET profile_id = (
      SELECT pr.id
      FROM profiles pr
      WHERE pr.user_id::TEXT = ac.metadata->>'user_id'
      AND pr.is_default = true
      LIMIT 1
    )
    WHERE profile_id IS NULL
    AND ac.metadata->>'user_id' IS NOT NULL;

    RAISE NOTICE 'API costs table backfill attempted (based on metadata.user_id)';
  ELSE
    RAISE NOTICE 'API costs table does not exist, skipping backfill';
  END IF;
END $$;

-- ============== Step 5: Verify backfill completeness ==============
-- This verification MUST pass before proceeding to migration 005

DO $$
DECLARE
  orphaned_projects INTEGER;
BEGIN
  -- Count projects with user_id but no profile_id
  SELECT COUNT(*) INTO orphaned_projects
  FROM editai_projects
  WHERE profile_id IS NULL
  AND user_id IS NOT NULL;

  -- Fail migration if any orphaned projects exist
  IF orphaned_projects > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % projects have user_id but no profile_id. Cannot proceed to migration 005.', orphaned_projects;
  END IF;

  -- Success message
  RAISE NOTICE '✓ Backfill verification passed. All projects with user_id are assigned to profiles.';
END $$;

-- =====================================================
-- Migration 004 Complete
-- Next: Run 005_enforce_constraints_and_rls.sql
-- =====================================================
