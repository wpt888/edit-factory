# Requirements: Edit Factory

**Defined:** 2026-02-28
**Core Value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.

## v9 Requirements

Requirements for v9 Assembly Pipeline Fix + Overlays. Each maps to roadmap phases.

### Assembly Fix

- [ ] **ASMB-01**: Merge step uses all segments before repeating any (full round-robin through merge)
- [ ] **ASMB-02**: Diversity window tracks all used segments in merged groups, not just the previous one
- [ ] **ASMB-03**: Segments from same source video with overlapping time ranges are not placed near each other

### Subtitle Fix

- [ ] **SUBS-01**: Step 2 TTS generation persists srt_content and timestamps in tts_previews cache
- [ ] **SUBS-02**: Step 3 render reuses cached SRT content instead of regenerating TTS
- [ ] **SUBS-03**: Assembled video duration matches TTS audio duration (no subtitle cutoff)
- [ ] **SUBS-04**: SRT entries have minimum duration floor (no zero-duration invisible subtitles)

### Overlay Render

- [ ] **OVRL-01**: User can insert interstitial product slides between video segments
- [ ] **OVRL-02**: Interstitial slides have configurable duration
- [ ] **OVRL-03**: Ken Burns animation applied to interstitial product images
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
| ASMB-01 | TBD | Pending |
| ASMB-02 | TBD | Pending |
| ASMB-03 | TBD | Pending |
| SUBS-01 | TBD | Pending |
| SUBS-02 | TBD | Pending |
| SUBS-03 | TBD | Pending |
| SUBS-04 | TBD | Pending |
| OVRL-01 | TBD | Pending |
| OVRL-02 | TBD | Pending |
| OVRL-03 | TBD | Pending |
| OVRL-04 | TBD | Pending |
| OVRL-05 | TBD | Pending |
| OVRL-06 | TBD | Pending |

**Coverage:**
- v9 requirements: 13 total
- Mapped to phases: 0
- Unmapped: 13 (pending roadmap)

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after initial definition*
