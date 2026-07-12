-- Persist the selected Step 3 pacing so previews and renders use the same value.
ALTER TABLE editai_pipelines
  ADD COLUMN IF NOT EXISTS min_segment_duration REAL DEFAULT 3.0;
