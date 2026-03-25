-- Add single_use flag to segments
-- When true, the segment will appear at most once per render (across all SRT matches)
ALTER TABLE editai_segments ADD COLUMN IF NOT EXISTS single_use BOOLEAN DEFAULT false;
