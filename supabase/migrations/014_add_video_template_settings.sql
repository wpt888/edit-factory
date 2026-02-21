-- Migration 014: Add video template settings to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS video_template_settings JSONB DEFAULT '{
  "template_name": "product_spotlight",
  "primary_color": "#FF0000",
  "accent_color": "#FFFF00",
  "font_family": "",
  "cta_text": "Comanda acum!"
}'::JSONB;

CREATE INDEX IF NOT EXISTS idx_profiles_template_name
ON profiles ((video_template_settings->>'template_name'));

COMMENT ON COLUMN profiles.video_template_settings IS
  'Per-profile video template preset: template_name, primary_color (hex), accent_color (hex), font_family, cta_text';
