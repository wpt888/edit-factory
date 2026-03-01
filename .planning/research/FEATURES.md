# Feature Research

**Domain:** Desktop app distribution — launcher, installer, auto-update, licensing, crash reporting
**Researched:** 2026-03-01
**Confidence:** HIGH (installer/launcher/tray patterns), HIGH (Lemon Squeezy license API), MEDIUM (auto-update implementation), MEDIUM (Sentry integration), LOW (code signing ROI)

---

## Context: What Already Exists

Edit Factory is a FastAPI (port 8000) + Next.js (port 3000) hybrid that currently starts via `start-dev.bat` or `start-dev.sh`. The v10 milestone goal is to transform this into a distributable Windows product with: a `.exe` launcher, an NSIS installer, first-run setup wizard, auto-update, license key validation (Lemon Squeezy), and opt-in crash reporting (Sentry). Supabase remains cloud DB — this is a hybrid (local rendering, cloud data), not a fully offline app.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any paid Windows desktop app must have. Missing these = product feels unfinished or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Double-click launcher (.exe) | Users expect to launch an app by clicking it, not running scripts in a terminal | MEDIUM | `pystray` + Python launcher process; starts FastAPI backend subprocess + opens browser; must suppress console window (`CREATE_NO_WINDOW` flag on subprocess); single executable entry point |
| System tray icon with right-click menu | Windows convention for background service apps; "running" indicator; quit mechanism | MEDIUM | `pystray` library (Win32 backend default on Windows); menu items: "Open Edit Factory", "Quit"; no systray = users don't know if app is running or how to stop it |
| Windows installer (.exe) | Paid software ships with an installer; unzip-and-run feels unprofessional and untrusted | HIGH | NSIS + `pynsist` (builds NSIS installers for Python apps, bundles Python itself); alternatives: PyInstaller (antivirus false positive risk), conda-pack (heavier); installer bundles Python runtime, dependencies, FFmpeg binary, frontend build |
| Install to `Program Files` with Start Menu shortcut | Windows user expectation — app appears in Start Menu and Add/Remove Programs | LOW | NSIS handles this natively; include uninstaller registration; standard NSIS install script |
| First-run setup wizard | New users don't have API keys configured; wizard guides to a working state before reaching main app | MEDIUM | Web page served by Next.js (`/setup` route); detect on first launch (flag in `%APPDATA%`); 3–4 steps: Welcome → API Keys → Test Connection → Done; cannot skip required keys (Supabase URL/key required; others optional) |
| Version number displayed | Users need to know what version they have for support and update conversations | LOW | Show in UI footer or settings page; backend `GET /api/v1/version` endpoint returns `{"version": "1.0.0"}`; read from single source of truth (e.g., `version.txt` or `pyproject.toml`) |
| Graceful shutdown | Closing launcher should stop backend process cleanly; orphan processes are a UX defect | LOW | Track subprocess PID in launcher; on tray "Quit" → send SIGTERM to backend → wait for exit → exit launcher; also handle on window close |
| Uninstaller | Paid app that can't be uninstalled cleanly feels hostile; Add/Remove Programs entry required | LOW | NSIS generates uninstaller automatically; remove installed files, Start Menu shortcuts, optionally `%APPDATA%` config (ask user) |

### Differentiators (Competitive Advantage)

Features that raise perceived quality and reduce support burden. Not expected, but clearly signal a polished product.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Auto-update on startup | Users stay on latest version without manual reinstall; critical for fixing bugs post-sale | MEDIUM | Check GitHub Releases API (or private endpoint) on launch; compare `current_version` vs `latest_version`; if behind, show notification with "Download update" button; download new installer, prompt user to run it; simple `requests`-based implementation — no framework needed for a one-time-purchase indie app; tufup/PyUpdater are overkill here |
| License key activation screen | Gate access to app behind purchase; simple XXXX-XXXX-XXXX-XXXX entry screen | MEDIUM | Lemon Squeezy License API: `POST /v1/licenses/activate` with `license_key` + `instance_name` (machine hostname); store `instance_id` locally in `%APPDATA%/edit_factory/license.json`; validate on each launch with `POST /v1/licenses/validate`; Lemon Squeezy supports activation limits and tracks machine count |
| Opt-in crash reporting (Sentry) | Reduces support blind spots; developer knows what breaks in production | LOW | `sentry-sdk` with `sentry_sdk.init(dsn=..., traces_sample_rate=0.1)`; show consent dialog on first run: "Help improve Edit Factory by sending anonymous crash reports"; store consent in `%APPDATA%` config; if declined, never initialize Sentry; FastAPI Sentry integration is built-in (`SentryAsgiMiddleware`) |
| `%APPDATA%` config storage | Installed apps must not write config to `Program Files` (permissions issue); `%APPDATA%` is the Windows standard | LOW | `%APPDATA%/EditFactory/config.json` stores: license key, instance_id, API keys, crash consent, first-run complete flag; all services read from this path instead of `.env`; DESKTOP_MODE flag activates this path |
| Desktop mode env flags | Separate desktop behavior from dev behavior without code duplication | LOW | `DESKTOP_MODE=true` in launcher-injected env; `AUTH_DISABLED=true` (single-user app, no multi-user auth needed); backend detects these flags at startup to skip JWT validation and read from `%APPDATA%` config |
| Startup notification toast | Windows toast notification on launch: "Edit Factory is ready — click to open" | LOW | `win10toast` or `plyer` library; optional nicety; avoids user confusion when browser doesn't open automatically |
| Portable mode (no installer) | Advanced users want to run from a folder on USB or network drive | LOW | Support `--portable` flag on launcher; reads config from `./config.json` relative to exe instead of `%APPDATA%`; do not require this for v10 launch — defer |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| PyInstaller single `.exe` bundle | "One file is clean and simple" | PyInstaller-generated exes trigger antivirus false positives on many Windows machines (well-documented, affects many versions including post-v5.13.2); complex deps (numpy, whisper, torch) frequently fail to bundle correctly; produces 150–400MB bloated executable | Use NSIS installer with `pynsist` that installs Python runtime + packages as separate files; no packing/extraction = no antivirus trigger; installed files are human-readable, trustworthy |
| Electron wrapper | "Makes it feel like a real desktop app" | PROJECT.md explicitly ruled this out — "unnecessary overhead for single-user workflow"; adds 150MB Chromium runtime; requires Node.js build pipeline; no benefit when app already runs in browser; constant Electron security updates become maintenance burden | Keep browser-in-tray pattern: pystray + subprocess FastAPI + `webbrowser.open()`; users already have a browser; this is the established pattern for local web tools (Calibre-Web, many others) |
| Offline-only license validation | "What if users have no internet?" | Offline license validation requires cryptographic signing infrastructure (public/private key embed), replay attack prevention, and hardware fingerprinting; significantly more complex than online validation; for a web-dependent app (Supabase requires internet), purely offline use is not the target case | Grace period: cache last successful validation result with timestamp; allow 72-hour offline use before re-prompting; Lemon Squeezy's API is reliable enough for startup validation |
| Mandatory code signing | "Windows will block unsigned executables" | Code signing certificates cost €60–€300/year and take days to provision; they reduce (but do not eliminate) antivirus warnings; Windows SmartScreen warnings appear for new/low-reputation signers regardless; for a personal-use indie tool, the cost/benefit is poor at launch | Start unsigned; add notice in install docs about SmartScreen warning; tell users to click "Run anyway"; pursue signing after first 50+ sales if support requests about this increase |
| Auto-start on Windows boot | "Should be always running" | Heavy video processing tools running at boot annoy users and consume resources; boot startup is acceptable for messaging apps, not rendering pipelines | Add opt-in "Start on login" checkbox in Settings page (uses `winreg` to add Run key); OFF by default |
| In-app payment / subscription | "Sell upgrades inside the app" | Requires payment SDK integration, PCI compliance considerations, in-app purchase flow — enormous scope; Lemon Squeezy handles the purchase externally | Sell on Lemon Squeezy website; app receives license key post-purchase via email; simple and standard for indie tools |

---

## Feature Dependencies

```
[Windows NSIS Installer]
    └──bundles──> [Python Runtime + Dependencies]
    └──bundles──> [FFmpeg Binary]
    └──bundles──> [Next.js Built Frontend (static export or dev server)]
    └──creates──> [Start Menu Shortcut → Launcher .exe]
    └──installs──> [Uninstaller]

[Launcher .exe (pystray + subprocess)]
    ├──requires──> [NSIS Installer] (produces the exe)
    ├──starts──> [FastAPI Backend (subprocess)]
    ├──opens──> [Browser at localhost:3000]
    ├──creates──> [System Tray Icon]
    └──injects──> [DESKTOP_MODE=true, AUTH_DISABLED=true env flags]

[First-Run Setup Wizard]
    ├──requires──> [Launcher] (detects first-run flag)
    ├──requires──> [%APPDATA% config path] (writes config.json)
    ├──blocks──> [Main App] (redirect to /setup until complete)
    └──gates──> [License Key Activation] (step 1 or pre-wizard)

[License Key Activation]
    ├──requires──> [Lemon Squeezy account + product configured]
    ├──requires──> [%APPDATA% config path] (stores instance_id)
    ├──calls──> [Lemon Squeezy License API: /v1/licenses/activate]
    └──validates on──> [Each launcher startup via /v1/licenses/validate]

[Auto-Update]
    ├──requires──> [Version endpoint in backend]
    ├──requires──> [GitHub Releases or update manifest URL]
    ├──runs at──> [Launcher startup, before opening browser]
    └──downloads──> [New NSIS installer, prompts user to run]

[Crash Reporting (Sentry)]
    ├──requires──> [Consent captured in First-Run Wizard]
    ├──requires──> [Sentry project DSN configured in build]
    ├──integrates with──> [FastAPI via SentryAsgiMiddleware]
    └──integrates with──> [Frontend via @sentry/nextjs]

[%APPDATA% Config Path]
    ├──required by──> [License Key Activation]
    ├──required by──> [First-Run Wizard]
    ├──required by──> [Crash Reporting consent]
    └──required by──> [DESKTOP_MODE env flag logic]

[DESKTOP_MODE env flag]
    ├──activates──> [%APPDATA% config read instead of .env]
    ├──activates──> [AUTH_DISABLED=true behavior]
    └──required by──> [All desktop-specific code paths]
```

### Dependency Notes

- **Installer must be stable before auto-update:** Auto-update downloads and runs a new installer. If the installer is broken, auto-update creates a support nightmare. Ship installer, validate it across clean Windows machines, then add auto-update in a subsequent phase.
- **%APPDATA% config is the keystone:** Everything desktop-specific (license, API keys, crash consent, first-run flag) flows through this path. Implement this before wizard, licensing, or Sentry.
- **License gate before wizard:** Show the license activation screen before the setup wizard. A user without a valid license should not reach API key configuration.
- **Sentry consent must precede Sentry init:** `sentry_sdk.init()` must only be called after consent is confirmed. Cannot initialize at module load time in desktop mode.
- **Auto-update runs before browser opens:** User should be notified of update availability before starting a work session, not interrupted mid-session.

---

## MVP Definition

### Launch With (v10 core)

The minimum required to ship a paid, installable version of Edit Factory.

- [ ] **%APPDATA% config storage** — foundation for everything else; no desktop features work without it
- [ ] **DESKTOP_MODE + AUTH_DISABLED env flags** — separates desktop behavior from dev; unlocks desktop code paths
- [ ] **Launcher .exe (pystray)** — starts backend, opens browser, shows system tray icon, handles shutdown
- [ ] **NSIS installer (pynsist)** — bundles Python, deps, FFmpeg, frontend; installs to Program Files; Start Menu shortcut; uninstaller
- [ ] **First-run setup wizard** — /setup page; detects first-run; collects API keys; writes to %APPDATA% config; marks complete
- [ ] **License key activation** — Lemon Squeezy activate + validate on startup; blocks app if invalid; stores instance_id locally
- [ ] **Version display** — show version number in Settings; backend /version endpoint

### Add After Validation (v10.x)

Add once the core installer + launcher is working on clean Windows machines.

- [ ] **Auto-update** — trigger: installer validated on clean machines; check GitHub Releases on startup; notify + download
- [ ] **Opt-in crash reporting (Sentry)** — trigger: first production users encountered; consent dialog in wizard; FastAPI + Next.js Sentry integration
- [ ] **"Start on login" option** — trigger: user request; opt-in winreg entry in Settings page

### Future Consideration (v11+)

Defer until v10 is stable and selling.

- [ ] **Portable mode** — low demand for a resource-heavy video tool; complex edge cases with relative paths
- [ ] **Code signing** — expensive; pursue after 50+ sales if antivirus support requests become common
- [ ] **macOS support** — NSIS is Windows-only; would require separate build pipeline (Homebrew or DMG); out of scope for personal-use Windows tool
- [ ] **Delta/patch updates** — tufup handles this; significant complexity for marginal bandwidth saving; full installer download is simpler

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| %APPDATA% config storage | HIGH (foundation) | LOW | P1 |
| DESKTOP_MODE / AUTH_DISABLED flags | HIGH (foundation) | LOW | P1 |
| Launcher .exe with system tray | HIGH | MEDIUM | P1 |
| NSIS installer | HIGH | HIGH | P1 |
| First-run setup wizard | HIGH | MEDIUM | P1 |
| License key validation (Lemon Squeezy) | HIGH | MEDIUM | P1 |
| Version display | MEDIUM | LOW | P1 |
| Auto-update on startup | HIGH | MEDIUM | P2 |
| Opt-in Sentry crash reporting | MEDIUM | LOW | P2 |
| Start on login option | LOW | LOW | P2 |
| Portable mode | LOW | MEDIUM | P3 |
| Code signing | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Required for v10 launch — product is not shippable without this
- P2: Ship in first update after launch validation
- P3: Future consideration

---

## Implementation Detail: Key Patterns

### Launcher Architecture (pystray pattern)

The launcher is a small Python script compiled to `.exe` via pynsist. It:
1. Starts FastAPI backend as a hidden subprocess (`subprocess.Popen` with `CREATE_NO_WINDOW`)
2. Waits for backend health check (`GET /api/v1/health`) to return 200
3. Opens browser at `http://localhost:3000` via `webbrowser.open()`
4. Creates pystray system tray icon with menu: "Open Edit Factory" / "Quit"
5. On "Quit": sends SIGTERM to backend subprocess, waits for exit, exits launcher

### License Validation Flow (Lemon Squeezy)

On first run:
- Show license key input screen (fullscreen, blocks main app)
- Call `POST https://api.lemonsqueezy.com/v1/licenses/activate` with `license_key` + `instance_name=socket.gethostname()`
- On success: store `instance_id` + `license_key` in `%APPDATA%/EditFactory/license.json`

On every subsequent launch:
- Read `license.json`; call `POST /v1/licenses/validate` with `license_key` + `instance_id`
- If `valid: true` → proceed; if `valid: false` or network error → show re-activation screen (with 72h offline grace period)
- Hard-code `product_id` and `store_id` in the client and verify response fields match (prevents key-sharing with other LS products)

### First-Run Wizard Steps

Step 1 — Welcome: product name, version, brief description, "Get Started" button
Step 2 — License Key: input field, activate button, success/error feedback (shown only if not already activated)
Step 3 — API Keys: Supabase URL (required), Supabase Key (required), Gemini API Key (optional), ElevenLabs API Key (optional); each field shows inline validation; "Test Connection" button hits `/api/v1/setup/test-connection`
Step 4 — Crash Reporting: opt-in checkbox with plain-language explanation: "Send anonymous error reports to help fix bugs. No personal data or video content is included."; defaults to OFF
Step 5 — Done: "Open Edit Factory" CTA; writes `first_run_complete: true` to config.json

### Auto-Update Implementation

Simple approach (no framework):
- `GET https://api.github.com/repos/[owner]/edit-factory/releases/latest` → parse `tag_name` as latest version
- Compare to `current_version` from local `version.txt`
- If newer: show non-blocking notification in the launcher tray menu: "Update available: v1.2.0 — Download"
- Download new NSIS installer to `%TEMP%`; prompt user to run it (it handles the update)
- User runs installer → old version replaced → launcher restarts

This is lower complexity than tufup (patch-based TUF framework) and appropriate for an indie tool where full installer download (~50–100MB) is acceptable.

### Sentry Integration

Backend (`app/main.py`):
```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

if desktop_config.crash_reporting_enabled:  # read from %APPDATA% config
    sentry_sdk.init(
        dsn="https://[key]@sentry.io/[project]",
        integrations=[FastApiIntegration()],
        traces_sample_rate=0.1,
    )
```

Frontend (`frontend/sentry.client.config.ts`):
```typescript
import * as Sentry from "@sentry/nextjs";
// Only init if backend reports consent enabled
if (window.__SENTRY_ENABLED__) {  // injected by backend on /api/v1/config
    Sentry.init({ dsn: "...", tracesSampleRate: 0.1 });
}
```

---

## Platform Comparison: Lemon Squeezy vs Gumroad

| Criterion | Lemon Squeezy | Gumroad |
|-----------|--------------|---------|
| Transaction fee | 5% + $0.50 | 10% + $0.50 |
| License key API | Full REST API (activate/validate/deactivate), instance limits, machine count | Basic validate-only API, limited instance tracking |
| Python library | Unofficial (`lemonsqueezy-py-api`) or direct HTTP | Direct HTTP only |
| Tax handling | MoR — handles VAT/GST in 100+ countries automatically | MoR since Jan 2025 — handles global taxes |
| Software focus | Built for SaaS/software sellers — license management is first-class | General digital products — licenses are secondary |
| Recommendation | **Use Lemon Squeezy** for software with license key management | Use Gumroad for simpler digital downloads without activation |

**Verdict:** Lemon Squeezy. Lower fees, purpose-built license API with machine activation limits, better for software distribution.

---

## Sources

- [NSIS Best Practices](https://nsis.sourceforge.io/Best_practices) — installer conventions
- [pynsist — Build Windows installers for Python](https://github.com/takluyver/pynsist) — NSIS + Python bundling
- [pystray documentation](https://pystray.readthedocs.io/en/latest/usage.html) — system tray implementation
- [PyInstaller antivirus false positives (GitHub issue #8164)](https://github.com/pyinstaller/pyinstaller/issues/8164) — why not PyInstaller
- [Lemon Squeezy License API — Validate](https://docs.lemonsqueezy.com/api/license-api/validate-license-key) — response fields, activation_limit, instance tracking
- [Lemon Squeezy License API — Activate](https://docs.lemonsqueezy.com/api/license-api/activate-license-key) — activation flow
- [Lemon Squeezy vs Gumroad 2025 comparison](https://ruul.io/blog/lemonsqueezy-vs-gumroad) — fee and feature comparison
- [sentry-python official SDK](https://github.com/getsentry/sentry-python) — FastAPI integration
- [tufup — Python auto-updater](https://github.com/dennisvang/tufup) — considered, rejected as overkill for indie tool
- [Wizard design pattern — UX Planet](https://uxplanet.org/wizard-design-pattern-8c86e14f2a38) — first-run wizard UX principles
- [Setup wizard design analysis — Krystal Higgins](https://www.kryshiggins.com/the-design-of-setup-wizards/) — multi-step setup patterns
- [Building Production-Ready Desktop LLM Apps: Tauri, FastAPI, and PyInstaller](https://aiechoes.substack.com/p/building-production-ready-desktop) — hybrid Python+frontend desktop patterns

---
*Feature research for: Desktop app distribution — launcher, installer, auto-update, licensing, crash reporting (v10 milestone)*
*Researched: 2026-03-01*
