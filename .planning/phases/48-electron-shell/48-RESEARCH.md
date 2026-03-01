# Phase 48: Electron Shell - Research

**Researched:** 2026-03-01
**Domain:** Electron main process, child process management, system tray, electron-builder packaging
**Confidence:** HIGH

## Summary

Phase 48 wraps the existing Edit Factory services (FastAPI on :8000, Next.js standalone on :3000) in an Electron shell. Electron's role here is purely an **orchestrator shell** — not a UI renderer. The app runs in a `BrowserWindow` that loads `http://localhost:3000` (the already-running Next.js server), while the main process manages child process lifecycle, health polling, tray icon, and graceful shutdown.

The architecture decision from STATE.md is clear: Electron is a process orchestrator only (not a WebView renderer). The Electron main process spawns two child processes using Node's `child_process.spawn`: (1) `venv/Scripts/uvicorn.exe app.main:app --port 8000` and (2) `node .next/standalone/server.js` on port 3000. It polls both health endpoints (`GET /api/v1/health` at :8000 and a root `GET /` at :3000) before calling `mainWindow.loadURL('http://localhost:3000')` and showing the window. The tray icon provides the only persistent UI during and after startup.

Phase 47 is complete and delivers everything Phase 48 depends on: `APP_BASE_DIR` abstraction, `DESKTOP_MODE=true` env var that the Electron main process will inject into the backend spawn call, and `app/desktop.py cleanup --ports 8000 3000` for orphan cleanup. These are ready to use.

**Primary recommendation:** Implement Electron as a standalone `electron/` directory at the project root with its own `package.json`. Use `child_process.spawn` (not `UtilityProcess`) to start external Python and Node.js processes. Use `app.on('will-quit')` to clean up child processes. The tray icon must be kept as a module-level variable to prevent garbage collection.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SHELL-01 | Electron main process spawns FastAPI backend + Next.js standalone as child processes | `child_process.spawn` from Node.js stdlib. Backend: `venv/Scripts/uvicorn.exe app.main:app --port 8000` with `DESKTOP_MODE=true` injected via `env`. Frontend: `node .next/standalone/server.js` with `PORT=3000`. Paths computed relative to `app.getAppPath()` in dev, `process.resourcesPath` in packaged builds. |
| SHELL-02 | BrowserWindow opens at localhost:3000 after health-check polling confirms both services ready | Poll `http://127.0.0.1:8000/api/v1/health` and `http://127.0.0.1:3000` with Node `http.get()` in a `setInterval` loop (500ms). When both return 200, call `mainWindow.loadURL('http://localhost:3000')` then `mainWindow.show()`. Use `show: false` on BrowserWindow constructor. |
| SHELL-03 | System tray icon with right-click menu: Open Edit Factory, Quit | `new Tray(iconPath)` with ICO file (Windows). `tray.setContextMenu(Menu.buildFromTemplate([...]))`. Assign tray to module-level `let tray` variable — GC pitfall if scoped to a function. `tray.setToolTip('Starting...')` during startup, update to `'Edit Factory'` when ready. |
| SHELL-04 | Graceful shutdown kills child processes and cleans up ports 8000/3000 via psutil | `app.on('will-quit', (event) => { event.preventDefault(); killAll().then(() => app.exit(0)) })`. Call `backendProcess.kill()` and `frontendProcess.kill()` + fallback `python -m app.desktop cleanup --ports 8000 3000` via `spawnSync`. Python psutil ensures child trees are cleaned (uvicorn workers). |
| SHELL-05 | Orphaned processes from previous launches cleaned up on startup | On `app.whenReady()`, before spawning services, run `spawnSync(pythonExe, ['-m', 'app.desktop', 'cleanup', '--ports', '8000', '3000'])`. This calls the `app/desktop.py` utility built in Phase 47. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| electron | ^34.x (latest stable) | Desktop shell — BrowserWindow, Tray, app lifecycle | The only mature cross-platform desktop shell for Node.js |
| electron-builder | ^25.x (latest) | Package + produce distributable — NSIS installer (Phase 52 uses this) | De facto standard for Electron packaging; handles extraResources, NSIS, code signing |
| Node.js child_process (stdlib) | Node.js 24.x (bundled with Electron) | Spawn Python/Node child processes | No library needed — `spawn` handles stdin/stdout piping and process lifecycle |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| electron-is-dev | ^2.0.0 | Detect dev vs packaged at runtime | Needed to switch path resolution between dev (`__dirname`) and packaged (`process.resourcesPath`) |
| wait-on | ^8.x | Alternative: wait for ports instead of custom polling | Optional — custom `http.get` poll is simpler with no extra dep; use if poll logic becomes complex |

### Not Needed (Confirmed Out of Scope)

- **Nextron**: Combines Next.js dev server with Electron renderer — not applicable here because Electron is not a renderer. Next.js runs as a standalone server, not inside Electron's renderer.
- **electron-next**: Same as Nextron — renderer integration, not orchestrator.
- **UtilityProcess**: For spawning Node.js utility processes that need IPC with renderer. Python and external Node.js are better handled by `child_process.spawn`.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `child_process.spawn` | `UtilityProcess` | UtilityProcess is for Node.js utilities with IPC; can't directly wrap Python or external Node binaries. Use spawn. |
| Custom http.get poll loop | `wait-on` npm package | wait-on adds a dependency for what is ~15 lines of code. Custom is fine for this phase. |
| ICO tray icon file | PNG tray icon | Windows recommends ICO; PNG works but ICO with multi-size layers looks sharper in HiDPI. Use ICO. |

**Installation (for new `electron/` package):**
```bash
npm install --save-dev electron electron-builder
npm install electron-is-dev
```

## Architecture Patterns

### Recommended Project Structure

```
electron/                    # New directory at project root
├── package.json             # Electron app package (separate from frontend/)
├── electron-builder.json    # Builder config (or inline in package.json)
├── src/
│   └── main.js              # Electron main process entry point
└── build/
    └── icon.ico             # App icon (Windows) — 256x256+ ICO with multi-size layers
```

Phase 48 creates `electron/` and `electron/src/main.js`. The builder config is used by Phase 52. For Phase 48, the app runs in dev mode only (no packaging yet — that is Phase 52's job).

### Pattern 1: Path Resolution in Dev vs Packaged

**What:** In dev mode, paths are relative to the `electron/src/` directory (or project root). In packaged mode, Python venv and Next.js standalone are in `process.resourcesPath`. Phase 48 only handles dev mode — Phase 52 handles packaging.

**When to use:** Every path to Python exe, Next.js server.js, and venv directory.

```javascript
// electron/src/main.js
const isDev = require('electron-is-dev');
const path = require('path');
const { app } = require('electron');

// Project root: one level up from electron/src/
const PROJECT_ROOT = isDev
  ? path.join(__dirname, '..', '..')  // electron/src/ -> electron/ -> project root
  : process.resourcesPath;           // Phase 52: resources/ in packaged app

const PYTHON_EXE = isDev
  ? path.join(PROJECT_ROOT, 'venv', 'Scripts', 'python.exe')  // Windows venv
  : path.join(process.resourcesPath, 'venv', 'Scripts', 'python.exe');

const NEXT_SERVER = isDev
  ? path.join(PROJECT_ROOT, 'frontend', '.next', 'standalone', 'server.js')
  : path.join(process.resourcesPath, 'frontend', 'standalone', 'server.js');
```

**NOTE:** The `venv/Scripts/python.exe` path is Windows-specific. The project is Windows-first (DIST-01 deferred), so this is correct.

### Pattern 2: Spawning Child Processes with Environment Injection

**What:** Spawn backend with `DESKTOP_MODE=true` injected into the child process environment. Spawn frontend with `PORT=3000` and `NODE_ENV=production`.

```javascript
// electron/src/main.js
const { spawn } = require('child_process');

let backendProcess = null;
let frontendProcess = null;

function startBackend() {
  // Use uvicorn.exe from the venv Scripts dir
  const uvicornExe = path.join(PROJECT_ROOT, 'venv', 'Scripts', 'uvicorn.exe');
  backendProcess = spawn(
    uvicornExe,
    ['app.main:app', '--host', '127.0.0.1', '--port', '8000'],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DESKTOP_MODE: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  backendProcess.stdout.on('data', (d) => console.log('[backend]', d.toString()));
  backendProcess.stderr.on('data', (d) => console.error('[backend]', d.toString()));
  backendProcess.on('exit', (code) => console.log('[backend] exited', code));
}

function startFrontend() {
  // Next.js standalone server.js
  const nodeExe = process.execPath;  // Node.js bundled with Electron
  frontendProcess = spawn(
    nodeExe,
    [NEXT_SERVER],
    {
      cwd: path.join(PROJECT_ROOT, 'frontend', '.next', 'standalone'),
      env: { ...process.env, PORT: '3000', NODE_ENV: 'production', HOSTNAME: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  frontendProcess.stdout.on('data', (d) => console.log('[frontend]', d.toString()));
  frontendProcess.stderr.on('data', (d) => console.error('[frontend]', d.toString()));
}
```

**CRITICAL:** Use `process.execPath` for the Node.js binary when spawning the Next.js standalone server. This is the Node binary bundled inside Electron. Do NOT rely on a system `node` in PATH — it may not exist or may be a different version in desktop mode.

### Pattern 3: Health Check Polling Before Window Show

**What:** Poll both service health endpoints with Node's built-in `http` module. Show window only when both return 2xx. Update tray tooltip to reflect startup state.

```javascript
// electron/src/main.js
const http = require('http');

function checkUrl(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => resolve(res.statusCode >= 200 && res.statusCode < 400))
      .on('error', () => resolve(false));
  });
}

async function waitForServices(win, tray) {
  const BACKEND_URL = 'http://127.0.0.1:8000/api/v1/health';
  const FRONTEND_URL = 'http://127.0.0.1:3000';
  const MAX_WAIT_MS = 60000;
  const POLL_INTERVAL_MS = 500;
  let elapsed = 0;

  tray.setToolTip('Edit Factory — Starting...');

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      elapsed += POLL_INTERVAL_MS;
      const [backOk, frontOk] = await Promise.all([
        checkUrl(BACKEND_URL),
        checkUrl(FRONTEND_URL),
      ]);
      if (backOk && frontOk) {
        clearInterval(interval);
        tray.setToolTip('Edit Factory — Ready');
        win.loadURL('http://localhost:3000');
        win.once('ready-to-show', () => win.show());
        resolve();
      } else if (elapsed >= MAX_WAIT_MS) {
        clearInterval(interval);
        reject(new Error('Services did not start within 60 seconds'));
      }
    }, POLL_INTERVAL_MS);
  });
}
```

**Why `127.0.0.1` not `localhost` for polling:** Some Windows configurations resolve `localhost` via IPv6 (`::1`) while the server binds on IPv4 `127.0.0.1`, causing connection refused on the poll. Use `127.0.0.1` explicitly in the health check; use `localhost` in `loadURL` for normal browser behavior.

### Pattern 4: System Tray Icon

**What:** Create a tray icon using a `.ico` file. Assign to module-level variable. Attach context menu.

```javascript
// electron/src/main.js
const { Tray, Menu, shell } = require('electron');

let tray = null;  // Module-level — prevents garbage collection

function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  tray = new Tray(iconPath);
  tray.setToolTip('Edit Factory — Starting...');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Edit Factory',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}
```

**Windows icon format:** Must be ICO format. The ICO file should include layers at 16x16, 32x32, 48x48, and 256x256 pixels for correct rendering across all Windows DPI settings. A single 256x256 PNG converted to ICO works but multi-size ICO is recommended.

### Pattern 5: Graceful Shutdown

**What:** On `app.quit()`, `will-quit` fires. Kill child processes there. Use `event.preventDefault()` to do async cleanup before allowing exit.

```javascript
// electron/src/main.js
app.on('will-quit', (event) => {
  event.preventDefault();
  cleanup().then(() => app.exit(0));
});

async function cleanup() {
  console.log('[launcher] Shutting down services...');
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
  if (frontendProcess) {
    frontendProcess.kill('SIGTERM');
    frontendProcess = null;
  }
  // Fallback: Python psutil cleanup to catch uvicorn worker processes
  const { spawnSync } = require('child_process');
  const pythonExe = path.join(PROJECT_ROOT, 'venv', 'Scripts', 'python.exe');
  spawnSync(pythonExe, ['-m', 'app.desktop', 'cleanup', '--ports', '8000', '3000'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    timeout: 5000,
  });
  // Brief settle time
  await new Promise((r) => setTimeout(r, 500));
}
```

### Pattern 6: Orphan Cleanup on Startup

**What:** Before spawning services, call `app/desktop.py cleanup` synchronously to kill any processes that survived from a previous crash or unclean exit.

```javascript
// electron/src/main.js — called first in app.whenReady()
function cleanupOrphans() {
  const { spawnSync } = require('child_process');
  const pythonExe = path.join(PROJECT_ROOT, 'venv', 'Scripts', 'python.exe');
  const result = spawnSync(
    pythonExe,
    ['-m', 'app.desktop', 'cleanup', '--ports', '8000', '3000'],
    { cwd: PROJECT_ROOT, timeout: 10000, encoding: 'utf-8' }
  );
  console.log('[launcher] Orphan cleanup:', result.stdout || 'done');
}
```

### Pattern 7: Prevent App from Quitting When Window Closes

**What:** `window-all-closed` should not quit the app — user closes the window but the tray icon keeps the app alive.

```javascript
app.on('window-all-closed', (event) => {
  // Do NOT call app.quit() — tray keeps the app alive
  // Window can be re-opened via tray menu "Open Edit Factory"
});
```

### Anti-Patterns to Avoid

- **Scoping `tray` to a function:** `let tray = new Tray(...)` inside a function body gets garbage collected immediately, removing the icon from the notification area. Always assign to a module-level variable.
- **Using `app.exit()` directly in `will-quit`:** Bypasses cleanup. Use `event.preventDefault()` + `cleanup().then(() => app.exit(0))`.
- **Using `localhost` in health check polling:** IPv6 vs IPv4 resolution mismatch on some Windows setups. Use `127.0.0.1` for polling.
- **Spawning `node` from PATH for the frontend server:** PATH may not include Node.js in packaged mode. Use `process.execPath` which is the Node bundled inside Electron.
- **Spawning `python` from PATH for the backend:** Use the venv's python.exe explicitly. PATH-based `python` may be a different version or absent.
- **Not handling child process `exit` events:** If uvicorn crashes, the window will still show a blank localhost. Monitor `backendProcess.on('exit')` and show an error dialog.
- **Calling `mainWindow.loadURL()` before services are ready:** Results in `ERR_CONNECTION_REFUSED` rendered in the window. Always poll first.
- **Using `ready-to-show` to wait for services:** `ready-to-show` fires when the renderer has painted, not when the backend is running. Polling is the correct approach for service readiness.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process cleanup when app quits | Custom taskkill subprocess | `process.kill()` on the ChildProcess object + psutil fallback via `app/desktop.py` | Already built in Phase 47; psutil handles uvicorn worker child trees |
| Health check socket polling | Raw TCP connect | `http.get()` to `/api/v1/health` | HTTP GET already exists; socket connect doesn't verify the server is actually accepting requests |
| Port occupancy check | netstat parsing | `app/desktop.py cleanup` (Phase 47) | Already built |
| Packaging and distribution | Custom installer script | electron-builder (Phase 52) | Do not attempt manual zip/install for Phase 48 — Phase 48 is dev-mode-only |
| Inter-process communication | Custom TCP/websocket | Not needed in Phase 48 | Electron and the web app communicate through the existing HTTP API at :8000 |

**Key insight:** Phase 48 is primarily integration work — connecting already-built pieces (Phase 47 process utilities, existing FastAPI health endpoint at `/api/v1/health`, existing Next.js standalone output) with Electron's standard process management APIs.

## Common Pitfalls

### Pitfall 1: Tray Icon Garbage Collected

**What goes wrong:** Icon disappears from the notification area immediately or after a short time.
**Why it happens:** V8's garbage collector collects the `Tray` object when it goes out of scope. If `tray` is declared with `let` inside `createTray()` without being returned or assigned to a module-level variable, this happens instantly.
**How to avoid:** Always declare `let tray = null` at module scope and assign inside the function: `tray = new Tray(iconPath)`.
**Warning signs:** Tray icon appears briefly then vanishes; no error message.

### Pitfall 2: Next.js Standalone CWD Requirement

**What goes wrong:** `node server.js` crashes with `ENOENT` for static assets or produces 404s for all routes.
**Why it happens:** Next.js standalone `server.js` expects to be run with its CWD set to the directory containing `server.js`. It reads `public/` and `.next/` relative to CWD.
**How to avoid:** Set `cwd` in the `spawn` options to the directory containing `server.js` (i.e., `frontend/.next/standalone/`). When accessing static files, Next.js standalone also needs a `public` directory: copy `frontend/public` into `frontend/.next/standalone/public` and `frontend/.next/static` into `frontend/.next/standalone/.next/static` (these are standard Next.js standalone post-build steps).
**Warning signs:** Next.js starts (port 3000 responds) but all pages return 404 or images are broken.

### Pitfall 3: Electron's `process.execPath` Points to Electron Binary, Not Node

**What goes wrong:** Using `process.execPath` to spawn `node server.js` actually runs `EditFactory.exe server.js` (the Electron binary), which exits immediately.
**Why it happens:** In a packaged Electron app, `process.execPath` is the Electron executable, not a standalone Node binary.
**How to avoid:** For Phase 48 (dev mode), `process.execPath` correctly points to Electron's bundled Node.js during development because you run `electron .` and `process.execPath` is the Electron binary which runs JS as Node. The correct approach for dev mode is to spawn a _separate_ Node.js process using the system `node` or a bundled Node binary. In Phase 52 (installer), a portable Node.js 22.x will be bundled (per INST-02). For Phase 48 dev, the safest approach is to find the system `node` from PATH, or use `which node`/`where node`.
**Recommendation:** In Phase 48 dev mode, use `process.execPath` which for `electron .` dev invocation equals the Electron binary in Node mode. The key is: spawn `['server.js']` with the Electron binary itself (as a Node runtime), not via a separate `node` command. **Actually:** the correct dev approach is to detect the system Node: `const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node'` and rely on PATH. Phase 52 will replace with bundled Node. See Open Questions below for this nuance.

### Pitfall 4: `app.on('will-quit')` Not Firing on Windows System Shutdown

**What goes wrong:** Child processes orphaned when Windows shuts down or the user logs off.
**Why it happens:** `will-quit` and `before-quit` events are NOT emitted during Windows system shutdown or user logoff (documented in Electron API).
**How to avoid:** This is acceptable for Phase 48. The Phase 47 `app/desktop.py cleanup` utility handles orphan cleanup on next launch. No code workaround is possible for hard system shutdown.
**Warning signs:** Backend/frontend processes still running after Windows logoff — cleaned up on next Electron launch via SHELL-05.

### Pitfall 5: `backendProcess.kill('SIGTERM')` Not Effective on Windows

**What goes wrong:** uvicorn does not terminate after `SIGTERM` on Windows. Ports 8000/3000 remain occupied.
**Why it happens:** Windows does not support POSIX signals. `process.kill()` sends SIGTERM which on Windows maps to a forceful termination for some processes but uvicorn may leave worker processes running.
**How to avoid:** Use `backendProcess.kill()` (which on Windows sends `TerminateProcess`) AND call `app/desktop.py cleanup` as a synchronous fallback in the cleanup handler. The psutil-based cleanup kills the entire process tree.
**Warning signs:** After Quit, `python -m app.desktop cleanup` output shows "killed N processes" with N > 0.

### Pitfall 6: `_next/static` Assets Missing from Next.js Standalone

**What goes wrong:** App loads but CSS and JS chunks return 404.
**Why it happens:** Next.js standalone output does NOT automatically copy `.next/static/` into the standalone directory.
**How to avoid:** Add a post-build script to `frontend/package.json` that copies `.next/static` → `.next/standalone/.next/static` and `public/` → `.next/standalone/public/`. This must be done before Electron can serve the frontend. Add to `build` script in `frontend/package.json`:
```json
"build": "next build && cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public"
```
On Windows, this needs either WSL or a Node.js copy script. Use `fs-extra` or a Node.js script as a postbuild step.
**Warning signs:** App renders but all styling is missing; browser dev tools show 404 for chunk files.

### Pitfall 7: Backend Binding to 0.0.0.0 Exposes Port on Network

**What goes wrong:** In desktop mode, the backend is accessible from the local network, not just localhost.
**Why it happens:** uvicorn default host is `0.0.0.0`.
**How to avoid:** Spawn backend with `--host 127.0.0.1` explicitly. This limits access to localhost only, which is correct for a desktop app.
**Warning signs:** `netstat` shows backend listening on `0.0.0.0:8000` instead of `127.0.0.1:8000`.

## Code Examples

Verified patterns from official sources and project codebase:

### Minimal Electron main.js Skeleton

```javascript
// electron/src/main.js
// Source: Electron official docs — https://www.electronjs.org/docs/latest/tutorial/quick-start
const { app, BrowserWindow, Tray, Menu } = require('electron');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const isDev = require('electron-is-dev');

const PROJECT_ROOT = isDev
  ? path.join(__dirname, '..', '..')
  : process.resourcesPath;

let mainWindow = null;
let tray = null;  // Module-level — prevents GC
let backendProcess = null;
let frontendProcess = null;

// --- STARTUP ---
app.whenReady().then(async () => {
  cleanupOrphans();
  createTray();
  createWindow();
  startBackend();
  startFrontend();
  try {
    await waitForServices();
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.once('ready-to-show', () => mainWindow.show());
    tray.setToolTip('Edit Factory');
  } catch (err) {
    // Show error dialog — services failed to start
    const { dialog } = require('electron');
    dialog.showErrorBox('Startup Failed', err.message);
    app.exit(1);
  }
});

// Prevent app quit when window is closed — tray keeps it alive
app.on('window-all-closed', () => {});

// Graceful shutdown
app.on('will-quit', (event) => {
  event.preventDefault();
  cleanup().then(() => app.exit(0));
});
```

### electron/package.json for Phase 48 Dev

```json
{
  "name": "edit-factory-shell",
  "version": "0.1.0",
  "description": "Edit Factory Desktop Shell",
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron ."
  },
  "devDependencies": {
    "electron": "^34.0.0",
    "electron-builder": "^25.0.0"
  },
  "dependencies": {
    "electron-is-dev": "^2.0.0"
  },
  "build": {
    "appId": "com.editfactory.app",
    "productName": "Edit Factory",
    "win": {
      "target": "nsis",
      "icon": "build/icon.ico"
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
      }
    ]
  }
}
```

**NOTE:** The `build.extraResources` config shown above is for Phase 52 reference. Phase 48 runs in dev mode via `electron .` — packaging is not done until Phase 52.

### Health Check Polling

```javascript
// Source: Node.js http module docs (stdlib)
function checkUrl(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => resolve(res.statusCode >= 200 && res.statusCode < 400))
      .on('error', () => resolve(false));
  });
}
```

### Tray Creation (Official Pattern)

```javascript
// Source: https://www.electronjs.org/docs/latest/tutorial/tray
const { app, Tray, Menu } = require('electron/main');
let tray;  // module-level
app.whenReady().then(() => {
  tray = new Tray('/path/to/icon.ico');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Edit Factory', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip('Edit Factory');
});
```

### Next.js Standalone Post-Build Copy (Windows-Compatible)

```javascript
// frontend/scripts/postbuild.js — run after `next build`
const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const base = path.join(__dirname, '..');
copyDir(path.join(base, '.next', 'static'), path.join(base, '.next', 'standalone', '.next', 'static'));
copyDir(path.join(base, 'public'), path.join(base, '.next', 'standalone', 'public'));
console.log('Standalone assets copied.');
```

Then update `frontend/package.json` `build` script to:
```json
"build": "next build && node scripts/postbuild.js"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Packaging Python with PyInstaller | Python venv copy (not PyInstaller) | v10 decision 2026-03-01 | Avoids antivirus false positives, PyTorch bundling fragility |
| Electron as UI renderer (WebView) | Electron as process orchestrator only | v10 decision 2026-03-01 | BrowserWindow loads localhost:3000 — no custom renderer needed |
| Custom process tray managers (pystray) | Electron shell with electron-builder | v10 decision 2026-03-01 | electron-builder + electron-updater eliminates custom installer code |
| `child_process.fork()` for child processes | `child_process.spawn()` for external processes | N/A | `fork()` is Node-to-Node IPC; `spawn()` is correct for Python and external Node processes |

**Deprecated/outdated:**
- `UtilityProcess` for Python spawning: UtilityProcess is for Node.js processes needing IPC with renderer, not for Python executables.
- `electron-squirrel-startup`: Windows installer helper for Squirrel (an older Windows installer). We use NSIS via electron-builder, not Squirrel.

## Open Questions

1. **Node.js binary for spawning Next.js standalone server in Phase 48 dev mode**
   - What we know: `process.execPath` in Electron dev mode (`electron .`) is the `electron` binary itself, not a standalone `node`. Passing `server.js` to it works only if Electron passes through to Node mode. In practice, `spawn(process.execPath, ['server.js'])` in Electron's main process actually spawns a new Electron process running as Node (because Electron sets `ELECTRON_RUN_AS_NODE=1` on forks). This is unreliable.
   - What's unclear: The cleanest Phase 48 dev-mode approach. Option A: rely on system `node` in PATH (acceptable for dev mode since devs have Node installed). Option B: find node via `which node` / `where node`. Option C: use the Node bundled in the project (`node_modules/.bin`-adjacent).
   - Recommendation: For Phase 48 dev mode, use system `node` from PATH. For Phase 52 packaging, a portable Node.js 22.x binary will be bundled per INST-02. Add a startup check that `node --version` returns something, and fail gracefully if not found.

2. **Windows-compatible static asset copy in postbuild step**
   - What we know: Unix `cp -r` does not work in Windows cmd.exe. The postbuild script must use Node's `fs` module or a cross-platform tool.
   - What's unclear: Whether the project CI/build runs in WSL (where `cp` works) or native Windows cmd.
   - Recommendation: Use the Node.js `fs` postbuild script approach (Pattern 6 above). Works on both Windows and WSL.

3. **electron-is-dev version compatibility with Electron 34**
   - What we know: `electron-is-dev@2.x` uses `app.isPackaged` for detection, which is the official Electron API for distinguishing dev from packaged. This API is stable.
   - What's unclear: Whether any breaking changes exist between electron-is-dev 2.x and Electron 34.
   - Recommendation: Use `app.isPackaged` directly rather than the package to avoid the dependency: `const isDev = !app.isPackaged`. This is the idiomatic Electron 14+ approach.

## Validation Architecture

> `nyquist_validation` is not set in `.planning/config.json` (key absent). Skipping this section.

## Sources

### Primary (HIGH confidence)
- [Electron official Tray tutorial](https://www.electronjs.org/docs/latest/tutorial/tray) — tray creation, setContextMenu, setToolTip, GC pitfall
- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window) — show: false, ready-to-show, loadURL
- [Electron app API](https://www.electronjs.org/docs/latest/api/app) — will-quit, window-all-closed, app.exit vs app.quit lifecycle
- [Electron Tray API](https://www.electronjs.org/docs/latest/api/tray) — constructor, setToolTip, setContextMenu, click events
- [electron-builder configuration docs](https://www.electron.build/configuration.html) — extraResources, files, FileSet format
- [electron-builder contents docs](https://www.electron.build/contents.html) — extraResources Windows path (`resources/`), process.resourcesPath
- Codebase audit: `app/desktop.py`, `app/config.py`, `app/main.py`, `app/api/routes.py` — confirmed Phase 47 deliverables, health endpoint at `/api/v1/health`, DESKTOP_MODE flag, venv structure at `venv/Scripts/`
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model) — main vs renderer, child_process vs UtilityProcess distinction

### Secondary (MEDIUM confidence)
- [Simon Willison's TIL — Bundling Python inside Electron](https://til.simonwillison.net/electron/python-inside-electron) — extraResources config pattern `{"from": "python", "to": "python", "filter": ["**/*"]}`, process.resourcesPath path resolution
- [electron-builder npm page](https://www.npmjs.com/package/electron-builder) — current version reference
- WebSearch: Electron tray icon Windows format — ICO with 16/32/48/256 layers recommended (multiple sources agree)
- [Next.js standalone server docs](https://github.com/vercel/next.js/discussions/38448) — server.js CWD requirement, PORT env var

### Tertiary (LOW confidence)
- WebSearch only: exact behavior of `process.execPath` vs system `node` for spawning Next.js server in Electron dev mode — needs validation during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Electron, electron-builder, and Node.js `child_process` are mature, stable, well-documented
- Architecture: HIGH — patterns verified against Electron official docs and existing codebase (Phase 47 deliverables confirmed)
- Pitfalls: HIGH for tray GC, Windows SIGTERM, static asset copy (documented issues); MEDIUM for process.execPath Node spawning nuance (confirmed as a known Electron quirk but Phase 48 solution depends on dev vs packaged mode distinction)

**Research date:** 2026-03-01
**Valid until:** 2026-09-01 (Electron 34.x stable; electron-builder 25.x stable)
