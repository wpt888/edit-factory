# Project Research Summary

**Project:** Edit Factory — v10 Desktop Launcher & Distribution
**Domain:** Windows desktop distribution of a hybrid FastAPI + Next.js web app
**Researched:** 2026-03-01
**Confidence:** HIGH

## Executive Summary

Edit Factory v10 transforms an existing FastAPI + Next.js localhost tool into a distributable Windows desktop product using a thin Electron shell. The core insight from research is that no business logic changes are required: the existing two-process architecture (FastAPI on :8000, Next.js on :3000) already supports `AUTH_DISABLED=true`, `NEXT_PUBLIC_API_URL` externalization, and `output: "standalone"` in `next.config.ts` — making this primarily a packaging and lifecycle-management problem rather than an application rewrite. The Electron shell acts as a process orchestrator that spawns both services, manages the system tray, handles auto-update, validates the license, and cleans up on quit.

The recommended approach is Electron with `electron-builder` for the NSIS installer and `electron-updater` for auto-update, backed by Lemon Squeezy for license key management and Sentry for opt-in crash reporting. New Python runtime dependencies are minimal: `platformdirs` (AppData path resolution), `sentry-sdk[fastapi]` (crash reporting), and `psutil` (process cleanup on shutdown — not currently in requirements.txt). All license and update API calls reuse the existing `httpx` dependency. The architecture adds approximately 7 new files and modifies 4 existing files; every one of the 14 existing API routers and 13+ services remains unchanged.

The top risks are process lifecycle correctness (orphaned backend processes block port reuse on relaunch), Windows SmartScreen blocking unsigned installers (critical for commercial distribution), and PyInstaller fragility when bundling PyTorch-heavy dependencies. All three have well-documented mitigations: health-check polling before opening the browser, port cleanup on startup/shutdown via `psutil`, deferring code signing until after first sales validation, and shipping a venv copy rather than a PyInstaller bundle for v1. The %APPDATA% config path is the keystone: every desktop-specific feature (license, API keys, crash consent, first-run flag) flows through `%APPDATA%\EditFactory\` and must be established in Phase 1 before any other desktop work.

---

## Key Findings

### Recommended Stack

The existing production stack (FastAPI, Next.js, Supabase, FFmpeg, ElevenLabs, Edge TTS, Gemini) requires zero changes for desktop mode. New capabilities are exclusively in the distribution and lifecycle layer. The architecture research confirmed that `next.config.ts` already sets `output: "standalone"` — the Next.js frontend can be run with bare Node.js via `node .next/standalone/server.js`. The existing `AUTH_DISABLED=true` flag already bypasses all JWT logic, making desktop mode's single-user requirement trivial to satisfy.

**Core new technologies:**
- **Electron 33+**: Process orchestrator shell — spawns FastAPI + Next.js, creates BrowserWindow, system tray, IPC; chosen because `electron-updater` + `electron-builder` together provide a complete NSIS installer and auto-update pipeline with minimal custom code
- **electron-builder**: Produces NSIS installer that bundles FFmpeg, Python venv/dist, Next.js standalone, and configures Start Menu shortcuts and uninstaller; auto-generates `latest.yml` for update channel
- **electron-updater**: Handles delta auto-updates against a static file server (S3 or GitHub Releases); downloads in background, prompts on restart (not mid-session)
- **platformdirs 4.9.2**: Resolves `%APPDATA%\EditFactory\` on Windows; actively maintained fork of abandoned `appdirs`
- **sentry-sdk[fastapi] 2.53.0 + @sentry/nextjs 10.x**: Opt-in crash reporting; FastAPI integration auto-activates; free tier (5,000 errors/month) is sufficient for indie distribution
- **Lemon Squeezy License API (httpx, no new lib)**: Activate/validate/deactivate lifecycle with machine instance tracking; 5% fees vs Gumroad's 10%; handles EU VAT as Merchant of Record
- **psutil**: Process cleanup on launcher shutdown — prevents orphaned backend/frontend processes from blocking ports on next launch (not currently in requirements.txt; must be added explicitly)

**Note on pystray:** `pystray 0.19.5` is the correct choice if a pure-Python launcher is preferred as a v1 alternative to Electron. Electron is recommended for v10 because `electron-updater` + `electron-builder` eliminate custom installer and update-server code.

**Critical version requirements:**
- PyInstaller 6.19.0 (build tool only, not in requirements.txt) — use `--onedir` not `--onefile` to reduce antivirus false-positive rate; only needed if venv-copy approach is insufficient
- Node.js LTS 22.x portable runtime — bundled in installer to run Next.js standalone without a user Node install
- `workers=1` in bundled uvicorn call — multiple workers cause `WinError 10022` asyncio failures in frozen builds

### Expected Features

The feature research identifies a two-tier MVP: features required to ship at all (P1), and features that ship in the first update after installer validation on clean machines (P2).

**Must have (table stakes — P1, launch blockers):**
- %APPDATA% config storage — foundation for all desktop-specific behavior; every other desktop feature depends on it
- DESKTOP_MODE + AUTH_DISABLED env flags — separates desktop behavior from dev with zero code duplication
- Launcher .exe with system tray — starts backend, opens browser, shows tray icon with Open/Quit menu, handles graceful shutdown
- NSIS installer via electron-builder — bundles Python, deps, FFmpeg, Next.js standalone, Node.js portable; produces Start Menu shortcut and uninstaller; registers in Add/Remove Programs
- First-run setup wizard (/setup page) — detects first run via %APPDATA% flag; collects license key (step 1), API keys (step 2, optional except Supabase), crash reporting consent (step 3); writes config.json; marks complete
- License key activation (Lemon Squeezy) — activate on first run, validate on each startup with 7-day offline grace period; stores instance_id in license.json
- Version display — backend `/api/v1/version` endpoint; shown in Settings UI footer

**Should have (differentiators — P2, ship in first update):**
- Auto-update on startup — GitHub Releases or S3 manifest check; notify and download in background; prompt on restart, not mid-session
- Opt-in Sentry crash reporting — consent captured in wizard; DSN injected from config; scrub API keys in `before_send` filter
- Start on login option — opt-in `winreg` Run key in Settings; OFF by default

**Defer (v11+):**
- Portable mode (USB-runnable) — complex relative path edge cases; low demand for heavy video tool
- Code signing certificate — €70-350/year; pursue after 50+ sales if SmartScreen support requests increase
- macOS support — requires entirely separate build pipeline (DMG/Homebrew); out of scope for Windows-first tool
- Delta/patch updates — tufup handles this; full installer download (~100MB) is acceptable for an indie tool

**Anti-features to explicitly avoid:**
- Electron as a framework rewrite (ruled out in PROJECT.md): Next.js standalone + system browser is the established pattern; Electron is only used as the process orchestrator, not to render app UI in a WebView
- PyInstaller single `.exe` bundle: antivirus false-positive rate is too high; use NSIS with electron-builder instead
- Auto-start on Windows boot: OFF by default; opt-in only via Settings
- In-app payment/subscription: sell via Lemon Squeezy website; app receives license key by email

### Architecture Approach

The architecture is a thin wrapper pattern: Electron sits above the unchanged two-process app, injecting environment variables that activate desktop-mode behavior. All differences between desktop and web modes are controlled exclusively by environment variables (`DESKTOP_MODE`, `AUTH_DISABLED`, `APP_DATA_DIR`, `FFMPEG_BINARY`, `NEXT_PUBLIC_DESKTOP_MODE`). The main process orchestrates lifecycle; all business logic stays in FastAPI/Next.js unchanged.

**Major components:**

1. **`electron/main.js`** (NEW) — process orchestrator: spawns FastAPI backend via `child_process.spawn`, spawns Next.js standalone via `node server.js`, health-check polls both before opening BrowserWindow, creates system tray with Open/Quit menu, handles IPC, triggers auto-update check, kills children on quit
2. **`electron/preload.js`** (NEW) — context bridge: exposes only version query, license activation, and external URL open to renderer; `contextIsolation: true` required — no direct Node access from renderer
3. **`electron-builder.yml`** (NEW) — installer config: bundles FFmpeg, Python venv/dist, Next.js standalone, portable Node.js 22.x; NSIS target with Start Menu + desktop shortcuts; publishes `latest.yml` + `.blockmap` for electron-updater
4. **`app/api/desktop_routes.py`** (NEW) — desktop-only FastAPI router: version info, license activate/validate, settings read/write (writes API keys to AppData .env); conditionally registered only when `DESKTOP_MODE=true`
5. **`app/services/license_service.py`** (NEW) — Lemon Squeezy License API wrapper: activate on first run, validate on startup (cached 7 days), offline grace period, `product_id` verification in response
6. **`frontend/src/app/setup/page.tsx`** (NEW) — first-run wizard: 3-step (license key, API keys, crash consent); writes config via desktop_routes; reachable at any time from Settings
7. **`app/config.py`** (MODIFIED, ~10 lines) — add `APP_DATA_DIR`, `FFMPEG_BINARY`, `DESKTOP_MODE` settings; merge AppData .env with project .env via pydantic_settings `env_file` list
8. **`frontend/src/components/auth-provider.tsx` + `middleware.ts`** (MODIFIED, 3-5 lines each) — add `NEXT_PUBLIC_DESKTOP_MODE` bypass to skip Supabase SSR cookie handling in desktop mode

**Build pipeline:** Next.js `npm run build` → Python venv copy (v1) or PyInstaller `--onedir` (v1.1) → FFmpeg binary copy → `electron-builder --win nsis` → produces `EditFactory-Setup-{version}.exe` + `latest.yml` for auto-update.

**Unchanged (verified by direct codebase inspection):** All 14 existing API routers, all 13+ services, `frontend/src/lib/api.ts` (already uses `NEXT_PUBLIC_API_URL`), `frontend/next.config.ts` (already has `output: "standalone"`), all video processing pipeline.

### Critical Pitfalls

1. **Hardcoded relative paths break after installation** — CWD is not the project root when launched from a desktop shortcut; FFmpeg path, log dir, and config all silently resolve to `C:\Windows\System32\` or equivalent. Prevention: establish `APP_BASE_DIR` from `sys._MEIPASS` (frozen) or `Path(__file__).parent.parent` (dev) in Phase 1; audit all `os.path.join`, `Path(...)`, and `open(...)` calls before packaging. Address in Phase 1.

2. **Orphaned backend/frontend processes block port reuse on relaunch** — Windows does not propagate process termination to children; uvicorn workers survive launcher exit; ports 8000 and 3000 remain occupied. Prevention: use `psutil` to `kill_port(8000)` and `kill_port(3000)` at startup (cleanup of previous orphans) and on tray Quit. Add `psutil` to requirements.txt. Address in Phase 1.

3. **Backend not ready when browser opens** — uvicorn and Next.js take 5-15 seconds to initialize; opening the browser immediately shows "site can't be reached"; on first run (deps not compiled) this can be 15-30 seconds. Prevention: poll `GET /api/v1/health` and `GET http://localhost:3000/` with 60-second timeout before calling `win.loadURL()`; show "Starting..." tray tooltip during wait. Address in Phase 1.

4. **Antivirus and SmartScreen block unsigned installer** — PyInstaller bootloader pattern matches known malware signatures; Windows 11 Smart App Control can silently block unsigned executables with no user bypass. Prevention: use `electron-builder` NSIS output (lower false-positive rate); plan for code signing before commercial distribution; include SmartScreen bypass instructions in install docs. Address in Phase 2.

5. **Sentry captures user API keys in stack frame locals** — Sentry Python SDK sends local variable values by default; any crash in config or service init code exposes `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, etc. Prevention: implement `before_send` scrubber that filters known sensitive key names from frame locals; set `send_default_pii=False` explicitly. Address in Phase 5.

6. **WSL-specific paths shipped in the desktop build** — dev environment is WSL; FFmpeg font paths use `/usr/share/fonts/...`; `app/main.py` has WSL-specific PATH injection. Prevention: audit all path-handling code for WSL assumptions in Phase 1; use `DESKTOP_MODE` flag to route to native Windows paths; bundle DejaVu Sans font in installer. Address in Phase 1.

7. **Auto-update cannot replace a running executable on Windows** — Windows file locking prevents overwriting a running .exe in-place; update appears to succeed but version does not change. Prevention: use electron-updater's built-in NSIS update mechanism (it handles this correctly) or the two-process batch-script pattern for custom updaters. Address in Phase 2 (architecture decision before implementation).

---

## Implications for Roadmap

Based on combined research, the build order is fully determined by dependencies. Config and path hardening must precede everything because the Electron shell cannot be tested until the backend resolves paths correctly from AppData. The desktop API routes must exist before the setup wizard can be built. Crash reporting and auto-update are independent of each other and can be parallelized after the core shell works. The installer is last because it can only be validated end-to-end after all features are integrated.

### Phase 1: Desktop Foundation — Config, Paths, and Process Lifecycle

**Rationale:** Every downstream phase depends on correct path resolution and process lifecycle management. Building anything else before this requires reworking it later. This is also where the highest-severity pitfalls live: relative paths (#1), orphaned processes (#2), backend-not-ready (#3), and WSL paths (#6). The %APPDATA% config directory is the keystone — every desktop feature writes to or reads from it.

**Delivers:** Backend starts correctly from AppData paths; launcher correctly starts, waits for health, opens browser, and fully cleans up on quit; `%APPDATA%\EditFactory\` created and writable; `DESKTOP_MODE` flag respected; WSL path assumptions removed from `app/main.py` and `run.py`.

**Addresses:** DESKTOP_MODE + AUTH_DISABLED env flags, %APPDATA% config storage, graceful shutdown (all P1 table stakes)

**Avoids:** Pitfalls 1 (hardcoded paths), 2 (orphaned processes), 3 (backend not ready), 6 (WSL paths)

**Modifies:** `app/config.py` — adds `APP_DATA_DIR`, `FFMPEG_BINARY`, `DESKTOP_MODE` settings with settings-driven FFmpeg PATH injection; `app/main.py` — settings-driven FFmpeg PATH; `run.py` — health endpoint

**New files:** `app/services/license_service.py` (stubbed), AppData directory creation utility

**Research flag:** Standard patterns — pydantic_settings multi-file `env_file` is in official docs. Direct file modifications to known files.

### Phase 2: Electron Shell — Launcher, Tray, and BrowserWindow

**Rationale:** The Electron shell is the core user-facing artifact of v10. It depends on Phase 1 (correct backend paths and health endpoint) and unblocks the setup wizard (which needs Electron IPC running).

**Delivers:** `EditFactory.exe` that spawns backend + frontend, health-checks both with 60-second timeout, opens BrowserWindow at localhost:3000, shows system tray with Open/Quit menu, handles graceful shutdown with port cleanup.

**Addresses:** Launcher .exe with system tray (P1 table stake)

**Avoids:** Pitfall 2 (orphaned processes — psutil port cleanup at startup and quit), Pitfall 7 (update exe lock — use electron-updater NSIS mechanism)

**Uses:** Electron 33+, electron-updater (stub only — no update server yet), electron-builder config scaffolding

**New files:** `electron/main.js`, `electron/preload.js`, `frontend/src/lib/desktop.ts`, `electron/package.json`

**Research flag:** Needs phase-level research for exact `electron-builder` configuration for bundling Python venv alongside Next.js standalone output. The `extraResources` and `files` config for a Python+Node hybrid needs verification on a clean Windows VM before the installer phase.

### Phase 3: Desktop API Routes — Version, License, and Settings Endpoints

**Rationale:** The setup wizard (Phase 4) calls these endpoints. Building the frontend wizard without the backend API would require mocking — better to build the real API first so the wizard develops against actual behavior.

**Delivers:** `app/api/desktop_routes.py` with: `GET /api/v1/desktop/version`, `POST /api/v1/desktop/license/activate`, `POST /api/v1/desktop/license/validate`, `GET /api/v1/desktop/settings`, `POST /api/v1/desktop/settings`, `GET /api/v1/desktop/health`. Full `LicenseService` implementation against Lemon Squeezy API with 7-day validation cache and offline grace period.

**Addresses:** License key activation (P1), version display (P1)

**Avoids:** Pitfall — license checked only at startup (implements periodic 7-day re-validation with offline grace period); verifies `product_id` in Lemon Squeezy response to prevent key sharing from other products

**Uses:** Lemon Squeezy License API via httpx, platformdirs for AppData path, pydantic_settings multi-file env_file merge

**New files:** `app/api/desktop_routes.py`, completes `app/services/license_service.py`

**Research flag:** Standard patterns — new FastAPI router following established pattern (assembly_routes.py, pipeline_routes.py). Lemon Squeezy API endpoints and response schema verified from official docs.

### Phase 4: First-Run Setup Wizard — Frontend /setup Page

**Rationale:** Depends on Phase 3 (API endpoints for license activation and settings write). This is the onboarding UX that gates the entire product — must be built and validated before packaging.

**Delivers:** `frontend/src/app/setup/page.tsx` with 3-step wizard: (1) License key entry with Lemon Squeezy activation, (2) API key configuration (Supabase required, others optional) with inline validation, (3) Crash reporting consent (opt-in, defaults OFF). Auth bypass modifications to `auth-provider.tsx` and `middleware.ts`. First-run detection via %APPDATA% flag. Wizard is reachable from Settings at any time.

**Addresses:** First-run setup wizard (P1 table stake)

**Avoids:** Pitfall — wizard skipped with no recovery path (implements completion flag; re-shows wizard if incomplete on next relaunch; Settings page links back to wizard)

**Modifies:** `frontend/src/components/auth-provider.tsx` (skip Supabase auth when DESKTOP_MODE=true), `frontend/src/lib/supabase/middleware.ts` (skip SSR cookie handling when DESKTOP_MODE=true)

**New files:** `frontend/src/app/setup/page.tsx`

**Research flag:** Standard Next.js multi-step form. Auth bypass changes are 3-5 lines in known files. No phase research needed.

### Phase 5: Crash Reporting — Sentry Integration (Opt-In)

**Rationale:** Independent of the installer; can be tested before packaging. Can run parallel with Phase 4 after Phase 2 (Electron running). Consent must be captured in the wizard (Phase 4) before Sentry is initialized — this dependency makes Phase 4 logically first.

**Delivers:** Opt-in Sentry in both Electron main process (`@sentry/electron/main`) and FastAPI (`sentry-sdk[fastapi]`); consent captured in setup wizard step 3 and Settings toggle; `before_send` scrubber for API keys and file paths; DSN stored in AppData config.

**Addresses:** Opt-in crash reporting (P2 differentiator)

**Avoids:** Pitfall 5 — Sentry captures API keys (implements `before_send` filter with `SENSITIVE_KEYS` set that scrubs frame locals before sending)

**New:** Sentry config additions to `electron/main.js`, `app/main.py`, optional `frontend/sentry.client.config.ts`

**Research flag:** Both `sentry-sdk[fastapi]` and `@sentry/electron` have official first-class integration guides with copy-paste setup. No phase research needed.

### Phase 6: Installer and Packaging — NSIS Installer via electron-builder

**Rationale:** Must come last — can only be validated end-to-end after all features are integrated. This is also the riskiest phase (PyInstaller fragility with PyTorch, NSIS size limits, antivirus detection). The v1 strategy is venv copy (requires Python on user machine, documented as prerequisite) rather than PyInstaller to avoid ML library bundling failures.

**Delivers:** `EditFactory-Setup-{version}.exe` NSIS installer with: Python venv copy (v1) or PyInstaller `--onedir` dist (v1.1), bundled FFmpeg binary, Next.js standalone output, portable Node.js 22.x LTS, Start Menu shortcut, desktop shortcut, Add/Remove Programs entry, uninstaller. `latest.yml` + `.blockmap` for electron-updater auto-update channel. `build.bat` for reproducible builds.

**Addresses:** NSIS installer (P1 table stake), auto-update foundation (P2 differentiator)

**Avoids:** Pitfall 4 (antivirus blocks installer — electron-builder NSIS output has lower false-positive rate; SmartScreen bypass documented in install notes), NSIS 2GB size limit (keep Whisper model weights out of bundle; target bundle <700MB; measure components before scripting), PyInstaller wrong environment (build from clean venv, verify bundle <600MB)

**New files:** `electron-builder.yml`, `build.bat`

**Research flag:** Needs phase-level research for: exact NSIS customization to bundle portable Node.js 22 alongside electron-builder output; SHA256 hash verification in auto-update download flow; update server setup (GitHub Releases vs S3 — decision needed before this phase). Build size validation requires measurement on the actual codebase before scripting.

### Phase Ordering Rationale

- **Foundation first (Phase 1):** Pitfalls 1, 2, 3, and 6 are all addressed in Phase 1 because any work built on top of broken path resolution and process lifecycle must be redone. Research explicitly flags this.
- **Shell before wizard (Phase 2 before Phase 4):** The Electron IPC bridge must be running before the setup wizard can test license activation via IPC. Building the wizard against a stub delays discovery of integration issues.
- **API before UI (Phase 3 before Phase 4):** Standard backend-first discipline. The wizard calls real endpoints and validates real Lemon Squeezy responses — no mocking needed or desired.
- **Sentry after wizard (Phase 5 after Phase 4):** Crash reporting consent must be captured in the wizard before Sentry can be initialized. Initializing Sentry without consent is a privacy violation.
- **Installer last (Phase 6):** The installer bundles everything else. Building it before features are stable wastes packaging cycles and produces misleading test results on clean VMs.

### Research Flags

**Needs phase-level research:**
- **Phase 2 (Electron Shell):** Exact `electron-builder` configuration for bundling a Python venv (not PyInstaller) alongside Next.js standalone. The `extraResources` and `files` config for a Python+Node hybrid needs verification on a clean Windows 11 VM before the installer phase begins.
- **Phase 6 (Installer):** NSIS script customization to include portable Node.js 22 alongside the Python bundle; SHA256 hash verification for the downloaded installer auto-update; update server setup (GitHub Releases vs S3); build size measurement before scripting. pynsist generates a base NSIS script but Node.js bundling requires manual NSIS script extensions.

**Standard patterns (skip research-phase):**
- **Phase 1 (Config/paths):** Directly modifies known files (`app/config.py`, `app/main.py`) with minimal, well-documented changes. pydantic_settings multi-file `env_file` is in official docs.
- **Phase 3 (Desktop API routes):** New FastAPI router with CRUD endpoints and httpx calls to Lemon Squeezy API. All patterns follow established router pattern. Endpoint URLs and response schemas verified from official Lemon Squeezy docs.
- **Phase 4 (Setup wizard):** Standard Next.js multi-step form. Auth bypass changes are 3-5 lines in known files.
- **Phase 5 (Sentry):** Both `sentry-sdk[fastapi]` and `@sentry/electron` have first-class official integration guides with copy-paste setup steps.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified on PyPI/npm (2026-02-14 to 2026-03-01); official docs reviewed for Lemon Squeezy License API endpoints, electron-updater, Sentry FastAPI/Electron integrations; pystray/platformdirs/sentry-sdk all on PyPI with recent releases |
| Features | HIGH | Feature set is well-understood for Windows indie desktop app distribution; Lemon Squeezy vs Gumroad comparison from multiple sources; PyInstaller antivirus issue confirmed by official PyInstaller GitHub and NSIS false-positive documentation |
| Architecture | HIGH | Existing codebase read directly during research; all integration points verified against live files (`auth-provider.tsx`, `next.config.ts`, `middleware.ts`, `app/config.py`, `app/main.py`); Electron + FastAPI hybrid pattern confirmed from production templates |
| Pitfalls | HIGH (process/antivirus/Sentry) / MEDIUM (licensing grace period) | Windows process lifecycle pitfalls documented with reproducible evidence; Sentry key-scrubbing in official docs; licensing offline grace period pattern from community sources with multiple confirming examples |

**Overall confidence:** HIGH

### Gaps to Address

- **Python bundle strategy (v1 vs v1.1):** Research recommends venv copy for v1 (simpler, reliable — but requires Python 3.x on user machine as a documented prerequisite) vs PyInstaller `--onedir` for v1.1 (no user Python required but PyTorch/Silero fragility is LOW confidence). This decision must be made in Phase 6 planning with explicit testing on a clean Windows 11 VM. If Python is required as a prerequisite, the installer must check for it and prompt the user to install it first.

- **Update server hosting:** Research documents GitHub Releases as the simplest option for `electron-updater` (free, zero infrastructure). If the product moves to a private repository, an S3 bucket or dedicated update server is needed. This decision can be deferred to Phase 6 but must be made before that phase begins.

- **Code signing on Windows 11 Smart App Control:** Research recommends deferring code signing (€70-350/year) until 50+ sales trigger SmartScreen support requests. However, Windows 11 Smart App Control (SAC) can silently block unsigned executables on some configurations with no user bypass. Validate the actual block behavior on a fresh Windows 11 VM during Phase 6 to determine if this is a launch blocker or a documentation-only issue.

- **Whisper model first-run download UX:** The existing app downloads Whisper model weights on first TTS use, stalling 3-5 minutes with no progress indicator. Research flags this as a UX pitfall. Whether to pre-download in the first-run wizard (Phase 4) with a progress bar or accept the current behavior needs a decision during roadmap creation — if deferred, a support ticket about "app is frozen" is likely from early users.

---

## Sources

### Primary (HIGH confidence)
- `.planning/research/STACK.md` — PyInstaller 6.19.0, pystray 0.19.5, platformdirs 4.9.2, sentry-sdk 2.53.0, Lemon Squeezy API, Next.js standalone mode, pynsist 2.8, NSIS 3.x — all PyPI/npm/official docs verified 2026-02-14 to 2026-03-01
- `.planning/research/ARCHITECTURE.md` — existing codebase read directly 2026-03-01; Electron + FastAPI pattern with electron-builder NSIS; Lemon Squeezy License API; Sentry Electron + FastAPI integrations — official docs verified
- `.planning/research/FEATURES.md` — feature dependency graph; Lemon Squeezy vs Gumroad comparison; first-run wizard UX pattern; anti-feature rationale
- `.planning/research/PITFALLS.md` — Windows process lifecycle, PyInstaller antivirus, Sentry key scrubbing, orphaned processes, WSL paths, NSIS size limits
- [Lemon Squeezy License API — validate](https://docs.lemonsqueezy.com/api/license-api/validate-license-key) — endpoint URL, response schema, `product_id` verification requirement
- [Sentry FastAPI integration](https://docs.sentry.io/platforms/python/integrations/fastapi/) — `FastApiIntegration`, `StarletteIntegration`, `before_send` scrubbing
- [electron-builder NSIS](https://www.electron.build/nsis.html) — installer config, auto-update channel, `latest.yml` format
- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) — `output: "standalone"`, `server.js` execution pattern
- [platformdirs PyPI](https://pypi.org/project/platformdirs/) — version 4.9.2, official appdirs successor

### Secondary (MEDIUM confidence)
- [pyinstaller-fastapi reference](https://github.com/iancleary/pyinstaller-fastapi) — uvicorn + PyInstaller bundle pattern
- [Lemon Squeezy vs Gumroad 2025](https://ruul.io/blog/lemonsqueezy-vs-gumroad) — fee comparison, license API feature comparison
- [PyInstaller antivirus false positives — GitHub Issue #8164](https://github.com/pyinstaller/pyinstaller/issues/8164) — bootloader pattern as AV trigger
- [Child Processes Not Terminating with Uvicorn — GitHub Discussion #2281](https://github.com/Kludex/uvicorn/discussions/2281) — orphaned child process behavior on Windows
- [Electron + FastAPI desktop pattern](https://medium.com/@shakeef.rakin321/electron-react-fastapi-template-for-cross-platform-desktop-apps-cf31d56c470c) — hybrid Python+Node desktop app template
- [tufup — Python auto-updater](https://github.com/dennisvang/tufup) — considered and rejected as overkill for indie tool

### Tertiary (LOW confidence — needs validation)
- PyInstaller + PyTorch bundling for complex ML deps — multiple community reports of fragility; testing on clean Windows 11 VM is required before committing to this approach for v1.1
- Windows 11 Smart App Control behavior on fresh installs without code signing — block severity varies by machine configuration; must be empirically verified during Phase 6

---
*Research completed: 2026-03-01*
*Ready for roadmap: yes*
