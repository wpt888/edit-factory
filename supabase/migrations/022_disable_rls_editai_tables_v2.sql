-- Disable RLS on all editai_* tables
-- The backend handles authorization via get_profile_context / ProfileContext
-- RLS with uid() doesn't work because the backend uses anon key without an authenticated session
ALTER TABLE editai_assembly_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_clip_content DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_clips DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_export_presets DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_exports DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_pipelines DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_postiz_publications DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_product_groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_project_segments DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_segments DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_source_videos DISABLE ROW LEVEL SECURITY;
ALTER TABLE editai_tts_assets DISABLE ROW LEVEL SECURITY;
