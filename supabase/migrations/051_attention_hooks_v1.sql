ALTER TABLE public.editai_pipelines
ADD COLUMN IF NOT EXISTS attention_timeline JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.editai_pipelines.attention_timeline IS
'Versioned AttentionTimeline documents keyed by PreviewKey (0, 0_A, 0_B).';

CREATE TABLE IF NOT EXISTS public.editai_attention_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.editai_attention_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile attention templates" ON public.editai_attention_templates
USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = (SELECT auth.uid())))
WITH CHECK (profile_id IN (SELECT id FROM public.profiles WHERE user_id = (SELECT auth.uid())));

-- PostgREST caches writable table metadata. New relations can answer a simple
-- GET before their mutation routes appear, so explicitly refresh the cache.
NOTIFY pgrst, 'reload schema';
