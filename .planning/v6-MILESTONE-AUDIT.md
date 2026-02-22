---
milestone: v6
audited: 2026-02-22T10:30:00Z
status: tech_debt
scores:
  requirements: 25/25
  phases: 7/7
  integration: 31/34
  flows: 7/8
gaps:
  requirements: []
  integration:
    - id: "MISSING-01"
      description: "usage/page.tsx data-fetch GETs use apiGet instead of apiGetWithRetry"
      affected_requirements: ["FE-02"]
      severity: "low"
      evidence: "Lines 105, 120-121, 142 use apiGet; handleApiError present in catch blocks, only retry missing"
    - id: "MISSING-02"
      description: "pytest not in requirements.txt"
      affected_requirements: ["TEST-01"]
      severity: "medium"
      evidence: "Fresh pip install -r requirements.txt cannot run pytest; works in development venv only"
    - id: "MISSING-03"
      description: "library/page.tsx data-fetch calls use apiFetch instead of apiGetWithRetry"
      affected_requirements: ["FE-02"]
      severity: "low"
      evidence: "Lines 352, 388, 400, 415, 427, 446 use apiFetch directly; has timeout and ApiError, missing only retry"
  flows:
    - id: "BROKEN-01"
      description: "pytest test suite fails in fresh environment"
      severity: "medium"
      evidence: "pytest not in requirements.txt; 18 tests fail under system Python without pydantic_settings"
tech_debt:
  - phase: 25-rate-limiting-and-security
    items:
      - "validate_tts_text_length() helper used only in tts_routes.py; other routes use MAX_TTS_CHARS inline (functional but inconsistent)"
  - phase: 26-frontend-resilience
    items:
      - "usePolling hook uses raw fetch() not apiFetch — onError receives plain Error not ApiError, losing status-specific toast messages"
      - "usePolling duplicates API_URL constant locally instead of importing from api.ts"
  - phase: 27-frontend-refactoring
    items:
      - "library/page.tsx is 1100 lines total (290 lines JSX) — state/handler logic retained as orchestrator"
      - "4 human verification items pending (visual layout, ClipStatusPoller, segment modal, postiz modal)"
  - phase: 28-code-quality
    items:
      - "cost_tracker.py, job_storage.py, tts_library_service.py still have local create_client calls (out of Phase 28 scope)"
  - phase: 29-testing-and-observability
    items:
      - "pytest not declared in requirements.txt — works in dev venv but not reproducible for fresh installs"
  - phase: 30-frontend-error-handling-adoption
    items:
      - "usage/page.tsx has 3 data-fetch apiGet calls not migrated to apiGetWithRetry"
      - "library/page.tsx data-fetch calls use apiFetch directly (has timeout/error handling, missing retry)"
---

# v6 Production Hardening — Milestone Audit Report

**Milestone Goal:** Harden Edit Factory for production stability — fix memory leaks, add error handling, improve security, add tests, and clean up technical debt.

**Audited:** 2026-02-22
**Status:** TECH DEBT (all requirements satisfied, no critical blockers, accumulated debt items)
**Previous Audit:** 2026-02-22T05:00 — gaps_found (FE-02 unsatisfied) — closed by Phase 30

## Requirements Coverage (25/25)

All 25 v6 requirements are satisfied across 7 phases.

### 3-Source Cross-Reference

| REQ-ID | Description | VERIFICATION.md | REQUIREMENTS.md | Final Status |
|--------|-------------|-----------------|-----------------|--------------|
| STAB-01 | Persist progress to DB | SATISFIED (Ph.24) | `[x]` | **satisfied** |
| STAB-02 | Lock cleanup after completion | SATISFIED (Ph.24) | `[x]` | **satisfied** |
| STAB-03 | Lock timeout returns 409 | SATISFIED (Ph.24) | `[x]` | **satisfied** |
| STAB-04 | Invalid JSON returns 400 | SATISFIED (Ph.24) | `[x]` | **satisfied** |
| STAB-05 | Upload size validated (413) | SATISFIED (Ph.24) | `[x]` | **satisfied** |
| STAB-06 | Retry with exponential backoff | SATISFIED (Ph.25) | `[x]` | **satisfied** |
| SEC-01 | Rate limiting middleware | SATISFIED (Ph.25) | `[x]` | **satisfied** |
| SEC-02 | SRT XSS prevention | SATISFIED (Ph.25) | `[x]` | **satisfied** |
| SEC-03 | Cache-Control headers | SATISFIED (Ph.25) | `[x]` | **satisfied** |
| SEC-04 | TTS text length validated | SATISFIED (Ph.25) | `[x]` | **satisfied** |
| FE-01 | Global error boundary | SATISFIED (Ph.26) | `[x]` | **satisfied** |
| FE-02 | Consistent error handling replaces mix | SATISFIED (Ph.30) | `[x]` | **satisfied** |
| FE-03 | API client timeout + retry | SATISFIED (Ph.26) | `[x]` | **satisfied** |
| FE-04 | All pages show empty states | SATISFIED (Ph.26) | `[x]` | **satisfied** |
| FE-05 | Shared polling hook | SATISFIED (Ph.26) | `[x]` | **satisfied** |
| REF-01 | Split library page | SATISFIED (Ph.27) | `[x]` | **satisfied** |
| REF-02 | Eliminate polling duplication | SATISFIED (Ph.27) | `[x]` | **satisfied** |
| QUAL-01 | Single get_supabase() | SATISFIED (Ph.28) | `[x]` | **satisfied** |
| QUAL-02 | Async ElevenLabs client | SATISFIED (Ph.24) | `[x]` | **satisfied** |
| QUAL-03 | Remove debug logs | SATISFIED (Ph.28) | `[x]` | **satisfied** |
| QUAL-04 | Integrate cleanup_project_lock | SATISFIED (Ph.24) | `[x]` | **satisfied** |
| TEST-01 | pytest setup | SATISFIED (Ph.29) | `[x]` | **satisfied** |
| TEST-02 | Unit tests for critical services | SATISFIED (Ph.29) | `[x]` | **satisfied** |
| TEST-03 | Structured JSON logging | SATISFIED (Ph.29) | `[x]` | **satisfied** |
| TEST-04 | Data retention cleanup | SATISFIED (Ph.29) | `[x]` | **satisfied** |

**Note:** SUMMARY frontmatter uses `provides`/`affects` fields instead of `requirements_completed` — 2-source cross-reference (VERIFICATION + REQUIREMENTS.md) used. Both sources agree on all 25 requirements.

**Orphaned Requirements:** None. All 25 REQ-IDs in traceability table appear in at least one phase VERIFICATION.md.

## Phase Verification Summary (7/7)

| Phase | Status | Score | Critical Gaps | Human Items |
|-------|--------|-------|---------------|-------------|
| 24 — Backend Stability | passed | 7/7 | 0 | 2 |
| 25 — Rate Limiting & Security | passed | 7/7 | 0 | 2 |
| 26 — Frontend Resilience | passed | 5/5 | 0 | 3 |
| 27 — Frontend Refactoring | human_needed | 4/5 | 0 | 4 |
| 28 — Code Quality | passed | 3/3 | 0 | 0 |
| 29 — Testing & Observability | passed | 6/6 | 0 | 0 |
| 30 — Error Handling Adoption | passed | 5/5 | 0 | 0 |

All 7 phases have VERIFICATION.md files. No unverified phases. Phase 27's single "NEEDS HUMAN" item is runtime behavior (live browser test), not a code gap.

## Cross-Phase Integration (31/34 exports wired)

### Key Integration Chains — All Confirmed

| # | Chain | Status |
|---|-------|--------|
| 1 | Phase 24 `validators.py` → Phase 25 `MAX_TTS_CHARS` extension and shared usage | WIRED |
| 2 | Phase 24 async TTS → Phase 25 tenacity retry wrapping on `_call_elevenlabs_api` | WIRED |
| 3 | Phase 26 `handleApiError` → Phase 27 components → Phase 30 full adoption (22 files) | WIRED |
| 4 | Phase 26 `usePolling` → Phase 27 `ClipStatusPoller` in clip-gallery.tsx | WIRED |
| 5 | Phase 26 `EmptyState` → 11 data pages + project-sidebar.tsx | WIRED |
| 6 | Phase 26 `ErrorBoundary` → Phase 27 library/page.tsx (3 section wraps) | WIRED |
| 7 | Phase 28 `get_supabase()` from db.py → 18 backend files | WIRED |
| 8 | Phase 29 structured logging → root logger → all backend services inherit | WIRED |
| 9 | Phase 29 tests → cover srt_validator (Phase 25), job_storage (Phase 24) | WIRED |
| 10 | Phase 30 `apiGetWithRetry` → Phase 26 definition consumed in 22 files | WIRED |
| 11 | Phase 25 rate limiting (60/min) safe with Phase 26/27 polling (20/min max) | SAFE |

### Missing Connections (3 non-critical)

1. **usage/page.tsx** — 3 `apiGet` calls at lines 105, 120-121, 142 not migrated to `apiGetWithRetry` (error handling works via `handleApiError`, only retry on transient failures missing)
2. **pytest not in requirements.txt** — fresh `pip install -r requirements.txt` followed by `pytest` fails; works in dev venv only
3. **library/page.tsx** — data-fetch calls use `apiFetch` directly (has timeout + ApiError, missing only retry behavior)

### Orphaned Exports: 0

All Phase 24-30 exports are consumed within the milestone.

## E2E Flow Verification (7/8)

| Flow | Status | Notes |
|------|--------|-------|
| Upload → validate_upload_size → 413 error | COMPLETE | |
| Lock contention → is_project_locked → 409 Conflict | COMPLETE | |
| Rate limit → slowapi → 429 response | COMPLETE | |
| SRT XSS → sanitize_srt_text → safe render | COMPLETE | |
| Error → handleApiError → sonner toast (22 files) | COMPLETE | |
| Empty DB → EmptyState component (11 pages) | COMPLETE | |
| Generation → usePolling → progress updates | COMPLETE | |
| Fresh install → pip install → pytest → all pass | PARTIAL | pytest not in requirements.txt |

## Tech Debt Summary (9 items across 6 phases)

### Phase 25 — Rate Limiting & Security
- `validate_tts_text_length()` helper used only in tts_routes.py; other routes use inline MAX_TTS_CHARS comparison

### Phase 26 — Frontend Resilience
- `usePolling` uses raw `fetch()` instead of `apiFetch` — onError receives plain Error, losing status-specific toast messages
- `usePolling` duplicates `API_URL` constant locally instead of importing from api.ts

### Phase 27 — Frontend Refactoring
- `library/page.tsx` is 1100 lines total (290 lines JSX) — state/handler logic retained as orchestrator
- 4 human verification items pending for live runtime testing

### Phase 28 — Code Quality
- `cost_tracker.py`, `job_storage.py`, `tts_library_service.py` retain local `create_client` calls (out of phase scope)

### Phase 29 — Testing & Observability
- pytest not declared in requirements.txt — works in dev venv but not reproducible for fresh installs

### Phase 30 — Frontend Error Handling Adoption
- `usage/page.tsx` has 3 data-fetch apiGet calls not migrated to `apiGetWithRetry`
- `library/page.tsx` data-fetch calls use `apiFetch` directly (has timeout/error handling, missing retry)

**Total: 9 items across 6 phases**

## Human Verification Pending (11 items)

| Phase | Test | Status |
|-------|------|--------|
| 24 | Progress DB fallback after server restart | Pending |
| 24 | Concurrent 409 lock response | Pending |
| 25 | Rate limit 429 response under load | Pending |
| 25 | SRT script injection prevention in rendered video | Pending |
| 26 | Error boundary visual appearance | Pending |
| 26 | Toast consistency across error types | Pending |
| 26 | Empty state display on all pages | Pending |
| 27 | Library 3-column layout rendering | Pending |
| 27 | ClipStatusPoller live polling | Pending |
| 27 | Segment selection modal state propagation | Pending |
| 27 | Postiz publish modal error handling | Pending |

---

_Audited: 2026-02-22T10:30:00Z_
_Previous audit: 2026-02-22T05:00 (gaps_found → Phase 30 gap closure → gaps closed)_
_Auditor: Claude (gsd audit-milestone workflow)_
