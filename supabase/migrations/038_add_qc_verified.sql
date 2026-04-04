-- Add quality control verification flag to editai_clips
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS qc_verified BOOLEAN DEFAULT FALSE;
