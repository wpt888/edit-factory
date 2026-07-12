# Subtitle preview scaling

## 2026-07-12 — Shared scaling contract

Subtitle CSS overlays use `scaleSubtitlePx()` from `frontend/src/lib/subtitle-preview-scale.ts`. The helper owns the single `SUBTITLE_REFERENCE_HEIGHT = 1920` reference and accepts a per-property minimum.

The Step 3 timeline preview stores its container height through a `ResizeObserver`-backed hook, so compact and expanded overlays recalculate after mount and whenever the preview frame resizes. Font size, outline width, shadow depth, and glow blur all use the shared helper; the subtitle style editor uses the same calculations for its local fallback overlay.

Backend subtitle rendering remains the ground truth and is intentionally unchanged.