-- =====================================================
-- Migration 046: Create Wiki Pages Table
-- Purpose: Internal knowledge base — per-profile Markdown
--          documentation pages, grouped by a free-text category.
--          Markdown is the single source of truth (content_md);
--          rendering happens client-side. No publish workflow / SEO.
--
-- Security model: RLS is intentionally DISABLED, matching the
-- project's data-table convention (editai_pipelines, editai_segments,
-- image_prompt_templates, ...). Per-profile scoping is enforced in the
-- backend (app/api/wiki_routes.py via get_profile_context + ownership
-- checks), and the backend connects with the anon key in dev.
-- Run this in Supabase Dashboard > SQL Editor.
-- =====================================================

-- Create editai_wiki_pages table
CREATE TABLE IF NOT EXISTS public.editai_wiki_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT,                       -- free-text group for the sidebar (NULL -> "General")
  content_md TEXT DEFAULT '',          -- Markdown source of truth
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Slug is unique within a profile (used for routing / lookup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_pages_profile_slug
ON editai_wiki_pages(profile_id, slug);

-- Sidebar ordering: category then sort_order
CREATE INDEX IF NOT EXISTS idx_wiki_pages_profile_category
ON editai_wiki_pages(profile_id, category, sort_order);

-- Auto-update updated_at trigger
DROP TRIGGER IF EXISTS editai_wiki_pages_updated_at ON editai_wiki_pages;
CREATE TRIGGER editai_wiki_pages_updated_at
  BEFORE UPDATE ON editai_wiki_pages
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- PostgREST caches the schema; after creating a table via raw SQL its
-- write path can 404 ("JSON could not be generated") until the cache
-- reloads. Force a reload so inserts/updates work immediately.
NOTIFY pgrst, 'reload schema';

-- =====================================================
-- Migration 046 Complete
-- =====================================================
