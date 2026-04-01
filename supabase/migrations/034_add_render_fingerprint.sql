-- Add render_fingerprint column to editai_clips for render deduplication
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS render_fingerprint TEXT;
