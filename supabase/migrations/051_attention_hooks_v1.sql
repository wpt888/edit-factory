ALTER TABLE editai_pipelines
ADD COLUMN IF NOT EXISTS attention_timeline JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN editai_pipelines.attention_timeline IS
'Versioned AttentionTimeline documents keyed by PreviewKey (0, 0_A, 0_B).';

CREATE TABLE IF NOT EXISTS editai_attention_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES editai_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE editai_attention_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile attention templates" ON editai_attention_templates
USING (profile_id IN (SELECT id FROM editai_profiles WHERE user_id = auth.uid()))
WITH CHECK (profile_id IN (SELECT id FROM editai_profiles WHERE user_id = auth.uid()));
