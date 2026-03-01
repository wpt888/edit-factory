# Phase 54: Electron Startup State Check - Research

**Researched:** 2026-03-01
**Domain:** Electron main process — startup URL routing, Node.js HTTP in main process
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WIZD-01 | /setup page detects first run via %APPDATA% flag and redirects new users | GAP-4 fix: Electron reads `first_run_complete` from GET /desktop/settings and loads `/setup` URL when false |
| LICS-02 | License validated via POST /v1/licenses/validate on each startup | GAP-5 fix: Electron calls POST /desktop/license/validate after services ready and first_run_complete=true |
| LICS-04 | Invalid/expired license blocks app access with re-activation prompt | Handled by routing to `/setup` when validate returns 403 (expired) or 404 (not activated) |
</phase_requirements>

---

## Summary

This phase is a targeted, single-file fix to `electron/src/main.js`. The v10 milestone audit identified two remaining integration gaps (GAP-4 and GAP-5) where Electron loads `http://localhost:3000` unconditionally after `waitForServices()` without checking first-run state or license validity. All supporting infrastructure (backend API endpoints, license service, setup wizard page, config.json persistence) was fully implemented in earlier phases — the only missing piece is a decision block in the Electron main process startup sequence.

The fix requires inserting an async startup state check between `waitForServices()` resolution and `mainWindow.loadURL()`. The check calls two existing backend endpoints in sequence: first `GET /api/v1/desktop/settings` (for `first_run_complete`), then `POST /api/v1/desktop/license/validate` (only if first run is complete). The result determines which URL to load: root URL for valid licenses, `/setup` for everything else. Network errors at this stage fall back to root URL for graceful degradation (the backend already implements its own 7-day offline grace period).

The audit document (`v10-MILESTONE-AUDIT.md`) contains a near-complete reference implementation for the fix. The implementation is confined to `electron/src/main.js` only — no frontend changes, no backend changes.

**Primary recommendation:** Insert a `checkStartupState()` async function in `electron/src/main.js` that runs after `waitForServices()` and returns the URL to load. Use Node.js's built-in `http` module (already imported and used by `checkUrl()`) for HTTP calls to stay consistent with existing patterns.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `http` module | built-in | HTTP requests in Electron main process | Already imported in main.js; used by `checkUrl()`; no additional dependency |
| Electron `BrowserWindow.loadURL()` | v34 (existing) | Navigate the main window to a specific URL | Already used at line 395 of main.js |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `http` module (POST via `http.request`) | built-in | POST /desktop/license/validate | Electron main process has no native `fetch` until Electron 21+; project uses Electron 34 so `fetch` IS available but `http` module is already the established pattern |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `http` module | `fetch` (global in Electron 34+) | `fetch` is cleaner but introduces inconsistency with existing `checkUrl()` pattern; either works — see Open Questions |
| `http` module | `net.request` (Electron API) | More complex; `http` module is already imported; no benefit |

**Installation:** No new packages required. This phase adds zero new dependencies.

---

## Architecture Patterns

### Recommended Project Structure

```
electron/src/main.js  — ONLY file modified
```

No new files. No frontend changes. No backend changes.

### Pattern 1: Insert State Check After `waitForServices()` in `app.whenReady()`

**What:** After `waitForServices()` resolves (both backend and frontend confirmed healthy), call `checkStartupState()` which returns the URL to load. Pass the URL to `mainWindow.loadURL()`.

**When to use:** Always — this is the startup sequence modification.

**Current code (lines 392-407 in main.js):**
```javascript
// SHELL-02: Wait for services, then show window
try {
  await waitForServices();
  console.log('[launcher] Services ready — loading UI...');
  mainWindow.loadURL('http://localhost:3000');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  tray.setToolTip('Edit Factory');

  // UPDT-01: Check for updates after services are confirmed running
  setupAutoUpdater();
} catch (err) {
  // ...
}
```

**Target code after Phase 54:**
```javascript
// SHELL-02: Wait for services, then show window
try {
  await waitForServices();
  console.log('[launcher] Services ready — checking startup state...');

  // WIZD-01 / LICS-02 / LICS-04: Determine correct startup URL
  const startupUrl = await checkStartupState();

  console.log('[launcher] Loading:', startupUrl);
  mainWindow.loadURL(startupUrl);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  tray.setToolTip('Edit Factory');

  // UPDT-01: Check for updates after services are confirmed running
  setupAutoUpdater();
} catch (err) {
  // ...
}
```

### Pattern 2: `checkStartupState()` Function

**What:** Async function that encapsulates the two API calls and returns the URL to load.

**Logic flow:**
1. Call `GET http://127.0.0.1:8000/api/v1/desktop/settings`
2. Parse JSON response — extract `first_run_complete` boolean
3. If `first_run_complete === false` → return `http://localhost:3000/setup` (GAP-4 / WIZD-01)
4. If `first_run_complete === true` → call `POST http://127.0.0.1:8000/api/v1/desktop/license/validate`
5. If validate returns 200 → return `http://localhost:3000` (valid license, normal launch)
6. If validate returns 403 or 404 → return `http://localhost:3000/setup` (invalid/expired/not activated)
7. If any network error occurs → log warning, return `http://localhost:3000` (graceful degradation — LICS-03 grace period handles it on backend)

**Reference implementation from audit document:**
```javascript
// Source: .planning/v10-MILESTONE-AUDIT.md — Combined Fix section
async function checkStartupState() {
  const SETUP_URL = 'http://localhost:3000/setup';
  const APP_URL   = 'http://localhost:3000';

  try {
    // Step 1: Check first-run state
    const settingsRes = await fetchJson(
      'http://127.0.0.1:8000/api/v1/desktop/settings'
    );
    if (!settingsRes || settingsRes.first_run_complete === false) {
      console.log('[launcher] First run detected — routing to setup wizard');
      return SETUP_URL;
    }

    // Step 2: Validate license (only on subsequent launches)
    const licenseStatus = await httpPost(
      'http://127.0.0.1:8000/api/v1/desktop/license/validate'
    );
    if (licenseStatus === 200) {
      return APP_URL;
    }
    // 403 = expired/invalid, 404 = not activated
    console.log(`[launcher] License check returned ${licenseStatus} — routing to setup`);
    return SETUP_URL;

  } catch (err) {
    console.warn('[launcher] Startup state check failed (non-fatal):', err.message);
    return APP_URL;  // Graceful degradation
  }
}
```

### Pattern 3: HTTP Helpers Using Built-in `http` Module

The existing `checkUrl()` function in main.js uses `http.get`. For `checkStartupState()`, we need two helpers:
- A GET helper that returns parsed JSON
- A POST helper that returns the HTTP status code (no body needed for validate)

Using the `http` module (already imported):

```javascript
// Source: Consistent with existing checkUrl() pattern in main.js
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON response'));
        }
      });
    }).on('error', reject);
  });
}

function httpPost(url) {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname } = new URL(url);
    const req = http.request(
      { hostname, port: Number(port), path: pathname, method: 'POST',
        headers: { 'Content-Length': 0 } },
      (res) => resolve(res.statusCode)
    );
    req.on('error', reject);
    req.end();
  });
}
```

**Note on `fetch` alternative:** Electron 34 (the version in `electron/package.json`) does expose a global `fetch` in the main process. Using `fetch` would be simpler code. However, it introduces an inconsistency with the existing `http.get` pattern used by `checkUrl()`. The planner should pick one approach and stay consistent. The `http` module approach is lower risk (same pattern already working) and avoids any concern about `fetch` behaving differently with `127.0.0.1` vs `localhost` on Windows.

### Pattern 4: The `/setup` Page Guard Logic (Existing — No Change Needed)

The existing `setup/page.tsx` already handles the case where Electron routes to `/setup`:

- **First run (404):** Guard detects `!first_run_complete` state when validate returns 404 → stays on wizard Step 1 (line 71-74 of setup/page.tsx)
- **Expired license (403):** Guard shows "license has expired" error message in Step 1 (line 76-80)
- **Valid license (200):** Guard redirects away to `/librarie` (line 66-68) — this prevents users from re-running wizard unnecessarily

The setup page also already handles the `?mode=edit` query param for Settings → edit flow, and the non-desktop mode case. **No changes to setup/page.tsx are needed.**

### Anti-Patterns to Avoid

- **Anti-pattern: Calling license validate when first_run_complete=false.** A fresh install has no license activated — validate returns 404 immediately. The correct flow skips validate on first run entirely and goes straight to `/setup`.
- **Anti-pattern: Treating network error as license failure.** If `checkStartupState()` throws a network error, the correct response is to load root URL and let the backend's grace period handle it. Do NOT redirect to `/setup` on network errors.
- **Anti-pattern: Using `localhost` for API calls.** The existing pattern uses `127.0.0.1` for backend health checks (per Phase 48 decision: "127.0.0.1 for health polling, localhost for loadURL — avoids IPv6 mismatch on Windows"). `checkStartupState()` must follow the same convention: use `127.0.0.1:8000` for API calls.
- **Anti-pattern: Blocking the tray icon on the state check.** The state check happens after services are already ready and after the tray icon exists. Update the tray tooltip to indicate the check is in progress if desired, but do not block tray creation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP GET with JSON parsing | Custom fetch wrapper | Node.js `http` module (consistent with existing `checkUrl()`) | Already in file; no new imports |
| HTTP POST (status code only) | Custom request handler | `http.request` with method: 'POST' | Minimal; backend endpoint needs no body |
| URL determination logic | Complex state machine | Simple if/else decision tree | Only 3 outcomes: setup (first run), setup (bad license), root (valid) |

---

## Common Pitfalls

### Pitfall 1: 127.0.0.1 vs localhost for API calls

**What goes wrong:** Using `localhost` for the backend API calls may fail on Windows if IPv6 resolution maps `localhost` to `::1` but the backend listens on `127.0.0.1`. This would cause a ECONNREFUSED error, triggering the graceful degradation path and always loading root URL.

**Why it happens:** Per Phase 48 decision (documented in STATE.md): "127.0.0.1 for health polling, localhost for loadURL — avoids IPv6 mismatch on Windows."

**How to avoid:** Use `http://127.0.0.1:8000/api/v1/desktop/settings` and `http://127.0.0.1:8000/api/v1/desktop/license/validate` for API calls. Use `http://localhost:3000` and `http://localhost:3000/setup` for `loadURL` calls (browser navigation is fine with localhost).

**Warning signs:** State check always falls through to graceful degradation; logs show connection errors even after services are confirmed ready.

### Pitfall 2: Setup Page Double-Redirect Loop

**What goes wrong:** If Electron loads `/setup` and the setup page's first-run guard (line 64 of setup/page.tsx) immediately re-validates the license, getting a successful validation might redirect the user away from setup on a legitimate re-activation flow.

**Why it happens:** The setup page calls `apiPost("/desktop/license/validate")` on mount to check if setup should be skipped. If the license is valid (e.g., expired license just renewed), it redirects to `/librarie`.

**How to avoid:** The setup page logic already handles this correctly. When Electron routes to `/setup` because of 403, the setup page guard will also call validate, get 403, show the re-activation error, and stay on the wizard. This is correct behavior — no code change needed. Just ensure the Electron routing logic routes correctly.

### Pitfall 3: Race Condition — Services Ready but API Not Responding

**What goes wrong:** `waitForServices()` polls `FRONTEND_HEALTH_URL` (which returns any 2xx-3xx). The backend health URL is `http://127.0.0.1:8000/api/v1/health`. However, the desktop routes at `/api/v1/desktop/*` are mounted separately. In theory, health could pass before desktop routes are fully registered.

**Why it happens:** FastAPI mounts all routers at startup; this shouldn't be an issue in practice. The health endpoint is only reachable once FastAPI has fully started, at which point all routers including the desktop router are registered.

**How to avoid:** No special handling needed. The existing `waitForServices()` polling is sufficient. Document this as LOW concern.

### Pitfall 4: first_run_complete is undefined (missing key)

**What goes wrong:** If `config.json` exists but `first_run_complete` key is absent, `GET /desktop/settings` returns `first_run_complete: false` (per line 133 of desktop_routes.py: `config.get("first_run_complete", False)`). The JS side must treat any falsy value (false, undefined, null) as "first run."

**Why it happens:** Config file might exist from a partial previous install attempt with only API keys written but no first-run completion.

**How to avoid:** In `checkStartupState()`, check `settingsData.first_run_complete !== true` rather than `settingsData.first_run_complete === false` to catch all falsy variants.

---

## Code Examples

Verified patterns from existing codebase:

### Existing `checkUrl()` — Reference for HTTP Pattern
```javascript
// Source: electron/src/main.js line 161-166
function checkUrl(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => resolve(res.statusCode >= 200 && res.statusCode < 400))
      .on('error', () => resolve(false));
  });
}
```

### Existing `waitForServices()` → `loadURL()` — Where the New Code Inserts
```javascript
// Source: electron/src/main.js lines 392-407
try {
  await waitForServices();
  console.log('[launcher] Services ready — loading UI...');
  mainWindow.loadURL('http://localhost:3000');   // <-- THIS BECOMES checkStartupState()
  mainWindow.once('ready-to-show', () => mainWindow.show());
  tray.setToolTip('Edit Factory');
  setupAutoUpdater();
} catch (err) {
  console.error('[launcher] Startup failed:', err.message);
  // ...
}
```

### Backend Endpoints Already Implemented

```
GET  http://127.0.0.1:8000/api/v1/desktop/settings
     → { first_run_complete: boolean, crash_reporting_enabled: boolean, ... }

POST http://127.0.0.1:8000/api/v1/desktop/license/validate
     → 200: { valid: true, grace_period: boolean, error: null }
     → 403: HTTPException (invalid/expired)
     → 404: HTTPException (not activated)
```

### Decision Map

| Condition | URL to Load |
|-----------|-------------|
| `first_run_complete` is false/missing | `http://localhost:3000/setup` |
| `first_run_complete` is true AND validate returns 200 | `http://localhost:3000` |
| `first_run_complete` is true AND validate returns 403 | `http://localhost:3000/setup` |
| `first_run_complete` is true AND validate returns 404 | `http://localhost:3000/setup` |
| Any network error during state check | `http://localhost:3000` (graceful degradation) |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `loadURL('http://localhost:3000')` unconditionally | `loadURL(await checkStartupState())` | Phase 54 | Closes GAP-4 + GAP-5; satisfies WIZD-01, LICS-02, LICS-04 |

**No deprecated items in this domain.** The `http` module is stable Node.js core API. Electron 34's main process patterns haven't changed.

---

## Open Questions

1. **`fetch` vs `http` module for `checkStartupState()`**
   - What we know: Electron 34 supports global `fetch` in main process; `http` module already imported; both work
   - What's unclear: No strong technical reason to prefer one over the other; style consistency question only
   - Recommendation: Use `http` module to stay consistent with `checkUrl()` pattern already in the file. This minimizes diff size and cognitive load.

2. **Tray tooltip during state check**
   - What we know: Services are "ready" per `waitForServices()` but state check adds a small delay (~100-500ms for local HTTP)
   - What's unclear: Whether a brief tooltip update ("Checking license...") improves UX
   - Recommendation: Keep it simple — no tooltip change during state check. The delay is negligible and the tray is still showing "Edit Factory — Starting..." from the services startup phase.

---

## Validation Architecture

(No `nyquist_validation` key in `.planning/config.json` — section included for completeness but no test framework is required for this phase.)

The success criteria are behavioral and can be verified manually:

| Success Criterion | Verification Method |
|-------------------|---------------------|
| Fresh install (first_run_complete=false) loads /setup | Temporarily set `first_run_complete: false` in AppData config.json; launch app; verify /setup loads |
| Valid license loads root URL | Normal launch after setup completion |
| Expired/invalid (403) redirects to /setup | Mock or simulate license expiry in license.json; verify /setup loads |
| Not-yet-activated (404) redirects to /setup | Remove license.json; verify /setup loads |
| Network error falls back to root URL | Disable backend network temporarily; verify root URL loads |

No automated test framework changes needed. This is a single-function addition in a single file.

---

## Sources

### Primary (HIGH confidence)

- `electron/src/main.js` — full current implementation, insertion point identified at lines 392-407
- `app/api/desktop_routes.py` — both API endpoints fully implemented; response shapes confirmed
- `app/services/license_service.py` — validate() logic confirmed; HTTP status codes confirmed (200/403/404)
- `frontend/src/app/setup/page.tsx` — existing /setup page guard logic confirmed; no changes needed
- `.planning/v10-MILESTONE-AUDIT.md` — GAP-4 and GAP-5 root cause analysis + reference fix implementation

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` decisions section — "127.0.0.1 for health polling, localhost for loadURL" pattern confirmed

### Tertiary (LOW confidence)

- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — uses existing http module already in file; no new dependencies
- Architecture: HIGH — insertion point is unambiguous; both endpoint APIs are fully implemented and confirmed
- Pitfalls: HIGH — derived from audit document evidence + examination of actual code

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable — Electron 34 and these APIs won't change meaningfully)
