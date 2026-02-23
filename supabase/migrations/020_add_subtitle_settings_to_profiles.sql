ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subtitle_settings JSONB DEFAULT '{
  "fontSize": 48,
  "fontFamily": "var(--font-montserrat), Montserrat, sans-serif",
  "textColor": "#FFFFFF",
  "outlineColor": "#000000",
  "outlineWidth": 3,
  "positionY": 85
}'::JSONB;
