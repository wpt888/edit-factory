-- =====================================================
-- SQLite Schema for Edit Factory
-- Creates all tables equivalent to the Supabase/PostgreSQL schema.
-- Run with: sqlite3 database.db < supabase/sqlite_schema.sql
--
-- Type mappings from PostgreSQL:
--   UUID          -> TEXT (stored as string)
--   TIMESTAMPTZ   -> TEXT (ISO8601 format)
--   JSONB / JSON  -> TEXT (stored as JSON string)
--   TEXT[]         -> TEXT (stored as JSON array string)
--   BOOLEAN       -> INTEGER (0/1)
--   FLOAT / DOUBLE PRECISION -> REAL
--   DATE          -> TEXT (ISO8601 date)
--   TIME          -> TEXT (HH:MM:SS)
--   SERIAL        -> INTEGER PRIMARY KEY AUTOINCREMENT
--
-- Notes:
--   - RLS policies are not applicable in SQLite.
--   - auth.users references are replaced with plain TEXT user_id columns.
--   - UUID defaults are omitted; Python generates UUIDs before insert.
--   - Timestamp defaults use strftime for ISO8601.
-- =====================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- =====================================================
-- Schema Version Tracking
-- =====================================================

CREATE TABLE IF NOT EXISTS schema_version (
    version   INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);

-- =====================================================
-- TABLE: profiles
-- Source: migrations 002, 006, 014, 020
-- =====================================================

CREATE TABLE IF NOT EXISTS profiles (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,

    -- TTS settings (from 002)
    default_tts_provider TEXT DEFAULT 'elevenlabs',
    elevenlabs_voice_id  TEXT,
    edge_tts_voice       TEXT,
    tts_model            TEXT,

    -- Postiz settings (from 002)
    postiz_integration_ids TEXT DEFAULT '[]',
    default_caption_template TEXT,

    -- Metadata (from 002)
    is_default      INTEGER DEFAULT 0,
    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    -- TTS settings JSONB (from 006)
    tts_settings    TEXT DEFAULT '{"provider":"edge","elevenlabs":{"voice_id":null,"model":"eleven_multilingual_v2","stability":0.57,"similarity_boost":0.75,"style":0.22,"use_speaker_boost":true},"edge":{"voice":"en-US-GuyNeural","rate":"+0%","volume":"+0%","pitch":"+0Hz"},"coqui":{"model":"xtts_v2","use_gpu":true,"speaker_wav":null},"kokoro":{"voice":"af","speed":1.0}}',
    cloned_voices   TEXT DEFAULT '[]',

    -- Video template settings (from 014)
    video_template_settings TEXT DEFAULT '{"template_name":"product_spotlight","primary_color":"#FF0000","accent_color":"#FFFF00","font_family":"","cta_text":"Comanda acum!"}',

    -- Subtitle settings (from 020)
    subtitle_settings TEXT DEFAULT '{"fontSize":48,"fontFamily":"var(--font-montserrat), Montserrat, sans-serif","textColor":"#FFFFFF","outlineColor":"#000000","outlineWidth":3,"positionY":85}'
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_default ON profiles(user_id) WHERE is_default = 1;

-- =====================================================
-- TABLE: editai_projects
-- Source: original schema + migrations 001, 003, 005, 015
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_projects (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    description           TEXT,
    status                TEXT DEFAULT 'created',
    target_duration       REAL,
    context_text          TEXT,

    -- Auth (from 001)
    user_id               TEXT,

    -- Profile (from 003, 005)
    profile_id            TEXT NOT NULL,

    -- Source video metadata (from 015)
    source_video_path     TEXT,
    source_video_duration REAL,
    source_video_width    INTEGER,
    source_video_height   INTEGER,
    variants_count        INTEGER DEFAULT 0,
    selected_count        INTEGER DEFAULT 0,
    exported_count        INTEGER DEFAULT 0,

    created_at            TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at            TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON editai_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_profile_id ON editai_projects(profile_id);

-- =====================================================
-- TABLE: editai_clips
-- Source: original schema + migrations 001, 012, 015, 024, 025
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_clips (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL,
    variant_index     INTEGER,
    raw_video_path    TEXT,
    thumbnail_path    TEXT,
    duration          REAL,
    is_selected       INTEGER DEFAULT 0,
    final_video_path  TEXT,
    final_status      TEXT,

    -- Profile (from 012)
    profile_id        TEXT,
    is_deleted        INTEGER DEFAULT 0,

    -- Postiz columns (from 015)
    variant_name      TEXT,
    postiz_status     TEXT,
    postiz_post_id    TEXT,
    postiz_scheduled_at TEXT,

    -- Soft delete (from 024)
    deleted_at        TEXT,

    -- Tags (from 025) - stored as JSON array string
    tags              TEXT DEFAULT '[]',

    created_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (project_id) REFERENCES editai_projects(id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_clips_project_id ON editai_clips(project_id);
CREATE INDEX IF NOT EXISTS idx_clips_profile_id ON editai_clips(profile_id);
CREATE INDEX IF NOT EXISTS idx_editai_clips_deleted_at ON editai_clips(deleted_at) WHERE deleted_at IS NOT NULL;

-- =====================================================
-- TABLE: editai_clip_content
-- Source: original schema + migrations 009, 015
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_clip_content (
    id              TEXT PRIMARY KEY,
    clip_id         TEXT NOT NULL,
    script_text     TEXT,
    tts_audio_path  TEXT,
    srt_path        TEXT,
    srt_content     TEXT,

    -- TTS timestamps (from 009)
    tts_timestamps  TEXT,
    tts_model       TEXT,

    -- Additional columns (from 015)
    updated_at      TEXT,
    subtitle_settings TEXT,
    tts_voice_id    TEXT,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (clip_id) REFERENCES editai_clips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clip_content_clip_id ON editai_clip_content(clip_id);

-- =====================================================
-- TABLE: editai_segments
-- Source: original schema + migration 008
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_segments (
    id              TEXT PRIMARY KEY,
    source_video_id TEXT,
    start_time      REAL,
    end_time        REAL,
    duration        REAL,
    thumbnail_path  TEXT,
    video_path      TEXT,
    score           REAL,
    label           TEXT,
    is_selected     INTEGER DEFAULT 0,

    -- Profile (from 008)
    profile_id      TEXT,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_segments_profile_id ON editai_segments(profile_id);

-- =====================================================
-- TABLE: editai_source_videos
-- Source: original schema + migration 008
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_source_videos (
    id              TEXT PRIMARY KEY,
    filename        TEXT,
    file_path       TEXT,
    duration        REAL,
    width           INTEGER,
    height          INTEGER,
    file_size        INTEGER,
    status          TEXT DEFAULT 'ready',
    segment_count   INTEGER DEFAULT 0,

    -- Profile (from 008)
    profile_id      TEXT,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_videos_profile_id ON editai_source_videos(profile_id);

-- =====================================================
-- TABLE: editai_project_segments
-- Source: original schema + migration 012
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_project_segments (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL,
    segment_id          TEXT NOT NULL,
    sequence_order      INTEGER DEFAULT 0,
    is_manual_selection INTEGER DEFAULT 0,

    created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (project_id) REFERENCES editai_projects(id) ON DELETE CASCADE,
    FOREIGN KEY (segment_id) REFERENCES editai_segments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_segments_project_id ON editai_project_segments(project_id);
CREATE INDEX IF NOT EXISTS idx_project_segments_segment_id ON editai_project_segments(segment_id);

-- =====================================================
-- TABLE: editai_export_presets
-- Source: original schema + migrations 007, 012
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_export_presets (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT,
    name            TEXT NOT NULL,
    description     TEXT,
    width           INTEGER,
    height          INTEGER,
    fps             INTEGER DEFAULT 30,
    video_codec     TEXT DEFAULT 'libx264',
    audio_codec     TEXT DEFAULT 'aac',
    audio_bitrate   TEXT DEFAULT '128k',
    crf             INTEGER DEFAULT 23,
    pixel_format    TEXT DEFAULT 'yuv420p',

    -- Keyframe params (from 007)
    gop_size        INTEGER DEFAULT 60,
    keyint_min      INTEGER DEFAULT 60,
    video_preset    TEXT DEFAULT 'medium',

    -- Default flag (from 012)
    is_default      INTEGER DEFAULT 0,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- =====================================================
-- TABLE: editai_exports
-- Source: original schema
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_exports (
    id              TEXT PRIMARY KEY,
    clip_id         TEXT NOT NULL,
    preset_id       TEXT,
    output_path     TEXT,
    file_size       INTEGER,
    status          TEXT DEFAULT 'pending',
    error           TEXT,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (clip_id) REFERENCES editai_clips(id) ON DELETE CASCADE,
    FOREIGN KEY (preset_id) REFERENCES editai_export_presets(id)
);

CREATE INDEX IF NOT EXISTS idx_exports_clip_id ON editai_exports(clip_id);

-- =====================================================
-- TABLE: editai_postiz_publications
-- Source: original schema
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_postiz_publications (
    id                TEXT PRIMARY KEY,
    clip_id           TEXT NOT NULL,
    postiz_post_id    TEXT,
    integration_id    TEXT,
    status            TEXT DEFAULT 'pending',
    scheduled_at      TEXT,
    published_at      TEXT,
    error             TEXT,
    caption           TEXT,

    created_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (clip_id) REFERENCES editai_clips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_publications_clip_id ON editai_postiz_publications(clip_id);

-- =====================================================
-- TABLE: editai_product_groups
-- Source: original schema
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_product_groups (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    product_ids     TEXT DEFAULT '[]',

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_groups_profile_id ON editai_product_groups(profile_id);

-- =====================================================
-- TABLE: editai_pipelines
-- Source: migration 016 + 021
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_pipelines (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    idea            TEXT NOT NULL,
    context         TEXT DEFAULT '',
    provider        TEXT NOT NULL DEFAULT 'gemini',
    variant_count   INTEGER NOT NULL DEFAULT 3,
    keyword_count   INTEGER NOT NULL DEFAULT 0,
    scripts         TEXT NOT NULL DEFAULT '[]',
    previews        TEXT NOT NULL DEFAULT '{}',
    render_jobs     TEXT NOT NULL DEFAULT '{}',

    -- Source video IDs (from 021)
    source_video_ids TEXT DEFAULT '[]',

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at      TEXT,

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_editai_pipelines_profile_id ON editai_pipelines(profile_id);

-- =====================================================
-- TABLE: editai_assembly_jobs
-- Source: migration 016
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_assembly_jobs (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'processing',
    progress        INTEGER NOT NULL DEFAULT 0,
    current_step    TEXT DEFAULT 'Initializing assembly',
    final_video_path TEXT,
    error           TEXT,
    started_at      TEXT,
    completed_at    TEXT,
    failed_at       TEXT,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at      TEXT,

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_editai_assembly_jobs_profile_id ON editai_assembly_jobs(profile_id);

-- =====================================================
-- TABLE: editai_generation_progress
-- Source: migration 017
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_generation_progress (
    project_id          TEXT PRIMARY KEY,
    percentage          INTEGER NOT NULL DEFAULT 0,
    current_step        TEXT NOT NULL DEFAULT '',
    estimated_remaining INTEGER,
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- =====================================================
-- TABLE: editai_tts_assets
-- Source: migration 010
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_tts_assets (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    tts_text        TEXT NOT NULL,
    mp3_path        TEXT,
    srt_path        TEXT,
    srt_content     TEXT,
    tts_provider    TEXT NOT NULL DEFAULT 'elevenlabs',
    tts_model       TEXT DEFAULT 'eleven_flash_v2_5',
    tts_voice_id    TEXT,
    audio_duration  REAL DEFAULT 0.0,
    char_count      INTEGER DEFAULT 0,
    tts_timestamps  TEXT,
    status          TEXT DEFAULT 'ready',
    error_message   TEXT,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tts_assets_profile ON editai_tts_assets(profile_id);
CREATE INDEX IF NOT EXISTS idx_tts_assets_created ON editai_tts_assets(profile_id, created_at DESC);

-- =====================================================
-- TABLE: editai_schedule_plans
-- Source: migration 026
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_schedule_plans (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    integration_ids TEXT NOT NULL DEFAULT '[]',
    start_date      TEXT NOT NULL,
    post_time       TEXT NOT NULL DEFAULT '09:00',
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    collection_ids  TEXT NOT NULL DEFAULT '[]',
    caption_template TEXT,
    total_clips     INTEGER NOT NULL DEFAULT 0,
    scheduled_count INTEGER NOT NULL DEFAULT 0,
    failed_count    INTEGER NOT NULL DEFAULT 0,
    summary         TEXT,

    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedule_plans_profile ON editai_schedule_plans(profile_id);
CREATE INDEX IF NOT EXISTS idx_schedule_plans_status ON editai_schedule_plans(status);

-- =====================================================
-- TABLE: editai_schedule_items
-- Source: migration 026
-- =====================================================

CREATE TABLE IF NOT EXISTS editai_schedule_items (
    id              TEXT PRIMARY KEY,
    plan_id         TEXT NOT NULL,
    clip_id         TEXT NOT NULL,
    project_id      TEXT NOT NULL,
    scheduled_date  TEXT NOT NULL,
    scheduled_at    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    postiz_post_id  TEXT,
    error_message   TEXT,
    caption         TEXT,

    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (plan_id) REFERENCES editai_schedule_plans(id) ON DELETE CASCADE,
    FOREIGN KEY (clip_id) REFERENCES editai_clips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedule_items_plan ON editai_schedule_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_clip ON editai_schedule_items(clip_id);
CREATE INDEX IF NOT EXISTS idx_schedule_items_date ON editai_schedule_items(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_schedule_items_status ON editai_schedule_items(status);

-- =====================================================
-- TABLE: jobs (background processing)
-- Source: original schema + migration 003
-- =====================================================

CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,
    job_type        TEXT,
    status          TEXT DEFAULT 'pending',
    progress        INTEGER DEFAULT 0,
    data            TEXT,
    error           TEXT,

    -- Profile (from 003)
    profile_id      TEXT,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_profile_id ON jobs(profile_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- =====================================================
-- TABLE: api_costs
-- Source: original schema + migration 003
-- =====================================================

CREATE TABLE IF NOT EXISTS api_costs (
    id              TEXT PRIMARY KEY,
    service         TEXT,
    operation       TEXT,
    cost            REAL,
    metadata        TEXT,

    -- Profile (from 003)
    profile_id      TEXT,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_costs_profile_id ON api_costs(profile_id);

-- =====================================================
-- TABLE: product_feeds
-- Source: migration 013
-- =====================================================

CREATE TABLE IF NOT EXISTS product_feeds (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    feed_url        TEXT NOT NULL,
    last_synced_at  TEXT,
    product_count   INTEGER DEFAULT 0,
    sync_status     TEXT DEFAULT 'idle',
    sync_error      TEXT,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_feeds_profile_id ON product_feeds(profile_id);

-- =====================================================
-- TABLE: products
-- Source: migration 013
-- =====================================================

CREATE TABLE IF NOT EXISTS products (
    id                TEXT PRIMARY KEY,
    feed_id           TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    title             TEXT NOT NULL,
    brand             TEXT,
    product_type      TEXT,
    price             REAL,
    sale_price        REAL,
    raw_price_str     TEXT,
    raw_sale_price_str TEXT,
    is_on_sale        INTEGER DEFAULT 0,
    image_link        TEXT,
    local_image_path  TEXT,
    product_url       TEXT,
    description       TEXT,

    created_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    UNIQUE(feed_id, external_id),
    FOREIGN KEY (feed_id) REFERENCES product_feeds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_products_feed_id ON products(feed_id);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(feed_id, brand);
CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(feed_id, product_type);
CREATE INDEX IF NOT EXISTS idx_products_is_on_sale ON products(feed_id, is_on_sale);

-- =====================================================
-- TABLE: elevenlabs_accounts
-- Source: migration 011
-- =====================================================

CREATE TABLE IF NOT EXISTS elevenlabs_accounts (
    id                TEXT PRIMARY KEY,
    profile_id        TEXT NOT NULL,
    label             TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    api_key_hint      TEXT NOT NULL,
    is_primary        INTEGER DEFAULT 0,
    is_active         INTEGER DEFAULT 1,
    sort_order        INTEGER DEFAULT 0,

    -- Subscription info
    character_limit   INTEGER,
    characters_used   INTEGER,
    tier              TEXT,

    -- Error tracking
    last_checked_at   TEXT,
    last_error        TEXT,

    created_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_elevenlabs_accounts_primary ON elevenlabs_accounts(profile_id) WHERE is_primary = 1;
CREATE INDEX IF NOT EXISTS idx_elevenlabs_accounts_profile_id ON elevenlabs_accounts(profile_id);
CREATE INDEX IF NOT EXISTS idx_elevenlabs_accounts_sort_order ON elevenlabs_accounts(profile_id, sort_order);

-- =====================================================
-- TABLE: segment_product_associations
-- Source: migration 019
-- =====================================================

CREATE TABLE IF NOT EXISTS segment_product_associations (
    id                  TEXT PRIMARY KEY,
    segment_id          TEXT NOT NULL,
    catalog_product_id  TEXT NOT NULL,
    selected_image_urls TEXT NOT NULL DEFAULT '[]',
    pip_config          TEXT,
    slide_config        TEXT,

    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    UNIQUE(segment_id),
    FOREIGN KEY (segment_id) REFERENCES editai_segments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spa_segment_id ON segment_product_associations(segment_id);
CREATE INDEX IF NOT EXISTS idx_spa_catalog_product_id ON segment_product_associations(catalog_product_id);

-- =====================================================
-- TABLE: generated_images
-- Source: code usage in app/api/image_generate_routes.py
-- =====================================================

CREATE TABLE IF NOT EXISTS generated_images (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    product_id      TEXT,
    prompt          TEXT,
    template_name   TEXT,
    status          TEXT DEFAULT 'pending',
    image_path      TEXT,
    error           TEXT,
    aspect_ratio    TEXT,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_generated_images_profile_id ON generated_images(profile_id);

-- =====================================================
-- TABLE: image_prompt_templates
-- Source: code usage in app/api/image_generate_routes.py
-- =====================================================

CREATE TABLE IF NOT EXISTS image_prompt_templates (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    prompt_template TEXT,
    is_default      INTEGER DEFAULT 0,

    created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_image_prompt_templates_profile_id ON image_prompt_templates(profile_id);
