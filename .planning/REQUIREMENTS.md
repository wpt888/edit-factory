# Requirements: Edit Factory

**Defined:** 2026-02-28
**Core Value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.

## v9 Requirements

Requirements for v9 Assembly Pipeline Fix + Overlays. Each maps to roadmap phases.

### Assembly Fix

- [x] **ASMB-01**: Merge step uses all segments before repeating any (full round-robin through merge)
- [x] **ASMB-02**: Diversity window tracks all used segments in merged groups, not just the previous one
- [x] **ASMB-03**: Segments from same source video with overlapping time ranges are not placed near each other

### Subtitle Fix

- [x] **SUBS-01**: Step 2 TTS generation persists srt_content and timestamps in tts_previews cache
- [x] **SUBS-02**: Step 3 render reuses cached SRT content instead of regenerating TTS
- [x] **SUBS-03**: Assembled video duration matches TTS audio duration (no subtitle cutoff)
- [x] **SUBS-04**: SRT entries have minimum duration floor (no zero-duration invisible subtitles)

### Overlay Render

- [x] **OVRL-01**: User can insert interstitial product slides between video segments
- [x] **OVRL-02**: Interstitial slides have configurable duration
- [x] **OVRL-03**: Ken Burns animation applied to interstitial product images
- [ ] **OVRL-04**: PiP overlay rendered in final video via FFmpeg
- [ ] **OVRL-05**: Interstitial slides rendered in final video via FFmpeg
- [ ] **OVRL-06**: Product image animation (zoom/pan) in rendered overlays

## Future Requirements

None — all scoped features included in v9.

## Out of Scope

| Feature | Reason |
|---------|--------|
| pHash visual similarity during assembly | Unnecessary — proper round-robin with ID tracking solves repetition without compute overhead |
| Real-time subtitle preview | Complex infrastructure, preview never matches final render |
| Automatic segment pool expansion | Would require re-analyzing source videos mid-assembly |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ASMB-01 | Phase 43 | Complete |
| ASMB-02 | Phase 43 | Complete |
| ASMB-03 | Phase 43 | Complete |
| SUBS-01 | Phase 44 | Complete |
| SUBS-02 | Phase 44 | Complete |
| SUBS-03 | Phase 44 | Complete |
| SUBS-04 | Phase 44 | Complete |
| OVRL-01 | Phase 45 | Complete |
| OVRL-02 | Phase 45 | Complete |
| OVRL-03 | Phase 45 | Complete |
| OVRL-04 | Phase 46 | Pending |
| OVRL-05 | Phase 46 | Pending |
| OVRL-06 | Phase 46 | Pending |

**Coverage:**
- v9 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after roadmap creation (traceability complete)*
