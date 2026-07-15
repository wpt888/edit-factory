-- Persist Step 1 script-generation and Step 2 per-variant TTS job state.
-- These JSON documents let the browser resume polling after navigation or refresh.
ALTER TABLE public.editai_pipelines
ADD COLUMN IF NOT EXISTS generation_job JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS tts_jobs JSONB NOT NULL DEFAULT '{}'::jsonb;
