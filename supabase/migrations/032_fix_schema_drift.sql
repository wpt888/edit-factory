-- Migration 032: Fix schema drift identified by codebase audit
-- Addresses: missing tables, missing columns, column renames, missing indexes

-- 1. Create editai_exports table (used by library_routes.py render task)
CREATE TABLE IF NOT EXISTS editai_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clip_id UUID REFERENCES editai_clips(id) ON DELETE CASCADE,
    preset_name TEXT,
    output_path TEXT,
    file_size BIGINT DEFAULT 0,
    status TEXT DEFAULT 'completed',
    profile_id UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add profile_id to jobs table if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'jobs' AND column_name = 'profile_id'
    ) THEN
        ALTER TABLE jobs ADD COLUMN profile_id UUID;
    END IF;
END $$;

-- 3. Fix api_costs: ensure 'cost' column exists (code uses 'cost', schema had 'cost_usd')
DO $$
BEGIN
    -- If cost_usd exists but cost does not, rename it
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'api_costs' AND column_name = 'cost_usd'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'api_costs' AND column_name = 'cost'
    ) THEN
        ALTER TABLE api_costs RENAME COLUMN cost_usd TO cost;
    END IF;
    -- If neither exists, add cost
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'api_costs' AND column_name = 'cost'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'api_costs' AND column_name = 'cost_usd'
    ) THEN
        ALTER TABLE api_costs ADD COLUMN cost DECIMAL(10,6) DEFAULT 0;
    END IF;
END $$;

-- 4. Add missing columns to editai_pipelines (used by pipeline_routes.py)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'editai_pipelines' AND column_name = 'tts_previews'
    ) THEN
        ALTER TABLE editai_pipelines ADD COLUMN tts_previews JSONB;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'editai_pipelines' AND column_name = 'preview_renders'
    ) THEN
        ALTER TABLE editai_pipelines ADD COLUMN preview_renders JSONB;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'editai_pipelines' AND column_name = 'segment_usage'
    ) THEN
        ALTER TABLE editai_pipelines ADD COLUMN segment_usage JSONB;
    END IF;
END $$;

-- 5. Ensure UNIQUE constraint on editai_clip_content.clip_id (required for upsert)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'editai_clip_content' AND indexdef LIKE '%clip_id%' AND indexdef LIKE '%UNIQUE%'
    ) THEN
        -- Add unique constraint if not present
        ALTER TABLE editai_clip_content ADD CONSTRAINT editai_clip_content_clip_id_unique UNIQUE (clip_id);
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 6. Add composite index on editai_clips (project_id, is_deleted) — most queried pattern
CREATE INDEX IF NOT EXISTS idx_editai_clips_project_not_deleted
    ON editai_clips (project_id, is_deleted)
    WHERE is_deleted = false;

-- 7. Add functional index on jobs JSONB for project_id lookups
CREATE INDEX IF NOT EXISTS idx_jobs_data_project_id
    ON jobs ((data->>'project_id'))
    WHERE data->>'project_id' IS NOT NULL;
