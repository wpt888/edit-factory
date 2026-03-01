# Requirements: Edit Factory

**Defined:** 2026-03-01
**Core Value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.

## v10 Requirements

Requirements for v10 Desktop Launcher & Distribution. Each maps to roadmap phases.

### Desktop Foundation

- [x] **FOUND-01**: App stores config in %APPDATA%\EditFactory\ (config.json, license.json, .env)
- [x] **FOUND-02**: Backend detects DESKTOP_MODE=true and skips JWT auth, reads config from AppData
- [ ] **FOUND-03**: FFmpeg path resolves bundled binary in desktop mode, falls back to system PATH in dev
- [x] **FOUND-04**: All file paths use APP_BASE_DIR abstraction (no hardcoded relative paths)

### Electron Shell

- [x] **SHELL-01**: Electron main process spawns FastAPI backend + Next.js standalone as child processes
- [x] **SHELL-02**: BrowserWindow opens at localhost:3000 after health-check polling confirms both services ready
- [x] **SHELL-03**: System tray icon with right-click menu: Open Edit Factory, Quit
- [x] **SHELL-04**: Graceful shutdown kills child processes and cleans up ports 8000/3000 via psutil
- [x] **SHELL-05**: Orphaned processes from previous launches cleaned up on startup

### Installer

- [x] **INST-01**: electron-builder produces NSIS .exe installer for Windows
- [ ] **INST-02**: Installer bundles Python venv, FFmpeg binary, Next.js standalone, portable Node.js 22.x
- [x] **INST-03**: Installer creates Start Menu shortcut, desktop shortcut, and Add/Remove Programs entry
- [x] **INST-04**: Uninstaller removes all installed files and shortcuts

### Setup Wizard

- [ ] **WIZD-01**: /setup page detects first run via %APPDATA% flag and redirects new users
- [ ] **WIZD-02**: Step 1: License key entry with Lemon Squeezy activation and success/error feedback
- [ ] **WIZD-03**: Step 2: API key configuration (Supabase required, Gemini/ElevenLabs optional) with test connection
- [ ] **WIZD-04**: Step 3: Crash reporting consent (opt-in, defaults OFF)
- [x] **WIZD-05**: Wizard writes config to %APPDATA% and marks first_run_complete
- [ ] **WIZD-06**: Wizard re-accessible from Settings page at any time

### Licensing

- [x] **LICS-01**: License activated via Lemon Squeezy POST /v1/licenses/activate on first run
- [x] **LICS-02**: License validated via POST /v1/licenses/validate on each startup
- [x] **LICS-03**: 7-day offline grace period with cached last-successful validation timestamp
- [x] **LICS-04**: Invalid/expired license blocks app access with re-activation prompt

### Updates & Telemetry

- [x] **UPDT-01**: electron-updater checks for new version on startup via latest.yml manifest
- [x] **UPDT-02**: Update downloads in background, prompts user to restart (not mid-session)
- [x] **UPDT-03**: Sentry crash reporting initialized only when user has opted in
- [x] **UPDT-04**: before_send filter scrubs API keys from Sentry stack frame locals
- [ ] **UPDT-05**: Backend GET /api/v1/desktop/version returns current version number
- [ ] **UPDT-06**: Version displayed in Settings page footer

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Distribution

- **DIST-01**: macOS DMG/Homebrew installer
- **DIST-02**: Code signing certificate for Windows SmartScreen reputation
- **DIST-03**: Portable mode (USB-runnable, no installation)
- **DIST-04**: Delta/patch updates (tufup-based)

### Tier Enforcement

- **TIER-01**: Starter vs Pro feature gating based on license tier
- **TIER-02**: Start on login option via winreg Run key

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| PyInstaller single .exe bundle | Antivirus false positives, PyTorch bundling fragility |
| Electron as UI renderer (WebView) | App already runs in browser; Electron is process orchestrator only |
| In-app payment/subscription | Sell via Lemon Squeezy website; app receives license key |
| Auto-start on Windows boot (default ON) | Heavy video tool should not auto-start; defer opt-in to future |
| Offline-only license validation | App requires Supabase (internet); grace period is sufficient |
| macOS build (v10) | Separate build pipeline; Windows-first |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 47 → Phase 53 | Complete |
| FOUND-02 | Phase 47 | Complete |
| FOUND-03 | Phase 47 → Phase 53 | Pending |
| FOUND-04 | Phase 47 | Complete |
| SHELL-01 | Phase 48 | Complete |
| SHELL-02 | Phase 48 | Complete |
| SHELL-03 | Phase 48 | Complete |
| SHELL-04 | Phase 48 | Complete |
| SHELL-05 | Phase 48 | Complete |
| INST-01 | Phase 52 | Complete |
| INST-02 | Phase 52 → Phase 53 | Pending |
| INST-03 | Phase 52 | Complete |
| INST-04 | Phase 52 | Complete |
| WIZD-01 | Phase 50 → Phase 53 | Pending |
| WIZD-02 | Phase 50 → Phase 53 | Pending |
| WIZD-03 | Phase 50 → Phase 53 | Pending |
| WIZD-04 | Phase 50 → Phase 53 | Pending |
| WIZD-05 | Phase 50 → Phase 53 | Complete |
| WIZD-06 | Phase 50 → Phase 53 | Pending |
| LICS-01 | Phase 49 | Complete |
| LICS-02 | Phase 49 | Complete |
| LICS-03 | Phase 49 | Complete |
| LICS-04 | Phase 49 | Complete |
| UPDT-01 | Phase 52 | Complete |
| UPDT-02 | Phase 52 | Complete |
| UPDT-03 | Phase 51 | Complete |
| UPDT-04 | Phase 51 | Complete |
| UPDT-05 | Phase 49 → Phase 53 | Pending |
| UPDT-06 | Phase 49 → Phase 53 | Pending |

**Coverage:**
- v10 requirements: 29 total
- Satisfied: 19
- Pending (gap closure Phase 53): 10 (FOUND-01, FOUND-03, INST-02, WIZD-01-06, UPDT-05, UPDT-06)
- Unmapped: 0

---
*Requirements defined: 2026-03-01*
*Last updated: 2026-03-01 after gap closure phase 53 added*
