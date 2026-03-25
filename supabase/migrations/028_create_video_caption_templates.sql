-- Video caption templates for social media caption generation in pipeline Step 4
CREATE TABLE IF NOT EXISTS video_caption_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prompt_template TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_caption_templates_profile
    ON video_caption_templates(profile_id);

-- RLS
ALTER TABLE video_caption_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own video caption templates"
    ON video_caption_templates
    FOR ALL
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());
