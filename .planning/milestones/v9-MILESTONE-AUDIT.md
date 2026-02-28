---
milestone: v9
audited: 2026-02-28T02:00:00Z
status: passed
scores:
  requirements: 13/13
  phases: 4/4
  integration: 14/14
  flows: 4/4
gaps:
  requirements: []
  integration: []
  flows: []
tech_debt:
  - phase: 46-overlay-ffmpeg-render-integration
    items:
      - "Dead code: pipeline_routes.py lines 1343-1351 — Phase 45 interstitial extraction block superseded by Phase 46 block at lines 1392-1397. Causes redundant log line but no incorrect behavior."
      - "Type annotation: overlay_renderer.py functions annotated as str params but callers pass Path objects. Runtime-safe due to Python duck typing."
      - "Type annotation: assembly_service.py line 1012 assigns Path to results[] list typed as Optional[Path] but apply_pip_overlay returns str-annotated value (actually Path at runtime)."
  - phase: 45-interstitial-slide-controls
    items:
      - "Human visual verification deferred: Timeline '+' button insertion, slide config panel, Ken Burns conditional dropdown, render payload — all automated checks passed."
  - phase: 46-overlay-ffmpeg-render-integration
    items:
      - "Human visual verification deferred: PiP overlay position/size, interstitial slide insertion, Ken Burns animation quality, graceful degradation with failed image URL."
  - phase: 44-subtitle-data-flow-fix
    items:
      - "Human perceptual verification deferred: Subtitle timing match (preview vs render), no cutoff at video end, zero-duration suppression not dropping visible words."
---

# v9 Milestone Audit: Assembly Pipeline Fix + Overlays

**Audited:** 2026-02-28
**Status:** PASSED
**Milestone Goal:** Fix critical assembly pipeline bugs (segment repetition, missing subtitles) and complete deferred v7 overlay rendering (interstitial slides + PiP via FFmpeg)

## Scores

| Category | Score | Details |
|----------|-------|---------|
| Requirements | 13/13 | All satisfied across 3-source cross-reference |
| Phases | 4/4 | All verified (2 passed, 2 human_needed — automated checks complete) |
| Integration | 14/14 | All cross-phase connections wired, 0 orphaned exports |
| E2E Flows | 4/4 | Diversity fix, SRT cache, interstitial slides, PiP overlays — all complete in code |

## Requirements Coverage (3-Source Cross-Reference)

| REQ-ID | Description | VERIFICATION.md | SUMMARY Frontmatter | REQUIREMENTS.md | Final Status |
|--------|-------------|-----------------|---------------------|-----------------|--------------|
| ASMB-01 | Merge step uses all segments before repeating | SATISFIED (43-V) | 43-01-S | [x] Complete | **satisfied** |
| ASMB-02 | Diversity window tracks all used segments | SATISFIED (43-V) | 43-01-S | [x] Complete | **satisfied** |
| ASMB-03 | Same-source overlapping time ranges not adjacent | SATISFIED (43-V) | 43-01-S | [x] Complete | **satisfied** |
| SUBS-01 | Step 2 TTS persists srt_content in cache | SATISFIED (44-V) | 44-01-S | [x] Complete | **satisfied** |
| SUBS-02 | Step 3 reuses cached SRT | SATISFIED (44-V) | 44-01-S | [x] Complete | **satisfied** |
| SUBS-03 | Video duration matches TTS audio | SATISFIED (44-V) | 44-02-S | [x] Complete | **satisfied** |
| SUBS-04 | Minimum SRT entry duration floor | SATISFIED (44-V) | 44-02-S | [x] Complete | **satisfied** |
| OVRL-01 | Insert interstitial slides between segments | SATISFIED (45-V) | 45-01-S | [x] Complete | **satisfied** |
| OVRL-02 | Configurable slide duration | SATISFIED (45-V) | 45-01-S | [x] Complete | **satisfied** |
| OVRL-03 | Ken Burns animation config | SATISFIED (45-V) | 45-01-S | [x] Complete | **satisfied** |
| OVRL-04 | PiP overlay rendered via FFmpeg | SATISFIED-code (46-V) | 46-01-S, 46-02-S | [x] Complete | **satisfied** |
| OVRL-05 | Interstitial slides rendered via FFmpeg | SATISFIED-code (46-V) | 46-01-S, 46-02-S | [x] Complete | **satisfied** |
| OVRL-06 | Ken Burns animation in rendered overlays | SATISFIED-code (46-V) | 46-01-S, 46-02-S | [x] Complete | **satisfied** |

**Orphaned requirements:** None. All 13 REQ-IDs from traceability table are present in at least one VERIFICATION.md.

## Phase Verification Summary

| Phase | Status | Score | Requirements | Gaps |
|-------|--------|-------|--------------|------|
| 43 — Assembly Diversity Fix | passed | 4/4 | ASMB-01, ASMB-02, ASMB-03 | None |
| 44 — Subtitle Data Flow Fix | passed | 6/6 | SUBS-01, SUBS-02, SUBS-03, SUBS-04 | None |
| 45 — Interstitial Slide Controls | human_needed | 4/4 | OVRL-01, OVRL-02, OVRL-03 | None (visual verification deferred) |
| 46 — Overlay FFmpeg Render | human_needed | 7/7 | OVRL-04, OVRL-05, OVRL-06 | None (visual verification deferred) |

## Cross-Phase Integration Report

**Integration checker result:** All 14 cross-phase connections verified as wired.

### Key Integration Paths

1. **Phase 43 → Phase 46:** `build_timeline` sub-entries merge → `assemble_video` receives diverse `TimelineEntry` list with overlays applied per-segment
2. **Phase 44 → Phase 46:** `srt_content` stored in `tts_previews` → `reuse_srt_content` passed to `assemble_and_render` → subtitle timing preserved through overlay render
3. **Phase 45 → Phase 46:** `InterstitialSlide` type/state → `interstitial_slides` in render POST body → `PipelineRenderRequest.interstitial_slides` → `assemble_video` concat list insertion
4. **Phase 45 → Phase 46:** `pip_overlays` built from product associations → `PipelineRenderRequest.pip_overlays` → `assemble_video` PiP post-extract pass

### Integration Issues Found

| Severity | Issue | Affected REQs | Impact |
|----------|-------|---------------|--------|
| Low | Dead code: `pipeline_routes.py` lines 1343-1351 (Phase 45 stub) overwritten by Phase 46 block at lines 1392-1397 | OVRL-01, OVRL-02, OVRL-03, OVRL-05 | No incorrect behavior — Phase 46 block is authoritative. Redundant log line only. |
| Info | Type annotations: `overlay_renderer.py` annotated `str` but receives `Path` objects | OVRL-04, OVRL-05 | Runtime-safe (Python duck typing). Annotation-only inconsistency. |

### E2E Flow Verification

| Flow | Path | Status |
|------|------|--------|
| Assembly diversity | Script → match_srt_to_segments → build_timeline (sub-entries merge) → assemble_video | Complete |
| SRT cache reuse | preview_variant → tts_previews[srt_content] → do_render → assemble_and_render(reuse_srt_content) | Complete |
| Interstitial slides | Timeline UI → pipeline state → render POST → pipeline_routes → assemble_video → concat list rebuild | Complete |
| PiP overlays | Product associations → render POST → pipeline_routes → assemble_video → per-segment apply_pip_overlay | Complete |

**Broken flows:** None.

## Tech Debt Summary

| Phase | Items | Severity |
|-------|-------|----------|
| 46 | Dead code block in pipeline_routes.py (3 items) | Low |
| 45 | Visual verification deferred (4 tests) | Info |
| 46 | Visual verification deferred (4 tests) | Info |
| 44 | Perceptual verification deferred (3 tests) | Info |

**Total:** 14 items across 3 phases. No blockers.

## Conclusion

v9 milestone **passes** audit. All 13 requirements are satisfied in code across all three verification sources. All 14 cross-phase integration connections are wired. All 4 E2E flows complete without breaks. The remaining tech debt is minor (dead code cleanup, type annotations) and visual verification items that require a live render pipeline with actual product images.

---

*Audited: 2026-02-28*
*Auditor: Claude (audit-milestone workflow)*
