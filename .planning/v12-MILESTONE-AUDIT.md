---
milestone: v12
audited: 2026-03-09T11:00:00Z
status: gaps_found
scores:
  requirements: 26/28
  phases: 12/12
  integration: 18/21
  flows: 4/6
gaps:
  requirements:
    - id: "UX-07"
      status: "partial"
      phase: "72"
      claimed_by_plans: ["72-01-PLAN.md", "74-01-PLAN.md"]
      completed_by_plans: ["72-01-SUMMARY.md", "74-01-SUMMARY.md"]
      verification_status: "gaps_found"
      evidence: "Frontend Romanian removed. Backend still returns Romanian in progress API at library_routes.py:629 (Proiect negăsit), :633 (Se inițializează...), :637 (Eșuat). These are user-visible API responses."
    - id: "UX-05"
      status: "satisfied"
      phase: "75"
      claimed_by_plans: ["75-01-PLAN.md"]
      completed_by_plans: ["75-01-SUMMARY.md"]
      verification_status: "passed"
      evidence: "BatchUploadQueue calls /generate (not /generate-raw). Verified by grep: 0 matches for generate-raw in frontend/src/."
  integration:
    - id: "INT-04"
      summary: "Service singletons not refreshed after API key save"
      from_phase: 69
      to_phase: 69
      affected_requirements: ["API-01", "API-02"]
      severity: "HIGH"
      detail: "desktop_routes.py save_desktop_settings() stores keys in vault but does not call _reset_elevenlabs_tts() or refresh_gemini_availability(). Keys require backend restart to take effect."
    - id: "INT-05"
      summary: "Romanian strings in backend progress API"
      from_phase: 72
      affected_requirements: ["UX-07"]
      severity: "MEDIUM"
      detail: "library_routes.py lines 629, 633, 637 return Romanian strings in progress API responses visible to frontend users."
  flows:
    - id: "FLOW-03"
      name: "API Key Setup -> Immediate Use"
      breaks_at: "Singleton refresh after key save"
      affected_requirements: ["API-01", "API-02"]
      detail: "After saving keys in setup wizard, ElevenLabs/Gemini singletons retain old (empty) keys until backend restart."
tech_debt:
  - phase: 64-data-abstraction-layer
    items:
      - "26+ library routes still use get_client() escape hatch instead of typed repository methods"
      - "SQLiteRepository.get_client() returns None by design — routes using it return 503 in SQLite mode"
  - phase: 65-sqlite-local-database
    items:
      - "DATA_BACKEND not auto-activated in desktop mode — Electron sets DESKTOP_MODE=true but not DATA_BACKEND=sqlite"
      - "Full offline mode requires remaining routes to be migrated from get_client() to typed methods"
  - phase: 70-ux-simplification-pipeline-batch
    items:
      - "GET /pipeline/presets endpoint is orphaned — frontend uses local TypeScript constant instead"
  - phase: various
    items:
      - "Romanian comments throughout backend Python files (non-user-facing, low priority)"
nyquist:
  overall: "skipped"
  reason: "nyquist_validation not configured"
---

# v12 Desktop Product MVP — Milestone Audit Report

**Audited:** 2026-03-09T11:00:00Z
**Status:** gaps_found
**Score:** 26/28 requirements satisfied
**Re-audit:** 3rd audit round (after Phase 74 and Phase 75 gap closures)

## Requirements Coverage (3-Source Cross-Reference)

| Requirement | Phase | VERIFICATION | SUMMARY | Traceability | Final Status |
|-------------|-------|-------------|---------|-------------|--------------|
| DATA-01 | 65 | passed | - | Complete | satisfied |
| DATA-02 | 64 | passed | - | Complete | satisfied |
| DATA-03 | 66 | passed | - | Complete | satisfied |
| DATA-04 | 66 | passed | - | Complete | satisfied |
| DATA-05 | 65 | passed | - | Complete | satisfied |
| DATA-06 | 64 | passed | - | Complete | satisfied |
| AUTH-01 | 67 | passed | - | Complete | satisfied |
| AUTH-02 | 67 | passed | - | Complete | satisfied |
| AUTH-03 | 68 | passed | - | Complete | satisfied |
| AUTH-04 | 67 | passed | - | Complete | satisfied |
| AUTH-05 | 67 | passed | - | Complete | satisfied |
| UX-01 | 70 | passed | - | Complete | satisfied |
| UX-02 | 70 | passed | - | Complete | satisfied |
| UX-03 | 71 | passed | - | Complete | satisfied |
| UX-04 | 71 | passed | - | Complete | satisfied |
| UX-05 | 75 | - | completed | Pending | **satisfied** (update checkbox) |
| UX-06 | 72 | passed | - | Complete | satisfied |
| UX-07 | 72 | passed* | - | Complete | **partial** |
| ELEC-01 | 73 | passed | - | Complete | satisfied |
| ELEC-02 | 73 | passed | - | Complete | satisfied |
| ELEC-03 | 73 | passed | - | Complete | satisfied |
| ELEC-04 | 73 | passed | - | Complete | satisfied |
| ELEC-05 | 73 | passed | - | Complete | satisfied |
| ELEC-06 | 73 | passed | - | Complete | satisfied |
| API-01 | 69 | passed | - | Complete | satisfied |
| API-02 | 69 | passed | - | Complete | satisfied |
| API-03 | 69 | passed | - | Complete | satisfied |
| API-04 | 69 | passed | - | Complete | satisfied |

*UX-07: Phase 72 verification checked frontend only. Backend still returns Romanian text in progress API responses.

**Unsatisfied: UX-07** — Backend progress API at library_routes.py returns Romanian strings ("Proiect negăsit", "Se inițializează...", "Eșuat") that are visible to users.

## Phase Completion

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 64 | Data Abstraction Layer | 3/3 | passed |
| 65 | SQLite Local Database | 1/1 | passed |
| 66 | Local File Storage & Offline | 3/3 | passed |
| 67 | Auth Flow Fixes | 3/3 | passed |
| 68 | License Key Validation Polish | 1/1 | passed |
| 69 | Direct API Integration | 3/3 | passed |
| 70 | UX — Pipeline & Batch | 3/3 | passed |
| 71 | UX — Onboarding & Presets | 2/2 | passed |
| 72 | Brand & Language Cleanup | 1/1 | passed |
| 73 | Electron Polish | 3/3 | passed |
| 74 | v12 Gap Closure | 1/1 | passed |
| 75 | Batch Endpoint Fix | 1/1 | passed (no VERIFICATION.md) |

## Cross-Phase Integration

### Connected Exports: 18/21

All core wiring verified:
- Repository pattern → all routes and services
- JWT injection → all frontend API calls
- LicenseGuard → layout wrapping
- KeyVault → ElevenLabs/Gemini services
- SimplePipeline/BatchUploadQueue → pipeline page
- Caption presets → subtitle editor
- Download endpoint → SimplePipeline

### Integration Gaps

1. **INT-04 (HIGH):** Service singletons not refreshed after API key save via setup wizard. `_reset_elevenlabs_tts()` and `refresh_gemini_availability()` exist but aren't called from `save_desktop_settings()`. Keys require restart. (API-01, API-02)

2. **INT-05 (MEDIUM):** Romanian strings in backend progress API responses at library_routes.py:629,633,637. (UX-07)

### Orphaned Exports

1. `GET /pipeline/presets` endpoint — frontend uses local TypeScript constant instead (LOW)

## E2E Flow Verification

| Flow | Status |
|------|--------|
| Auth: Login → JWT → API → Protection | COMPLETE |
| License: Setup → Validate → Recheck → Grace | COMPLETE |
| Simple Pipeline: Upload → Style → Generate → Download | COMPLETE |
| Batch Queue: Drag → Queue → Process → Results | COMPLETE |
| API Key Setup → Immediate Use | BROKEN (singleton refresh) |
| Offline Desktop Operation | BROKEN (DATA_BACKEND not auto-activated + get_client gaps) |

## Tech Debt Summary

| Phase | Item | Priority |
|-------|------|----------|
| 64 | 26+ routes use get_client() escape hatch | Medium |
| 65 | DATA_BACKEND not auto-activated in Electron | Medium |
| 70 | Orphaned /pipeline/presets endpoint | Low |
| Various | Romanian comments in backend Python files | Low |

**Total: 4 tech debt items across 3 phases**

## Actionable Gaps (Require Closure)

1. **UX-07:** Replace Romanian strings at library_routes.py:629,633,637 with English equivalents
2. **INT-04:** Call `_reset_elevenlabs_tts()` and `refresh_gemini_availability()` after saving keys in `save_desktop_settings()`

---
*Generated by GSD milestone audit workflow*
