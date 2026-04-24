-- User-saved named subtitle style presets at the profile level.
--
-- Distinct from hardcoded CAPTION_PRESETS (Bold White, Neon Glow, etc.) which
-- live in frontend/src/types/video-processing.ts. These are presets the user
-- builds themselves and can reuse across pipelines.
--
-- Structure: [
--   { "id": "<uuid>", "name": "Aggressive Red",
--     "created_at": "2026-04-11T12:34:56Z",
--     "settings": { "fontSize": 56, "textColor": "#FF0000", ... } }
-- ]

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS user_subtitle_presets JSONB DEFAULT '[]'::JSONB;
