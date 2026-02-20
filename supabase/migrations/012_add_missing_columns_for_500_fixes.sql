-- Add missing columns that cause 500 errors after editai→public schema migration

-- editai_clips: profile_id for profile-scoped queries, is_deleted for soft delete
ALTER TABLE public.editai_clips
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- editai_export_presets: is_default to mark default preset
ALTER TABLE public.editai_export_presets
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

-- editai_project_segments: rename sort_order to match backend code
ALTER TABLE public.editai_project_segments
  RENAME COLUMN sort_order TO sequence_order;

-- editai_project_segments: add is_manual_selection flag
ALTER TABLE public.editai_project_segments
  ADD COLUMN IF NOT EXISTS is_manual_selection BOOLEAN DEFAULT false;
