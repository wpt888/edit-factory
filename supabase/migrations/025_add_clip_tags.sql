-- Migration 025: Add tags column for clip organization
-- Apply this via: Supabase Dashboard > SQL Editor > New Query

-- Use text[] array for tags — simple, queryable with ANY/ALL operators, no join table needed
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- GIN index for fast array containment queries (@> operator)
CREATE INDEX IF NOT EXISTS idx_editai_clips_tags ON editai_clips USING GIN (tags);

COMMENT ON COLUMN editai_clips.tags IS 'User-defined tags for clip organization; stored as text array';
