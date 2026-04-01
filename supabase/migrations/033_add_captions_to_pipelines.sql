-- Add captions column to editai_pipelines for persisting generated video captions
ALTER TABLE editai_pipelines ADD COLUMN IF NOT EXISTS captions JSONB DEFAULT '{}';
