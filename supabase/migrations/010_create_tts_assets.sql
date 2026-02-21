-- TTS Library: persistent TTS assets with MP3 + SRT files
CREATE TABLE IF NOT EXISTS editai_tts_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  tts_text TEXT NOT NULL,
  mp3_path TEXT,
  srt_path TEXT,
  srt_content TEXT,
  tts_provider TEXT NOT NULL DEFAULT 'elevenlabs',
  tts_model TEXT DEFAULT 'eleven_flash_v2_5',
  tts_voice_id TEXT,
  audio_duration FLOAT DEFAULT 0.0,
  char_count INTEGER DEFAULT 0,
  tts_timestamps JSONB,
  status TEXT DEFAULT 'ready',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tts_assets_profile ON editai_tts_assets(profile_id);
CREATE INDEX idx_tts_assets_created ON editai_tts_assets(profile_id, created_at DESC);
