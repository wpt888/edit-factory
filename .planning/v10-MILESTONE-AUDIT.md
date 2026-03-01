---
milestone: v10
audited: "2026-03-01T16:00:00Z"
status: gaps_found
scores:
  requirements: 23/29
  phases: 6/6
  integration: 15/18
  flows: 3/5
gaps:
  requirements:
    - id: "WIZD-01"
      status: "unsatisfied"
      phase: "Phase 50"
      claimed_by_plans: ["50-01-PLAN.md", "50-02-PLAN.md"]
      completed_by_plans: ["50-01-SUMMARY.md", "50-02-SUMMARY.md"]
      verification_status: "passed"
      evidence: "Phase verification passed (code exists) but NEXT_PUBLIC_DESKTOP_MODE=true is never set in any .env file or build step — setup/page.tsx line 59 exits early with 'only available in desktop mode' message"
    - id: "WIZD-02"
      status: "unsatisfied"
      phase: "Phase 50"
      claimed_by_plans: ["50-02-PLAN.md"]
      completed_by_plans: ["50-02-SUMMARY.md"]
      verification_status: "passed"
      evidence: "Wizard inaccessible due to NEXT_PUBLIC_DESKTOP_MODE not set — license step never renders"
    - id: "WIZD-03"
      status: "unsatisfied"
      phase: "Phase 50"
      claimed_by_plans: ["50-01-PLAN.md", "50-02-PLAN.md"]
      completed_by_plans: ["50-01-SUMMARY.md", "50-02-SUMMARY.md"]
      verification_status: "passed"
      evidence: "Wizard inaccessible — API key configuration step never renders"
    - id: "WIZD-04"
      status: "unsatisfied"
      phase: "Phase 50"
      claimed_by_plans: ["50-02-PLAN.md"]
      completed_by_plans: ["50-02-SUMMARY.md"]
      verification_status: "passed"
      evidence: "Wizard inaccessible — crash consent step never renders"
    - id: "WIZD-05"
      status: "partial"
      phase: "Phase 50"
      claimed_by_plans: ["50-01-PLAN.md", "50-02-PLAN.md"]
      completed_by_plans: ["50-01-SUMMARY.md", "50-02-SUMMARY.md"]
      verification_status: "passed"
      evidence: "Config write endpoint exists but get_settings.cache_clear() not called after POST /desktop/settings — stale settings until restart"
    - id: "WIZD-06"
      status: "unsatisfied"
      phase: "Phase 50"
      claimed_by_plans: ["50-02-PLAN.md"]
      completed_by_plans: ["50-02-SUMMARY.md"]
      verification_status: "passed"
      evidence: "Settings page Setup Wizard link gated on NEXT_PUBLIC_DESKTOP_MODE — never rendered in desktop build"
  integration:
    - from: "Phase 48 (Electron)"
      to: "Phase 50 (Setup Wizard frontend)"
      issue: "NEXT_PUBLIC_DESKTOP_MODE=true never injected into Next.js build or runtime env — Electron main.js sets DESKTOP_MODE for backend but not NEXT_PUBLIC_DESKTOP_MODE for frontend"
      affected_requirements: ["WIZD-01", "WIZD-02", "WIZD-03", "WIZD-04", "WIZD-06", "UPDT-05", "UPDT-06"]
    - from: "Phase 49 (desktop_routes.py)"
      to: "Phase 47 (config.py)"
      issue: "get_settings.cache_clear() not called after POST /desktop/settings writes .env — backend serves stale Settings until process restart"
      affected_requirements: ["WIZD-05", "FOUND-01"]
    - from: "Phase 52 (electron-builder extraResources)"
      to: "Phase 47 (app/main.py _setup_ffmpeg_path)"
      issue: "extraResources copies FFmpeg to process.resourcesPath/ffmpeg/bin but main.py looks for %APPDATA%\\EditFactory\\bundled\\ffmpeg\\bin — paths are disjoint"
      affected_requirements: ["FOUND-03", "INST-02"]
  flows:
    - name: "Fresh install wizard flow"
      breaks_at: "setup/page.tsx line 59 — NEXT_PUBLIC_DESKTOP_MODE check fails"
    - name: "Settings crash reporting toggle"
      breaks_at: "settings/page.tsx line 1049 — crash card hidden by NEXT_PUBLIC_DESKTOP_MODE gate"
tech_debt:
  - phase: 47-desktop-foundation
    items:
      - "app/cleanup.py line 35: _PROJECT_ROOT = Path(__file__).parent.parent — hardcoded, not using APP_BASE_DIR (pre-existing, not in Phase 47 scope)"
  - phase: 48-electron-shell
    items:
      - "will-quit handler only cleans up when isQuitting=True — OS-kill/Task Manager path leaves orphans (mitigated by next-launch cleanupOrphans)"
  - phase: 51-crash-reporting
    items:
      - "SENTRY_DSN = '' — empty placeholder; Sentry never initializes even when opted in until DSN is populated"
  - phase: 52-installer-and-packaging
    items:
      - "publish.owner = 'PLACEHOLDER_ORG', publish.repo = 'PLACEHOLDER_REPO' — auto-update check fails silently until real values set"
      - "electron/build/icon.ico is 16x16 placeholder — needs production-quality icon before release"
---

# v10 Desktop Launcher & Distribution — Milestone Audit

**Audited:** 2026-03-01T16:00:00Z
**Status:** GAPS FOUND
**Score:** 23/29 requirements satisfied (6 unsatisfied/partial due to integration gaps)

## Executive Summary

All 6 phases passed individual verification (code exists and works in isolation). However, cross-phase integration checking revealed 3 critical wiring gaps that prevent the desktop build from functioning end-to-end:

1. **NEXT_PUBLIC_DESKTOP_MODE never set** — all frontend desktop-mode gates are dead code in the packaged app
2. **Settings cache not cleared** after wizard writes config — backend serves stale settings
3. **FFmpeg path mismatch** — installer puts FFmpeg in a different location than where the backend looks for it

## Phase Verification Summary

| Phase | Status | Score | Gaps |
|-------|--------|-------|------|
| 47: Desktop Foundation | passed | 4/4 | None (tts_cache fix applied) |
| 48: Electron Shell | passed | 10/10 | None |
| 49: Desktop API Routes | passed | 7/7 | None |
| 50: Setup Wizard | passed | 6/6 | None (code-level) |
| 51: Crash Reporting | passed | 4/4 | None |
| 52: Installer & Packaging | passed | 6/6 | None |

All phase verifications passed because they evaluated code correctness in isolation. The integration gaps exist at the boundaries between phases.

## Requirements Cross-Reference (3-Source)

### Source 1: VERIFICATION.md Status

All 29 requirements marked SATISFIED across 6 phase VERIFICATIONs.

### Source 2: SUMMARY.md Frontmatter

No standardized `requirements_completed` field used. Requirements tracked via `provides` and `dependency_graph.provides` fields. Process improvement: adopt `requirements_completed` field in future milestones.

### Source 3: REQUIREMENTS.md Traceability

All 29 requirements checked `[x]` as Complete.

### Cross-Reference Results

| Requirement | VERIFICATION | SUMMARY | REQUIREMENTS.md | Integration | Final Status |
|-------------|-------------|---------|-----------------|-------------|--------------|
| FOUND-01 | passed | listed (provides) | [x] | PARTIAL (cache_clear gap) | **partial** |
| FOUND-02 | passed | listed | [x] | WIRED | **satisfied** |
| FOUND-03 | passed | listed | [x] | UNWIRED (path mismatch) | **unsatisfied** |
| FOUND-04 | passed | listed | [x] | WIRED | **satisfied** |
| SHELL-01 | passed | listed | [x] | WIRED | **satisfied** |
| SHELL-02 | passed | listed | [x] | WIRED | **satisfied** |
| SHELL-03 | passed | listed | [x] | WIRED | **satisfied** |
| SHELL-04 | passed | listed | [x] | PARTIAL (will-quit gap) | **satisfied** (mitigated) |
| SHELL-05 | passed | listed | [x] | WIRED | **satisfied** |
| INST-01 | passed | listed | [x] | WIRED | **satisfied** |
| INST-02 | passed | listed | [x] | PARTIAL (FFmpeg dest) | **partial** |
| INST-03 | passed | listed | [x] | WIRED | **satisfied** |
| INST-04 | passed | listed | [x] | WIRED | **satisfied** |
| WIZD-01 | passed | listed | [x] | UNWIRED (env var) | **unsatisfied** |
| WIZD-02 | passed | listed | [x] | UNWIRED (env var) | **unsatisfied** |
| WIZD-03 | passed | listed | [x] | UNWIRED (env var) | **unsatisfied** |
| WIZD-04 | passed | listed | [x] | UNWIRED (env var) | **unsatisfied** |
| WIZD-05 | passed | listed | [x] | PARTIAL (cache_clear) | **partial** |
| WIZD-06 | passed | listed | [x] | UNWIRED (env var) | **unsatisfied** |
| LICS-01 | passed | listed | [x] | WIRED (isolated) | **satisfied** |
| LICS-02 | passed | listed | [x] | WIRED (isolated) | **satisfied** |
| LICS-03 | passed | listed | [x] | WIRED | **satisfied** |
| LICS-04 | passed | listed | [x] | WIRED (isolated) | **satisfied** |
| UPDT-01 | passed | listed | [x] | PARTIAL (placeholder) | **satisfied** (pre-release) |
| UPDT-02 | passed | listed | [x] | PARTIAL (placeholder) | **satisfied** (pre-release) |
| UPDT-03 | passed | listed | [x] | PARTIAL (empty DSN) | **satisfied** (pre-release) |
| UPDT-04 | passed | listed | [x] | WIRED | **satisfied** |
| UPDT-05 | passed | listed | [x] | UNWIRED (env var) | **unsatisfied** |
| UPDT-06 | passed | listed | [x] | UNWIRED (env var) | **unsatisfied** (frontend gate) |

**Satisfied:** 21 | **Partial:** 2 | **Unsatisfied:** 6

Note: UPDT-05 backend endpoint works correctly; the "unsatisfied" status is because the frontend gate prevents the Settings page from fetching/displaying it. Similarly UPDT-06's crash reporting toggle card is hidden.

## Critical Integration Gaps

### GAP-1: NEXT_PUBLIC_DESKTOP_MODE Not Injected (CRITICAL)

**Root cause:** `electron/src/main.js` sets `DESKTOP_MODE=true` in the backend process env (line 88) but does NOT set `NEXT_PUBLIC_DESKTOP_MODE=true` in the frontend standalone server env (lines 124-138). The Next.js build also never has this env var baked in.

**Impact:** All 7 frontend desktop-mode gates resolve to `false`:
- `setup/page.tsx` line 59: wizard exits early
- `settings/page.tsx` lines 250, 1049, 1078: version, crash toggle, wizard link hidden

**Affected requirements:** WIZD-01 through WIZD-06, UPDT-05, UPDT-06

**Fix:** Add `NEXT_PUBLIC_DESKTOP_MODE: 'true'` to the frontend process env in `startFrontend()` (main.js line ~130), AND/OR create `frontend/.env.production` with `NEXT_PUBLIC_DESKTOP_MODE=true` for the build step.

### GAP-2: Settings Cache Not Cleared After Wizard Write (HIGH)

**Root cause:** `app/api/desktop_routes.py` `save_desktop_settings` (line 183) writes to config.json but does not call `get_settings.cache_clear()`. Comment in `app/config.py` line 131 acknowledges this obligation.

**Impact:** After wizard saves API keys, backend continues using stale (empty) settings until process restart.

**Affected requirements:** WIZD-05, FOUND-01

**Fix:** Add `get_settings.cache_clear(); get_settings()` after config write in both `save_desktop_settings` and `mark_first_run_complete`.

### GAP-3: FFmpeg Path Mismatch (HIGH)

**Root cause:** `app/main.py` line 16 looks for FFmpeg at `%APPDATA%\EditFactory\bundled\ffmpeg\bin`. `electron/package.json` extraResources copies FFmpeg to `process.resourcesPath/ffmpeg/bin` (inside installation directory).

**Impact:** Packaged app cannot find FFmpeg — all video processing broken.

**Affected requirements:** FOUND-03, INST-02

**Fix:** Either (a) pass `process.resourcesPath` as an env var from Electron and update `_setup_ffmpeg_path()` to check it, or (b) change extraResources destination to copy FFmpeg to AppData during first run.

## Tech Debt (Non-Blocking)

### Phase 47: Desktop Foundation
- `app/cleanup.py` line 35: hardcoded `_PROJECT_ROOT` (pre-existing, not in scope)

### Phase 48: Electron Shell
- `will-quit` only cleans up when `isQuitting=True` — OS-kill leaves orphans (mitigated by next-launch cleanup)

### Phase 51: Crash Reporting
- `SENTRY_DSN = ""` — empty placeholder; must populate before release

### Phase 52: Installer & Packaging
- `publish.owner/repo = PLACEHOLDER_*` — must set real GitHub org/repo before release
- `icon.ico` is 16x16 placeholder — needs production icon

**Total: 5 tech debt items across 4 phases**

## Broken E2E Flows

### Flow 1: Fresh Install Wizard (BROKEN)
Installer → Electron launch → backend ready → frontend loads → **setup/page.tsx exits early** (NEXT_PUBLIC_DESKTOP_MODE not set) → user sees "only available in desktop mode" message

### Flow 2: Settings Crash Toggle (BROKEN)
Settings page → **crash card hidden** (NEXT_PUBLIC_DESKTOP_MODE gate) → toggle inaccessible

### Flow 3: Returning User Launch (OK)
Electron launch → backend starts with DESKTOP_MODE=true → auth bypassed → app loads normally

### Flow 4: Auto-Update (OK, pre-release)
Startup → setupAutoUpdater() → checkForUpdates() → fails silently (placeholder repo) — acceptable pre-release

### Flow 5: Settings Re-Config (BROKEN)
Settings → **Setup Wizard link hidden** (NEXT_PUBLIC_DESKTOP_MODE gate) → cannot re-access wizard

---

_Audited: 2026-03-01T16:00:00Z_
_Auditor: Claude (gsd-audit-milestone)_
