-- Migration: add_missing_columns_bugfix
-- Fixes BUGs 02-05: Code writes columns that don't exist in the DB

-- BUG-02: editai_projects missing columns
ALTER TABLE editai_projects ADD COLUMN IF NOT EXISTS source_video_path text;
ALTER TABLE editai_projects ADD COLUMN IF NOT EXISTS source_video_duration double precision;
ALTER TABLE editai_projects ADD COLUMN IF NOT EXISTS source_video_width integer;
ALTER TABLE editai_projects ADD COLUMN IF NOT EXISTS source_video_height integer;
ALTER TABLE editai_projects ADD COLUMN IF NOT EXISTS variants_count integer DEFAULT 0;
ALTER TABLE editai_projects ADD COLUMN IF NOT EXISTS selected_count integer DEFAULT 0;
ALTER TABLE editai_projects ADD COLUMN IF NOT EXISTS exported_count integer DEFAULT 0;

-- BUG-03: editai_clips missing columns
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS variant_name text;
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS postiz_status text;
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS postiz_post_id text;
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS postiz_scheduled_at timestamptz;

-- BUG-04: editai_clip_content missing columns
ALTER TABLE editai_clip_content ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE editai_clip_content ADD COLUMN IF NOT EXISTS subtitle_settings jsonb;
ALTER TABLE editai_clip_content ADD COLUMN IF NOT EXISTS tts_voice_id text;
