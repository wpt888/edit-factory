---
milestone: v12
audited: 2026-03-09T14:00:00Z
status: gaps_found
scores:
  requirements: 27/28
  phases: 11/11
  integration: 26/28
  flows: 4/5
gaps:
  requirements:
    - id: "UX-05"
      status: "unsatisfied"
      phase: "70"
      claimed_by_plans: ["70-03-PLAN.md"]
      completed_by_plans: ["70-03-SUMMARY.md"]
      verification_status: "passed"
      evidence: "BatchUploadQueue calls /library/projects/${projectId}/generate-raw but actual backend route is /projects/{project_id}/generate (library_routes.py:761). Every batch job fails with 404 at clip generation step."
  integration:
    - id: "INT-03"
      description: "BatchUploadQueue calls non-existent endpoint /generate-raw instead of /generate"
      file: "frontend/src/components/batch-upload-queue.tsx"
      line: 234
      affected_requirements: ["UX-05"]
      severity: "high"
      evidence: "grep confirms /generate-raw at line 234; backend route is POST /projects/{project_id}/generate at library_routes.py:761"
  flows:
    - id: "FLOW-02"
      description: "Batch upload flow breaks at clip generation — every queued video fails with 404 when BatchUploadQueue POSTs to /generate-raw"
      affected_requirements: ["UX-05"]
tech_debt:
  - phase: 64-data-abstraction-layer
    items:
      - "118 direct supabase references in library_routes.py bypass repository abstraction — SQLite backend cannot serve these routes"
      - "Download route (library_routes.py:470-473) uses repo.get_client() which returns None for SQLiteRepository — breaks SimplePipeline download under SQLite"
  - phase: 73-electron-polish
    items:
      - "Missing icon.icns file in electron/build/ — macOS build would fail or use default icon (ELEC-06 partial)"
      - "generate-icon.js only produces .ico format, not .icns for macOS"
nyquist:
  compliant_phases: 0
  partial_phases: 0
  missing_phases: 11
  overall: "MISSING — no VALIDATION.md files exist for any v12 phase"
  phases:
    - { phase: 64, status: "MISSING" }
    - { phase: 65, status: "MISSING" }
    - { phase: 66, status: "MISSING" }
    - { phase: 67, status: "MISSING" }
    - { phase: 68, status: "MISSING" }
    - { phase: 69, status: "MISSING" }
    - { phase: 70, status: "MISSING" }
    - { phase: 71, status: "MISSING" }
    - { phase: 72, status: "MISSING" }
    - { phase: 73, status: "MISSING" }
    - { phase: 74, status: "MISSING" }
---

# v12 Desktop Product MVP — Milestone Audit Report

**Audited:** 2026-03-09T14:00:00Z
**Status:** gaps_found
**Re-audit:** Yes — previous audit found INT-01 (download 404) and INT-02 (Romanian text), closed via Phase 74

## Requirements Coverage (27/28)

### 3-Source Cross-Reference

| REQ-ID | Description | Phase | VERIFICATION | SUMMARY | REQUIREMENTS.md | Final Status |
|--------|-------------|-------|--------------|---------|-----------------|--------------|
| DATA-01 | Local SQLite storage | 65 | passed | — | [x] | satisfied |
| DATA-02 | Data abstraction layer | 64 | passed | — | [x] | satisfied |
| DATA-03 | Offline project CRUD | 66 | passed | — | [x] | satisfied |
| DATA-04 | Local filesystem for video | 66 | passed | — | [x] | satisfied |
| DATA-05 | Cost tracking in SQLite | 65 | passed | — | [x] | satisfied |
| DATA-06 | SQLite schema from migrations | 64 | passed | — | [x] | satisfied |
| AUTH-01 | JWT token injection | 67 | passed | — | [x] | satisfied |
| AUTH-02 | Logout button | 67 | passed | — | [x] | satisfied |
| AUTH-03 | License validation + grace | 68 | passed | — | [x] | satisfied |
| AUTH-04 | Password reset | 67 | passed | — | [x] | satisfied |
| AUTH-05 | Route protection middleware | 67 | passed | — | [x] | satisfied |
| UX-01 | Simplified 3-step pipeline | 70 | passed | — | [x] | satisfied |
| UX-02 | Advanced params hidden | 70 | passed | — | [x] | satisfied |
| UX-03 | Setup wizard with presets | 71 | passed | — | [x] | satisfied |
| UX-04 | 5+ caption visual presets | 71 | passed | — | [x] | satisfied |
| **UX-05** | **Batch video queue** | **70** | **passed** | **—** | **[x]** | **unsatisfied** |
| UX-06 | Consistent brand name | 72 | passed | — | [x] | satisfied |
| UX-07 | No Romanian text | 72+74 | passed | — | [x] | satisfied |
| ELEC-01 | Real publish config | 73 | passed | — | [x] | satisfied |
| ELEC-02 | Portable Node.js documented | 73 | passed | — | [x] | satisfied |
| ELEC-03 | Installer under 500MB | 73 | passed | — | [x] | satisfied |
| ELEC-04 | Auto-updater | 73 | passed | — | [x] | satisfied |
| ELEC-05 | Brand icon + window title | 73 | passed | — | [x] | satisfied |
| ELEC-06 | macOS target configured | 73 | passed | — | [x] | satisfied |
| API-01 | ElevenLabs from vault | 69 | passed | — | [x] | satisfied |
| API-02 | Gemini from vault | 69 | passed | — | [x] | satisfied |
| API-03 | Encrypted API key storage | 69 | passed | — | [x] | satisfied |
| API-04 | Fallback without API keys | 69 | passed | — | [x] | satisfied |

**Note on UX-05:** Phase 70 VERIFICATION passed because it verified the UI renders correctly and files can be added to the queue. However, the integration checker found the queue calls a non-existent endpoint (`/generate-raw` instead of `/generate`), meaning batch processing always fails with 404. The requirement is functionally unsatisfied.

**Note on SUMMARY frontmatter:** No v12 phase SUMMARYs include `requirements_completed` field — cross-reference limited to VERIFICATION + REQUIREMENTS.md.

## Phase Verifications (11/11)

| Phase | Name | Status | Score |
|-------|------|--------|-------|
| 64 | Data Abstraction Layer | passed | 4/4 |
| 65 | SQLite Local Database | passed | 7/7 |
| 66 | Local File Storage & Offline | passed | 7/7 |
| 67 | Auth Flow Fixes | passed | 7/7 |
| 68 | License Key Validation Polish | passed | 5/5 |
| 69 | Direct API Integration | passed | 5/5 |
| 70 | UX — Pipeline & Batch | passed | 11/11 |
| 71 | UX — Onboarding & Presets | passed | 4/4 |
| 72 | Brand & Language Cleanup | passed | 3/3 |
| 73 | Electron Polish | passed | 6/6 |
| 74 | v12 Gap Closure | passed | 2/2 |

All phases individually passed verification. The batch endpoint issue is a cross-phase integration gap not caught by phase-level verification.

## Integration Check (26/28)

### Connected (26)
- Phase 64→65: DataRepository → SQLiteRepository (WIRED)
- Phase 65→66: SQLiteRepository + MediaManager (WIRED)
- Phase 67→all: JWT injection in apiFetch (WIRED)
- Phase 67→68: Auth → License validation (WIRED)
- Phase 69→71: KeyVault → Setup wizard (WIRED)
- Phase 70→pipeline: SimplePipeline + mode toggle (WIRED)
- Phase 70→74: SimplePipeline download → /clips/{id}/download route (WIRED)
- Phase 72→all: "Edit Factory" brand consistent (WIRED)
- Phase 73→desktop: Electron spawns backend with DESKTOP_MODE (WIRED)

### Broken (2)
- **INT-03:** BatchUploadQueue → `/generate-raw` (404) — actual route is `/generate`
- Download route uses `get_client()` → fails under SQLite (tech debt, not gap — Supabase is default)

## E2E Flows (4/5)

| Flow | Status | Notes |
|------|--------|-------|
| First launch → setup → API keys → pipeline | COMPLETE | Works with Supabase backend |
| Upload → simple mode → style → download | COMPLETE | Fixed in Phase 74 |
| Login → protected routes → logout → redirect | COMPLETE | — |
| License validation → grace period → blocking | COMPLETE | — |
| **Batch upload → queue → process multiple** | **BROKEN** | Fails at `/generate-raw` (404) |

## Tech Debt (Non-Blocking)

### Phase 64: Data Abstraction Layer
- 118 direct supabase references in library_routes.py bypass repository abstraction
- Download route (line 470-473) uses `get_client()` → returns None for SQLite
- These are intentional: Phase 64 introduced the abstraction, full migration is future work

### Phase 73: Electron Polish
- Missing `icon.icns` for macOS (only `.ico` exists) — macOS build would use default icon
- `generate-icon.js` only produces ICO format

## Nyquist Compliance

No VALIDATION.md files exist for any v12 phase (0/11 compliant). Nyquist validation was not run during phase execution.

## Previous Audit Gap Closure

| Previous Gap | Status | Closed By |
|-------------|--------|-----------|
| INT-01: SimplePipeline download 404 | CLOSED | Phase 74 — added `/clips/{clip_id}/download` route |
| INT-02: Romanian text "Se initializeaza" | CLOSED | Phase 74 — replaced with "Initializing..." |
| FLOW-01: Simple Mode download returns 404 | CLOSED | Phase 74 — download route + anchor element |
