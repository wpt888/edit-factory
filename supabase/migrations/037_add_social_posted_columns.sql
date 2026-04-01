-- Add social media posted tracking columns to editai_clips
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS instagram_posted BOOLEAN DEFAULT FALSE;
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS youtube_posted BOOLEAN DEFAULT FALSE;
ALTER TABLE editai_clips ADD COLUMN IF NOT EXISTS facebook_posted BOOLEAN DEFAULT FALSE;
