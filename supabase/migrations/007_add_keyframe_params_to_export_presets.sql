-- Add keyframe control parameters to export presets table
-- These parameters enable platform-compatible encoding with proper keyframe intervals

-- Add new columns for keyframe control
ALTER TABLE editai_export_presets
ADD COLUMN IF NOT EXISTS gop_size INTEGER DEFAULT 60,
ADD COLUMN IF NOT EXISTS keyint_min INTEGER DEFAULT 60,
ADD COLUMN IF NOT EXISTS video_preset TEXT DEFAULT 'medium';

-- Update existing presets with platform-specific values

-- TikTok: CRF 20, medium preset
UPDATE editai_export_presets
SET
    crf = 20,
    gop_size = 60,
    keyint_min = 60,
    audio_bitrate = '192k',
    video_preset = 'medium'
WHERE name = 'tiktok';

-- Instagram Reels: CRF 18 (higher quality), slow preset
UPDATE editai_export_presets
SET
    crf = 18,
    gop_size = 60,
    keyint_min = 60,
    audio_bitrate = '192k',
    video_preset = 'slow'
WHERE name = 'instagram_reels';

-- YouTube Shorts: CRF 18 (high quality), slow preset
UPDATE editai_export_presets
SET
    crf = 18,
    gop_size = 60,
    keyint_min = 60,
    audio_bitrate = '192k',
    video_preset = 'slow'
WHERE name = 'youtube_shorts';

-- Facebook Reels: CRF 20, medium preset (generic settings)
UPDATE editai_export_presets
SET
    crf = 20,
    gop_size = 60,
    keyint_min = 60,
    audio_bitrate = '192k',
    video_preset = 'medium'
WHERE name = 'facebook_reels';

-- Instagram Story: CRF 20, medium preset (generic settings)
UPDATE editai_export_presets
SET
    crf = 20,
    gop_size = 60,
    keyint_min = 60,
    audio_bitrate = '192k',
    video_preset = 'medium'
WHERE name = 'instagram_story';

-- Add comment explaining the keyframe parameters
COMMENT ON COLUMN editai_export_presets.gop_size IS 'GOP size (keyframe interval) - 60 frames = 2 seconds at 30fps';
COMMENT ON COLUMN editai_export_presets.keyint_min IS 'Minimum keyframe interval - prevents excessive keyframes';
COMMENT ON COLUMN editai_export_presets.video_preset IS 'FFmpeg encoding preset (ultrafast to veryslow) - affects compression efficiency';
