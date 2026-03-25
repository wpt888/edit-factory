-- 031: Image generation improvements
-- 1. Add is_approved column to generated_images
-- 2. Add logo_position to profiles
-- 3. RPC to get products with approved images

-- 1. is_approved on generated_images
ALTER TABLE public.generated_images ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_generated_images_product_approved
  ON public.generated_images (product_id) WHERE is_approved = true AND product_id IS NOT NULL;

-- 2. logo_position on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS logo_position JSONB DEFAULT '{"x": 20, "y": 20, "scale": 0.3}';

-- 3. RPC: products with approved images
CREATE OR REPLACE FUNCTION public.get_products_with_approved_images(p_profile_id uuid)
RETURNS TABLE(product_id uuid) AS $$
  SELECT DISTINCT gi.product_id
  FROM public.generated_images gi
  WHERE gi.profile_id = p_profile_id
    AND gi.product_id IS NOT NULL
    AND gi.is_approved = true
    AND gi.status = 'completed';
$$ LANGUAGE sql STABLE SECURITY DEFINER;
