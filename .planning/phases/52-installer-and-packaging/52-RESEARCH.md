# Phase 52: Installer and Packaging - Research

**Researched:** 2026-03-01
**Domain:** electron-builder NSIS packaging, electron-updater auto-update, portable Node.js bundling, build size management
**Confidence:** HIGH

## Summary

Phase 52 completes the v10 milestone by producing a self-contained Windows NSIS .exe installer and wiring up auto-update. The primary tool is `electron-builder` (already installed at `^25.0.0` in `electron/package.json` from Phase 48). The NSIS target is already declared — `"target": "nsis"` in the `win` key. What remains is: (1) completing the `electron/package.json` build config with NSIS options, extraResources for portable Node.js 22.x and FFmpeg, and publish config; (2) adding `electron-updater` to the Electron main process for startup update checks with a deferred-restart notification; (3) writing a build script that assembles all artifacts before invoking `electron-builder`.

**Critical size finding:** The project venv is currently 522 MB and the FFmpeg bin directory is 553 MB. The Next.js standalone is 74 MB. Total installer payload (before compression) is approximately 1.1–1.2 GB plus portable Node.js (~45 MB zip). This is well under NSIS's effective 2 GB limit, so no NSISBI workaround is needed. Build time will be the main concern (NSIS LZMA compression of 1+ GB takes several minutes).

**Primary recommendation:** Use `electron-builder` with the `nsis` target, `extraResources` for venv + FFmpeg + Node.js portable + app source, `publish.provider = "github"` for free update hosting on GitHub Releases, and `electron-updater` in main.js for background update checking with a `dialog.showMessageBox` on `update-downloaded`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INST-01 | electron-builder produces NSIS .exe installer for Windows | `"win": { "target": "nsis" }` already declared in `electron/package.json`. Running `npx electron-builder --win` from `electron/` produces `EditFactory-Setup-{version}.exe` in `electron/dist/`. |
| INST-02 | Installer bundles Python venv, FFmpeg binary, Next.js standalone, portable Node.js 22.x | All four delivered via `extraResources` in the build config. Portable Node.js 22.x downloaded from `https://nodejs.org/dist/v22.22.0/node-v22.22.0-win-x64.zip` (latest LTS as of 2026-01-12), extracted to `electron/resources/node/`, included as `{"from": "resources/node", "to": "node"}`. venv, app, and frontend/standalone already listed. |
| INST-03 | Installer creates Start Menu shortcut, desktop shortcut, and Add/Remove Programs entry | NSIS options: `createDesktopShortcut: true`, `createStartMenuShortcut: true`. Add/Remove Programs entry is automatic via NSIS — uses `productName` and `version` from `package.json`. |
| INST-04 | Uninstaller removes all installed files and shortcuts | NSIS generates an uninstaller automatically. `uninstallDisplayName` controls the display name in Add/Remove Programs. No custom NSIS script needed for standard file removal. |
| UPDT-01 | electron-updater checks for new version on startup via latest.yml manifest | Install `electron-updater` as a runtime dependency. Call `autoUpdater.checkForUpdates()` in `app.whenReady()` after services start. Configure `publish.provider = "github"` in `electron/package.json`. electron-builder auto-generates `latest.yml` and uploads it to the GitHub Release. |
| UPDT-02 | Update downloads in background, prompts user to restart (not mid-session) | Set `autoUpdater.autoDownload = true` (default). Listen to `update-downloaded` event; show `dialog.showMessageBox` with "Restart Now" and "Later" buttons. On "Restart Now", call `autoUpdater.quitAndInstall()`. On "Later", do nothing — update applies on next launch. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| electron-builder | ^25.0.0 (already installed) | Produce NSIS installer, manage extraResources, generate latest.yml | De facto standard for Electron packaging and distribution |
| electron-updater | ^6.x | Auto-update: check, download, notify, install | Purpose-built companion to electron-builder; handles SHA512 verification automatically |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js 22.x portable (win-x64 zip) | v22.22.0 (latest LTS) | Runtime for Next.js standalone server.js in packaged mode | INST-02 requires bundling — not an npm package, downloaded as zip artifact |
| GitHub Releases | Free | Host installer .exe and latest.yml for auto-updates | Free for public repos; electron-builder uploads automatically with GH_TOKEN |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| GitHub Releases (publish) | S3 bucket | S3 costs money and requires manual upload; GitHub Releases is free and electron-builder handles upload automatically with GH_TOKEN. Use GitHub Releases. |
| GitHub Releases (publish) | Generic HTTP server | Generic server requires you to host and upload manually; GitHub Releases is managed. Use GitHub Releases. |
| NSIS target | nsis-web target | nsis-web splits installer + payload download; useful when installer would exceed 2 GB or users have slow connections. Current payload is ~1.1 GB — standard NSIS is fine. |
| `checkForUpdatesAndNotify()` | Manual event handling | `checkForUpdatesAndNotify()` uses OS system tray notifications which may not be seen. Manual `update-downloaded` + `dialog.showMessageBox` gives explicit in-app control per UPDT-02. Use manual events. |

**Installation:**
```bash
cd electron
npm install electron-updater
```

## Architecture Patterns

### Recommended Project Structure

```
electron/
├── package.json             # Build config — extend existing with nsis + publish sections
├── src/
│   └── main.js              # Add electron-updater import + checkForUpdates() call
├── build/
│   └── icon.ico             # Already exists (Phase 48-01)
├── resources/               # Pre-downloaded artifacts (gitignored, prepared by build script)
│   └── node/                # Portable Node.js 22.x extracted here
│       ├── node.exe
│       ├── node_modules/
│       └── ...
└── dist/                    # electron-builder output (gitignored)
    ├── EditFactory-Setup-1.0.0.exe
    ├── EditFactory-Setup-1.0.0.exe.blockmap
    └── latest.yml

# Build preparation script (project root level):
scripts/
└── build-installer.js       # Node.js script: build frontend, copy assets, download Node, run electron-builder
```

### Pattern 1: Complete electron-builder NSIS Configuration

**What:** The `build` key in `electron/package.json` needs NSIS options, publish config, and the full extraResources list.

**Example:**
```json
{
  "name": "edit-factory-shell",
  "version": "1.0.0",
  "description": "Edit Factory Desktop Shell",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron .",
    "dist": "electron-builder --win",
    "dist:publish": "electron-builder --win --publish always"
  },
  "devDependencies": {
    "electron": "^34.0.0",
    "electron-builder": "^25.0.0"
  },
  "dependencies": {
    "electron-updater": "^6.1.0"
  },
  "build": {
    "appId": "com.editfactory.app",
    "productName": "Edit Factory",
    "directories": {
      "output": "dist"
    },
    "win": {
      "target": "nsis",
      "icon": "build/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "Edit Factory",
      "uninstallDisplayName": "Edit Factory ${version}"
    },
    "publish": {
      "provider": "github",
      "owner": "YOUR_GITHUB_ORG",
      "repo": "edit-factory",
      "releaseType": "release"
    },
    "extraResources": [
      {
        "from": "../venv",
        "to": "venv",
        "filter": ["**/*"]
      },
      {
        "from": "../frontend/.next/standalone",
        "to": "frontend/standalone",
        "filter": ["**/*"]
      },
      {
        "from": "../app",
        "to": "app",
        "filter": ["**/*"]
      },
      {
        "from": "../ffmpeg/ffmpeg-master-latest-win64-gpl/bin",
        "to": "ffmpeg/bin",
        "filter": ["ffmpeg.exe"]
      },
      {
        "from": "resources/node",
        "to": "node",
        "filter": ["**/*"]
      }
    ]
  }
}
```

**Key NSIS options explained:**
- `oneClick: false` — shows a wizard installer (vs silent one-click); required for `allowToChangeInstallationDirectory`
- `perMachine: false` — installs per-user by default (no admin required); can be toggled during install
- `allowToChangeInstallationDirectory: true` — lets user pick install path
- `createDesktopShortcut: true` — desktop shortcut (INST-03)
- `createStartMenuShortcut: true` — Start Menu shortcut (INST-03)
- `uninstallDisplayName` — controls Add/Remove Programs entry (INST-04)

### Pattern 2: electron-updater in main.js

**What:** Import `autoUpdater` from `electron-updater`, set `autoDownload = true`, call `checkForUpdates()` after services are ready, and show a dialog on `update-downloaded`.

**When to use:** In the packaged app only — guard with `!isDev` to avoid polluting dev with update checks.

```javascript
// electron/src/main.js — add after existing requires
const { autoUpdater } = require('electron-updater');

// Configure updater — call once near startup
function setupAutoUpdater() {
  if (isDev) return;  // No update checks in dev mode

  autoUpdater.autoDownload = true;          // Download silently in background
  autoUpdater.autoInstallOnAppQuit = false; // We control when to install

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[updater] Up to date:', info.version);
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] Download ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version);
    // Show dialog — NOT mid-session: user can defer
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Edit Factory ${info.version} has been downloaded.`,
      detail: 'Restart now to apply the update, or continue working and restart later.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
      // response === 1: user chose "Later" — update applies on next launch automatically
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message);
    // Non-fatal — app continues normally
  });
}

// Call in app.whenReady() AFTER services are confirmed ready:
// await waitForServices();
// ... existing code ...
// setupAutoUpdater();
// autoUpdater.checkForUpdates().catch(err => console.error('[updater] Check failed:', err));
```

**Why check after services are ready, not immediately on startup:**
- If update check fires before backend starts, any network activity competes with startup
- Checking after `waitForServices()` guarantees the app is fully functional before prompting a restart
- The update-downloaded dialog appearing during startup could confuse users before they see the app

### Pattern 3: Portable Node.js 22 Download and Placement

**What:** Download the portable Node.js 22 LTS Windows binary, extract to `electron/resources/node/`. This directory is included via extraResources. The existing `main.js` already references the packaged Node at:
```javascript
const nodeExe = isDev ? 'node' : path.join(process.resourcesPath, 'node', 'node.exe');
```
This path is already wired correctly in Phase 48.

**Download URL (Node.js 22 LTS latest as of 2026-01-12):**
```
https://nodejs.org/dist/v22.22.0/node-v22.22.0-win-x64.zip
```

**Extraction:** Extract ZIP contents into `electron/resources/node/` so that `electron/resources/node/node.exe` exists. The entire extracted directory is bundled via extraResources.

**Build script snippet:**
```javascript
// scripts/build-installer.js
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NODE_VERSION = 'v22.22.0';
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;
const NODE_ZIP = path.join(__dirname, '..', 'electron', 'resources', 'node.zip');
const NODE_DEST = path.join(__dirname, '..', 'electron', 'resources', 'node');

// Download + extract if not already present
if (!fs.existsSync(path.join(NODE_DEST, 'node.exe'))) {
  console.log('Downloading portable Node.js', NODE_VERSION, '...');
  // download NODE_URL -> NODE_ZIP, then extract
  // Use PowerShell Expand-Archive or a Node unzip library
  execSync(`powershell -command "Expand-Archive -Path '${NODE_ZIP}' -DestinationPath '${NODE_DEST}_tmp' -Force"`);
  // Move contents of extracted subfolder up one level
  const extracted = fs.readdirSync(`${NODE_DEST}_tmp`)[0];
  fs.renameSync(path.join(`${NODE_DEST}_tmp`, extracted), NODE_DEST);
  fs.rmdirSync(`${NODE_DEST}_tmp`);
}
```

**Alternative:** Use the Node.js `unzipper` npm package in the build script for cross-platform unzip. Since this build script runs on Windows only (WINDOWS-first), PowerShell `Expand-Archive` is acceptable.

### Pattern 4: SHA512 Hash Verification (Built-in)

**What:** electron-updater automatically verifies the SHA512 hash of downloaded update files against the `sha512` value in `latest.yml`. **No custom verification code is needed.**

The `latest.yml` generated by electron-builder contains:
```yaml
version: 1.1.0
path: EditFactory-Setup-1.1.0.exe
sha512: <base64-encoded SHA512 hash>
releaseDate: '2026-03-01T00:00:00.000Z'
```

electron-updater downloads the installer, computes its SHA512, and compares against the manifest value. If they differ, the download is rejected and an `error` event fires.

**Conclusion on "SHA256 hash verification" research flag:** electron-updater uses SHA512 (not SHA256) and this is automatic. No developer action required beyond using electron-updater correctly.

### Pattern 5: Build Script Orchestration

**What:** A single `scripts/build-installer.js` (or `npm run dist` from `electron/`) that sequences:
1. `cd frontend && npm run build` — builds Next.js standalone + copies static assets (postbuild.js from Phase 48-01)
2. Download and extract portable Node.js 22 if not cached
3. `cd electron && npx electron-builder --win` — packages everything into NSIS installer

**Build command from project root:**
```bash
node scripts/build-installer.js
```

Or add to root `package.json` scripts if one exists:
```json
"scripts": {
  "build:installer": "node scripts/build-installer.js"
}
```

### Anti-Patterns to Avoid

- **Calling `autoUpdater.quitAndInstall()` immediately on `update-downloaded`:** This would restart the app mid-session. Always show a dialog and let the user defer.
- **Running update checks in dev mode:** `!isDev` guard is mandatory — electron-updater looks for `app-update.yml` which only exists in packaged builds. In dev, it throws an error or reads `dev-app-update.yml`.
- **Omitting the `publish` key in package.json:** Without it, `--publish always` has no provider to push to, and `latest.yml` won't be uploaded.
- **Including `venv/node_modules` or `venv/__pycache__` in extraResources without exclusion:** Currently `"filter": ["**/*"]` includes everything. This is acceptable since venv size is 522 MB (manageable), but `__pycache__` adds bloat. Consider `"filter": ["**/*", "!**/__pycache__/**", "!**/*.pyc"]` to reduce installer size.
- **Committing `electron/resources/node/` to git:** The portable Node.js directory (~45 MB) should be gitignored and downloaded during build. Add `resources/node/` to `electron/.gitignore`.
- **Setting `releaseType: "release"` for all publishes:** Use `"draft"` during development testing and only switch to `"release"` for production. Drafts don't trigger auto-update for existing users.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA512 hash verification of downloaded update | Custom hash comparison | electron-updater built-in | Already implemented; errors on mismatch automatically |
| Start Menu / Desktop shortcut creation | NSIS script macros | electron-builder NSIS options `createDesktopShortcut`, `createStartMenuShortcut` | electron-builder generates correct NSIS script automatically |
| Add/Remove Programs registration | NSIS registry writes | electron-builder NSIS default behavior | NSIS installer always registers with Windows Uninstall registry; no custom script needed |
| Update manifest generation | Custom latest.yml writer | electron-builder `--publish` flag | electron-builder computes SHA512, version, path, and generates the manifest automatically |
| Installer signing (code signing) | Custom signtool invocation | electron-builder `win.signingHashAlgorithms`, `certificateFile` | Deferred to DIST-02 (future requirement) — SmartScreen warnings are acceptable for v10 |
| File download progress for update | Custom progress bar | electron-updater `download-progress` event | Provides `percent`, `bytesPerSecond`, `transferred`, `total` — log to console, no UI needed for v10 |

**Key insight:** electron-builder and electron-updater eliminate all packaging and update plumbing. The only custom code needed in Phase 52 is: (1) the build script to orchestrate artifact preparation, (2) ~30 lines in `main.js` for update event handling.

## Common Pitfalls

### Pitfall 1: NSIS 2 GB File Size Limit

**What goes wrong:** If the uncompressed installer payload exceeds ~2 GB, electron-builder silently produces a malformed (corrupt) .exe with no error message. The installer appears to complete but fails on target machines.

**Why it happens:** Standard NSIS has a 2 GB solid block limit. electron-builder uses standard NSIS by default.

**How to avoid:** Measure payload size before building. Current measurements:
- venv: 522 MB
- FFmpeg bin (ffmpeg.exe only): ~192 MB
- Next.js standalone: 74 MB
- app/ source: 2.7 MB
- Portable Node.js 22: ~45 MB (extracted)
- Electron itself: ~200 MB (bundled by electron-builder)
- **Total estimated uncompressed: ~1.04 GB** — safely under the 2 GB limit

**If payload grows beyond 1.5 GB:** Exclude `venv/__pycache__`, `venv/**/*.pyc`, and test whether TTS models (if downloaded on first run) are in venv or separately cached. If needed, switch to `nsis-web` target.

**Warning signs:** Installer file size looks wrong (too small), or installer fails to extract on target machine.

### Pitfall 2: extraResources Filter Syntax — Empty Directories Not Copied

**What goes wrong:** An `extraResources` entry with `"filter": ["**/*"]` does not copy empty directories. If a resource directory is empty, it silently skips.

**Why it happens:** Glob `**/*` matches files, not empty directories.

**How to avoid:** Ensure all bundled directories (venv, standalone, app, node) have files in them at build time. For the portable Node.js directory, if it's empty (not yet downloaded), the build will silently produce an incomplete installer. The build script must download/extract Node.js BEFORE running electron-builder.

**Warning signs:** Packaged app fails to start — frontend can't find node.exe.

### Pitfall 3: electron-updater Requires Code Signing on macOS (Ignored Here)

**What goes wrong:** On macOS, electron-updater only works with signed apps. On Windows, it works without code signing.

**Why it happens:** macOS Gatekeeper enforces app identity for update trust.

**How to avoid:** Not relevant for v10 Windows-first builds. Windows updates will work without a code signing certificate (SmartScreen will warn on first install, but updates work). Code signing is DIST-02 (future).

**Warning signs:** N/A for Windows.

### Pitfall 4: `autoUpdater.checkForUpdates()` Throws in Dev Mode

**What goes wrong:** Calling `checkForUpdates()` without a `dev-app-update.yml` file in dev mode throws an unhandled error.

**Why it happens:** electron-updater looks for `app-update.yml` (generated during build) or `dev-app-update.yml` in dev mode. If neither exists, it errors.

**How to avoid:** Guard with `if (isDev) return;` at the top of `setupAutoUpdater()`. Do NOT call `checkForUpdates()` in dev mode.

**Warning signs:** `Error: Cannot find module 'electron-updater'` or `Error: ENOENT: no such file or directory, open 'app-update.yml'` in dev console.

### Pitfall 5: GitHub Release Must Be Published (Not Draft) for Updates to Trigger

**What goes wrong:** Users don't receive auto-updates even though a new version is on GitHub.

**Why it happens:** electron-updater only checks published releases, not drafts. `releaseType: "draft"` (default) means electron-builder creates a draft that is invisible to updater.

**How to avoid:** Use `"releaseType": "release"` in the publish config for production builds, or manually publish the GitHub draft after verifying it. For CI, `--publish always` with `releaseType: "release"` automates this.

**Warning signs:** `update-not-available` fires even though a newer version exists on GitHub.

### Pitfall 6: venv Path Resolution — Windows vs WSL

**What goes wrong:** `extraResources` `from` path `"../venv"` is resolved relative to `electron/`. In WSL, this path is accessible. On a native Windows build machine, path separators and drive letters must be correct.

**Why it happens:** electron-builder resolves `from` relative to the `electron/` directory (where `package.json` lives). WSL mounts Windows paths, so this works correctly.

**How to avoid:** The path `"../venv"` (one level up from `electron/`) correctly points to the project root's `venv/` directory in both WSL and native Windows. This has been validated by the Phase 48 configuration. No action needed.

**Warning signs:** electron-builder warning: `extraResources: from "../venv" — directory does not exist`.

### Pitfall 7: `update-downloaded` Dialog Requires `mainWindow` to Exist

**What goes wrong:** `dialog.showMessageBox(mainWindow, ...)` called when `mainWindow` is null (user closed the window — window hides to tray, `mainWindow` stays non-null per Phase 48 `close` handler).

**Why it happens:** In Phase 48, `mainWindow.on('close')` hides the window instead of destroying it, so `mainWindow` stays non-null while the app is running. However, if the app is quitting, `mainWindow` could be null.

**How to avoid:** Use `dialog.showMessageBox(mainWindow || undefined, ...)` — passing `undefined` as parent shows a standalone dialog. Or check `if (!mainWindow || isQuitting) return;` at the top of the `update-downloaded` handler.

## Code Examples

Verified patterns from official sources and project-specific context:

### Complete electron-updater Setup in main.js

```javascript
// electron/src/main.js — add at top with other requires
const { autoUpdater } = require('electron-updater');

// Add this function (call after waitForServices() resolves):
function setupAutoUpdater() {
  if (isDev) return;  // Guard: no updates in dev mode

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] App is up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] Downloading update: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    // UPDT-02: Prompt user to restart — not mid-session
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: 'Update Ready',
      message: `Edit Factory ${info.version} is ready to install.`,
      detail: 'Restart the app now to apply the update, or continue working and restart later.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Auto-update error (non-fatal):', err.message);
  });

  // Check immediately — update downloads in background
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] Check failed (non-fatal):', err.message);
  });
}
```

### Insertion Point in app.whenReady()

```javascript
// In app.whenReady() — AFTER waitForServices() resolves:
try {
  await waitForServices();
  mainWindow.loadURL('http://localhost:3000');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  tray.setToolTip('Edit Factory');

  // Start update check AFTER app is confirmed running (UPDT-01)
  setupAutoUpdater();
} catch (err) {
  // ... existing error handling
}
```

### Build Script: scripts/build-installer.js

```javascript
#!/usr/bin/env node
// scripts/build-installer.js — Run from project root
// Sequences: frontend build -> Node.js download -> electron-builder

const { execSync, spawnSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELECTRON_DIR = path.join(ROOT, 'electron');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const NODE_DEST = path.join(ELECTRON_DIR, 'resources', 'node');
const NODE_VERSION = 'v22.22.0';
const NODE_ZIP_URL = `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`;
const NODE_ZIP = path.join(ELECTRON_DIR, 'resources', `node-${NODE_VERSION}-win-x64.zip`);

// Step 1: Build Next.js standalone
console.log('\n[build] Step 1: Building frontend...');
execSync('npm run build', { cwd: FRONTEND_DIR, stdio: 'inherit' });

// Step 2: Download portable Node.js if not cached
if (!fs.existsSync(path.join(NODE_DEST, 'node.exe'))) {
  console.log(`\n[build] Step 2: Downloading portable Node.js ${NODE_VERSION}...`);
  fs.mkdirSync(path.join(ELECTRON_DIR, 'resources'), { recursive: true });

  // Download
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(NODE_ZIP);
    https.get(NODE_ZIP_URL, (res) => res.pipe(file).on('finish', resolve)).on('error', reject);
  });

  // Extract using PowerShell (Windows only — acceptable since this is a Windows installer build)
  const tmpDir = path.join(ELECTRON_DIR, 'resources', 'node_tmp');
  execSync(
    `powershell -command "Expand-Archive -Path '${NODE_ZIP}' -DestinationPath '${tmpDir}' -Force"`,
    { stdio: 'inherit' }
  );

  // Move inner folder (node-v22.22.0-win-x64/) to NODE_DEST
  const inner = fs.readdirSync(tmpDir)[0];
  fs.renameSync(path.join(tmpDir, inner), NODE_DEST);
  fs.rmdirSync(tmpDir);
  fs.unlinkSync(NODE_ZIP);
  console.log('[build] Portable Node.js ready at:', NODE_DEST);
} else {
  console.log('\n[build] Step 2: Portable Node.js already cached — skipping download');
}

// Step 3: Run electron-builder
console.log('\n[build] Step 3: Running electron-builder...');
execSync('npx electron-builder --win', { cwd: ELECTRON_DIR, stdio: 'inherit' });

console.log('\n[build] Build complete. Installer in electron/dist/');
```

### latest.yml Format (auto-generated by electron-builder)

```yaml
# Source: https://www.electron.build/auto-update.html
version: 1.0.0
path: EditFactory-Setup-1.0.0.exe
sha512: <base64-sha512-hash>
releaseDate: '2026-03-01T00:00:00.000Z'
files:
  - url: EditFactory-Setup-1.0.0.exe
    sha512: <base64-sha512-hash>
    size: 450000000
```

This file is generated automatically. No developer writes this manually.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom installer scripts (InnoSetup, WiX) | electron-builder NSIS | ~2016 (electron-builder matured) | Eliminates bespoke installer code; shortcut/uninstaller built-in |
| Manual update checking + HTTP | electron-updater with latest.yml | ~2018 | SHA512 verification, staged rollouts, cross-platform built-in |
| PyInstaller single .exe | Python venv copy (decided in STATE.md) | v10 decision | Avoids antivirus false positives, PyTorch bundling fragility |
| Squirrel.Windows (older Electron default) | NSIS via electron-builder | Still current in 2025 | NSIS gives more control over shortcuts and install options |

**Deprecated/outdated:**
- `electron-squirrel-startup`: For Squirrel.Windows installer — not relevant since we use NSIS
- `update-electron-app` package: Only works with public GitHub repos + update.electronjs.org service — `electron-updater` is more flexible and already in the stack

## Update Server Hosting Decision

**Decision: GitHub Releases**

Rationale:
- Free for public repositories
- electron-builder uploads installer .exe and latest.yml automatically with `GH_TOKEN` env var
- No infrastructure to manage
- electron-updater has first-class GitHub provider support
- If the repo is private, GH_TOKEN is set on the build machine (CI), not on user machines — auto-update still works because latest.yml and the installer are in the public release assets

**Configuration required:**
- Set `GH_TOKEN` environment variable in CI/build environment (NOT committed to code)
- Use `"releaseType": "draft"` during development, `"release"` for production
- Run `npx electron-builder --win --publish always` to build and upload

## Build Size Analysis

| Component | Current Size | Notes |
|-----------|-------------|-------|
| venv/ | 522 MB | Includes PyTorch, Whisper, TTS, OpenCV |
| ffmpeg.exe only | 192 MB | ffplay.exe excluded — only ffmpeg.exe needed |
| frontend/.next/standalone | 74 MB | Post-build including static assets |
| app/ source | 2.7 MB | FastAPI routes, services, etc. |
| Portable Node.js 22 | ~45 MB | Extracted win-x64 zip |
| Electron runtime | ~200 MB | Bundled by electron-builder automatically |
| **Total uncompressed** | **~1.04 GB** | Under NSIS 2 GB limit |
| **Estimated installer .exe** | **~300-400 MB** | LZMA compression typical ratio 30-40% |

**Conclusion:** Standard NSIS target is sufficient. No NSISBI workaround needed. FFmpeg `ffplay.exe` (194 MB) should be explicitly excluded from extraResources to save ~50 MB in the installer.

**venv optimization available (optional):** Adding `"!**/__pycache__/**", "!**/*.pyc"` to the venv filter could save 20-50 MB. Worth doing.

## Open Questions

1. **GitHub repository visibility for auto-updates**
   - What we know: electron-updater's GitHub provider works with both public and private repos. Private repos require `GH_TOKEN` on the build machine. Release asset downloads are public even for private repos if the release is published.
   - What's unclear: Whether the Edit Factory GitHub repo exists and is configured. The planner should ask the user for `owner` and `repo` values or use placeholder values.
   - Recommendation: Use `"owner": "PLACEHOLDER_ORG"` and `"repo": "PLACEHOLDER_REPO"` in package.json — document that these must be filled in before publishing.

2. **ffplay.exe and ffprobe.exe — include or exclude?**
   - What we know: CLAUDE.md mentions FFmpeg. The app uses `ffmpeg.exe` for video processing. `ffplay.exe` is 194 MB and `ffprobe.exe` may be present.
   - What's unclear: Whether any code path in the app calls ffplay or ffprobe.
   - Recommendation: Check `app/services/` for ffprobe usage. If present, include `ffprobe.exe` in the filter. Exclude `ffplay.exe` (it's a media player, not used by server-side processing). Planner should add a grep task.

3. **`electron/resources/node/` gitignore handling**
   - What we know: Phase 48's `.gitignore` excludes `node_modules/`, `dist/`, `out/`, `*.log`. The `resources/` directory is not currently gitignored.
   - What's unclear: Whether `resources/node/` (45 MB Node.js binary) should be committed or downloaded at build time.
   - Recommendation: Add `resources/node/` and `resources/*.zip` to `electron/.gitignore`. The build script downloads it. This keeps the repo clean.

4. **Version sync between package.json and app**
   - What we know: The Settings footer shows version from `GET /api/v1/desktop/version` (Phase 49). This reads from some source.
   - What's unclear: Where `app/desktop.py` or the version endpoint reads the version from. If it reads from a hardcoded string, it won't auto-update when `electron/package.json` `version` bumps.
   - Recommendation: Planner should check the Phase 49 version endpoint implementation and, if needed, write a task to make the version endpoint read from `electron/package.json` via a generated `version.txt` file in extraResources.

## Sources

### Primary (HIGH confidence)
- [electron-builder NSIS configuration](https://www.electron.build/nsis.html) — all NSIS options: oneClick, perMachine, createDesktopShortcut, createStartMenuShortcut, shortcutName, uninstallDisplayName
- [electron-builder publish configuration](https://www.electron.build/publish.html) — GitHub provider format, Generic provider format, latest.yml hosting requirements
- [electron-builder auto-update](https://www.electron.build/auto-update.html) — electron-updater setup, events, checkForUpdates, quitAndInstall, latest.yml format
- [electron-builder common configuration](https://www.electron.build/configuration.html) — extraResources, FileSet format, directories, files glob, compression options
- Codebase: `electron/package.json` — confirmed electron-builder ^25.0.0 installed, existing extraResources for venv/frontend/app, `"target": "nsis"` declared
- Codebase: `electron/src/main.js` — confirmed `isDev = !app.isPackaged`, `nodeExe` already references `process.resourcesPath/node/node.exe` for packaged mode (Phase 48 decision)
- Codebase: `requirements.txt` — PyTorch, Whisper, TTS dependencies confirmed; venv measured at 522 MB
- Codebase: disk measurements — venv 522 MB, FFmpeg bin 553 MB (ffmpeg.exe 192 MB), standalone 74 MB, app 2.7 MB

### Secondary (MEDIUM confidence)
- [Node.js 22 LTS release page](https://nodejs.org/en/blog/release/v22.22.0) — v22.22.0 confirmed as latest LTS (2026-01-12), portable win-x64 zip available
- [electron-builder GitHub issues #8399](https://github.com/electron-userland/electron-builder/issues/8399) — NSIS 2 GB limit confirmed; workaround via NSISBI exists but not needed for ~1 GB payload
- WebSearch: electron-updater `update-downloaded` dialog pattern — multiple credible sources confirm `dialog.showMessageBox` + `quitAndInstall()` is the standard pattern

### Tertiary (LOW confidence)
- WebSearch: venv size estimates for PyTorch/Whisper apps — "5-10 GB" figures cited are for CUDA PyTorch + large Whisper models; this project's actual venv is 522 MB (CPU PyTorch likely, smaller models) — direct measurement supersedes web estimate

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — electron-builder 25.x and electron-updater are mature; all config options verified against official docs; existing codebase provides exact starting point
- Architecture: HIGH — extraResources paths confirmed against existing package.json and main.js; size measurements taken from actual project files
- Pitfalls: HIGH for NSIS size limit (verified against issues tracker and actual measurements); HIGH for electron-updater dev-mode guard (official docs); MEDIUM for GitHub release draft vs published state (community-confirmed behavior)

**Research date:** 2026-03-01
**Valid until:** 2026-09-01 (electron-builder 25.x stable; electron-updater 6.x stable; Node.js 22 LTS active through April 2027)
