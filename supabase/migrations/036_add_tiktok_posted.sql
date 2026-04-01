-- Add tiktok_posted column to editai_clips for manual TikTok posting tracking
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS tiktok_posted BOOLEAN DEFAULT FALSE;
