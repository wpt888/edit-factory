-- Seedance 2.0 generation records. Completed assets are also persisted in
-- editai_source_videos and editai_clips, so this table is generation history.
CREATE TABLE IF NOT EXISTS public.generated_videos (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  name text,
  model text NOT NULL DEFAULT 'seedance-2.0',
  duration text,
  aspect_ratio text,
  resolution text,
  generate_audio boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  video_url text,
  local_video_path text,
  source_video_id uuid REFERENCES public.editai_source_videos(id) ON DELETE SET NULL,
  library_project_id uuid REFERENCES public.editai_projects(id) ON DELETE SET NULL,
  library_clip_id uuid REFERENCES public.editai_clips(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generated_videos_profile_created
  ON public.generated_videos(profile_id, created_at DESC);
