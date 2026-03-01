// electron/src/main.js
// Edit Factory Desktop Shell — Electron main process
// Spawns FastAPI backend + Next.js frontend, polls for readiness,
// opens BrowserWindow, manages tray icon, handles graceful shutdown.

const { app, BrowserWindow, Tray, Menu, dialog } = require('electron');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

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
      env: { ...process.env, DESKTOP_MODE: 'true' },
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
  // Use icon if it exists, otherwise Electron will show a default
  const iconExists = fs.existsSync(ICON_PATH);
  if (!iconExists) {
    console.warn('[launcher] Tray icon not found at:', ICON_PATH);
  }

  tray = new Tray(iconExists ? ICON_PATH : path.join(__dirname, '..', 'build', 'icon.png'));
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
    console.log('[launcher] Services ready — loading UI...');
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.once('ready-to-show', () => mainWindow.show());
    tray.setToolTip('Edit Factory');
  } catch (err) {
    console.error('[launcher] Startup failed:', err.message);
    dialog.showErrorBox('Startup Failed', err.message);
    isQuitting = true;
    await cleanup();
    app.exit(1);
  }
});
