-- =====================================================
-- Migration 003: Add profile_id to Tables
-- Purpose: Add nullable profile_id columns with NOT VALID FKs (zero downtime)
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================
-- Phase: 01-database-foundation
-- Plan: 01-01
-- This migration adds profile_id columns to editai_projects, jobs, and api_costs
-- using PostgreSQL's NOT VALID pattern to avoid blocking production operations.
-- Indexes are created immediately for RLS performance in migration 005.
-- =====================================================

-- ============== Add profile_id to editai_projects ==============

-- Check if column exists, add if missing (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'editai_projects'
    AND column_name = 'profile_id'
  ) THEN
    ALTER TABLE editai_projects ADD COLUMN profile_id UUID;
  END IF;
END $$;

-- Add foreign key WITHOUT validation (fast operation, no table scan)
-- NOT VALID means existing NULL values are allowed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_projects_profile_id'
  ) THEN
    ALTER TABLE editai_projects
    ADD CONSTRAINT fk_projects_profile_id
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
    ON DELETE CASCADE
    NOT VALID;
  END IF;
END $$;

-- Create indexes immediately (before validation, before RLS)
-- These are critical for RLS policy performance
CREATE INDEX IF NOT EXISTS idx_projects_profile_id ON editai_projects(profile_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_profile ON editai_projects(user_id, profile_id);

-- ============== Add profile_id to jobs table ==============

-- Check if jobs table exists first
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'jobs'
  ) THEN
    -- Add column if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'jobs'
      AND column_name = 'profile_id'
    ) THEN
      ALTER TABLE jobs ADD COLUMN profile_id UUID;
    END IF;

    -- Add foreign key (ON DELETE SET NULL because jobs may outlive profiles)
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'fk_jobs_profile_id'
    ) THEN
      ALTER TABLE jobs
      ADD CONSTRAINT fk_jobs_profile_id
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
      ON DELETE SET NULL
      NOT VALID;
    END IF;

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_jobs_profile_id ON jobs(profile_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_profile_created ON jobs(profile_id, created_at DESC);
  END IF;
END $$;

-- ============== Add profile_id to api_costs table ==============

-- Check if api_costs table exists first
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'api_costs'
  ) THEN
    -- Add column if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'api_costs'
      AND column_name = 'profile_id'
    ) THEN
      ALTER TABLE api_costs ADD COLUMN profile_id UUID;
    END IF;

    -- Add foreign key (ON DELETE SET NULL because costs may outlive profiles)
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'fk_costs_profile_id'
    ) THEN
      ALTER TABLE api_costs
      ADD CONSTRAINT fk_costs_profile_id
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
      ON DELETE SET NULL
      NOT VALID;
    END IF;

    -- Create index
    CREATE INDEX IF NOT EXISTS idx_costs_profile_id ON api_costs(profile_id);
  END IF;
END $$;

-- =====================================================
-- NOTE: editai_clips, editai_clip_content, and editai_project_segments
-- do NOT need profile_id columns. They inherit profile context through
-- their foreign key relationships:
--   clips -> projects -> profiles
--   clip_content -> clips -> projects -> profiles
--   project_segments -> projects -> profiles
-- =====================================================

-- =====================================================
-- Migration 003 Complete
-- Next: Run 004_backfill_default_profiles.sql
-- =====================================================
