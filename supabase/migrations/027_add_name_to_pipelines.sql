-- Add name column to editai_pipelines for identifying script sets
ALTER TABLE editai_pipelines ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '';
