-- Complete pipeline-template export/import state.
-- New user-configurable settings are added inside this JSONB contract, which
-- avoids a new persistence column and a new export code path for every option.
ALTER TABLE public.editai_pipelines
ADD COLUMN IF NOT EXISTS template_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.editai_pipelines.template_settings IS
  'Versioned, portable pipeline settings used by JSON template export/import; never contains credentials or runtime artifacts.';
