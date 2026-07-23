-- Idempotent repair for deployments where migration 051 was marked applied
-- without creating the profile-scoped attention-template storage.
ALTER TABLE public.editai_pipelines
ADD COLUMN IF NOT EXISTS attention_timeline JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.editai_attention_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attention_templates_profile
ON public.editai_attention_templates(profile_id);

ALTER TABLE public.editai_attention_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'editai_attention_templates'
      AND policyname = 'profile attention templates'
  ) THEN
    CREATE POLICY "profile attention templates" ON public.editai_attention_templates
    USING (profile_id IN (SELECT id FROM public.profiles WHERE user_id = (SELECT auth.uid())))
    WITH CHECK (profile_id IN (SELECT id FROM public.profiles WHERE user_id = (SELECT auth.uid())));
  END IF;
END
$$;

-- Make the newly repaired table immediately available to POST/PATCH/DELETE.
NOTIFY pgrst, 'reload schema';
