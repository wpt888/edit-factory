-- =====================================================
-- Migration 019: Create segment_product_associations table
-- Purpose: Store which catalog product is linked to each segment,
--          which images are selected, and future PiP/interstitial config.
-- This is the data foundation for v7 Product Image Overlays milestone.
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================

-- ============== Create segment_product_associations table ==============

CREATE TABLE IF NOT EXISTS public.segment_product_associations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id          UUID        NOT NULL,
  catalog_product_id  UUID        NOT NULL,
  selected_image_urls JSONB       NOT NULL DEFAULT '[]'::jsonb,
  pip_config          JSONB       DEFAULT NULL,
  slide_config        JSONB       DEFAULT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- FK to editai_segments: cascade delete when segment is removed
  CONSTRAINT fk_spa_segment_id
    FOREIGN KEY (segment_id)
    REFERENCES public.editai_segments(id)
    ON DELETE CASCADE,

  -- One product association per segment (UNIQUE on segment_id)
  CONSTRAINT uq_spa_segment_id UNIQUE (segment_id)
);

-- ============== Indexes ==============

CREATE INDEX IF NOT EXISTS idx_spa_segment_id
  ON public.segment_product_associations(segment_id);

CREATE INDEX IF NOT EXISTS idx_spa_catalog_product_id
  ON public.segment_product_associations(catalog_product_id);

-- ============== RLS (Row Level Security) ==============

ALTER TABLE public.segment_product_associations ENABLE ROW LEVEL SECURITY;

-- Service role bypass (used by backend with service_role key)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'segment_product_associations'
    AND policyname = 'Service role bypass'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Service role bypass"
      ON public.segment_product_associations
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true)
    $policy$;
  END IF;
END $$;

-- Authenticated users: access via segment ownership chain
-- segment_id -> editai_segments.profile_id -> profiles.user_id = auth.uid()
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'segment_product_associations'
    AND policyname = 'Users access own segment associations'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Users access own segment associations"
      ON public.segment_product_associations
      FOR ALL
      TO authenticated
      USING (
        segment_id IN (
          SELECT id FROM public.editai_segments
          WHERE profile_id IN (
            SELECT id FROM public.profiles
            WHERE user_id = (SELECT auth.uid())
          )
        )
      )
      WITH CHECK (
        segment_id IN (
          SELECT id FROM public.editai_segments
          WHERE profile_id IN (
            SELECT id FROM public.profiles
            WHERE user_id = (SELECT auth.uid())
          )
        )
      )
    $policy$;
  END IF;
END $$;

-- ============== updated_at trigger function (ensure it exists in public schema) ==============
-- NOTE: handle_updated_at() lives in the editai schema in this project.
-- We create a copy in public schema so it is accessible from public tables.

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END
$$;

-- ============== updated_at trigger ==============

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'handle_segment_product_associations_updated_at'
  ) THEN
    EXECUTE $trig$
      CREATE TRIGGER handle_segment_product_associations_updated_at
      BEFORE UPDATE ON public.segment_product_associations
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_updated_at()
    $trig$;
  END IF;
END $$;

-- ============== Helper function: get all variant images for a catalog product ==============
-- Returns all distinct image_url values from uf.products_catalog for products
-- sharing the same group_key (or gomag_product_id if no group_key exists).
-- Used by GET /catalog/products/{id}/images endpoint.

CREATE OR REPLACE FUNCTION public.get_catalog_product_images(p_product_id UUID)
RETURNS TABLE(image_url TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, uf
AS $$
  SELECT DISTINCT pc.image_url
  FROM uf.products_catalog pc
  WHERE
    COALESCE(pc.group_key, pc.gomag_product_id) = (
      SELECT COALESCE(pc2.group_key, pc2.gomag_product_id)
      FROM uf.products_catalog pc2
      WHERE pc2.id = p_product_id
    )
    AND pc.image_url IS NOT NULL
    AND pc.image_url != ''
  ORDER BY pc.image_url
$$;

-- Grant execute to anon and authenticated roles so the RPC is callable via PostgREST
GRANT EXECUTE ON FUNCTION public.get_catalog_product_images(UUID) TO anon, authenticated;

-- =====================================================
-- Migration 019 Complete
-- =====================================================
