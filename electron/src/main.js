// electron/src/main.js
// Edit Factory Desktop Shell — Electron main process
// Spawns FastAPI backend + Next.js frontend, polls for readiness,
// opens BrowserWindow, manages tray icon, handles graceful shutdown.

const { app, BrowserWindow, Tray, Menu, dialog } = require('electron');
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

const NEXT_SERVER = path.join(NEXT_STANDALONE_DIR, 'server.js');

// Backend CWD — must be project root so `app.main:app` resolves
const BACKEND_CWD = isDev
  ? PROJECT_ROOT
  : process.resourcesPath;

// Icon path
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico');

// ---------- Constants ----------
const BACKEND_PORT = 8000;
const FRONTEND_PORT = 3000;
const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/api/v1/health`;
const FRONTEND_HEALTH_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 60000;

// ---------- State ----------
let mainWindow = null;
let tray = null;          // Module-level — prevents GC (Pitfall 1)
let backendProcess = null;
let frontendProcess = null;
let isQuitting = false;

// ---------- SHELL-05: Orphan cleanup on startup ----------
function cleanupOrphans() {
  console.log('[launcher] Cleaning up orphaned processes...');
  try {
    const result = spawnSync(
      PYTHON_EXE,
      ['-m', 'app.desktop', 'cleanup', '--ports', String(BACKEND_PORT), String(FRONTEND_PORT)],
      { cwd: BACKEND_CWD, timeout: 10000, encoding: 'utf-8' }
    );
    if (result.stdout) console.log('[launcher] Orphan cleanup:', result.stdout.trim());
    if (result.stderr) console.error('[launcher] Orphan cleanup stderr:', result.stderr.trim());
  } catch (err) {
    console.error('[launcher] Orphan cleanup failed (non-fatal):', err.message);
  }
}

// ---------- SHELL-01: Spawn backend ----------
function startBackend() {
  console.log('[launcher] Starting backend...');
  console.log('[launcher] Uvicorn:', UVICORN_EXE);
  console.log('[launcher] CWD:', BACKEND_CWD);

  backendProcess = spawn(
    UVICORN_EXE,
    ['app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
    {
      cwd: BACKEND_CWD,
      env: {
        ...process.env,
        DESKTOP_MODE: 'true',
        ...(isDev ? {} : { RESOURCES_PATH: process.resourcesPath }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  backendProcess.stdout.on('data', (data) => {
    console.log('[backend]', data.toString().trim());
  });
  backendProcess.stderr.on('data', (data) => {
    console.error('[backend]', data.toString().trim());
  });
  backendProcess.on('error', (err) => {
    console.error('[backend] Failed to start:', err.message);
  });
  backendProcess.on('exit', (code, signal) => {
    console.log(`[backend] Exited with code=${code} signal=${signal}`);
    backendProcess = null;
    if (!isQuitting) {
      dialog.showErrorBox(
        'Backend Stopped',
        `The backend process exited unexpectedly (code: ${code}).\nPlease restart Edit Factory.`
      );
    }
  });
}

// ---------- SHELL-01: Spawn frontend ----------
function startFrontend() {
  console.log('[launcher] Starting frontend...');
  console.log('[launcher] Server:', NEXT_SERVER);

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
    console.log('[frontend]', data.toString().trim());
  });
  frontendProcess.stderr.on('data', (data) => {
    console.error('[frontend]', data.toString().trim());
  });
  frontendProcess.on('error', (err) => {
    console.error('[frontend] Failed to start:', err.message);
  });
  frontendProcess.on('exit', (code, signal) => {
    console.log(`[frontend] Exited with code=${code} signal=${signal}`);
    frontendProcess = null;
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

// WIZD-01 / LICS-02 / LICS-04: Determine startup URL based on first-run state and license
async function checkStartupState() {
  const SETUP_URL = 'http://localhost:3000/setup';
  const APP_URL   = 'http://localhost:3000';

  try {
    // Step 1: Check first-run state (WIZD-01)
    const settingsData = await httpGetJson(
      'http://127.0.0.1:8000/api/v1/desktop/settings'
    );
    if (!settingsData || settingsData.first_run_complete !== true) {
      console.log('[launcher] First run detected — routing to setup wizard');
      return SETUP_URL;
    }

    // Step 2: Validate license on subsequent launches (LICS-02 / LICS-04)
    const licenseStatus = await httpPost(
      'http://127.0.0.1:8000/api/v1/desktop/license/validate'
    );
    if (licenseStatus === 200) {
      return APP_URL;
    }
    // 403 = expired/invalid, 404 = not activated (LICS-04)
    console.log(`[launcher] License check returned ${licenseStatus} — routing to setup`);
    return SETUP_URL;

  } catch (err) {
    // Network error — graceful degradation (backend has its own 7-day grace period)
    console.warn('[launcher] Startup state check failed (non-fatal):', err.message);
    return APP_URL;
  }
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
  // Use brand icon — warn if missing (run generate-icon.js to create)
  const iconExists = fs.existsSync(ICON_PATH);
  if (!iconExists) {
    console.error('[launcher] WARN: icon.ico not found at:', ICON_PATH, '— run: node electron/build/generate-icon.js');
  }

  tray = new Tray(ICON_PATH);
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
    },
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
  console.log('[launcher] Shutting down services...');

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
      ['-m', 'app.desktop', 'cleanup', '--ports', String(BACKEND_PORT), String(FRONTEND_PORT)],
      { cwd: BACKEND_CWD, timeout: 5000, encoding: 'utf-8' }
    );
  } catch (err) {
    console.error('[launcher] Cleanup fallback failed:', err.message);
  }

  // Brief settle time for ports to release
  await new Promise((r) => setTimeout(r, 500));
  console.log('[launcher] Shutdown complete.');
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
  console.log('[launcher] Edit Factory starting...');
  console.log('[launcher] Dev mode:', isDev);
  console.log('[launcher] Project root:', PROJECT_ROOT);

  // SHELL-05: Clean up orphaned processes from previous launches
  cleanupOrphans();

  // SHELL-03: Create tray icon
  createTray();

  // SHELL-02: Create hidden window
  createWindow();

  // SHELL-01: Spawn services
  startBackend();
  startFrontend();

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
    console.error('[launcher] Startup failed:', err.message);
    dialog.showErrorBox('Startup Failed', err.message);
    isQuitting = true;
    await cleanup();
    app.exit(1);
  }
});
