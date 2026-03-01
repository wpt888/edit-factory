# Architecture Patterns: Desktop Launcher & Distribution

**Domain:** Hybrid desktop distribution of an existing FastAPI + Next.js web app
**Researched:** 2026-03-01
**Confidence:** HIGH (existing codebase examined directly; integration points verified against live files)
**Milestone:** v10 Desktop Launcher & Distribution

---

## Executive Summary

v10 does not change the rendering pipeline or any business logic. It wraps the existing two-process architecture (FastAPI on :8000 + Next.js on :3000) in a thin Electron shell that handles lifecycle management, system tray, auto-update, license validation, and crash reporting.

The codebase already has three features that make this migration almost free: `AUTH_DISABLED=true` bypasses all JWT logic, `NEXT_PUBLIC_API_URL` externalizes the backend URL, and `next.config.ts` already sets `output: "standalone"` for self-contained deployment. The existing `start-dev.bat` is effectively a manual prototype of what Electron's main process will do automatically.

New components cluster in four isolated zones: (1) the Electron shell (~5 new files), (2) `app/config.py` path changes (~10 lines), (3) a new `app/api/desktop_routes.py` for version/license/settings endpoints (~100 lines), and (4) a new `/setup` Next.js page for the first-run wizard (~150 lines). Nothing in the video processing pipeline, services layer, or 14 existing API routers requires modification.

---

## System Architecture: Before and After

### Before (Development / Web Mode)

```
start-dev.bat
├── cmd /c "python run.py" → uvicorn :8000
│     └── app.main:app (FastAPI)
│           ├── 14 API routers
│           └── Background video processing
└── cmd /c "npm run dev" → Next.js :3000
      └── Browser opened manually
```

### After (Desktop Mode)

```
EditFactory.exe (Electron shell)
├── main.js (Electron main process)
│   ├── Spawns: python backend/run.py (via child_process.spawn)
│   │     → uvicorn :8000 (same FastAPI app, unchanged)
│   ├── Spawns: node frontend/server.js (next start :3000)
│   ├── Creates: BrowserWindow → http://localhost:3000
│   ├── Creates: Tray icon → show/hide/quit
│   ├── Manages: auto-update checks (electron-updater)
│   └── Manages: IPC channels for license/settings from renderer
├── preload.js (Electron preload — context bridge)
│   └── Exposes safe APIs to renderer (no direct Node access)
└── Resources (bundled by electron-builder)
    ├── ffmpeg/bin/ffmpeg.exe
    ├── python-dist/ (PyInstaller or embedded venv)
    └── models/ (Silero VAD weights, pre-downloaded)
```

---

## Component Boundaries

| Component | Responsibility | New vs Existing | Key Files |
|-----------|---------------|-----------------|-----------|
| Electron main process | Spawn backend+frontend, tray, IPC, auto-update | **NEW** | `electron/main.js` |
| Electron preload | Context bridge to expose safe IPC to renderer | **NEW** | `electron/preload.js` |
| electron-builder config | NSIS installer packaging, resource bundling, update channel | **NEW** | `electron-builder.yml` or `package.json` build key |
| `app/config.py` | Path resolution (AppData, bundled FFmpeg, .env.desktop) | **MODIFIED** (~10 lines) | `app/config.py` |
| `app/api/desktop_routes.py` | Version check, license activation/validation, app settings r/w | **NEW** | `app/api/desktop_routes.py` |
| `app/api/auth.py` | Auth bypass for desktop mode — already implemented | **UNCHANGED** | `app/api/auth.py` |
| `/setup` Next.js page | First-run wizard: API key entry, license activation | **NEW** | `frontend/src/app/setup/page.tsx` |
| `frontend/src/lib/desktop.ts` | Detect desktop mode, IPC bridge helpers | **NEW** | `frontend/src/lib/desktop.ts` |
| Frontend auth flow | Remove SSR middleware (cookie-based) — use client-side only | **MODIFIED** (3 files) | `middleware.ts`, `auth-provider.tsx`, `auth/callback/route.ts` |
| License validation service | Lemon Squeezy API calls, instance ID persistence | **NEW** | `app/services/license_service.py` |
| Crash reporting | Sentry SDK in both Electron (JS) and FastAPI (Python) | **NEW** | `electron/main.js`, `app/main.py` |
| Auto-updater | electron-updater, check on startup, download in background | **NEW** | `electron/updater.js` or inline in `main.js` |
| AppData config | `%APPDATA%/EditFactory/.env` — user API keys, license key | **NEW** | Read by `app/config.py` + Electron setup wizard |

---

## Data Flow: Desktop Startup Sequence

```
1. USER LAUNCHES EditFactory.exe
   Electron main process starts

2. CHECK LICENSE (first launch only)
   Read %APPDATA%/EditFactory/license.json
   If missing → show /setup page before anything else
   If present → validate via Lemon Squeezy API (non-blocking)

3. SPAWN BACKEND
   child_process.spawn(pythonExe, ['run.py'], {
     env: { ...process.env, ...loadAppDataEnv() },
     cwd: backendDir
   })
   Wait for HTTP health check: GET http://localhost:8000/
   Timeout: 30s, retry every 500ms

4. SPAWN FRONTEND
   child_process.spawn(nodeExe, ['server.js'], {
     cwd: frontendStandaloneDir,
     env: { PORT: 3000, NEXT_PUBLIC_API_URL: 'http://localhost:8000/api/v1' }
   })
   Wait for HTTP health check: GET http://localhost:3000/
   Timeout: 30s, retry every 500ms

5. OPEN BROWSER WINDOW
   new BrowserWindow({ width: 1400, height: 900 })
   win.loadURL('http://localhost:3000')

   SKIP /login if AUTH_DISABLED=true (desktop default)
   → Redirect directly to /librarie

6. SETUP SYSTEM TRAY
   Tray icon with menu: Show/Hide, Quit

7. CHECK FOR UPDATES (background, non-blocking)
   autoUpdater.checkForUpdatesAndNotify()
   → Downloads update silently
   → Prompts user to restart when ready

8. APP RUNNING
   All 14 existing API routers serve normally
   Frontend operates identically to web mode
```

---

## Integration Points: Existing Code Changes

### 1. `app/config.py` — Path Resolution (MODIFIED)

The only required backend change. Currently paths are hardcoded relative to `__file__`. Desktop mode needs `%APPDATA%/EditFactory/` for user data and bundled FFmpeg path from Electron resources.

```python
# CURRENT (development only)
_BASE_DIR = Path(__file__).parent.parent
input_dir: Path = _BASE_DIR / "input"
output_dir: Path = _BASE_DIR / "output"

# AFTER — desktop-aware
import os, sys
from pathlib import Path

def _get_app_data_dir() -> Path:
    """Returns %APPDATA%/EditFactory on Windows, ~/Library/Application Support/EditFactory on Mac."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home()))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "EditFactory"

_APP_DATA_DIR = Path(os.environ.get("APP_DATA_DIR", "")) or _get_app_data_dir()
_BASE_DIR = Path(__file__).parent.parent

class Settings(BaseSettings):
    # existing fields unchanged...

    # NEW: Override paths for desktop mode
    input_dir: Path = _APP_DATA_DIR / "input"       # Default: AppData
    output_dir: Path = _APP_DATA_DIR / "output"     # Default: AppData
    logs_dir: Path = _APP_DATA_DIR / "logs"         # Default: AppData

    # NEW: Bundled FFmpeg override (set by Electron via env var)
    ffmpeg_binary: str = ""  # If set, prepended to PATH by main.py

    class Config:
        env_file = [".env", str(_APP_DATA_DIR / ".env")]  # Merge: project .env + AppData .env
        env_file_encoding = "utf-8"
```

`app/main.py` change (3 lines): replace hardcoded FFmpeg PATH logic with settings-driven:

```python
# CURRENT (hardcoded Windows path)
_ffmpeg_bin = Path(__file__).parent.parent / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin"
if _ffmpeg_bin.exists():
    os.environ['PATH'] = str(_ffmpeg_bin) + os.pathsep + os.environ.get('PATH', '')

# AFTER (settings-driven, supports both bundled and system FFmpeg)
settings = get_settings()
if settings.ffmpeg_binary:
    # Desktop mode: Electron sets FFMPEG_BINARY to bundled path
    _ffmpeg_dir = Path(settings.ffmpeg_binary).parent
    os.environ['PATH'] = str(_ffmpeg_dir) + os.pathsep + os.environ.get('PATH', '')
else:
    # Development fallback: existing hardcoded search
    _ffmpeg_bin = Path(__file__).parent.parent / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin"
    if _ffmpeg_bin.exists():
        os.environ['PATH'] = str(_ffmpeg_bin) + os.pathsep + os.environ.get('PATH', '')
```

### 2. `app/api/auth.py` — No Changes Needed

`AUTH_DISABLED=true` already short-circuits all auth and returns a hardcoded dev user. Desktop mode sets this flag by default via AppData `.env`. The existing implementation is correct and sufficient.

### 3. Frontend Auth — SSR Middleware Removal (MODIFIED, 3 files)

The Next.js SSR auth middleware (`@supabase/ssr` cookie handling) creates a problem in desktop mode: there's no HTTPS, no real cookie domain, and no auth to manage anyway. Three files need minor changes:

**`frontend/src/lib/supabase/middleware.ts`** — make the `updateSession` function a no-op when `DESKTOP_MODE=true`:

```typescript
// Add desktop mode check
export async function updateSession(request: NextRequest) {
  if (process.env.DESKTOP_MODE === 'true') {
    return NextResponse.next({ request });  // Pass through, no cookie management
  }
  // ... existing implementation unchanged
}
```

**`frontend/src/components/auth-provider.tsx`** — add desktop bypass:

```typescript
export function AuthProvider({ children }: AuthProviderProps) {
  const isDesktop = process.env.NEXT_PUBLIC_DESKTOP_MODE === 'true';

  // Desktop mode: skip Supabase auth entirely, render children immediately
  if (isDesktop) {
    return <>{children}</>;
  }

  // ... existing implementation unchanged
}
```

**`frontend/src/app/auth/callback/route.ts`** — not reached in desktop mode (no OAuth flow); no change needed but can be left as-is.

### 4. Frontend API Client — No Changes Needed

`frontend/src/lib/api.ts` already uses `NEXT_PUBLIC_API_URL` environment variable. Electron sets this to `http://localhost:8000/api/v1` for desktop builds. The client code is already correct.

---

## New Components to Build

### Component 1: `electron/main.js` (NEW)

The process orchestrator. Responsibilities: spawn backend, spawn frontend, create BrowserWindow, system tray, IPC handlers.

```javascript
// Structure outline — not production code
const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const path = require('path');

let backendProcess = null;
let frontendProcess = null;
let mainWindow = null;
let tray = null;

async function spawnBackend() {
  const pythonExe = getPythonExecutable();  // resolved from resources/
  const ffmpegBin = path.join(process.resourcesPath, 'ffmpeg', 'bin', 'ffmpeg.exe');

  backendProcess = spawn(pythonExe, ['run.py'], {
    cwd: getBackendDir(),
    env: {
      ...process.env,
      AUTH_DISABLED: 'true',
      DESKTOP_MODE: 'true',
      APP_DATA_DIR: app.getPath('userData'),
      FFMPEG_BINARY: ffmpegBin,
    }
  });

  await waitForPort(8000, 30000);  // Poll until healthy
}

async function spawnFrontend() {
  frontendProcess = spawn(process.execPath, ['server.js'], {
    cwd: getFrontendStandaloneDir(),
    env: {
      ...process.env,
      PORT: '3000',
      NEXT_PUBLIC_API_URL: 'http://localhost:8000/api/v1',
      NEXT_PUBLIC_DESKTOP_MODE: 'true',
    }
  });

  await waitForPort(3000, 30000);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  mainWindow.loadURL('http://localhost:3000');
}

function setupTray() {
  tray = new Tray(path.join(__dirname, 'icon.png'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open', click: () => mainWindow?.show() },
    { label: 'Quit', click: () => { app.quit(); } }
  ]));
  tray.on('click', () => mainWindow?.show());
}

app.whenReady().then(async () => {
  await spawnBackend();
  await spawnFrontend();
  await createWindow();
  setupTray();
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('before-quit', () => {
  backendProcess?.kill();
  frontendProcess?.kill();
});
```

### Component 2: `electron/preload.js` (NEW)

Context bridge. Exposes only what the renderer needs: IPC for license validation and app info. No direct Node.js access from renderer.

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkLicense: (key) => ipcRenderer.invoke('check-license', key),
  activateLicense: (key) => ipcRenderer.invoke('activate-license', key),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external', url),
});
```

### Component 3: `app/api/desktop_routes.py` (NEW)

New FastAPI router. Provides endpoints the frontend needs that are specific to desktop mode: version info, license status, settings r/w for AppData `.env`.

```python
# Endpoints:
# GET  /api/v1/desktop/version   → { app_version, update_available, latest_version }
# GET  /api/v1/desktop/license   → { valid, key_hint, tier, expires_at }
# POST /api/v1/desktop/license/activate   → { valid, instance_id, tier }
# GET  /api/v1/desktop/settings  → { gemini_api_key_hint, elevenlabs_api_key_hint, ... }
# POST /api/v1/desktop/settings  → write API keys to AppData .env
# GET  /api/v1/desktop/health    → { backend: ok, ffmpeg: ok, appdata_writable: ok }
```

This router is registered in `app/main.py` only when `DESKTOP_MODE=true`:

```python
if settings.desktop_mode:
    from app.api.desktop_routes import router as desktop_router
    app.include_router(desktop_router, prefix="/api/v1", tags=["Desktop"])
```

### Component 4: `app/services/license_service.py` (NEW)

Thin wrapper around Lemon Squeezy License API. Handles activation and periodic validation. Persists `instance_id` to AppData.

```python
# Lemon Squeezy License API:
# POST https://api.lemonsqueezy.com/v1/licenses/activate
#   Body: license_key, instance_name (e.g., "Windows-{machine-id}")
#   Response: { activated: bool, instance: { id: str } }
#
# POST https://api.lemonsqueezy.com/v1/licenses/validate
#   Body: license_key, instance_id
#   Response: { valid: bool, license_key: { status, activation_limit }, meta: { product_id } }
#
# POST https://api.lemonsqueezy.com/v1/licenses/deactivate
#   Body: license_key, instance_id

class LicenseService:
    LICENSE_CACHE_FILE = "license.json"   # in APP_DATA_DIR
    PRODUCT_ID = "..."                     # hardcoded, verify in validate() response

    def activate(self, license_key: str) -> dict:
        """First-time activation. Stores instance_id locally."""
        ...

    def validate(self) -> dict:
        """Periodic validation using stored license_key + instance_id."""
        ...

    def get_status(self) -> dict:
        """Returns cached license status (no network call)."""
        ...
```

Key design: validate() is called once on startup and cached. The app does not validate on every request — that would break offline usage. The license file contains: `{ license_key, instance_id, tier, last_validated_at, valid }`. If last_validated_at < 7 days ago, re-validate in background.

### Component 5: `/setup` Next.js Page (NEW)

First-run wizard shown when no AppData `.env` exists or license is not activated.

```
frontend/src/app/setup/page.tsx

Step 1: License Activation
  - Input: license key
  - Button: Activate → POST /api/v1/desktop/license/activate
  - Success: green checkmark, store key
  - Buy link for users without a key

Step 2: API Keys (optional, can skip)
  - ElevenLabs API Key (with link to ElevenLabs dashboard)
  - Gemini API Key (with link to Google AI Studio)
  - Anthropic API Key (optional, for Claude scripts)
  - Submit → POST /api/v1/desktop/settings
  - Note: "Edge TTS (free) works without any API keys"

Step 3: Done
  - "Setup complete" → redirect to /librarie
```

The setup page is reachable at any time from Settings page, not only first-run.

### Component 6: `electron-builder.yml` (NEW)

Build configuration for packaging. Produces NSIS installer with auto-update support.

```yaml
appId: ro.obsid.editfactory
productName: Edit Factory
directories:
  output: dist

files:
  - electron/**
  - frontend/.next/standalone/**    # Next.js standalone build
  - app/**                          # Python source (for venv mode)
  - run.py

extraResources:
  - from: ffmpeg/ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe
    to: ffmpeg/bin/ffmpeg.exe
  - from: python-dist/              # PyInstaller output or venv
    to: python-dist/

win:
  target: nsis
  icon: electron/icon.ico

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true

publish:
  provider: generic
  url: https://updates.editfactory.ro/releases/   # or S3/GitHub Releases

autoUpdater:
  allowDowngrade: false
```

### Component 7: `frontend/src/lib/desktop.ts` (NEW)

Utility to detect desktop mode and safely call `window.electronAPI`:

```typescript
export const isDesktop = () =>
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_DESKTOP_MODE === 'true';

export const getElectronAPI = () =>
  isDesktop() ? (window as Window & { electronAPI?: ElectronAPI }).electronAPI : null;

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  checkLicense: (key: string) => Promise<LicenseStatus>;
  activateLicense: (key: string) => Promise<LicenseActivation>;
  openExternalUrl: (url: string) => Promise<void>;
}
```

This prevents any import from crashing in web mode where `window.electronAPI` is undefined.

---

## Auto-Update Flow

```
Startup (background, non-blocking)
  autoUpdater.checkForUpdatesAndNotify()
  → Fetches https://updates.editfactory.ro/releases/latest.yml
  → Compares current version to latest

If update available:
  → Downloads update silently in background (delta update if NSIS)
  → Shows system notification: "Update downloaded. Restart to apply."
  → User can defer; update applied on next app restart

On restart:
  → NSIS installer replaces app files
  → New version launches

Update server:
  → Simple static file host (S3 bucket or GitHub Releases)
  → Files: latest.yml (metadata), EditFactory-Setup-{version}.exe, EditFactory-Setup-{version}.exe.blockmap
  → electron-builder publishes these automatically on build
```

---

## License Validation Flow

```
First launch (no license stored):
  → Show /setup wizard, Step 1
  → User enters key → POST /api/v1/desktop/license/activate
    → LicenseService calls:
        POST https://api.lemonsqueezy.com/v1/licenses/activate
        { license_key: key, instance_name: "Windows-{machine-id}" }
    → Store { license_key, instance_id, tier, activated_at } in AppData/license.json
  → Success: proceed to Step 2 (API keys) or /librarie

Subsequent launches (license stored):
  → Read AppData/license.json (instant, no network)
  → If last_validated_at > 7 days: validate in background
    → POST https://api.lemonsqueezy.com/v1/licenses/validate
        { license_key, instance_id }
    → { valid: true } → update last_validated_at
    → { valid: false } → show warning banner (not hard block)
  → App starts normally regardless of background validation result
    (prevents lockout if Lemon Squeezy is down)

Tier enforcement (optional for v1):
  → meta.product_id or meta.variant_id in validate response maps to tier
  → Starter: no ElevenLabs/Gemini API key required, core features only
  → Pro: all features unlocked

Grace period: 7-day offline grace after last successful validation
```

---

## Crash Reporting Flow

Two separate Sentry integrations run independently:

### Electron Side (JavaScript)

```javascript
// electron/main.js — initialize as early as possible
const Sentry = require('@sentry/electron/main');
Sentry.init({
  dsn: 'https://...@sentry.io/...',
  release: app.getVersion(),
  environment: 'production',
  // Native crash dumps via Electron's crashReporter
  // Main process JS errors
  // Renderer process errors (via IPC)
});
```

### FastAPI Side (Python)

```python
# app/main.py — add after imports, before app creation
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

if os.environ.get('SENTRY_DSN') and not os.environ.get('SENTRY_DISABLED'):
    sentry_sdk.init(
        dsn=os.environ['SENTRY_DSN'],
        integrations=[FastApiIntegration()],
        traces_sample_rate=0.1,    # Low, video processing is long-lived
        environment='desktop',
        release=os.environ.get('APP_VERSION', '1.0.0'),
    )
```

Both use the same Sentry project DSN. Opt-in: controlled by `SENTRY_DSN` env var. If not set, no telemetry. User can disable via Settings page toggle that removes `SENTRY_DSN` from AppData `.env`.

---

## Environment Configuration: Web vs Desktop

The same codebase runs in both modes. All differences are environment variables.

| Variable | Web/Dev | Desktop |
|----------|---------|---------|
| `AUTH_DISABLED` | `false` | `true` |
| `DESKTOP_MODE` | (unset) | `true` |
| `APP_DATA_DIR` | (unset, uses relative paths) | `%APPDATA%/EditFactory` |
| `FFMPEG_BINARY` | (unset, PATH search) | `/resources/ffmpeg/bin/ffmpeg.exe` |
| `ALLOWED_ORIGINS` | `https://editai.obsid.ro` | `http://localhost:3000` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api/v1` | `http://localhost:8000/api/v1` |
| `NEXT_PUBLIC_DESKTOP_MODE` | (unset) | `true` |
| `SENTRY_DSN` | (opt-in) | (set on build) |
| Supabase URLs | cloud | cloud (same, desktop v1 keeps cloud DB) |
| API keys | project `.env` | AppData `.env` (user-managed via setup wizard) |

---

## Build Pipeline

```
Build sequence for producing EditFactory-Setup-{version}.exe:

1. Build Next.js standalone
   cd frontend && npm run build
   Output: frontend/.next/standalone/

2. Build Python backend
   Option A (venv): Copy venv/ into resources, set PYTHON_EXE to venv/Scripts/python.exe
   Option B (PyInstaller): pyinstaller run.py --onedir --name editfactory-backend
   Output: dist/editfactory-backend/ (option B)

   Recommendation for v1: Option A (venv copy) — avoids PyInstaller + PyTorch fragility.
   Recommendation for shipping: Option B — no Python install required on end-user machine.

3. Bundle FFmpeg
   Copy ffmpeg/ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe
   into electron/resources/ffmpeg/bin/ffmpeg.exe

4. Build Electron package
   cd electron && electron-builder --win nsis
   Output: dist/EditFactory-Setup-{version}.exe
          dist/latest.yml
          dist/EditFactory-Setup-{version}.exe.blockmap

5. Publish update metadata
   Upload latest.yml + .exe + .blockmap to S3 or GitHub Releases
   (electron-builder publish --win does this automatically if configured)
```

---

## File Change Map

### New Files

```
electron/
  main.js                    # Process orchestrator, lifecycle, tray, IPC
  preload.js                 # Context bridge (safe renderer APIs)
  updater.js                 # Auto-update logic (or inline in main.js)
  icon.ico                   # App icon (Windows tray + installer)
  package.json               # Electron entry point, electron-builder config

app/api/
  desktop_routes.py          # Version, license, settings endpoints

app/services/
  license_service.py         # Lemon Squeezy API wrapper

frontend/src/app/
  setup/
    page.tsx                 # First-run wizard (license + API keys)

frontend/src/lib/
  desktop.ts                 # isDesktop(), getElectronAPI() utilities
```

### Modified Files

```
app/config.py                # Add APP_DATA_DIR, FFMPEG_BINARY, DESKTOP_MODE settings
app/main.py                  # Use settings.ffmpeg_binary; register desktop_routes conditionally; Sentry init
frontend/src/lib/supabase/middleware.ts   # Skip SSR cookies when DESKTOP_MODE=true
frontend/src/components/auth-provider.tsx # Skip Supabase auth when DESKTOP_MODE=true
```

### Unchanged Files (verified)

```
All 14 existing API routers (routes.py, library_routes.py, pipeline_routes.py, etc.)
All 13+ services (assembly_service.py, gemini_analyzer.py, etc.)
frontend/src/lib/api.ts         (already uses NEXT_PUBLIC_API_URL)
frontend/src/app/settings/page.tsx (extend in future; no change for v1)
frontend/next.config.ts         (already has output: "standalone")
```

---

## Build Order for Phases

Dependencies drive order: Electron shell can't be tested until backend starts correctly; license UI can't be built until the API endpoint exists; auto-update can't be validated until packaging works.

```
Phase 1: Config & Path Hardening (unblocks everything)
  - Modify app/config.py (APP_DATA_DIR, FFMPEG_BINARY, DESKTOP_MODE)
  - Modify app/main.py (settings-driven FFmpeg PATH)
  - Add app/services/license_service.py (can be stubbed initially)
  - Create %APPDATA%/EditFactory/ + .env template

  Validates: backend starts correctly from AppData paths
  Unblocks: Phase 2 (Electron needs this to work), Phase 3 (API needs settings)

Phase 2: Electron Shell (core launcher)
  - Create electron/main.js (spawn + window + tray)
  - Create electron/preload.js
  - Integrate electron-updater (just checkForUpdatesAndNotify, no server yet)
  - Test: app launches, backend + frontend both healthy, tray works

  Depends on: Phase 1 (correct paths in backend)
  Unblocks: Phase 4 (setup wizard needs Electron IPC running)

Phase 3: Desktop API Routes
  - Create app/api/desktop_routes.py (version, license, settings, health)
  - Register in app/main.py when DESKTOP_MODE=true
  - Wire LicenseService → Lemon Squeezy activate/validate

  Depends on: Phase 1 (DESKTOP_MODE flag in settings)
  Unblocks: Phase 4 (setup wizard calls these endpoints)

Phase 4: First-Run Setup Wizard
  - Create frontend/src/app/setup/page.tsx
  - Create frontend/src/lib/desktop.ts
  - Modify auth-provider.tsx (skip auth in desktop mode)
  - Modify supabase/middleware.ts (skip SSR cookies in desktop mode)

  Depends on: Phase 3 (API endpoints for license activation)
  Unblocks: Phase 5 (user flow is complete before packaging)

Phase 5: Crash Reporting
  - Add Sentry to electron/main.js
  - Add sentry_sdk.init to app/main.py (gated on SENTRY_DSN)
  - Add opt-in toggle to Settings page

  Depends on: Phase 2 (Electron running)
  Can be parallel with Phase 4

Phase 6: Installer & Packaging
  - Create electron-builder.yml
  - Build Next.js standalone
  - Bundle venv (option A) or PyInstaller (option B)
  - Bundle FFmpeg into resources/
  - Test full installer: fresh Windows machine
  - Configure update server (S3 or GitHub Releases)

  Depends on: Phases 1-5 all working
  Final phase — validates entire system end-to-end
```

---

## Scalability Considerations

This is a single-user desktop app. Scalability concerns are different from server apps.

| Concern | At launch (1 user) | Future (multi-seat license) |
|---------|-------------------|----------------------------|
| License activations | 1 machine per key default | Increase activation_limit in Lemon Squeezy |
| Update distribution | S3/GitHub, low bandwidth | Same — each machine pulls independently |
| Crash report volume | Low | Filter noise in Sentry by user count |
| SQLite vs Supabase | Supabase (cloud, requires internet) | SQLite offline mode is v2 feature |
| Python bundle size | 500MB-2GB with PyTorch | Slim installer + component download on first run |

---

## Known Complexity Points

### PyInstaller + PyTorch

The most fragile part of the entire build. PyTorch includes C extensions, CUDA DLLs, and large model weights. PyInstaller struggles with dynamic imports common in ML libraries.

Mitigation strategy:

1. For v1: Ship with venv copy (simpler, reliable). Requires Python 3.x on user machine — document this. Installer can check and prompt.
2. For v1.1 (polished release): PyInstaller with `--collect-all torch` and hook files. Test on a clean VM.
3. Alternative: Download PyTorch/Silero on first launch, not bundled. Backend checks if model exists; falls back to no-VAD mode silently (already implemented via `SILERO_AVAILABLE`).

### Next.js Standalone Mode

`output: "standalone"` is already enabled in `next.config.ts`. The standalone build produces `frontend/.next/standalone/server.js` that can be run with bare Node.js (`node server.js`). Electron spawns this directly — no `npm` required on user machine.

Caveat: public assets (images, fonts) must be copied from `frontend/public/` into `frontend/.next/standalone/public/`. The `next build` output does not include them automatically.

### Windows Path Separators

FastAPI receives file paths as strings. When `APP_DATA_DIR` is `C:\Users\...\AppData`, Python must handle backslash paths. `pathlib.Path` normalizes this correctly — all path operations in `config.py` already use `Path()` objects. New code must not use string concatenation for paths.

### Port Conflicts

Existing `start-dev.bat` already handles port conflict detection. Electron must do the same: if :8000 or :3000 are in use at launch, show an error dialog rather than silently failing. `waitForPort()` in main.js should surface this clearly.

---

## Patterns to Follow

### Pattern: Config-First Mode Detection

All behavior differences between desktop and web are controlled by environment variables read at startup, not by code-path switches scattered through the codebase. `DESKTOP_MODE=true` is the single source of truth.

### Pattern: Non-Blocking Feature Degradation

License validation failure → warning banner, not hard stop. Update check failure → silent (no internet). Sentry init failure → silent (no crash). The app must start and function even if every optional service is unreachable.

### Pattern: IPC for Privileged Operations Only

The Electron preload exposes only: version query, license activation, external URL open. File system access, process management, and environment mutation stay in the main process. The renderer (Next.js app) talks to FastAPI for all business operations — same as web mode.

### Pattern: Shared AppData `.env` for User Config

API keys and license info live in `%APPDATA%/EditFactory/.env`. This is the user's config, separate from the project's development `.env`. Settings page writes to this file via `POST /api/v1/desktop/settings`. `pydantic_settings` merges both files automatically (`env_file = [".env", appdata_env]`).

---

## Anti-Patterns to Avoid

### Anti-Pattern: Electron `nodeIntegration: true`

Giving the renderer direct Node.js access is a security risk even in a local-only desktop app. Use `contextIsolation: true` with preload.js context bridge. This is the current Electron best practice and prevents XSS from escalating to system compromise.

### Anti-Pattern: Bundling the Entire `node_modules`

`electron-builder` handles exclusions via `files` config. Never bundle `frontend/node_modules` or `venv/Lib/site-packages` directly — use the standalone Next.js build output and a PyInstaller dist instead. Bundling raw node_modules produces multi-GB installers.

### Anti-Pattern: Hardcoding Ports in Electron

The hardcoded `:8000`/`:3000` pattern is fine for v1 (single-user desktop, no port negotiation needed). Do not add port-auto-selection complexity. If ports are in use, show a clear error and exit — don't silently retry different ports.

### Anti-Pattern: License as Hard Gate

Never make the app completely non-functional when license validation fails. Lemon Squeezy can have outages. The correct behavior is: valid cached license → full access; expired validation cache (> 7 days, no internet) → show warning banner but allow full use for a grace period; invalid key → prompt to re-enter, but don't delete user's data.

### Anti-Pattern: Modifying Existing API Routes for Desktop Mode

Desktop-specific endpoints go in the new `desktop_routes.py`. Existing routers must remain unchanged and work identically in both web and desktop mode. The conditional registration (`if settings.desktop_mode: app.include_router(desktop_router)`) keeps the separation clean.

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Electron shell architecture | HIGH | Established pattern with multiple production templates (fast-electron, electron-fastapi-exe); Electron docs verified |
| Config changes in `app/config.py` | HIGH | Examined file directly; `pydantic_settings` multi-file `env_file` is documented |
| `app/main.py` FFmpeg path change | HIGH | Examined file directly; minimal delta |
| Auth bypass for desktop | HIGH | `AUTH_DISABLED` already implemented and tested in `app/api/auth.py` |
| Frontend auth SSR removal | HIGH | Examined `auth-provider.tsx` and `middleware.ts` directly; changes are 3-5 lines each |
| `output: "standalone"` Next.js | HIGH | `next.config.ts` already has this setting |
| electron-updater + NSIS | HIGH | Official electron-builder docs; widely used pattern |
| Lemon Squeezy License API | HIGH | Official API docs verified; endpoint confirmed at `POST /v1/licenses/validate` |
| Sentry Electron SDK | HIGH | Official `@sentry/electron` package; main + renderer process support documented |
| Sentry FastAPI integration | HIGH | Official `sentry-sdk` with FastAPI integration; 1-call init |
| PyInstaller + PyTorch bundling | LOW | Known fragility; multiple failure modes; requires testing on clean VM |
| NSIS installer final size | MEDIUM | Depends on Python bundling approach; range is 500MB-2GB |

---

## Sources

- Existing codebase: `app/config.py`, `app/main.py`, `app/api/auth.py`, `frontend/src/lib/api.ts`, `frontend/src/components/auth-provider.tsx`, `frontend/src/lib/supabase/middleware.ts`, `frontend/next.config.ts`, `start-dev.bat` — all read directly 2026-03-01
- Lemon Squeezy License API: https://docs.lemonsqueezy.com/api/license-api/validate-license-key — HIGH confidence, official docs
- Lemon Squeezy activate endpoint: https://docs.lemonsqueezy.com/api/license-api/activate-license-key — HIGH confidence, official docs
- Sentry Electron SDK: https://docs.sentry.io/platforms/javascript/guides/electron/ — HIGH confidence, official docs
- Sentry FastAPI integration: https://docs.sentry.io/platforms/python/integrations/fastapi/ — HIGH confidence, official docs
- electron-updater NSIS: https://www.electron.build/auto-update.html — HIGH confidence, official docs
- electron-builder NSIS: https://www.electron.build/nsis.html — HIGH confidence, official docs
- Electron + FastAPI pattern: https://medium.com/@shakeef.rakin321/electron-react-fastapi-template-for-cross-platform-desktop-apps-cf31d56c470c — MEDIUM confidence, verified pattern
- PyInstaller: https://www.pyinstaller.org/ — HIGH confidence for basic bundling, LOW for PyTorch-heavy bundles
- Prior market + feasibility analysis: `.planning/desktop-app-analysis.md` — internal, HIGH confidence

---

*Architecture research for: v10 Desktop Launcher & Distribution*
*Researched: 2026-03-01*
