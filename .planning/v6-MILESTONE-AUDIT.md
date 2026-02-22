---
milestone: v6
audited: 2026-02-22T10:00:00Z
status: tech_debt
scores:
  requirements: 25/25
  phases: 7/7
  integration: 26/28
  flows: 6/7
gaps:
  requirements: []
  integration:
    - id: "INT-01"
      description: "usePolling hook bypasses apiFetch — polling calls lack 30s timeout"
      from: "Phase 26 (api.ts timeout/ApiError)"
      to: "Phase 26 (use-polling.ts)"
      affected_requirements: ["FE-03", "FE-05"]
      severity: "moderate"
      evidence: "use-polling.ts line 85 uses raw fetch() instead of apiFetch(); no AbortSignal.timeout"
    - id: "INT-02"
      description: "usePolling duplicates API_URL constant instead of importing from api.ts"
      from: "Phase 26 (api.ts API_URL)"
      to: "Phase 26 (use-polling.ts)"
      affected_requirements: ["FE-03"]
      severity: "low"
      evidence: "use-polling.ts line 33 defines local API_URL identical to api.ts — drift risk"
  flows:
    - id: "FLOW-01"
      description: "pytest requires venv_linux activation — system Python lacks pydantic_settings"
      step: "Test execution"
      affected_requirements: ["TEST-01", "TEST-02"]
      severity: "low"
      evidence: "python -m pytest fails under system Python; passes under venv_linux (43/43)"
tech_debt:
  - phase: 28-code-quality
    items:
      - "cost_tracker.py, job_storage.py, tts_library_service.py still have local create_client calls (out of Phase 28 scope)"
  - phase: 27-frontend-refactoring
    items:
      - "library/page.tsx is 1100 lines total (290 lines JSX) — state/handler logic retained as orchestrator"
      - "4 human verification items pending (visual layout, ClipStatusPoller, segment modal, postiz modal)"
  - phase: 26-frontend-resilience
    items:
      - "usePolling uses raw fetch() instead of apiFetch — lacks timeout protection on polling calls"
      - "usePolling duplicates API_URL constant locally"
  - phase: 29-testing-and-observability
    items:
      - "pyproject.toml does not document required Python interpreter (venv_linux)"
      - "python-json-logger installed in .venv-wsl but needs pip install -r requirements.txt for other venvs"
  - phase: 25-rate-limiting-and-security
    items:
      - "tts_library_routes.py uses raw MAX_TTS_CHARS length check inline rather than validate_tts_text_length() helper"
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

**Note:** SUMMARY frontmatter `requirements_completed` field not used in v6 summaries — 2-source cross-reference (VERIFICATION + REQUIREMENTS.md) used. Both sources agree on all 25 requirements.

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

## Cross-Phase Integration (26/28 wired)

### 7 Key Integration Chains — All Confirmed

| # | Chain | Status |
|---|-------|--------|
| 1 | Phase 24 `validators.py` → Phase 25 `MAX_TTS_CHARS` extension | WIRED |
| 2 | Phase 24 async TTS → Phase 25 tenacity retry wrapping | WIRED |
| 3 | Phase 26 `handleApiError` → Phase 27 components → Phase 30 full adoption | WIRED |
| 4 | Phase 26 `usePolling` → Phase 27 `ClipStatusPoller` | WIRED |
| 5 | Phase 28 `get_supabase()` → Phase 24 DB progress | WIRED |
| 6 | Phase 29 structured logging → Phase 24/25 backend | WIRED |
| 7 | Phase 30 `apiGetWithRetry` → Phase 26 definition | WIRED |

### Integration Issues (2 non-critical)

**INT-01 (moderate): usePolling bypasses apiFetch timeout**
- `use-polling.ts` line 85 uses raw `fetch()` instead of `apiFetch()`
- Polling calls (generation progress, clip status, pipeline, TTS) have no 30s timeout
- Fix: Replace `fetch()` with `apiFetch()`, catch `ApiError` instead of generic `Error`

**INT-02 (low): usePolling duplicates API_URL constant**
- `use-polling.ts` line 33 defines local `API_URL` identical to `api.ts`
- Fix: Import `{ API_URL }` from `@/lib/api`

## E2E Flow Verification (6/7)

| Flow | Status |
|------|--------|
| Upload → Validate (413) → Rate Limit → Generate → Progress Poll → Complete | OK |
| TTS → Length Validate → Retry on Fail → Audio Output | OK |
| Error → handleApiError → Sonner Toast (18 files) | OK |
| Empty Page → EmptyState Component (11 pages) | OK |
| Library → Component Tree → ClipStatusPoller via usePolling | OK |
| Structured Log → JSON Output via python-json-logger | OK |
| System Python → pytest → Tests Pass | PARTIAL (requires venv) |

## Tech Debt Summary (8 items across 5 phases)

### Phase 28 — Code Quality
- `cost_tracker.py`, `job_storage.py`, `tts_library_service.py` retain local `create_client` calls (out of scope)

### Phase 27 — Frontend Refactoring
- `library/page.tsx` is 1100 lines total (290 lines JSX) — state/handlers retained as orchestrator
- 4 human verification items pending for live runtime testing

### Phase 26 — Frontend Resilience
- `usePolling` uses raw `fetch()` instead of `apiFetch` — no timeout on polling calls
- `usePolling` duplicates `API_URL` constant locally

### Phase 29 — Testing & Observability
- `pyproject.toml` does not document required Python interpreter (`venv_linux`)
- `python-json-logger` needs `pip install -r requirements.txt` for non-WSL venvs

### Phase 25 — Rate Limiting & Security
- `tts_library_routes.py` uses inline `MAX_TTS_CHARS` check rather than `validate_tts_text_length()` helper

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

_Audited: 2026-02-22_
_Previous audit: 2026-02-22T05:00 (gaps_found → Phase 30 created → gaps closed)_
_Auditor: Claude (gsd audit-milestone)_
