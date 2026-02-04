# Migration 007: Add Keyframe Parameters to Export Presets

## Purpose
Add keyframe control parameters (gop_size, keyint_min, video_preset) to the export presets table to enable platform-optimized encoding.

## Status
Migration file created but NOT YET APPLIED to database.

## To Apply

### Option 1: Supabase SQL Editor
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `007_add_keyframe_params_to_export_presets.sql`
3. Execute the SQL

### Option 2: Supabase CLI
```bash
cd /mnt/c/OBSID\ SRL/n8n/edit_factory
supabase db push
```

## What This Migration Does

1. **Adds columns:**
   - `gop_size` (INTEGER, default 60) - GOP size for keyframe intervals
   - `keyint_min` (INTEGER, default 60) - Minimum keyframe interval
   - `video_preset` (TEXT, default 'medium') - FFmpeg encoding preset

2. **Updates existing presets:**
   - TikTok: CRF 20, medium preset, 192k audio
   - Instagram Reels: CRF 18, slow preset, 192k audio
   - YouTube Shorts: CRF 18, slow preset, 192k audio
   - Facebook Reels: CRF 20, medium preset, 192k audio
   - Instagram Story: CRF 20, medium preset, 192k audio

## Verification

After applying, verify with:
```sql
SELECT name, crf, gop_size, keyint_min, video_preset, audio_bitrate
FROM editai_export_presets
ORDER BY name;
```

Expected output:
- All presets should have gop_size = 60, keyint_min = 60
- TikTok: CRF 20, preset 'medium'
- Instagram Reels: CRF 18, preset 'slow'
- YouTube Shorts: CRF 18, preset 'slow'
