# Requirements: Edit Factory v3

**Defined:** 2026-02-04
**Core Value:** Professional-grade video output with platform-optimized encoding and enhanced visual quality

## v3 Requirements

Requirements for video quality enhancement milestone. Each maps to roadmap phases.

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
- [x] **FLT-04**: System applies filters in correct order (denoise → sharpen → color correct)

### Segment Scoring

- [ ] **SCR-01**: System calculates blur score using Laplacian variance for each segment
- [ ] **SCR-02**: System penalizes blurry segments in combined scoring algorithm

### Subtitles

- [ ] **SUB-01**: User can enable shadow effects on subtitles with configurable depth
- [ ] **SUB-02**: User can enable glow/outline effects on subtitle text
- [ ] **SUB-03**: System automatically adjusts font size based on text length (adaptive sizing)

## Future Requirements

Deferred to v4 or later milestone.

### Advanced Quality

- **QUAL-01**: System calculates VMAF score for quality validation
- **QUAL-02**: User receives quality warnings before platform upload
- **QUAL-03**: System supports adaptive bitrate encoding (target VMAF instead of fixed CRF)

### Audio Enhancement

- **AUDE-01**: System applies noise reduction to voice recordings
- **AUDE-02**: System applies EQ enhancement for voice clarity
- **AUDE-03**: System applies compression for consistent volume

### Advanced Subtitles

- **SUBE-01**: System highlights current word during playback (CapCut style)
- **SUBE-02**: User can add subtitle animations (fade in, scale)

## Out of Scope

| Feature | Reason |
|---------|--------|
| AI video upscaling | Compute-intensive, artifacts common, 1080p sufficient for social media |
| Real-time preview | Complex infrastructure, preview never matches final output |
| Video stabilization | Compute-heavy, most phone footage already stabilized |
| Lossless export (ProRes) | Massive files, platforms compress heavily anyway |
| nlmeans denoising | 10-30x slower than hqdn3d, overkill for social video |
| Multi-track audio | Users who need this use DAWs, out of scope |
| Broadcast captions compliance | Social media doesn't require FCC/BBC standards |

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
| SCR-01 | Phase 10 | Pending |
| SCR-02 | Phase 10 | Pending |
| SUB-01 | Phase 11 | Pending |
| SUB-02 | Phase 11 | Pending |
| SUB-03 | Phase 11 | Pending |

**Coverage:**
- v3 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0
- Coverage: 100%

---
*Requirements defined: 2026-02-04*
*Last updated: 2026-02-05 (Phase 9 complete - FLT-01, FLT-02, FLT-03, FLT-04)*
