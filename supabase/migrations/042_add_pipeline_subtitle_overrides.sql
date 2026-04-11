-- Per-variant subtitle style overrides for pipeline renders.
--
-- Key is the PreviewKey used frontend-side ("0", "1", "0_A", "0_B"...).
-- Value is a SubtitleSettings-shaped dict in camelCase.
-- NULL means "no overrides — all variants use the flat subtitle fields from
-- the render request as default (with Meta profile fallback when applicable)".

ALTER TABLE editai_pipelines
  ADD COLUMN IF NOT EXISTS subtitle_settings_by_key JSONB DEFAULT NULL;
