ALTER TABLE editai_pipelines
ADD COLUMN IF NOT EXISTS script_names JSONB NOT NULL DEFAULT '[]'::jsonb;
