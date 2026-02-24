# Requirements: Edit Factory

**Defined:** 2026-02-24
**Core Value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.

## v8 Requirements

Requirements for v8 Pipeline UX Overhaul. Each maps to roadmap phases.

### Bug Fixes

- [x] **BUG-01**: User does not see empty state flash when entering Step 4 (render progress loads cleanly without flicker)
- [x] **BUG-02**: Rendered pipeline clips are saved to Supabase clips table and appear in library for publishing

### Video Source Selection

- [x] **SRC-01**: User can select one or more projects/videos from library as segment source before preview
- [x] **SRC-02**: Preview and render only match against segments from selected video(s), not entire library
- [x] **SRC-03**: User can see how many segments each video has when selecting source
- [x] **SRC-04**: Selected source videos persist in pipeline state (survives page reload via DB)

### Video Preview

- [x] **PREV-01**: User can play rendered videos inline in Step 4 variant cards (HTML5 video player)
- [x] **PREV-02**: Auto-generated thumbnail displayed for each rendered variant before playback

### Timeline Editor

- [x] **TIME-01**: User sees a visual timeline showing matched SRT phrases mapped to video segments in Step 3
- [x] **TIME-02**: User can drag and drop to reorder segments on the timeline
- [x] **TIME-03**: User can swap a segment for a different one from the selected source video(s)
- [x] **TIME-04**: Unmatched phrases are visually highlighted with option to manually assign a segment
- [ ] **TIME-05**: User can adjust segment duration on the timeline

## v7 Requirements (Paused)

v7 Product Image Overlays — 4/6 phases complete. Remaining:

- [ ] **SLID-01**: User can insert an interstitial product slide between segments
- [ ] **SLID-02**: User can configure interstitial slide duration (0.5s - 5s)
- [ ] **SLID-03**: Interstitial slide displays product image full-screen with Ken Burns animation
- [ ] **REND-01**: Assembly/render pipeline applies PiP overlays during video composition
- [ ] **REND-02**: Assembly/render pipeline inserts interstitial slides at segment boundaries
- [ ] **REND-03**: Rendered video uses selected product images with chosen animation style

## Future Requirements

v7 remaining phases (36-37) deferred — resume after v8.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-track audio mixing | Single TTS voiceover is sufficient for shorts |
| Frame-level segment trimming | Duration adjustment (TIME-05) is granular enough |
| Collaborative timeline editing | Single-user app |
| Real-time preview rendering | Too compute-heavy; preview via generated thumbnails |
| Automatic segment matching without source selection | Current pain point — user must choose source |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BUG-01 | Phase 38 | Complete |
| BUG-02 | Phase 38 | Complete |
| SRC-01 | Phase 39 | Complete |
| SRC-02 | Phase 38 | Complete |
| SRC-03 | Phase 39 | Complete |
| SRC-04 | Phase 39 | Complete |
| PREV-01 | Phase 40 | Complete |
| PREV-02 | Phase 40 | Complete |
| TIME-01 | Phase 41 | Complete |
| TIME-02 | Phase 41 | Complete |
| TIME-03 | Phase 41 | Complete |
| TIME-04 | Phase 41 | Complete |
| TIME-05 | Phase 41 | Pending |

**Coverage:**
- v8 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0

---
*Requirements defined: 2026-02-24*
*Last updated: 2026-02-24 after v8 roadmap created (phases 38-41)*
