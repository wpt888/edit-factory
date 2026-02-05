# Requirements Archive: v3 Video Quality Enhancement

**Archived:** 2026-02-06
**Status:** SHIPPED

This is the archived requirements specification for v3.
For current requirements, see `.planning/REQUIREMENTS.md` (created for next milestone).

---

# Requirements: Edit Factory v3

**Defined:** 2026-02-04
**Core Value:** Professional-grade video output with platform-optimized encoding and enhanced visual quality

## v3 Requirements

### Encoding

- [x] **ENC-01**: System applies platform-specific encoding presets (TikTok, Reels, YouTube Shorts) during export
- [x] **ENC-02**: System uses professional encoding settings (CRF 18-20, preset medium/slow)
- [x] **ENC-03**: System adds keyframe controls (-g 60, -keyint_min 60) for platform compatibility
- [x] **ENC-04**: System encodes audio at 192k bitrate (upgrade from 128k)

### Audio Normalization

- [x] **AUD-01**: System normalizes audio to -14 LUFS using two-pass loudnorm filter
- [x] **AUD-02**: System applies true peak limiting (-1.5 dBTP) to prevent clipping

### Video Filters

- [x] **FLT-01**: User can enable denoising filter (hqdn3d) for low-light footage
- [x] **FLT-02**: User can enable sharpening filter (unsharp) for soft footage
- [x] **FLT-03**: User can adjust color correction (brightness, contrast, saturation)
- [x] **FLT-04**: System applies filters in correct order (denoise -> sharpen -> color correct)

### Segment Scoring

- [x] **SCR-01**: System calculates blur score using Laplacian variance for each segment
- [x] **SCR-02**: System penalizes blurry segments in combined scoring algorithm

### Subtitles

- [x] **SUB-01**: User can enable shadow effects on subtitles with configurable depth
- [x] **SUB-02**: User can enable glow/outline effects on subtitle text
- [x] **SUB-03**: System automatically adjusts font size based on text length (adaptive sizing)

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENC-01 | Phase 7 | Complete |
| ENC-02 | Phase 7 | Complete |
| ENC-03 | Phase 7 | Complete |
| ENC-04 | Phase 7 | Complete |
| AUD-01 | Phase 8 | Complete |
| AUD-02 | Phase 8 | Complete |
| FLT-01 | Phase 9 | Complete |
| FLT-02 | Phase 9 | Complete |
| FLT-03 | Phase 9 | Complete |
| FLT-04 | Phase 9 | Complete |
| SCR-01 | Phase 10 | Complete |
| SCR-02 | Phase 10 | Complete |
| SUB-01 | Phase 11 | Complete |
| SUB-02 | Phase 11 | Complete |
| SUB-03 | Phase 11 | Complete |

**Coverage:** 15/15 (100%)

---

## Milestone Summary

**Shipped:** 15 of 15 v3 requirements
**Adjusted:** None — all requirements delivered as specified
**Dropped:** None

---
*Archived: 2026-02-06 as part of v3 milestone completion*
