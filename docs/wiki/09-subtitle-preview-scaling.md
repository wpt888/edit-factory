# Subtitle preview scaling

## 2026-07-12 — Shared scaling contract

Subtitle CSS overlays use `scaleSubtitlePx()` from `frontend/src/lib/subtitle-preview-scale.ts`. The helper owns the single `SUBTITLE_REFERENCE_HEIGHT = 1920` reference and accepts a per-property minimum.

The Step 3 timeline preview stores its container height through a `ResizeObserver`-backed hook, so compact and expanded overlays recalculate after mount and whenever the preview frame resizes. Font size, outline width, shadow depth, and glow blur all use the shared helper; the subtitle style editor uses the same calculations for its local fallback overlay.

Backend subtitle rendering remains the ground truth and is intentionally unchanged.

## 2026-07-12 — Frame-preview parity verification

The frame-preview endpoint scales and crops to 540x960 **before** applying the libass `subtitles` filter. It passes `original_size=1080x1920`, exactly as `_render_with_preset` does for its 540x960 preview preset. This is deliberate: `original_size` preserves the full-render glyph-to-frame ratio after the half-resolution preview encode.

An FFmpeg measurement using FontSize=107 produced a 26px glyph on both the endpoint chain and the preview-render chain (26/960 = 2.708%). The corresponding 1080x1920 full-render chain measured 54/1920 = 2.812%; the 3.8% relative rasterization difference is within the expected few-percent tolerance. The frontend sends the raw `fontSize` field in `subtitle_settings`; it does not pre-scale the value.

No endpoint font-size multiplier is appropriate: changing its reference to 540x960 would make the JPEG diverge from the final render. The active endpoint test now guards the 1080x1920 reference passed to `build_subtitle_filter`.

## 2026-07-12 - Variant-preview style source

The Step-3 MP4 preview must receive the already resolved style for its preview card (default + its A/B override or Meta fallback), rather than rebuilding a subset of fields and then asking the backend to apply another Meta style overlay. The client now sends that exact object, including karaoke fields, with `apply_meta_subtitle_style=false`.

`visual_version` remains present for the Meta segment offset and preview-cache key; it no longer changes the subtitle style for this request. The backend retains its server-side Meta fallback for legacy callers that omit the new flag. Final renders continue to resolve the same A/B fallback/override precedence before `_render_with_preset`.

## 2026-07-12 — Per-view height measurement

The compact and expanded timeline previews previously shared a single measurement ref, so opening the Expanded dialog kept the compact container's ~320px height and rendered overlay subtitles ~2.3x too small relative to the ~750px expanded frame. `useSubtitlePreviewHeight` now uses a callback ref — it observes whichever element actually mounts, robust to portal/dialog mount timing — and each view (compact, expanded, style-editor fallback) owns its own hook instance and passes its own height into the overlay renderer.
