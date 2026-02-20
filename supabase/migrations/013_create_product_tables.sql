-- =====================================================
-- Migration 013: Create Product Tables
-- Purpose: Product feed URLs and product storage for v5 Product Video Generator
-- Run this in Supabase Dashboard > SQL Editor
-- =====================================================

-- =====================================================
-- TABLE: product_feeds
-- Stores registered Google Shopping XML feed URLs per profile
-- =====================================================
CREATE TABLE IF NOT EXISTS public.product_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  product_count INTEGER DEFAULT 0,
  sync_status TEXT DEFAULT 'idle',  -- idle | syncing | error
  sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TABLE: products
-- Stores individual product records parsed from feed XML
-- =====================================================
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES public.product_feeds(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,          -- g:id from Google Shopping feed
  title TEXT NOT NULL,
  brand TEXT,
  product_type TEXT,
  price FLOAT,                         -- parsed float for SQL filtering/sorting
  sale_price FLOAT,
  raw_price_str TEXT,                  -- original "249.99 RON" for display
  raw_sale_price_str TEXT,
  is_on_sale BOOLEAN DEFAULT FALSE,
  image_link TEXT,                     -- original URL from feed
  local_image_path TEXT,               -- local cache path after download
  product_url TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(feed_id, external_id)         -- enables ON CONFLICT upsert
);

-- =====================================================
-- INDEXES
-- Optimized for Phase 19 product browser: filter by brand, type, sale, text search
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_products_feed_id
  ON products(feed_id);

CREATE INDEX IF NOT EXISTS idx_products_brand
  ON products(feed_id, brand);

CREATE INDEX IF NOT EXISTS idx_products_product_type
  ON products(feed_id, product_type);

CREATE INDEX IF NOT EXISTS idx_products_is_on_sale
  ON products(feed_id, is_on_sale);

CREATE INDEX IF NOT EXISTS idx_products_title_gin
  ON products USING gin(to_tsvector('romanian', title));

-- =====================================================
-- ROW LEVEL SECURITY: product_feeds
-- =====================================================
ALTER TABLE product_feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own product feeds" ON product_feeds
  FOR SELECT
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert own product feeds" ON product_feeds
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own product feeds" ON product_feeds
  FOR UPDATE
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can delete own product feeds" ON product_feeds
  FOR DELETE
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );

-- Service role bypass
CREATE POLICY "Service role bypass for product feeds" ON product_feeds
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================
-- ROW LEVEL SECURITY: products
-- Products are accessed via feed ownership chain
-- =====================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own products" ON products
  FOR SELECT
  TO authenticated
  USING (
    feed_id IN (
      SELECT id FROM product_feeds WHERE profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY "Users can insert own products" ON products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    feed_id IN (
      SELECT id FROM product_feeds WHERE profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY "Users can update own products" ON products
  FOR UPDATE
  TO authenticated
  USING (
    feed_id IN (
      SELECT id FROM product_feeds WHERE profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    )
  )
  WITH CHECK (
    feed_id IN (
      SELECT id FROM product_feeds WHERE profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY "Users can delete own products" ON products
  FOR DELETE
  TO authenticated
  USING (
    feed_id IN (
      SELECT id FROM product_feeds WHERE profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    )
  );

-- Service role bypass
CREATE POLICY "Service role bypass for products" ON products
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- =====================================================
-- UPDATED_AT TRIGGERS
-- Reuses existing handle_updated_at function
-- =====================================================
DROP TRIGGER IF EXISTS product_feeds_updated_at ON product_feeds;
CREATE TRIGGER product_feeds_updated_at
  BEFORE UPDATE ON product_feeds
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- =====================================================
-- Migration 013 Complete
-- =====================================================
