-- Migration 009: Add tts_timestamps JSONB column to editai_clip_content
-- Stores character-level timing data from ElevenLabs /with-timestamps endpoint
-- Used by Phase 13 for TTS-based subtitle generation

ALTER TABLE editai_clip_content
ADD COLUMN IF NOT EXISTS tts_timestamps JSONB DEFAULT NULL;

-- Also add elevenlabs_model to track which model was used for this clip's TTS
ALTER TABLE editai_clip_content
ADD COLUMN IF NOT EXISTS tts_model TEXT DEFAULT NULL;

COMMENT ON COLUMN editai_clip_content.tts_timestamps IS 'ElevenLabs character-level timing data: {characters, character_start_times_seconds, character_end_times_seconds}';
COMMENT ON COLUMN editai_clip_content.tts_model IS 'ElevenLabs model used for TTS generation (e.g. eleven_flash_v2_5)';
