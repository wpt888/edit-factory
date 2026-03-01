---
milestone: v10
audited: "2026-03-01T17:30:00Z"
status: gaps_found
prior_audit: "2026-03-01T16:00:00Z (3 gaps → Phase 53 closed all 3)"
scores:
  requirements: 26/29
  phases: 7/7
  integration: 25/28
  flows: 3/5
gaps:
  requirements:
    - id: "WIZD-01"
      status: "unsatisfied"
      phase: "Phase 50 → Phase 53"
      claimed_by_plans: ["50-01-PLAN.md", "50-02-PLAN.md", "53-01-PLAN.md"]
      completed_by_plans: ["50-01-SUMMARY.md", "50-02-SUMMARY.md", "53-01-SUMMARY.md"]
      verification_status: "passed"
      evidence: "Phase verifications confirm setup/page.tsx guards work when NEXT_PUBLIC_DESKTOP_MODE=true (Phase 53 fixed the env var). However, Electron main.js line 395 loads http://localhost:3000 unconditionally — no mechanism routes first-run users to /setup. Success criteria: 'A brand-new install automatically redirects to /setup on first launch' — this redirect does not exist."
    - id: "LICS-02"
      status: "unsatisfied"
      phase: "Phase 49"
      claimed_by_plans: ["49-01-PLAN.md"]
      completed_by_plans: ["49-01-SUMMARY.md"]
      verification_status: "passed"
      evidence: "LicenseService.validate() fully implemented. POST /desktop/license/validate endpoint exists. However, Electron main.js does not call license validation on startup — only occurs when user navigates to /setup page. Requirement: 'License validated on each startup' — does not happen on regular launches."
    - id: "LICS-04"
      status: "unsatisfied"
      phase: "Phase 49"
      claimed_by_plans: ["49-01-PLAN.md"]
      completed_by_plans: ["49-01-SUMMARY.md"]
      verification_status: "passed"
      evidence: "POST /desktop/license/validate returns 403 on invalid/expired license. But since validation never runs at startup (see LICS-02), an expired license does not block app access. User can continue using app indefinitely after initial activation."
  integration:
    - from: "Phase 48 (Electron main.js)"
      to: "Phase 50 (Setup Wizard)"
      issue: "Electron loads root URL unconditionally — no first-run detection or URL routing to /setup"
      affected_requirements: ["WIZD-01"]
    - from: "Phase 48 (Electron main.js)"
      to: "Phase 49 (License Service)"
      issue: "Electron startup does not call license validation API after services are ready"
      affected_requirements: ["LICS-02", "LICS-04"]
    - from: "Phase 49 (GET /desktop/settings)"
      to: "Phase 48 (Electron startup)"
      issue: "GET /desktop/settings returns first_run_complete but Electron doesn't consume it to decide startup URL"
      affected_requirements: ["WIZD-01"]
  flows:
    - name: "Fresh Install → Setup Wizard"
      status: "broken"
      breaks_at: "Electron loads http://localhost:3000 instead of /setup — no redirect from root to wizard for unconfigured installs"
      affected_requirements: ["WIZD-01"]
    - name: "Startup License Validation"
      status: "broken"
      breaks_at: "Electron does not call POST /desktop/license/validate after services are ready — license check only happens on /setup page"
      affected_requirements: ["LICS-02", "LICS-04"]
tech_debt:
  - phase: 51-crash-reporting
    items:
      - "SENTRY_DSN = '' — empty placeholder; crash reporting code structurally complete but inoperable until real Sentry DSN configured"
  - phase: 52-installer-and-packaging
    items:
      - "PLACEHOLDER_ORG / PLACEHOLDER_REPO in electron/package.json publish config — must replace before first release"
      - "electron/build/icon.ico is 16x16 placeholder — needs production-quality icon before release"
  - phase: 47-desktop-foundation
    items:
      - "app/cleanup.py uses hardcoded _PROJECT_ROOT — pre-existing utility, not in desktop mode runtime path"
  - phase: 48-electron-shell
    items:
      - "will-quit handler only cleans up when isQuitting=True — OS-kill leaves orphans (mitigated by next-launch cleanupOrphans)"
---

# v10 Desktop Launcher & Distribution — Milestone Audit (Post-Gap-Closure)

**Audited:** 2026-03-01T17:30:00Z
**Prior audit:** 2026-03-01T16:00:00Z (found 3 gaps → Phase 53 closed all 3)
**Status:** GAPS FOUND
**Score:** 26/29 requirements satisfied

## Executive Summary

Phase 53 successfully closed all 3 gaps from the first audit:
- ~~Gap 1: NEXT_PUBLIC_DESKTOP_MODE never set~~ → Fixed by `.env.production` + Electron env injection
- ~~Gap 2: Settings cache not cleared~~ → Fixed by `cache_clear` calls + `_write_env_keys` helper
- ~~Gap 3: FFmpeg path mismatch~~ → Fixed by `RESOURCES_PATH` env var injection

However, the integration checker identified **2 new cross-phase wiring gaps** in the Electron↔Backend startup sequence that prevent 3 requirements from being satisfied:

1. **Electron doesn't route first-run users to /setup** (WIZD-01) — loads root URL unconditionally
2. **Electron doesn't validate license on startup** (LICS-02, LICS-04) — license check only happens on /setup page

All individual phase verifications pass. The gaps exist at the Electron↔Backend API boundary during startup URL determination.

## Phase Verification Summary

| Phase | Status | Score | Gaps |
|-------|--------|-------|------|
| 47 - Desktop Foundation | PASSED | 4/4 | None |
| 48 - Electron Shell | PASSED | 10/10 | None |
| 49 - Desktop API Routes | PASSED | 7/7 | None |
| 50 - Setup Wizard | PASSED | 6/6 | None |
| 51 - Crash Reporting | PASSED | 4/4 | None |
| 52 - Installer & Packaging | PASSED | 6/6 | None |
| 53 - Integration Wiring | PASSED | 8/8 | None (closed all first-audit gaps) |

## Requirements Coverage (3-Source Cross-Reference)

### Desktop Foundation (4/4 satisfied)

| REQ-ID | VERIFICATION | SUMMARY Frontmatter | REQUIREMENTS.md | Final Status |
|--------|-------------|---------------------|-----------------|--------------|
| FOUND-01 | passed (47, 53) | 47-01 ✓, 53-02 ✓ | [x] | **satisfied** |
| FOUND-02 | passed (47) | 47-03 ✓ | [x] | **satisfied** |
| FOUND-03 | passed (47, 53) | 47-03 ✓ | [x] | **satisfied** |
| FOUND-04 | passed (47) | 47-01 ✓, 47-02 ✓ | [x] | **satisfied** |

### Electron Shell (5/5 satisfied)

| REQ-ID | VERIFICATION | SUMMARY Frontmatter | REQUIREMENTS.md | Final Status |
|--------|-------------|---------------------|-----------------|--------------|
| SHELL-01 | passed (48) | 48-01 ✓, 48-02 ✓ | [x] | **satisfied** |
| SHELL-02 | passed (48) | 48-02 ✓ | [x] | **satisfied** |
| SHELL-03 | passed (48) | 48-02 ✓ | [x] | **satisfied** |
| SHELL-04 | passed (48) | 48-02 ✓ | [x] | **satisfied** |
| SHELL-05 | passed (48) | 48-02 ✓ | [x] | **satisfied** |

### Installer (4/4 satisfied)

| REQ-ID | VERIFICATION | SUMMARY Frontmatter | REQUIREMENTS.md | Final Status |
|--------|-------------|---------------------|-----------------|--------------|
| INST-01 | passed (52) | 52-01 (no field) | [x] | **satisfied** |
| INST-02 | passed (52, 53) | 52-01 (no field) | [x] | **satisfied** |
| INST-03 | passed (52) | 52-01 (no field) | [x] | **satisfied** |
| INST-04 | passed (52) | 52-01 (no field) | [x] | **satisfied** |

### Setup Wizard (5/6 satisfied)

| REQ-ID | VERIFICATION | SUMMARY Frontmatter | REQUIREMENTS.md | Final Status |
|--------|-------------|---------------------|-----------------|--------------|
| WIZD-01 | passed (50, 53) | 50-01 ✓ | [x] | **UNSATISFIED** — No redirect to /setup on first launch |
| WIZD-02 | passed (50, 53) | 50-02 (no field) | [x] | **satisfied** |
| WIZD-03 | passed (50, 53) | 50-01 ✓ | [x] | **satisfied** |
| WIZD-04 | passed (50, 53) | 50-02 (no field) | [x] | **satisfied** |
| WIZD-05 | passed (50, 53) | 50-01 ✓, 53-02 ✓ | [x] | **satisfied** |
| WIZD-06 | passed (50, 53) | 50-02 (no field) | [x] | **satisfied** |

### Licensing (2/4 satisfied)

| REQ-ID | VERIFICATION | SUMMARY Frontmatter | REQUIREMENTS.md | Final Status |
|--------|-------------|---------------------|-----------------|--------------|
| LICS-01 | passed (49) | 49-01 ✓ | [x] | **satisfied** |
| LICS-02 | passed (49) | 49-01 ✓ | [x] | **UNSATISFIED** — No startup validation |
| LICS-03 | passed (49) | 49-01 ✓ | [x] | **satisfied** |
| LICS-04 | passed (49) | 49-01 ✓ | [x] | **UNSATISFIED** — Expired license doesn't block at launch |

### Updates & Telemetry (6/6 satisfied)

| REQ-ID | VERIFICATION | SUMMARY Frontmatter | REQUIREMENTS.md | Final Status |
|--------|-------------|---------------------|-----------------|--------------|
| UPDT-01 | passed (52) | 52-02 ✓ | [x] | **satisfied** |
| UPDT-02 | passed (52) | 52-02 ✓ | [x] | **satisfied** |
| UPDT-03 | passed (51) | 51-01 ✓, 51-02 ✓ | [x] | **satisfied** (code correct; DSN is deployment config) |
| UPDT-04 | passed (51) | 51-01 ✓ | [x] | **satisfied** (EventScrubber correct; DSN is deployment config) |
| UPDT-05 | passed (49, 53) | 49-01 ✓ | [x] | **satisfied** |
| UPDT-06 | passed (49, 53) | 49-02 ✓ | [x] | **satisfied** |

### Orphaned Requirements Check

No orphaned requirements. All 29 REQ-IDs appear in at least one phase VERIFICATION.md.

### Missing SUMMARY Frontmatter

3 summaries lack `requirements-completed` field (50-02, 52-01, 53-01). Not code gaps — all requirements confirmed by VERIFICATION.md evidence.

## Critical Integration Gaps

### GAP-4: First-Run Redirect Missing (Electron → Setup Wizard)

**Root cause:** `electron/src/main.js` loads `http://localhost:3000` unconditionally after `waitForServices()` resolves (line 395). No check for `first_run_complete` state. No conditional routing to `/setup`.

**Impact:** Fresh-install users land on library page with no API keys configured instead of setup wizard.

**Affected requirements:** WIZD-01

**Fix:** After `waitForServices()`, call `GET /api/v1/desktop/settings` to check `first_run_complete`. If `false`, load `http://localhost:3000/setup` instead of root URL.

### GAP-5: Startup License Validation Missing (Electron → License Service)

**Root cause:** `electron/src/main.js` does not call `POST /api/v1/desktop/license/validate` during startup. License validation only occurs when user navigates to `/setup` page (which calls it on mount at `setup/page.tsx` line 64).

**Impact:** Expired or invalidated licenses do not block app access on subsequent launches. Users can use the app indefinitely after initial activation without re-validation.

**Affected requirements:** LICS-02, LICS-04

**Fix:** After `waitForServices()` and checking `first_run_complete === true`, call `POST /api/v1/desktop/license/validate`. If 403 (invalid/expired), load `/setup` for re-activation. If 404 (not activated), load `/setup`. If 200 (valid), load root URL.

### Combined Fix (Single Change to main.js)

Both gaps share one root cause: `main.js` needs a startup state check. After `waitForServices()` resolves and before `loadURL()`:

```javascript
// 1. Check first-run state
const settings = await fetch('http://127.0.0.1:8000/api/v1/desktop/settings');
const { first_run_complete } = await settings.json();

if (!first_run_complete) {
  mainWindow.loadURL('http://localhost:3000/setup');  // WIZD-01 fix
} else {
  // 2. Validate license on startup
  const license = await fetch('http://127.0.0.1:8000/api/v1/desktop/license/validate', { method: 'POST' });
  if (license.status === 200) {
    mainWindow.loadURL('http://localhost:3000');       // Normal launch
  } else {
    mainWindow.loadURL('http://localhost:3000/setup'); // Re-activation
  }
}
```

## E2E Flow Verification

| Flow | Status | Details |
|------|--------|---------|
| Fresh Install → Setup Wizard | **BROKEN** | Electron loads root URL; no redirect to /setup |
| Settings → Edit Setup Wizard | COMPLETE | Settings links to /setup?mode=edit; pre-fills; saves with cache_clear |
| Startup → Services → Window | COMPLETE | Health polling, tray icon, window show all verified |
| Startup → License Validation | **BROKEN** | Electron doesn't call validate; no license gate |
| Startup → Auto-Update Check | COMPLETE | setupAutoUpdater() after services ready; dialog works |
| Crash Reporting Toggle | COMPLETE | Toggle → POST → set_crash_reporting → immediate effect |
| Settings Cache Invalidation | COMPLETE | Wizard saves → _write_env_keys → cache_clear → fresh Settings |

## Tech Debt (Non-Blocking)

| Phase | Item | Priority |
|-------|------|----------|
| 51 | `SENTRY_DSN = ""` — needs real DSN before release | Pre-release |
| 52 | `PLACEHOLDER_ORG/REPO` in publish config — needs real values before release | Pre-release |
| 52 | `icon.ico` 16x16 placeholder — needs production icon | Pre-release |
| 47 | `app/cleanup.py` hardcoded `_PROJECT_ROOT` — not in runtime path | Low |
| 48 | OS-kill cleanup gap — mitigated by next-launch cleanupOrphans | Low |

**Total: 5 tech debt items across 4 phases**

## Comparison with First Audit

| Metric | First Audit (pre-Phase 53) | This Audit (post-Phase 53) |
|--------|---------------------------|---------------------------|
| Requirements satisfied | 23/29 | 26/29 |
| Integration connections | 15/18 | 25/28 |
| E2E flows complete | 3/5 | 3/5 |
| Gaps | 3 (env var, cache, FFmpeg) | 2 (first-run, license startup) |
| Status | gaps_found | gaps_found |

Phase 53 improved requirements coverage from 23→26 and fixed all 3 original gaps. The 2 remaining gaps are simpler (single-file change in main.js) and share a common root cause.

---

*Audited: 2026-03-01T17:30:00Z*
*Auditor: Claude (gsd audit-milestone, post-gap-closure re-audit)*
