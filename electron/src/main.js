// electron/src/main.js
// Edit Factory Desktop Shell — Electron main process
// Spawns FastAPI backend + Next.js frontend, polls for readiness,
// opens BrowserWindow, manages tray icon, handles graceful shutdown.

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, shell } = require('electron');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// ---------- Path resolution ----------
const isDev = !app.isPackaged;

// Project root: electron/src/ -> electron/ -> project root
const PROJECT_ROOT = isDev
  ? path.resolve(__dirname, '..', '..')
  : process.resourcesPath;

// Python executable (Windows venv)
const PYTHON_EXE = isDev
  ? path.join(PROJECT_ROOT, 'venv', 'Scripts', 'python.exe')
  : path.join(process.resourcesPath, 'venv', 'Scripts', 'python.exe');

// Uvicorn executable (in venv Scripts)
const UVICORN_EXE = isDev
  ? path.join(PROJECT_ROOT, 'venv', 'Scripts', 'uvicorn.exe')
  : path.join(process.resourcesPath, 'venv', 'Scripts', 'uvicorn.exe');

// Next.js standalone server.js
const NEXT_STANDALONE_DIR = isDev
  ? path.join(PROJECT_ROOT, 'frontend', '.next', 'standalone')
  : path.join(process.resourcesPath, 'frontend', 'standalone');

// Flat standalone layout — outputFileTracingRoot in frontend/next.config.ts
// pins the workspace root so server.js stays at .next/standalone/server.js
// (no nested frontend/ subdir), matching where postbuild.js copies assets.
const NEXT_SERVER = path.join(NEXT_STANDALONE_DIR, 'server.js');

// Backend CWD — must be project root so `app.main:app` resolves
const BACKEND_CWD = isDev
  ? PROJECT_ROOT
  : process.resourcesPath;

// Icon path. In packaged mode the icon lives in resources/ (shipped via
// extraResources) — electron-builder excludes build/ from app.asar, so a
// build/icon.ico path inside the asar does NOT exist and new Tray() throws.
const ICON_PATH = isDev
  ? path.join(__dirname, '..', 'build', 'icon.ico')
  : path.join(process.resourcesPath, 'icon.ico');

// ---------- Constants ----------
const BACKEND_PORT = 8000;
// Uncommon port: 3000 collides with other local dev servers (Next/React,
// e.g. SITE_ZERO). cleanupOrphans() kills whatever holds this port on launch,
// so it must NOT be a port other projects use.
const FRONTEND_PORT = 3947;
const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/api/v1/health`;
const FRONTEND_HEALTH_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 60000;

// ---------- Logging ----------
// Backend/frontend stdout+stderr are invisible in the packaged app unless
// persisted — this is the only way to diagnose crashes in the field.
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'editfactory.log');
let logStream = null;

function initLogging() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // Simple rotation: at >5 MB, shift to .1 (keep one generation).
    // Done only at session start — no mid-write renames on Windows.
    try {
      if (fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
        fs.rmSync(LOG_FILE + '.1', { force: true });
        fs.renameSync(LOG_FILE, LOG_FILE + '.1');
      }
    } catch { /* no existing log */ }
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    logLine('launcher', `=== session start pid=${process.pid} v=${app.getVersion()} ===`);
  } catch (e) {
    console.error('[launcher] log init failed:', e.message);
  }
}

function logLine(tag, msg) {
  const line = `[${new Date().toISOString()}] [${tag}] ${msg}`;
  console.log(line);
  if (logStream) logStream.write(line + '\n');
}

// ---------- State ----------
let mainWindow = null;
let splashWindow = null;  // Branded splash shown during the 30-60s cold start
let tray = null;          // Module-level — prevents GC (Pitfall 1)
let backendProcess = null;
let frontendProcess = null;
let isQuitting = false;

// Auto-restart state (backend + frontend resilience)
const SERVICE_MAX_RESTARTS = 3;
const SERVICE_STABLE_MS = 60000;   // uptime after which the retry counter resets
let backendRestartCount = 0;
let backendStartedAt = 0;
let frontendRestartCount = 0;
let frontendStartedAt = 0;
let servicesReady = false;         // true once waitForServices() resolves

// ---------- Single instance lock ----------
// Without this, a second launch runs cleanupOrphans() and kills the first
// instance's backend on port 8000 (psutil terminate → exit code 15).
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Another instance is running — bail before whenReady/cleanupOrphans
  // can touch ports 8000/3000. will-quit early-returns when !isQuitting,
  // so this exit does not run cleanup(). Top-level return is valid in CJS.
  app.exit(0);
  return;
}

app.on('second-instance', () => {
  // User relaunched while we sit in tray — surface the existing window
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  // Only show if a URL is loaded; during startup the window is blank
  if (mainWindow.webContents.getURL()) {
    mainWindow.show();
    mainWindow.focus();
  }
});

// ---------- SHELL-05: Orphan cleanup on startup ----------
function cleanupOrphans() {
  logLine('launcher', 'Cleaning up orphaned processes...');
  try {
    const result = spawnSync(
      PYTHON_EXE,
      ['-m', 'app.platforms.desktop.service', 'cleanup', '--ports', String(BACKEND_PORT), String(FRONTEND_PORT)],
      { cwd: BACKEND_CWD, timeout: 10000, encoding: 'utf-8' }
    );
    if (result.stdout) logLine('launcher', `Orphan cleanup: ${result.stdout.trim()}`);
    if (result.stderr) logLine('launcher', `Orphan cleanup stderr: ${result.stderr.trim()}`);
  } catch (err) {
    logLine('launcher', `Orphan cleanup failed (non-fatal): ${err.message}`);
  }
}

// ---------- DATA-01: Seed Supabase credentials on first packaged run ----------
// Packaged desktop ships no .env. The backend reads %APPDATA%\EditFactory\.env as
// its highest-priority config source (config.py settings_customise_sources), so we
// copy the bundled credentials.env there once. This is what points the app at the
// same Supabase cloud as the web app. Idempotent: never overwrites an existing .env,
// so Settings-wizard edits (desktop/routes.py _write_env_keys) are preserved.
function seedDesktopEnv() {
  if (isDev) return;   // dev loads the project-root .env directly — nothing to seed
  try {
    const appData = process.env.APPDATA;
    if (!appData) {
      logLine('launcher', 'APPDATA missing — cannot seed credentials.env');
      return;
    }
    const baseDir = path.join(appData, 'EditFactory');
    const target = path.join(baseDir, '.env');
    if (fs.existsSync(target)) {
      logLine('launcher', 'AppData .env already present — leaving as-is');
      return;
    }
    const source = path.join(process.resourcesPath, 'credentials.env');
    if (!fs.existsSync(source)) {
      logLine('launcher', `Bundled credentials.env not found at ${source} — skipping seed`);
      return;
    }
    fs.mkdirSync(baseDir, { recursive: true });
    fs.copyFileSync(source, target);
    logLine('launcher', `Seeded credentials.env -> ${target}`);
  } catch (err) {
    logLine('launcher', `Credential seed failed (non-fatal): ${err.message}`);
  }
}

// ---------- SHELL-01: Spawn backend ----------
function startBackend() {
  logLine('launcher', 'Starting backend...');
  logLine('launcher', `Uvicorn: ${UVICORN_EXE}`);
  logLine('launcher', `CWD: ${BACKEND_CWD}`);

  backendStartedAt = Date.now();
  backendProcess = spawn(
    UVICORN_EXE,
    ['app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
    {
      cwd: BACKEND_CWD,
      env: {
        ...process.env,
        DESKTOP_MODE: 'true',
        // Cloud parity: desktop reads/writes the SAME Supabase cloud as the web
        // app (real projects/clips + per-profile API keys), instead of an empty
        // local SQLite DB. Credentials come from %APPDATA%\EditFactory\.env,
        // seeded by seedDesktopEnv() in packaged mode and from the project .env
        // in dev. Profile resolves to the cloud default profile (auth.py:310).
        DATA_BACKEND: 'supabase',
        // settings.host is read from HOST (default 0.0.0.0), separate from the
        // uvicorn --host bind. Desktop mode refuses any non-localhost host, so
        // pin it — the packaged app has no .env to supply HOST=127.0.0.1.
        HOST: '127.0.0.1',
        ...(isDev ? {} : { RESOURCES_PATH: process.resourcesPath }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  backendProcess.stdout.on('data', (data) => {
    logLine('backend', data.toString().trimEnd());
  });
  backendProcess.stderr.on('data', (data) => {
    logLine('backend', data.toString().trimEnd());
  });
  backendProcess.on('error', (err) => {
    logLine('backend', `Failed to start: ${err.message}`);
  });
  backendProcess.on('exit', (code, signal) => {
    logLine('backend', `exited code=${code} signal=${signal}`);
    backendProcess = null;
    if (isQuitting) return;                       // cleanup() killed it — expected

    if (Date.now() - backendStartedAt > SERVICE_STABLE_MS) {
      backendRestartCount = 0;                    // ran stable — fresh budget
    }

    if (backendRestartCount < SERVICE_MAX_RESTARTS) {
      backendRestartCount++;
      const delay = 1000 * 2 ** (backendRestartCount - 1);   // 1s, 2s, 4s
      logLine('launcher', `Backend died — restart ${backendRestartCount}/${SERVICE_MAX_RESTARTS} in ${delay}ms`);
      setTimeout(() => {
        if (!isQuitting && !backendProcess) startBackend();
      }, delay);
      return;
    }

    // Retries exhausted.
    if (!servicesReady) {
      // Still in startup: let waitForServices()' timeout produce the single
      // "Startup Failed" dialog instead of stacking a second one here.
      logLine('launcher', 'Backend restart budget exhausted during startup');
      return;
    }

    // A dialog parented to a hidden (tray) window would be invisible.
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'error',
      title: 'Backend Stopped',
      message: `The Edit Factory backend stopped unexpectedly (code: ${code}).`,
      detail: `Automatic restarts failed. Any running render was interrupted.\nLog file: ${LOG_FILE}`,
      buttons: ['Restart Backend', 'Quit Edit Factory'],
      defaultId: 0,
      cancelId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        backendRestartCount = 0;
        startBackend();
      } else {
        isQuitting = true;
        app.quit();        // will-quit → cleanup() → app.exit(0)
      }
    });
  });
}

// ---------- SHELL-01: Spawn frontend ----------
function startFrontend() {
  logLine('launcher', 'Starting frontend...');
  logLine('launcher', `Server: ${NEXT_SERVER}`);
  frontendStartedAt = Date.now();

  // Dev mode: use system node from PATH
  // Packaged mode (Phase 52): bundled portable Node.js
  const nodeExe = isDev ? 'node' : path.join(process.resourcesPath, 'node', 'node.exe');

  frontendProcess = spawn(
    nodeExe,
    [NEXT_SERVER],
    {
      cwd: NEXT_STANDALONE_DIR,
      env: {
        ...process.env,
        PORT: String(FRONTEND_PORT),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
        NEXT_PUBLIC_DESKTOP_MODE: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  frontendProcess.stdout.on('data', (data) => {
    logLine('frontend', data.toString().trimEnd());
  });
  frontendProcess.stderr.on('data', (data) => {
    logLine('frontend', data.toString().trimEnd());
  });
  frontendProcess.on('error', (err) => {
    logLine('frontend', `Failed to start: ${err.message}`);
  });
  frontendProcess.on('exit', (code, signal) => {
    logLine('frontend', `exited code=${code} signal=${signal}`);
    frontendProcess = null;
    if (isQuitting) return;

    if (Date.now() - frontendStartedAt > SERVICE_STABLE_MS) {
      frontendRestartCount = 0;
    }
    if (frontendRestartCount < SERVICE_MAX_RESTARTS) {
      frontendRestartCount++;
      const delay = 1000 * 2 ** (frontendRestartCount - 1);
      logLine('launcher', `Frontend died — restart ${frontendRestartCount}/${SERVICE_MAX_RESTARTS} in ${delay}ms`);
      setTimeout(() => {
        if (!isQuitting && !frontendProcess) startFrontend();
      }, delay);
      return;
    }
    logLine('launcher', 'Frontend restart budget exhausted');
  });
}

// ---------- SHELL-02: Health check polling ----------
function checkUrl(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => resolve(res.statusCode >= 200 && res.statusCode < 400))
      .on('error', () => resolve(false));
  });
}

// ---------- WIZD-01 / LICS-02 / LICS-04: Startup state helpers ----------
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

// Determine startup URL based on the simple desktop test-login state.
// (Replaces the old first-run/license gate — see /desktop/auth on the backend.)
async function checkStartupState() {
  const LOGIN_URL = `http://localhost:${FRONTEND_PORT}/login`;
  const APP_URL   = `http://localhost:${FRONTEND_PORT}`;

  try {
    const status = await httpGetJson(
      'http://127.0.0.1:8000/api/v1/desktop/auth/status'
    );
    if (status && status.logged_in === true) {
      return APP_URL;
    }
    logLine('launcher', 'Not logged in — routing to login');
    return LOGIN_URL;
  } catch (err) {
    // Backend unreachable — fail closed to the login screen.
    logLine('launcher', `Auth status check failed (non-fatal): ${err.message}`);
    return LOGIN_URL;
  }
}

// Branded splash window: shown immediately on launch so the user sees life
// during the 30-60s two-runtime cold start instead of a hidden/frozen window.
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 440,
    height: 300,
    frame: false,
    resizable: false,
    movable: true,
    show: true,
    center: true,
    alwaysOnTop: true,
    backgroundColor: '#0b0b0f',
    title: 'Edit Factory',
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html')).catch((e) => {
    logLine('launcher', `Splash load failed (non-fatal): ${e.message}`);
  });
  splashWindow.on('closed', () => { splashWindow = null; });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try { splashWindow.close(); } catch { /* already gone */ }
  }
  splashWindow = null;
}

function updateSplash(backOk, frontOk, elapsed) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  // A coarse time-based creep (capped) keeps the bar inching forward between
  // the two real milestones (API ready, UI ready) so it never looks frozen.
  const pct = Math.min(90, Math.round((elapsed / MAX_WAIT_MS) * 100));
  splashWindow.webContents
    .executeJavaScript(`window.__setStatus && window.__setStatus(${!!backOk}, ${!!frontOk}, ${pct})`)
    .catch(() => {});
}

function waitForServices() {
  return new Promise((resolve, reject) => {
    let elapsed = 0;
    if (tray) tray.setToolTip('Edit Factory — Starting...');

    const interval = setInterval(async () => {
      elapsed += POLL_INTERVAL_MS;

      const [backOk, frontOk] = await Promise.all([
        checkUrl(BACKEND_HEALTH_URL),
        checkUrl(FRONTEND_HEALTH_URL),
      ]);

      // Update tray tooltip with progress
      if (tray) {
        const status = [];
        if (backOk) status.push('API ready');
        else status.push('API starting...');
        if (frontOk) status.push('UI ready');
        else status.push('UI starting...');
        tray.setToolTip(`Edit Factory — ${status.join(', ')}`);
      }

      // Update the branded splash progress bar
      updateSplash(backOk, frontOk, elapsed);

      if (backOk && frontOk) {
        clearInterval(interval);
        if (tray) tray.setToolTip('Edit Factory');
        resolve();
      } else if (elapsed >= MAX_WAIT_MS) {
        clearInterval(interval);
        const msg = `Services did not start within ${MAX_WAIT_MS / 1000} seconds.\n`
          + `Backend: ${backOk ? 'ready' : 'not responding'}\n`
          + `Frontend: ${frontOk ? 'ready' : 'not responding'}`;
        reject(new Error(msg));
      }
    }, POLL_INTERVAL_MS);
  });
}

// ---------- SHELL-03: System tray ----------
function createTray() {
  // Build the tray image from a guaranteed-valid source: new Tray() throws on
  // a missing path (Electron 34), and the tray is essential here — window close
  // hides to tray, so without it the app becomes unreachable.
  let trayImage = nativeImage.createEmpty();
  if (fs.existsSync(ICON_PATH)) {
    const loaded = nativeImage.createFromPath(ICON_PATH);
    if (!loaded.isEmpty()) trayImage = loaded;
  } else {
    logLine('launcher', `WARN: icon.ico not found at: ${ICON_PATH} — tray will use a blank icon`);
  }

  tray = new Tray(trayImage);
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
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click tray icon opens the window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------- Application menu ----------
// Hide the default File/Edit/View/Window/Help bar but keep recovery
// accelerators alive (Ctrl+R reload, F12 devtools, zoom) via a hidden menu.
function setupApplicationMenu() {
  const template = [{
    label: 'View',
    submenu: [
      { role: 'reload' },                 // Ctrl+R
      { role: 'forceReload' },            // Ctrl+Shift+R
      { role: 'toggleDevTools' },         // Ctrl+Shift+I
      { label: 'Toggle DevTools (F12)', accelerator: 'F12', visible: false,
        click: () => mainWindow && mainWindow.webContents.toggleDevTools() },
      { type: 'separator' },
      { role: 'resetZoom' },              // Ctrl+0
      { role: 'zoomIn' },                 // Ctrl+Plus
      { role: 'zoomOut' },                // Ctrl+-
    ],
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC: native dialogs ----------
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'mpeg', 'mpg', '3gp', 'ogg'];

function registerIpcHandlers() {
  ipcMain.handle('dialog:select-videos', async (event) => {
    // Defense-in-depth: only serve our own UI origin
    try {
      const { hostname } = new URL(event.senderFrame.url);
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') return [];
    } catch {
      return [];
    }

    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(parent, {
      title: 'Select Video Files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video files', extensions: VIDEO_EXTENSIONS },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });
}

// ---------- SHELL-02: Create BrowserWindow ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,  // Hidden until services are ready
    title: 'Edit Factory',
    icon: ICON_PATH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Hidden menu keeps accelerators; bar never shows (Alt does not reveal it)
  mainWindow.setMenuBarVisibility(false);

  // External links (target="_blank" — e.g. "Get a free Gemini key →") open in
  // the system browser, not a bare Electron window. In-app navigation only.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Hide window instead of closing — tray keeps app alive
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------- SHELL-04: Graceful shutdown ----------
async function cleanup() {
  logLine('launcher', 'Shutting down services...');

  // Kill child processes directly
  if (backendProcess) {
    try { backendProcess.kill(); } catch (e) { /* already dead */ }
    backendProcess = null;
  }
  if (frontendProcess) {
    try { frontendProcess.kill(); } catch (e) { /* already dead */ }
    frontendProcess = null;
  }

  // Fallback: psutil cleanup to catch uvicorn worker processes (Pitfall 5)
  try {
    spawnSync(
      PYTHON_EXE,
      ['-m', 'app.platforms.desktop.service', 'cleanup', '--ports', String(BACKEND_PORT), String(FRONTEND_PORT)],
      { cwd: BACKEND_CWD, timeout: 5000, encoding: 'utf-8' }
    );
  } catch (err) {
    logLine('launcher', `Cleanup fallback failed: ${err.message}`);
  }

  // Brief settle time for ports to release
  await new Promise((r) => setTimeout(r, 500));
  logLine('launcher', 'Shutdown complete.');
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

// ---------- UPDT-01/02: Auto-update ----------
function setupAutoUpdater() {
  if (isDev) return;  // No update checks in dev mode (no app-update.yml exists)

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;  // We control install timing

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] Update available:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] App is up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] Downloading: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded:', info.version);
    // UPDT-02: Prompt user — never force restart mid-session
    if (isQuitting) return;  // Don't show dialog if app is shutting down
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
      // response === 1: "Later" — update applies on next launch automatically
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Auto-update error (non-fatal):', err.message);
  });

  // Start checking — download happens in background
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] Check failed (non-fatal):', err.message);
  });
}

// ---------- App lifecycle ----------

// Prevent app from quitting when window closes — tray keeps it alive
app.on('window-all-closed', () => {
  // Do NOT call app.quit() — tray icon keeps the app running
});

// Graceful shutdown on quit
app.on('will-quit', (event) => {
  if (!isQuitting) return;  // Let normal close-to-tray behavior work
  event.preventDefault();
  cleanup().then(() => app.exit(0));
});

// ---------- Main startup ----------
app.whenReady().then(async () => {
  initLogging();
  logLine('launcher', 'Edit Factory starting...');
  logLine('launcher', `Dev mode: ${isDev}`);
  logLine('launcher', `Project root: ${PROJECT_ROOT}`);

  // Whole startup wrapped so a throw is LOGGED + shown, never a silent zombie
  // process with no window (the original "opens but no window" bug).
  try {
    // SHELL-05: Clean up orphaned processes from previous launches
    cleanupOrphans();

    // Hidden app menu (no bar, accelerators only) + native dialog IPC
    setupApplicationMenu();
    registerIpcHandlers();

    // SHELL-03: Create tray icon
    createTray();

    // Branded splash — visible immediately so the cold start never looks frozen
    createSplash();

    // SHELL-02: Create hidden window
    createWindow();

    // DATA-01: Seed Supabase credentials into %APPDATA%\EditFactory\.env (first
    // packaged run only) so the backend connects to the cloud, not local SQLite.
    seedDesktopEnv();

    // SHELL-01: Spawn services
    startBackend();
    startFrontend();

    // SHELL-02: Wait for services, then show window
    await waitForServices();
    servicesReady = true;
    logLine('launcher', 'Services ready — checking startup state...');

    // WIZD-01 / LICS-02 / LICS-04: Determine correct startup URL
    const startupUrl = await checkStartupState();

    logLine('launcher', `Loading: ${startupUrl}`);
    mainWindow.loadURL(startupUrl);
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      closeSplash();  // Hand off from splash to the real window
    });
    tray.setToolTip('Edit Factory');

    // UPDT-01: Check for updates after services are confirmed running
    setupAutoUpdater();
  } catch (err) {
    logLine('launcher', `Startup failed: ${err.stack || err.message}`);
    closeSplash();  // Don't leave the splash hanging over the error dialog
    dialog.showErrorBox('Startup Failed', String(err.stack || err.message));
    isQuitting = true;
    await cleanup();
    app.exit(1);
  }
});
