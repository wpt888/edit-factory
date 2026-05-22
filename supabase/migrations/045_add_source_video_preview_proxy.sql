-- Add browser-optimized preview proxy metadata for source videos.

ALTER TABLE public.editai_source_videos
  ADD COLUMN IF NOT EXISTS preview_proxy_path TEXT,
  ADD COLUMN IF NOT EXISTS preview_proxy_status TEXT,
  ADD COLUMN IF NOT EXISTS preview_proxy_error TEXT,
  ADD COLUMN IF NOT EXISTS preview_proxy_created_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'editai_source_videos_preview_proxy_status_check'
      AND conrelid = 'public.editai_source_videos'::regclass
  ) THEN
    ALTER TABLE public.editai_source_videos
      ADD CONSTRAINT editai_source_videos_preview_proxy_status_check
      CHECK (
        preview_proxy_status IS NULL
        OR preview_proxy_status IN ('pending', 'ready', 'failed', 'skipped')
      )
      NOT VALID;

    ALTER TABLE public.editai_source_videos
      VALIDATE CONSTRAINT editai_source_videos_preview_proxy_status_check;
  END IF;
END $$;
