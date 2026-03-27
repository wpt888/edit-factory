ALTER TABLE editai_pipelines ADD COLUMN IF NOT EXISTS selected_captions JSONB DEFAULT '{}'::jsonb;
