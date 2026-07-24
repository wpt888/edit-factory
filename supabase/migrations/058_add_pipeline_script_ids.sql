-- Stable script identities prevent index-based output state from moving after
-- scripts are deleted or reordered. This is runtime state, separate from the
-- portable pipeline template document.
ALTER TABLE public.editai_pipelines
ADD COLUMN IF NOT EXISTS script_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.editai_pipelines.script_ids IS
  'Durable ScriptId values aligned with scripts; used to derive stable OutputId values.';
