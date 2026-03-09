-- Migration 026: Smart Schedule Publishing
-- Adds tables for scheduling clips from multiple collections across days

-- Schedule Plans table
CREATE TABLE IF NOT EXISTS editai_schedule_plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    integration_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    start_date      DATE NOT NULL,
    post_time       TIME NOT NULL DEFAULT '09:00',
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    collection_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
    caption_template TEXT,
    total_clips     INT NOT NULL DEFAULT 0,
    scheduled_count INT NOT NULL DEFAULT 0,
    failed_count    INT NOT NULL DEFAULT 0,
    summary         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_plans_profile ON editai_schedule_plans(profile_id);
CREATE INDEX IF NOT EXISTS idx_schedule_plans_status ON editai_schedule_plans(status);

-- Enable RLS
ALTER TABLE editai_schedule_plans ENABLE ROW LEVEL SECURITY;

-- Service role bypass
CREATE POLICY "Service role bypass for editai_schedule_plans"
    ON editai_schedule_plans
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Schedule Items table
CREATE TABLE IF NOT EXISTS editai_schedule_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id         UUID NOT NULL REFERENCES editai_schedule_plans(id) ON DELETE CASCADE,
    clip_id         UUID NOT NULL REFERENCES editai_clips(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL,
    scheduled_date  DATE NOT NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    postiz_post_id  TEXT,
    error_message   TEXT,
    caption         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedule_items_plan ON editai_schedule_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_clip ON editai_schedule_items(clip_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_date ON editai_schedule_items(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_schedule_items_status ON editai_schedule_items(status);

-- Enable RLS
ALTER TABLE editai_schedule_items ENABLE ROW LEVEL SECURITY;

-- Service role bypass
CREATE POLICY "Service role bypass for editai_schedule_items"
    ON editai_schedule_items
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
