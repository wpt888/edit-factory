-- Migration 040: Add visual_version for Meta render multiplication
--
-- When meta_multiplication is enabled, each variant renders twice:
--   Version A (Instagram): different segments + red text/white outline
--   Version B (Facebook):  different segments + white text/red outline
--
-- visual_version tracks which version a clip/export belongs to.
-- NULL means legacy single-version render (backwards compatible).

-- Add to editai_clips table (main clip records used by backend)
ALTER TABLE editai_clips
ADD COLUMN IF NOT EXISTS visual_version TEXT DEFAULT NULL;

COMMENT ON COLUMN editai_clips.visual_version IS 'Meta visual profile version: A=Instagram, B=Facebook, NULL=single render';

-- Add to editai_exports table (export/render records)
ALTER TABLE editai_exports
ADD COLUMN IF NOT EXISTS visual_version TEXT DEFAULT NULL;

COMMENT ON COLUMN editai_exports.visual_version IS 'Meta visual profile version: A=Instagram, B=Facebook, NULL=single render';

-- Add to editai_pipelines (top-level flag for easy querying)
ALTER TABLE editai_pipelines
ADD COLUMN IF NOT EXISTS meta_multiplication BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN editai_pipelines.meta_multiplication IS 'Whether this pipeline uses Meta render multiplication (2x renders per variant)';

-- Index for filtering clips by visual version
CREATE INDEX IF NOT EXISTS idx_editai_clips_visual_version ON editai_clips(visual_version) WHERE visual_version IS NOT NULL;
