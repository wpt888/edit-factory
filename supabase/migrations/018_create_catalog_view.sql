-- Create a VIEW in public schema that maps uf.products_catalog columns
-- to the shape expected by the product video generation pipeline.
-- This allows the Supabase client (which operates on public schema) to
-- access catalog products transparently.

CREATE OR REPLACE VIEW public.v_catalog_products AS
SELECT
  id,
  company_id,
  name AS title,
  description,
  brand,
  sku,
  price::float,
  sale_price::float,
  CASE WHEN price > 0 THEN price::text || ' RON' ELSE NULL END AS raw_price_str,
  CASE WHEN sale_price > 0 THEN sale_price::text || ' RON' ELSE NULL END AS raw_sale_price_str,
  image_url AS image_link,
  product_url,
  category,
  category AS product_type,
  has_promotion AS is_on_sale,
  promotion_name,
  is_active,
  stock_status,
  gomag_product_id AS external_id,
  NULL::text AS feed_id,
  NULL::text AS local_image_path,
  created_at,
  updated_at
FROM uf.products_catalog;
