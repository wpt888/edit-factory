---
milestone: v6
audited: 2026-02-22T05:00:00Z
status: gaps_found
scores:
  requirements: 24/25
  phases: 6/6
  integration: 18/21 exports wired
  flows: 4/5 E2E flows complete
gaps:
  requirements:
    - id: "FE-02"
      status: "unsatisfied"
      phase: "Phase 26"
      claimed_by_plans: ["26-01-PLAN.md"]
      completed_by_plans: ["26-01-SUMMARY.md"]
      verification_status: "passed (artifact exists but not adopted)"
      evidence: "handleApiError() defined in api-error.ts, re-exported via api.ts L7, but zero call sites in any page or component. All 33+ catch blocks in pages use console.error(). alert() calls remain in library/page.tsx L596, L631. The utility was built but never wired into consumers — the old inconsistent patterns were not replaced."
  integration:
    - from: "Phase 26 api-error.ts"
      to: "All page catch blocks"
      issue: "handleApiError() has zero consumers. Pages continue using console.error() (72 instances across app pages) and alert() (2 instances in library/page.tsx)"
    - from: "Phase 26 error-boundary.tsx"
      to: "Page sections"
      issue: "ErrorBoundary component created but never imported by any page or layout. Section-level error isolation is non-functional (global-error.tsx root boundary works)"
    - from: "Phase 26 apiGetWithRetry"
      to: "Page data fetching"
      issue: "apiGetWithRetry() defined at api.ts L91 but never called. Pages using apiGet do not get retry behavior on transient failures"
  flows:
    - flow: "Error → boundary catches → handleApiError shows toast"
      breaks_at: "handleApiError never called by any catch block"
      affected_requirements: ["FE-02"]
tech_debt:
  - phase: 26-frontend-resilience
    items:
      - "ErrorBoundary component unused — no section-level error isolation (FE-01 partial)"
      - "apiGetWithRetry() unused — pages don't get automatic retry (FE-03 partial)"
      - "72 console.error() calls + 2 alert() calls remain across pages — not migrated to handleApiError"
  - phase: 25-rate-limiting-and-security
    items:
      - "routes.py L1288 raises ValueError (not HTTPException) for TTS length in background task — surfaces as 500 instead of 400 (SEC-04 edge case)"
      - "3 of 4 TTS endpoint files use raw inline MAX_TTS_CHARS check instead of validate_tts_text_length() helper"
  - phase: 28-code-quality
    items:
      - "cost_tracker.py, job_storage.py, tts_library_service.py still have local create_client calls (out of scope for Phase 28)"
  - phase: 29-testing-and-observability
    items:
      - "No unit tests for Phase 24 additions: is_project_locked, update_generation_progress, validate_upload_size"
      - "No unit tests for Phase 25 additions: tenacity @retry behavior, validate_tts_text_length"
  - phase: 27-frontend-refactoring
    items:
      - "library/page.tsx is 1100 lines total (290 JSX) — handlers and state kept in orchestrator"
      - "4 human verification items pending: layout rendering, ClipStatusPoller, segment modal, Postiz modal"
---

# v6 Production Hardening — Milestone Audit

**Milestone Goal:** Harden Edit Factory for production stability — fix memory leaks, add error handling, improve security, add tests, and clean up technical debt.

**Audited:** 2026-02-22
**Status:** GAPS FOUND
**Score:** 24/25 requirements satisfied

## Phase Verification Summary

| Phase | Goal | Status | Score |
|-------|------|--------|-------|
| 24 Backend Stability | Backend handles errors, cleans up, validates input | passed | 7/7 |
| 25 Rate Limiting & Security | Enforce request limits, sanitize content, secure HTTP | passed | 5/5 |
| 26 Frontend Resilience | Handle errors gracefully, communicate clearly | passed | 5/5 |
| 27 Frontend Refactoring | Decompose library page, eliminate polling duplication | human_needed | 4/5 |
| 28 Code Quality | Single Supabase client, no debug noise | passed | 3/3 |
| 29 Testing & Observability | Test harness, structured logs, data retention | passed | 6/6 |

All 6 phases have VERIFICATION.md files. No unverified phases.

## Requirements Coverage (3-Source Cross-Reference)

**Sources:**
1. Phase VERIFICATION.md requirements tables (all 6 present)
2. SUMMARY.md frontmatter `provides` fields (no `requirements-completed` field — using `provides` as proxy)
3. REQUIREMENTS.md traceability table (all 25 mapped, all marked `[x]`)

| REQ-ID | Description | VERIFICATION | SUMMARY provides | REQUIREMENTS.md | Integration | Final |
|--------|-------------|-------------|-----------------|-----------------|-------------|-------|
| STAB-01 | Persist progress to DB | SATISFIED | listed (24-01) | [x] Complete | WIRED | **satisfied** |
| STAB-02 | Lock cleanup after completion | SATISFIED | listed (24-01) | [x] Complete | WIRED | **satisfied** |
| STAB-03 | Lock timeout → 409 | SATISFIED | listed (24-01) | [x] Complete | WIRED | **satisfied** |
| STAB-04 | Invalid JSON → 400 | SATISFIED | listed (24-02) | [x] Complete | WIRED | **satisfied** |
| STAB-05 | Upload size → 413 | SATISFIED | listed (24-02) | [x] Complete | WIRED | **satisfied** |
| STAB-06 | Retry with backoff | SATISFIED | listed (25-02) | [x] Complete | WIRED | **satisfied** |
| SEC-01 | Rate limiting middleware | SATISFIED | listed (25-01) | [x] Complete | WIRED | **satisfied** |
| SEC-02 | SRT XSS prevention | SATISFIED | listed (25-02) | [x] Complete | WIRED | **satisfied** |
| SEC-03 | Cache-Control headers | SATISFIED | listed (25-02) | [x] Complete | WIRED | **satisfied** |
| SEC-04 | TTS text length validation | SATISFIED | listed (25-01) | [x] Complete | PARTIAL | **satisfied** |
| FE-01 | Global error boundary | SATISFIED | listed (26-01) | [x] Complete | PARTIAL | **satisfied** |
| FE-02 | Consistent error handling utility **replaces** mix | SATISFIED | listed (26-01) | [x] Complete | UNWIRED | **unsatisfied** |
| FE-03 | API client timeout + retry | SATISFIED | listed (26-01) | [x] Complete | PARTIAL | **satisfied** |
| FE-04 | All pages show empty states | SATISFIED | listed (26-02) | [x] Complete | WIRED | **satisfied** |
| FE-05 | Shared polling hook | SATISFIED | listed (26-02) | [x] Complete | WIRED | **satisfied** |
| REF-01 | Split library page | SATISFIED | listed (27-01) | [x] Complete | WIRED | **satisfied** |
| REF-02 | Eliminate polling duplication | SATISFIED | listed (27-01) | [x] Complete | WIRED | **satisfied** |
| QUAL-01 | Single get_supabase() | SATISFIED | listed (28-01) | [x] Complete | WIRED | **satisfied** |
| QUAL-02 | Async ElevenLabs client | SATISFIED | listed (24-02) | [x] Complete | WIRED | **satisfied** |
| QUAL-03 | Remove debug logs | SATISFIED | listed (28-01) | [x] Complete | WIRED | **satisfied** |
| QUAL-04 | Integrate cleanup_project_lock | SATISFIED | listed (24-01) | [x] Complete | WIRED | **satisfied** |
| TEST-01 | pytest setup | SATISFIED | listed (29-01) | [x] Complete | WIRED | **satisfied** |
| TEST-02 | Unit tests for critical services | SATISFIED | listed (29-01) | [x] Complete | PARTIAL | **satisfied** |
| TEST-03 | Structured JSON logging | SATISFIED | listed (29-02) | [x] Complete | WIRED | **satisfied** |
| TEST-04 | Data retention cleanup | SATISFIED | listed (29-02) | [x] Complete | WIRED | **satisfied** |

**Orphaned requirements:** None. All 25 REQ-IDs in REQUIREMENTS.md traceability table appear in at least one phase VERIFICATION.md.

## Unsatisfied Requirements Detail

### FE-02: Consistent error handling utility replaces toast/alert/silence mix

**Requirement:** "Consistent error handling utility replaces toast/alert/silence mix"
**Phase:** 26 (Frontend Resilience)
**What was built:** `handleApiError()` in `api-error.ts` routes all ApiError variants through `toast.error()`. Re-exported via `api.ts`.
**What's missing:** Zero call sites. No page or component imports or calls `handleApiError()`. Evidence:
- 72 `console.error()` calls across app pages
- 2 `alert()` calls in `library/page.tsx` (lines 596, 631)
- 33+ catch blocks use `console.error()` instead of `handleApiError()`

**Why unsatisfied:** The requirement says "replaces" — the old inconsistent patterns (console.error, alert) must be gone, substituted by the new utility. The utility infrastructure was built correctly but adoption was not completed. The old patterns remain.

## Cross-Phase Integration

### Connected Exports (18 verified)

All critical cross-phase wiring is functional:
- Phase 24 `validators.py` → used by Phase 25 (`MAX_TTS_CHARS`, `validate_tts_text_length`)
- Phase 26 `usePolling` → used by Phase 27 (`ClipStatusPoller` in `clip-gallery.tsx`)
- Phase 28 `app/db.py` → 18 backend files import `get_supabase()`
- Phase 24 async ElevenLabs + Phase 25 tenacity retry → both modify `elevenlabs_tts.py` correctly
- Phase 29 tests → test services modified by Phases 24-25 (job_storage, cost_tracker, srt_validator)

### Orphaned Exports (3)

1. **`apiGetWithRetry()`** — Phase 26 `api.ts` L91 — defined but never called
2. **`ErrorBoundary`** — Phase 26 `error-boundary.tsx` — created but never imported by any page
3. **`handleApiError()`** — Phase 26 `api-error.ts` — defined, re-exported, zero consumers

### Broken E2E Flows (1)

**Error → boundary → toast:** Global error boundary works (global-error.tsx). But catch blocks → handleApiError → toast chain is broken because handleApiError is never called. Pages still use console.error() and alert().

### Complete E2E Flows (4)

1. **Upload → validate → rate limit → generate → progress → poll:** All steps wired
2. **TTS text → validate length → retry → async client:** Complete (minor: routes.py ValueError edge case)
3. **SRT content → sanitize → render → no XSS:** All steps wired, tested
4. **pytest → test services → structured logs:** All steps wired

## Tech Debt Inventory

### Phase 26 — Frontend Resilience (3 items)
- `ErrorBoundary` component unused (section-level isolation absent)
- `apiGetWithRetry()` unused (no automatic retry on page data fetches)
- 72 console.error() + 2 alert() calls not migrated to handleApiError

### Phase 25 — Rate Limiting & Security (2 items)
- `routes.py` L1288: ValueError in background task for TTS length → 500 not 400
- 3/4 TTS files use raw inline check instead of `validate_tts_text_length()` helper

### Phase 28 — Code Quality (1 item)
- `cost_tracker.py`, `job_storage.py`, `tts_library_service.py` still have local `create_client` calls (out of scope)

### Phase 29 — Testing & Observability (1 item)
- No unit tests for Phase 24/25 core additions (lock lifecycle, progress persistence, upload validation, retry behavior)

### Phase 27 — Frontend Refactoring (2 items)
- `library/page.tsx` at 1100 lines (290 JSX) — handlers/state retained as orchestrator
- 4 human verification items pending

**Total: 9 tech debt items across 5 phases**

## Human Verification Pending

Items flagged by phase verifiers requiring live browser/server testing:

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

_Audited: 2026-02-22_
_Auditor: Claude (gsd audit-milestone)_
