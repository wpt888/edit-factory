-- Migration 006: Add TTS settings to profiles
-- Purpose: Enable per-profile TTS provider selection and voice configuration
-- Execution: Run in Supabase Dashboard SQL Editor

-- Add TTS settings column with default structure
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS tts_settings JSONB DEFAULT '{
  "provider": "edge",
  "elevenlabs": {
    "voice_id": null,
    "model": "eleven_multilingual_v2",
    "stability": 0.57,
    "similarity_boost": 0.75,
    "style": 0.22,
    "use_speaker_boost": true
  },
  "edge": {
    "voice": "en-US-GuyNeural",
    "rate": "+0%",
    "volume": "+0%",
    "pitch": "+0Hz"
  },
  "coqui": {
    "model": "xtts_v2",
    "use_gpu": true,
    "speaker_wav": null
  },
  "kokoro": {
    "voice": "af",
    "speed": 1.0
  }
}'::JSONB;

-- Add cloned voices metadata column (for future voice cloning feature)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS cloned_voices JSONB DEFAULT '[]'::JSONB;

-- Create index for fast provider lookups
CREATE INDEX IF NOT EXISTS idx_profiles_tts_provider
ON profiles ((tts_settings->>'provider'));

-- Add comment for documentation
COMMENT ON COLUMN profiles.tts_settings IS 'TTS provider configuration (provider, elevenlabs, edge, coqui, kokoro settings)';
COMMENT ON COLUMN profiles.cloned_voices IS 'Array of cloned voice metadata for voice cloning feature';
