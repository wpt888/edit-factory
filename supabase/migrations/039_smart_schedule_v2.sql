-- Migration 039: Smart Schedule V2
-- Adds per-platform variant routing, time slots, and jitter support
-- Backward compatible: all new columns nullable/defaulted, old plans (plan_version=1) unchanged

-- editai_schedule_plans: new columns for smart scheduling
ALTER TABLE editai_schedule_plans ADD COLUMN IF NOT EXISTS platform_times JSONB DEFAULT NULL;
ALTER TABLE editai_schedule_plans ADD COLUMN IF NOT EXISTS jitter_minutes INT DEFAULT 0;
ALTER TABLE editai_schedule_plans ADD COLUMN IF NOT EXISTS jitter_seed INT DEFAULT NULL;
ALTER TABLE editai_schedule_plans ADD COLUMN IF NOT EXISTS variant_routing JSONB DEFAULT NULL;
ALTER TABLE editai_schedule_plans ADD COLUMN IF NOT EXISTS plan_version INT NOT NULL DEFAULT 1;

-- editai_schedule_items: per-platform assignment columns
ALTER TABLE editai_schedule_items ADD COLUMN IF NOT EXISTS integration_id TEXT DEFAULT NULL;
ALTER TABLE editai_schedule_items ADD COLUMN IF NOT EXISTS platform_type TEXT DEFAULT NULL;
ALTER TABLE editai_schedule_items ADD COLUMN IF NOT EXISTS jitter_offset_minutes INT DEFAULT 0;
ALTER TABLE editai_schedule_items ADD COLUMN IF NOT EXISTS variant_index INT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_items_integration ON editai_schedule_items(integration_id);
