---
milestone: v5
audited: 2026-02-21T14:30:00Z
status: gaps_found
scores:
  requirements: 29/30
  phases: 6/6
  integration: 28/30
  flows: 6/7
gaps:
  requirements:
    - id: "FEED-01"
      status: "partial"
      phase: "Phase 17"
      claimed_by_plans: ["17-01-PLAN.md"]
      completed_by_plans: ["17-01-PLAN.md"]
      verification_status: "passed"
      evidence: "Backend POST /api/v1/feeds endpoint exists and works. Frontend has no UI to call it — products page says 'Add a feed in Settings' but Settings page has no feed creation form. New users cannot create feeds from the UI."
  integration:
    - from: "Phase 17 (feed_routes.py)"
      to: "Frontend (products/page.tsx, settings/page.tsx)"
      issue: "POST /api/v1/feeds has no frontend caller. Feed creation requires curl or Swagger UI."
      affected_requirements: ["FEED-01"]
    - from: "Phase 22 (VideoTemplate.safe_zone_top/bottom)"
      to: "Phase 18 (product_video_compositor._build_text_overlays)"
      issue: "safe_zone_top/safe_zone_bottom fields defined on VideoTemplate dataclass but never read by filter-building code. Safe zones enforced implicitly via manually-correct y-positions in each preset."
      affected_requirements: ["TMPL-04"]
  flows:
    - name: "Feed creation (first-time setup)"
      breaks_at: "Frontend — no UI to call POST /api/v1/feeds"
      affected_requirements: ["FEED-01"]
tech_debt:
  - phase: 22-templates-and-profile-customization
    items:
      - "TMPL-04: safe_zone_top/safe_zone_bottom fields on VideoTemplate are unused metadata — y-positions manually respect safe zones but fields are never consumed programmatically"
  - phase: 21-batch-generation
    items:
      - "Dead code: _finalize_batch 'completed_with_errors' branch is unreachable — condition (completed + failed) == total is always true when sequential loop exits"
  - phase: 13-tts-based-subtitles
    items:
      - "Human verification pending: subtitle sync with TTS audio requires visual/audio perception test"
  - phase: 09-video-enhancement-filters
    items:
      - "Human verification pending: filter visual quality and <20% performance overhead not confirmed"
  - phase: 07-platform-export-presets
    items:
      - "Human verification pending: actual TikTok/Instagram/YouTube upload acceptance not confirmed"
---

# v5 Product Video Generator — Milestone Audit Report

**Milestone:** v5 Product Video Generator
**Phases:** 17-22 (6 phases, 12 plans, all complete)
**Audited:** 2026-02-21
**Status:** GAPS FOUND

---

## Executive Summary

29 of 30 v5 requirements are fully satisfied with verified cross-phase wiring. One requirement (FEED-01) has an integration gap: the backend API for feed creation exists but the frontend has no UI to call it. All 6 phases passed individual verification. 6 of 7 E2E user flows are complete; the feed creation flow breaks at the frontend layer.

---

## Phase Verification Summary

| Phase | Name | Status | Score | Critical Gaps |
|-------|------|--------|-------|---------------|
| 17 | Feed Foundation | passed | 5/5 | None |
| 18 | Video Composition | passed | 5/5 (7/7 truths) | None |
| 19 | Product Browser | passed | 5/5 | None |
| 20 | Single Product E2E | passed | 10/10 | None |
| 21 | Batch Generation | human_needed | 10/10 | 5 items need browser testing |
| 22 | Templates & Profile | human_needed | 13/13 | 4 items need browser testing |

All phases passed automated verification. Phases 21 and 22 have `human_needed` status for browser-based interaction testing (not code gaps).

---

## Requirements Coverage (3-Source Cross-Reference)

### Source 1: REQUIREMENTS.md Traceability Table

All 30 requirements marked `[x]` Complete and mapped to phases.

### Source 2: Phase VERIFICATION.md Requirements Tables

| Phase | Requirements Verified | Status |
|-------|----------------------|--------|
| 17 | FEED-01, FEED-07, COMP-05 | All SATISFIED |
| 18 | COMP-01, COMP-02, COMP-03, COMP-04, COMP-06 | All SATISFIED |
| 19 | FEED-02, FEED-03, FEED-04, FEED-05, FEED-06 | All SATISFIED |
| 20 | TTS-01, TTS-02, TTS-03, TTS-04, BATCH-01, BATCH-05, OUT-01, OUT-02, OUT-03, OUT-04 | All SATISFIED |
| 21 | BATCH-02, BATCH-03, BATCH-04 | All SATISFIED |
| 22 | TMPL-01, TMPL-02, TMPL-03, TMPL-04 | All SATISFIED |

**Total:** 30/30 verified as SATISFIED in phase verifications.

### Source 3: SUMMARY.md Frontmatter

The `requirements_completed` YAML field is **not used** in any v5 SUMMARY.md file (12 summaries across 6 phases). This source is unavailable for cross-reference.

### Cross-Reference Matrix

| Req ID | REQUIREMENTS.md | VERIFICATION.md | Integration Check | Final Status |
|--------|----------------|-----------------|-------------------|--------------|
| FEED-01 | `[x]` Complete | SATISFIED (Phase 17) | **PARTIAL** — no frontend UI for feed creation | **partial** |
| FEED-02 | `[x]` Complete | SATISFIED (Phase 19) | WIRED | satisfied |
| FEED-03 | `[x]` Complete | SATISFIED (Phase 19) | WIRED | satisfied |
| FEED-04 | `[x]` Complete | SATISFIED (Phase 19) | WIRED | satisfied |
| FEED-05 | `[x]` Complete | SATISFIED (Phase 19) | WIRED | satisfied |
| FEED-06 | `[x]` Complete | SATISFIED (Phase 19) | WIRED | satisfied |
| FEED-07 | `[x]` Complete | SATISFIED (Phase 17) | WIRED (self-contained) | satisfied |
| COMP-01 | `[x]` Complete | SATISFIED (Phase 18) | WIRED | satisfied |
| COMP-02 | `[x]` Complete | SATISFIED (Phase 18) | WIRED | satisfied |
| COMP-03 | `[x]` Complete | SATISFIED (Phase 18) | WIRED | satisfied |
| COMP-04 | `[x]` Complete | SATISFIED (Phase 18) | WIRED | satisfied |
| COMP-05 | `[x]` Complete | SATISFIED (Phase 17) | WIRED (consumed by Phase 18) | satisfied |
| COMP-06 | `[x]` Complete | SATISFIED (Phase 18) | WIRED | satisfied |
| TTS-01 | `[x]` Complete | SATISFIED (Phase 20) | WIRED | satisfied |
| TTS-02 | `[x]` Complete | SATISFIED (Phase 20) | WIRED | satisfied |
| TTS-03 | `[x]` Complete | SATISFIED (Phase 20) | WIRED | satisfied |
| TTS-04 | `[x]` Complete | SATISFIED (Phase 20) | WIRED (Edge TTS skips subtitles, documented) | satisfied |
| TMPL-01 | `[x]` Complete | SATISFIED (Phase 22) | WIRED | satisfied |
| TMPL-02 | `[x]` Complete | SATISFIED (Phase 22) | WIRED | satisfied |
| TMPL-03 | `[x]` Complete | SATISFIED (Phase 22) | WIRED | satisfied |
| TMPL-04 | `[x]` Complete | SATISFIED (Phase 22) | PARTIAL (safe_zone fields unused) | satisfied (with tech debt) |
| BATCH-01 | `[x]` Complete | SATISFIED (Phase 20) | WIRED | satisfied |
| BATCH-02 | `[x]` Complete | SATISFIED (Phase 21) | WIRED | satisfied |
| BATCH-03 | `[x]` Complete | SATISFIED (Phase 21) | WIRED (dead code noted) | satisfied |
| BATCH-04 | `[x]` Complete | SATISFIED (Phase 21) | WIRED | satisfied |
| BATCH-05 | `[x]` Complete | SATISFIED (Phase 20) | WIRED | satisfied |
| OUT-01 | `[x]` Complete | SATISFIED (Phase 20) | WIRED | satisfied |
| OUT-02 | `[x]` Complete | SATISFIED (Phase 20) | WIRED | satisfied |
| OUT-03 | `[x]` Complete | SATISFIED (Phase 20) | WIRED | satisfied |
| OUT-04 | `[x]` Complete | SATISFIED (Phase 20) | WIRED | satisfied |

**Orphan check:** 0 orphaned requirements. All 30 REQ-IDs appear in at least one phase VERIFICATION.md.

---

## E2E User Flow Verification

| # | Flow | Status | Details |
|---|------|--------|---------|
| 1 | Feed sync → products table → product browser (17→19) | **PARTIAL** | Backend complete. Frontend has no feed creation UI — breaks at first-time setup |
| 2 | Product browser → single product → library (19→20→library) | COMPLETE | Full pipeline: select product → configure TTS → generate → poll → library |
| 3 | Product browser → batch generation → progress (19→21) | COMPLETE | Multi-select → POST batch → poll per-product → retry failed |
| 4 | Template settings → compositor → video (22→18→20/21) | COMPLETE | Settings save → profile JSONB → generation reads → compositor applies |
| 5 | Image download → compositor (17→18) | COMPLETE | Feed sync downloads → local cache → compositor reads (with re-download fallback) |
| 6 | v4 TTS + subtitles reuse (12/13→20) | COMPLETE | ElevenLabs timestamps + SRT generator reused in product pipeline |
| 7 | Profile template → batch pipeline (22→21) | COMPLETE | Batch reads profile template per product independently |

---

## Gap Details

### FEED-01: Feed Creation UI Missing

**Requirement:** "User can add a Google Shopping XML feed URL and sync product data"

**What works:**
- `POST /api/v1/feeds` backend endpoint exists and is functional
- Feed sync (`POST /feeds/{id}/sync`) works correctly
- Products page displays feed selector and "Re-sync" button for existing feeds
- Products page shows guidance text: "No feeds configured. Add a feed in Settings."

**What's missing:**
- No form, dialog, or button in the frontend to call `POST /api/v1/feeds`
- Settings page has no feed management section
- New users must use curl, Swagger UI (`/docs`), or direct API calls to create their first feed

**Fix scope:** Small — add a "Create Feed" dialog to the products page (name + feed_url fields, POST call). Estimated: 1 plan, ~50 frontend lines.

### TMPL-04: Safe Zone Fields (Tech Debt)

**Requirement:** "Templates define safe zones so text overlays do not overlap TikTok/Reels UI elements"

**Status:** Requirement intent is met — all 3 template presets have y-positions manually set to avoid top/bottom UI zones. However, the `safe_zone_top=150` and `safe_zone_bottom=200` fields on the `VideoTemplate` dataclass are never read by any code. They serve as documentation only.

**Risk:** If someone adds a 4th template with incorrect y-positions, the safe_zone fields won't prevent overlap. Low risk — adding templates requires editing Python code anyway.

---

## Tech Debt Summary

| Phase | Item | Severity |
|-------|------|----------|
| 22 | `safe_zone_top`/`safe_zone_bottom` fields unused — layout safe zones enforced via manual y-positions only | Low |
| 21 | `_finalize_batch` "completed_with_errors" branch is unreachable dead code | Low |
| 13 | Subtitle sync with TTS audio needs human visual verification | Info |
| 09 | Filter visual quality and performance overhead not human-verified | Info |
| 07 | Platform upload acceptance (TikTok/Instagram/YouTube) not human-verified | Info |

**Total:** 5 items across 5 phases. No blockers.

---

## Conclusion

v5 Product Video Generator delivers 29/30 requirements with full cross-phase integration. The single gap (FEED-01 frontend UI) is a small UX issue that doesn't affect any other requirement or flow — it only blocks first-time feed setup from the browser. All video generation, composition, batch processing, template customization, and library integration flows are complete and verified.

---

_Audited: 2026-02-21_
_Auditor: Claude (audit-milestone workflow)_
_Integration checker: Claude (gsd-integration-checker)_
