-- Migration 024: Add deleted_at column for soft-delete trash functionality
-- Apply this via: Supabase Dashboard > SQL Editor > New Query

ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_editai_clips_deleted_at ON editai_clips (deleted_at) WHERE deleted_at IS NOT NULL;
COMMENT ON COLUMN editai_clips.deleted_at IS 'Timestamp when clip was soft-deleted; NULL means active; non-NULL means in trash';
