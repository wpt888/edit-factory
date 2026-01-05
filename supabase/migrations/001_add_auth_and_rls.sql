-- =====================================================
-- Migration: Add Authentication and Row Level Security
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================

-- 1. Add user_id column to projects table
ALTER TABLE editai_projects
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON editai_projects(user_id);

-- 2. Enable Row Level Security on all tables
ALTER TABLE editai_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_clip_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE editai_project_segments ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies for editai_projects
-- Drop existing policies if any (safe to run multiple times)
DROP POLICY IF EXISTS "Users can view own projects" ON editai_projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON editai_projects;
DROP POLICY IF EXISTS "Users can update own projects" ON editai_projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON editai_projects;
DROP POLICY IF EXISTS "Service role bypass for projects" ON editai_projects;

-- Users can view their own projects
CREATE POLICY "Users can view own projects" ON editai_projects
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert projects with their own user_id
CREATE POLICY "Users can insert own projects" ON editai_projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own projects
CREATE POLICY "Users can update own projects" ON editai_projects
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own projects
CREATE POLICY "Users can delete own projects" ON editai_projects
  FOR DELETE USING (auth.uid() = user_id);

-- Service role can do everything (for backend operations)
CREATE POLICY "Service role bypass for projects" ON editai_projects
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- 4. Create RLS Policies for editai_clips (inherit from parent project)
DROP POLICY IF EXISTS "Users can view clips of own projects" ON editai_clips;
DROP POLICY IF EXISTS "Users can insert clips to own projects" ON editai_clips;
DROP POLICY IF EXISTS "Users can update clips of own projects" ON editai_clips;
DROP POLICY IF EXISTS "Users can delete clips of own projects" ON editai_clips;
DROP POLICY IF EXISTS "Service role bypass for clips" ON editai_clips;

CREATE POLICY "Users can view clips of own projects" ON editai_clips
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM editai_projects
      WHERE editai_projects.id = editai_clips.project_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert clips to own projects" ON editai_clips
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM editai_projects
      WHERE editai_projects.id = editai_clips.project_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update clips of own projects" ON editai_clips
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM editai_projects
      WHERE editai_projects.id = editai_clips.project_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete clips of own projects" ON editai_clips
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM editai_projects
      WHERE editai_projects.id = editai_clips.project_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role bypass for clips" ON editai_clips
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- 5. Create RLS Policies for editai_clip_content (inherit from clip -> project)
DROP POLICY IF EXISTS "Users can view clip content of own projects" ON editai_clip_content;
DROP POLICY IF EXISTS "Users can insert clip content to own projects" ON editai_clip_content;
DROP POLICY IF EXISTS "Users can update clip content of own projects" ON editai_clip_content;
DROP POLICY IF EXISTS "Users can delete clip content of own projects" ON editai_clip_content;
DROP POLICY IF EXISTS "Service role bypass for clip content" ON editai_clip_content;

CREATE POLICY "Users can view clip content of own projects" ON editai_clip_content
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM editai_clips
      JOIN editai_projects ON editai_projects.id = editai_clips.project_id
      WHERE editai_clips.id = editai_clip_content.clip_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert clip content to own projects" ON editai_clip_content
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM editai_clips
      JOIN editai_projects ON editai_projects.id = editai_clips.project_id
      WHERE editai_clips.id = editai_clip_content.clip_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update clip content of own projects" ON editai_clip_content
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM editai_clips
      JOIN editai_projects ON editai_projects.id = editai_clips.project_id
      WHERE editai_clips.id = editai_clip_content.clip_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete clip content of own projects" ON editai_clip_content
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM editai_clips
      JOIN editai_projects ON editai_projects.id = editai_clips.project_id
      WHERE editai_clips.id = editai_clip_content.clip_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role bypass for clip content" ON editai_clip_content
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- 6. Create RLS Policies for editai_project_segments (inherit from project)
DROP POLICY IF EXISTS "Users can view segments of own projects" ON editai_project_segments;
DROP POLICY IF EXISTS "Users can insert segments to own projects" ON editai_project_segments;
DROP POLICY IF EXISTS "Users can update segments of own projects" ON editai_project_segments;
DROP POLICY IF EXISTS "Users can delete segments of own projects" ON editai_project_segments;
DROP POLICY IF EXISTS "Service role bypass for segments" ON editai_project_segments;

CREATE POLICY "Users can view segments of own projects" ON editai_project_segments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM editai_projects
      WHERE editai_projects.id = editai_project_segments.project_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert segments to own projects" ON editai_project_segments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM editai_projects
      WHERE editai_projects.id = editai_project_segments.project_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update segments of own projects" ON editai_project_segments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM editai_projects
      WHERE editai_projects.id = editai_project_segments.project_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete segments of own projects" ON editai_project_segments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM editai_projects
      WHERE editai_projects.id = editai_project_segments.project_id
      AND editai_projects.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role bypass for segments" ON editai_project_segments
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================
-- DONE! Now go to Authentication > Providers in Supabase
-- and enable Email provider if not already enabled.
-- =====================================================
