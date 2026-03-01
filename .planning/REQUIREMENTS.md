# Requirements: Edit Factory

**Defined:** 2026-03-01
**Core Value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.

## v10 Requirements

Requirements for v10 Desktop Launcher & Distribution. Each maps to roadmap phases.

### Desktop Foundation

- [ ] **FOUND-01**: App stores config in %APPDATA%\EditFactory\ (config.json, license.json, .env)
- [ ] **FOUND-02**: Backend detects DESKTOP_MODE=true and skips JWT auth, reads config from AppData
- [ ] **FOUND-03**: FFmpeg path resolves bundled binary in desktop mode, falls back to system PATH in dev
- [ ] **FOUND-04**: All file paths use APP_BASE_DIR abstraction (no hardcoded relative paths)

### Electron Shell

- [ ] **SHELL-01**: Electron main process spawns FastAPI backend + Next.js standalone as child processes
- [ ] **SHELL-02**: BrowserWindow opens at localhost:3000 after health-check polling confirms both services ready
- [ ] **SHELL-03**: System tray icon with right-click menu: Open Edit Factory, Quit
- [ ] **SHELL-04**: Graceful shutdown kills child processes and cleans up ports 8000/3000 via psutil
- [ ] **SHELL-05**: Orphaned processes from previous launches cleaned up on startup

### Installer

- [ ] **INST-01**: electron-builder produces NSIS .exe installer for Windows
- [ ] **INST-02**: Installer bundles Python venv, FFmpeg binary, Next.js standalone, portable Node.js 22.x
- [ ] **INST-03**: Installer creates Start Menu shortcut, desktop shortcut, and Add/Remove Programs entry
- [ ] **INST-04**: Uninstaller removes all installed files and shortcuts

### Setup Wizard

- [ ] **WIZD-01**: /setup page detects first run via %APPDATA% flag and redirects new users
- [ ] **WIZD-02**: Step 1: License key entry with Lemon Squeezy activation and success/error feedback
- [ ] **WIZD-03**: Step 2: API key configuration (Supabase required, Gemini/ElevenLabs optional) with test connection
- [ ] **WIZD-04**: Step 3: Crash reporting consent (opt-in, defaults OFF)
- [ ] **WIZD-05**: Wizard writes config to %APPDATA% and marks first_run_complete
- [ ] **WIZD-06**: Wizard re-accessible from Settings page at any time

### Licensing

- [ ] **LICS-01**: License activated via Lemon Squeezy POST /v1/licenses/activate on first run
- [ ] **LICS-02**: License validated via POST /v1/licenses/validate on each startup
- [ ] **LICS-03**: 7-day offline grace period with cached last-successful validation timestamp
- [ ] **LICS-04**: Invalid/expired license blocks app access with re-activation prompt

### Updates & Telemetry

- [ ] **UPDT-01**: electron-updater checks for new version on startup via latest.yml manifest
- [ ] **UPDT-02**: Update downloads in background, prompts user to restart (not mid-session)
- [ ] **UPDT-03**: Sentry crash reporting initialized only when user has opted in
- [ ] **UPDT-04**: before_send filter scrubs API keys from Sentry stack frame locals
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
| FOUND-01 | — | Pending |
| FOUND-02 | — | Pending |
| FOUND-03 | — | Pending |
| FOUND-04 | — | Pending |
| SHELL-01 | — | Pending |
| SHELL-02 | — | Pending |
| SHELL-03 | — | Pending |
| SHELL-04 | — | Pending |
| SHELL-05 | — | Pending |
| INST-01 | — | Pending |
| INST-02 | — | Pending |
| INST-03 | — | Pending |
| INST-04 | — | Pending |
| WIZD-01 | — | Pending |
| WIZD-02 | — | Pending |
| WIZD-03 | — | Pending |
| WIZD-04 | — | Pending |
| WIZD-05 | — | Pending |
| WIZD-06 | — | Pending |
| LICS-01 | — | Pending |
| LICS-02 | — | Pending |
| LICS-03 | — | Pending |
| LICS-04 | — | Pending |
| UPDT-01 | — | Pending |
| UPDT-02 | — | Pending |
| UPDT-03 | — | Pending |
| UPDT-04 | — | Pending |
| UPDT-05 | — | Pending |
| UPDT-06 | — | Pending |

**Coverage:**
- v10 requirements: 29 total
- Mapped to phases: 0
- Unmapped: 29

---
*Requirements defined: 2026-03-01*
*Last updated: 2026-03-01 after initial definition*
