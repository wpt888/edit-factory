-- =====================================================
-- Migration 021: Add source_video_ids to editai_pipelines
-- Purpose: Store the user's selected source video UUIDs in the pipeline
--          so the selection persists across page reloads (SRC-04)
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================

ALTER TABLE editai_pipelines
ADD COLUMN IF NOT EXISTS source_video_ids jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN editai_pipelines.source_video_ids IS 'Selected source video UUIDs for segment matching';

-- =====================================================
-- Migration 021 Complete
-- =====================================================
