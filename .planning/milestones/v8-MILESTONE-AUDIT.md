---
milestone: v8
audited: 2026-02-24T13:00:00Z
status: gaps_found
scores:
  requirements: 11/13
  phases: 4/4
  integration: 11/13
  flows: 4/5
gaps:
  requirements:
    - id: "TIME-03"
      status: "unsatisfied"
      phase: "Phase 41"
      claimed_by_plans: ["41-02-PLAN.md"]
      completed_by_plans: ["41-02-SUMMARY.md"]
      verification_status: "passed (static analysis only)"
      evidence: "PipelinePreviewResponse Pydantic model (pipeline_routes.py:192-199) lacks available_segments field. assembly_service.preview_matches() produces it (line 844), but the route handler at line 853-860 drops it. Frontend page.tsx:559 reads available_segments from response — always undefined. TimelineEditor swap button disabled when availableSegments.length === 0 (timeline-editor.tsx:327)."
    - id: "TIME-04"
      status: "unsatisfied"
      phase: "Phase 41"
      claimed_by_plans: ["41-01-PLAN.md"]
      completed_by_plans: ["41-01-SUMMARY.md"]
      verification_status: "passed (static analysis only)"
      evidence: "Same root cause as TIME-03. 'Select Segment' button on unmatched phrases opens the same dialog that requires availableSegments to be non-empty. Without the PipelinePreviewResponse fix, unmatched phrases show the amber highlight but the assignment dialog has no segments to choose from."
  integration:
    - from: "assembly_service.preview_matches()"
      to: "PipelinePreviewResponse → frontend"
      issue: "available_segments field produced by service but not declared in Pydantic response model — FastAPI silently drops it"
      affected_requirements: ["TIME-03", "TIME-04"]
      fix: "Add available_segments: List[dict] = [] to PipelinePreviewResponse and include it in the return statement at line 853"
  flows:
    - name: "Full E2E: Select Sources → Preview → Edit Timeline → Render → Watch"
      breaks_at: "Step 3 timeline swap/assign — available_segments not received by frontend"
      affected_requirements: ["TIME-03", "TIME-04"]
tech_debt:
  - phase: 39-source-selection-frontend
    items:
      - "Source video thumbnail URL uses non-standard /thumbnails/{filename} path (page.tsx:1707) instead of /api/v1/segments/files/ — thumbnails may not render in source picker"
      - "Migration 021 (source_video_ids column) requires manual Supabase application — selection degrades to in-memory until applied"
  - phase: 38-bug-fixes-source-selection-backend
    items:
      - "Library save in do_render wrapped in try/except — if Supabase unavailable, clips not saved but render succeeds silently"
  - phase: all
    items:
      - "Pre-existing: tests/debug-all-logs.spec.ts:38 unused @ts-expect-error directive (TS2578 warning)"
---

# v8 Pipeline UX Overhaul — Milestone Audit

**Audited:** 2026-02-24
**Status:** gaps_found
**Score:** 11/13 requirements satisfied

## Phase Verification Summary

| Phase | Status | Score | Requirements |
|-------|--------|-------|-------------|
| 38: Bug Fixes + Source Selection Backend | PASSED | 6/6 | BUG-01, BUG-02, SRC-02 |
| 39: Source Selection Frontend | PASSED | 5/5 | SRC-01, SRC-03, SRC-04 |
| 40: Video Preview Player | PASSED | 5/5 | PREV-01, PREV-02 |
| 41: Timeline Editor | PASSED | 9/9 | TIME-01, TIME-02, TIME-03, TIME-04, TIME-05 |

All 4 phases passed individual verification (static code analysis). The gap is a cross-phase integration issue not caught by per-phase verification.

## Requirements Coverage (3-Source Cross-Reference)

| REQ-ID | VERIFICATION.md | SUMMARY Provides | REQUIREMENTS.md | Integration | Final |
|--------|----------------|------------------|-----------------|-------------|-------|
| BUG-01 | Phase 38: SATISFIED | 38-01: Step 4 no flash | `[x]` | WIRED | **satisfied** |
| BUG-02 | Phase 38: SATISFIED | 38-01: clips persisted | `[x]` | WIRED | **satisfied** |
| SRC-01 | Phase 39: SATISFIED | 39-01: source picker | `[x]` | WIRED | **satisfied** |
| SRC-02 | Phase 38: SATISFIED | 38-02: filtered segments | `[x]` | WIRED | **satisfied** |
| SRC-03 | Phase 39: SATISFIED | 39-01: segment counts | `[x]` | WIRED | **satisfied** |
| SRC-04 | Phase 39: SATISFIED | 39-01: DB persistence | `[x]` | WIRED | **satisfied** |
| PREV-01 | Phase 40: SATISFIED | 40-01: inline player | `[x]` | WIRED | **satisfied** |
| PREV-02 | Phase 40: SATISFIED | 40-01: thumbnail gen | `[x]` | WIRED | **satisfied** |
| TIME-01 | Phase 41: SATISFIED | 41-01: TimelineEditor | `[x]` | WIRED | **satisfied** |
| TIME-02 | Phase 41: SATISFIED | 41-02: drag-drop | `[x]` | WIRED | **satisfied** |
| TIME-03 | Phase 41: SATISFIED | 41-02: segment swap | `[x]` | **BROKEN** | **unsatisfied** |
| TIME-04 | Phase 41: SATISFIED | 41-01: assignment | `[x]` | **BROKEN** | **unsatisfied** |
| TIME-05 | Phase 41: SATISFIED | 41-03: duration adj | `[x]` | WIRED | **satisfied** |

## Critical Gap: available_segments Not Reaching Frontend

**Root cause:** `PipelinePreviewResponse` Pydantic model (pipeline_routes.py:192-199) does not declare `available_segments`. The service layer produces it, the route handler constructs a typed response that excludes it, and FastAPI drops it silently.

**Impact:** The `TimelineEditor` component's swap dialog and manual assignment dialog both depend on `availableSegments` being non-empty. With the current code, both features are non-functional at runtime despite all component-level code being correctly implemented.

**Fix (2 lines):**
1. Add `available_segments: List[dict] = []` to `PipelinePreviewResponse`
2. Add `available_segments=preview_data.get("available_segments", [])` to the return statement at line 853

## E2E Flow Verification

| Flow | Status |
|------|--------|
| Source selection → preview/render filtering | COMPLETE |
| Source selection → timeline available segments | **BROKEN** (available_segments dropped) |
| Timeline edits → render with overrides | COMPLETE |
| Render completion → library save + thumbnail | COMPLETE |
| Full E2E pipeline | **PARTIAL** (breaks at timeline swap/assign) |

## Tech Debt

### Phase 39: Source Selection Frontend
- Source video thumbnail URL uses `/thumbnails/{filename}` (non-standard) instead of `/api/v1/segments/files/` — thumbnails may show placeholder icons
- Migration 021 requires manual Supabase application

### Phase 38: Bug Fixes
- Library save wrapped in try/except — silent degradation if Supabase unavailable

### All Phases
- Pre-existing: `tests/debug-all-logs.spec.ts:38` unused `@ts-expect-error` directive

---

*Audited: 2026-02-24T13:00:00Z*
*Auditor: Claude (gsd-audit-milestone)*
