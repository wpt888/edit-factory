# Milestone v3: Video Quality Enhancement

**Status:** SHIPPED 2026-02-06
**Phases:** 7-11
**Total Plans:** 13

## Overview

Professional-grade video output with platform-optimized encoding, audio normalization, and enhanced visual quality. Upgraded from CRF 23/fast/128k baseline to CRF 18-20/medium/192k with per-platform presets, loudness normalization, video filters, improved scoring, and subtitle enhancement.

## Phases

### Phase 7: Platform Export Presets

**Goal**: Professional encoding with platform-specific presets for TikTok, Reels, YouTube Shorts
**Depends on**: Nothing (first phase of v3)
**Requirements**: ENC-01, ENC-02, ENC-03, ENC-04
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md — Encoding presets service: Pydantic model + platform preset definitions
- [x] 07-02-PLAN.md — Integration: keyframe controls in render pipeline + database preset updates
- [x] 07-03-PLAN.md — Frontend: Platform selector dropdown in library export UI

### Phase 8: Audio Normalization

**Goal**: Consistent audio loudness at -14 LUFS for social media standards
**Depends on**: Phase 7 (encoding foundation must be in place)
**Requirements**: AUD-01, AUD-02
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — Audio normalizer service + EncodingPreset normalization fields
- [x] 08-02-PLAN.md — Render pipeline integration + visual verification

### Phase 9: Video Enhancement Filters

**Goal**: Optional quality filters (denoise, sharpen, color correction) for user-generated content
**Depends on**: Phase 7 (filter chain must respect encoding architecture)
**Requirements**: FLT-01, FLT-02, FLT-03, FLT-04
**Plans**: 3 plans

Plans:
- [x] 09-01-PLAN.md — Backend filter foundation: video_filters.py service + EncodingPreset integration
- [x] 09-02-PLAN.md — Render pipeline integration: filter parameters + FFmpeg filter chain
- [x] 09-03-PLAN.md — Frontend filter UI: VideoEnhancementControls component + library page integration

### Phase 10: Segment Scoring Enhancement

**Goal**: Improved segment selection with blur detection and contrast analysis
**Depends on**: Nothing (independent scoring enhancement)
**Requirements**: SCR-01, SCR-02
**Plans**: 1 plan

Plans:
- [x] 10-01-PLAN.md — Blur/contrast scoring: Laplacian variance + std dev metrics, 5-factor weight rebalancing, blur rejection threshold

### Phase 11: Subtitle Enhancement

**Goal**: Professional subtitle styling with shadow, glow, and adaptive sizing
**Depends on**: Phase 7 (subtitle rendering must respect encoding pipeline)
**Requirements**: SUB-01, SUB-02, SUB-03
**Plans**: 3 plans

Plans:
- [x] 11-01-PLAN.md — Backend subtitle styling service: SubtitleStyleConfig, adaptive font sizing, filter builder
- [x] 11-02-PLAN.md — Render pipeline integration: subtitle enhancement Form params, build_subtitle_filter() refactor
- [x] 11-03-PLAN.md — Frontend subtitle enhancement controls: shadow/glow/adaptive UI + library page integration

---

## Milestone Summary

**Key Decisions:**
- -14 LUFS for audio normalization (social media platform standard)
- Two-pass loudnorm workflow (measure first, apply linear normalization second)
- Platform presets over manual encoding (users shouldn't configure technical settings)
- hqdn3d over nlmeans for denoising (10-30x faster, sufficient for social video)
- CRF 18 for Reels/YouTube Shorts, CRF 20 for TikTok/Generic
- stdlib dataclass over Pydantic for filter configs (simpler, no validation overhead)
- Filter order locked: denoise -> sharpen -> color (prevent sharpening noise)
- Laplacian variance for blur detection (industry standard, single-pass, fast)
- 5-factor scoring weights 40/20/20/15/5 (motion/variance/blur/contrast/brightness)
- Subtitle enhancement params passed per-render as Form fields (consistent with filter approach)

**Issues Resolved:**
- Database migration 007 requires manual application (Supabase client limitation)
- Application gracefully degrades without migration (uses hardcoded EncodingPreset defaults)

**Issues Deferred:**
- Scoring algorithm weights need A/B testing with platform performance data
- Database migration 007 still pending manual application
- VMAF/perceptual quality metrics deferred to future milestone

**Technical Debt Incurred:**
- None significant — all features integrated with backward compatibility

---

_For current project status, see .planning/ROADMAP.md_
