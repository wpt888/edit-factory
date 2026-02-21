-- =====================================================
-- Migration 008: Add profile_id to Source Videos and Segments
-- Purpose: Isolate source videos and segments per profile
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================
-- Currently editai_source_videos and editai_segments are global (shared
-- across all profiles). This migration scopes them per profile so each
-- profile sees only its own source videos and segments.
-- =====================================================

-- ============== Add profile_id to editai_source_videos ==============

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'editai_source_videos'
    AND column_name = 'profile_id'
  ) THEN
    ALTER TABLE editai_source_videos ADD COLUMN profile_id UUID;
  END IF;
END $$;

-- FK constraint (NOT VALID for zero-downtime)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_source_videos_profile_id'
  ) THEN
    ALTER TABLE editai_source_videos
    ADD CONSTRAINT fk_source_videos_profile_id
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
    ON DELETE CASCADE
    NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_source_videos_profile_id
  ON editai_source_videos(profile_id);

-- ============== Add profile_id to editai_segments ==============

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'editai_segments'
    AND column_name = 'profile_id'
  ) THEN
    ALTER TABLE editai_segments ADD COLUMN profile_id UUID;
  END IF;
END $$;

-- FK constraint (NOT VALID for zero-downtime)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_segments_profile_id'
  ) THEN
    ALTER TABLE editai_segments
    ADD CONSTRAINT fk_segments_profile_id
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
    ON DELETE CASCADE
    NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_segments_profile_id
  ON editai_segments(profile_id);

-- ============== Backfill existing records ==============
-- Assign orphan source videos and segments to the default profile
-- of each user. If no default profile exists, records stay NULL.

UPDATE editai_source_videos sv
SET profile_id = (
  SELECT p.id FROM profiles p
  WHERE p.is_default = true
  LIMIT 1
)
WHERE sv.profile_id IS NULL;

UPDATE editai_segments seg
SET profile_id = (
  SELECT p.id FROM profiles p
  WHERE p.is_default = true
  LIMIT 1
)
WHERE seg.profile_id IS NULL;

-- =====================================================
-- Migration 008 Complete
-- =====================================================
