-- Migration 041: Add caption column to editai_clip_content
-- Stores the final selected caption per clip for use by the V2 smart schedule executor.

ALTER TABLE editai_clip_content ADD COLUMN IF NOT EXISTS caption TEXT;

-- Also add to editai_clips for quick access without joining clip_content
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS caption TEXT;
