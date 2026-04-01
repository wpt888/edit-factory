-- Atomic batch increment for segment usage_count
-- Called after successful renders to track which segments have been used
CREATE OR REPLACE FUNCTION increment_segment_usage_batch(segment_ids UUID[])
RETURNS void AS $$
  UPDATE editai_segments
  SET usage_count = COALESCE(usage_count, 0) + 1,
      updated_at = now()
  WHERE id = ANY(segment_ids);
$$ LANGUAGE sql;
