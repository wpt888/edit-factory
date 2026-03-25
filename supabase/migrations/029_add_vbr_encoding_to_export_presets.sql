-- Migration 029: Add VBR 2-pass encoding columns to export presets
-- Upgrades from single-pass CRF to professional 2-pass VBR encoding
-- matching Adobe Premiere quality settings (10 Mbps, Main profile, Level 4.1, 320k audio)

ALTER TABLE editai_export_presets
  ADD COLUMN IF NOT EXISTS encoding_mode TEXT DEFAULT 'vbr_2pass';

ALTER TABLE editai_export_presets
  ADD COLUMN IF NOT EXISTS target_bitrate_kbps INTEGER DEFAULT 10000;

ALTER TABLE editai_export_presets
  ADD COLUMN IF NOT EXISTS video_profile TEXT DEFAULT 'main';

ALTER TABLE editai_export_presets
  ADD COLUMN IF NOT EXISTS video_level TEXT DEFAULT '4.1';

-- Upgrade existing presets to 320k audio (from 128k default)
UPDATE editai_export_presets
  SET audio_bitrate = '320k'
  WHERE audio_bitrate = '128k';
