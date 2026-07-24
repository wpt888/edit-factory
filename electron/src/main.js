// electron/src/main.js
// Blipost Desktop Shell — Electron main process
// Spawns FastAPI backend + Next.js frontend, polls for readiness,
// opens BrowserWindow, manages tray icon, handles graceful shutdown.

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} = require("electron");
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { autoUpdater } = require("electron-updater");
const { mergeBundledDesktopEnv, readEnvFile } = require("./desktop-env");

// ---------- Path resolution ----------
const isDev = !app.isPackaged;

// Project root: electron/src/ -> electron/ -> project root
const PROJECT_ROOT = isDev
  ? path.resolve(__dirname, "..", "..")
  : process.resourcesPath;

// Python executable (Windows venv)
const PYTHON_EXE = isDev
  ? path.join(PROJECT_ROOT, "venv", "Scripts", "python.exe")
  : path.join(process.resourcesPath, "venv", "Scripts", "python.exe");

// Uvicorn executable (in venv Scripts)
const UVICORN_EXE = isDev
  ? path.join(PROJECT_ROOT, "venv", "Scripts", "uvicorn.exe")
  : path.join(process.resourcesPath, "venv", "Scripts", "uvicorn.exe");

// Next.js standalone server.js
const NEXT_STANDALONE_DIR = isDev
  ? path.join(PROJECT_ROOT, "frontend", ".next", "standalone")
  : path.join(process.resourcesPath, "frontend", "standalone");

// Flat standalone layout — outputFileTracingRoot in frontend/next.config.ts
// pins the workspace root so server.js stays at .next/standalone/server.js
// (no nested frontend/ subdir), matching where postbuild.js copies assets.
const NEXT_SERVER = path.join(NEXT_STANDALONE_DIR, "server.js");

// Backend CWD — must be project root so `app.main:app` resolves
const BACKEND_CWD = isDev ? PROJECT_ROOT : process.resourcesPath;

// Icon path. In packaged mode the icon lives in resources/ (shipped via
// extraResources) — electron-builder excludes build/ from app.asar, so a
// build/icon.ico path inside the asar does NOT exist and new Tray() throws.
const ICON_PATH = isDev
  ? path.join(__dirname, "..", "build", "icon.ico")
  : path.join(process.resourcesPath, "icon.ico");

// ---------- Constants ----------
const BACKEND_PORT = 8000;
// Uncommon port: 3000 collides with other local dev servers (Next/React,
// e.g. SITE_ZERO). cleanupOrphans() kills whatever holds this port on launch,
// so it must NOT be a port other projects use.
const FRONTEND_PORT = 3947;
const BACKEND_HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/api/v1/health/live`;
const FRONTEND_HEALTH_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 60000;
const HEALTH_REQUEST_TIMEOUT_MS = 2000;

// ---------- Logging ----------
// Backend/frontend stdout+stderr are invisible in the packaged app unless
// persisted — this is the only way to diagnose crashes in the field.
const LOG_DIR = path.join(app.getPath("userData"), "logs");
const LOG_FILE = path.join(LOG_DIR, "editfactory.log");
let logStream = null;

function initLogging() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // Simple rotation: at >5 MB, shift to .1 (keep one generation).
    // Done only at session start — no mid-write renames on Windows.
    try {
      if (fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
        fs.rmSync(LOG_FILE + ".1", { force: true });
        fs.renameSync(LOG_FILE, LOG_FILE + ".1");
      }
    } catch {
      /* no existing log */
    }
    logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
    logLine(
      "launcher",
      `=== session start pid=${process.pid} v=${app.getVersion()} ===`,
    );
  } catch (e) {
    console.error("[launcher] log init failed:", e.message);
  }
}

function logLine(tag, msg) {
  const line = `[${new Date().toISOString()}] [${tag}] ${msg}`;
  console.log(line);
  if (logStream) logStream.write(line + "\n");
}

// ---------- State ----------
let mainWindow = null;
let splashWindow = null; // Branded splash shown during the 30-60s cold start
let tray = null; // Module-level — prevents GC (Pitfall 1)
let backendProcess = null;
let frontendProcess = null;
let isQuitting = false;
let trayHintShown = false; // one-time "still running in tray" balloon (audit #30)
let splashProgress = { percentage: 6, label: "Launching Blipost…" };

// Auto-restart state (backend + frontend resilience)
const SERVICE_MAX_RESTARTS = 3;
const SERVICE_STABLE_MS = 60000; // uptime after which the retry counter resets
let backendRestartCount = 0;
let backendStartedAt = 0;
let frontendRestartCount = 0;
let frontendStartedAt = 0;
let servicesReady = false; // true once waitForServices() resolves
let recoveryRestarting = false;

function surfaceMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();

  // Windows can refuse foreground activation when the request originates in
  // a second process. Pulse always-on-top, then restore normal z-order.
  mainWindow.setAlwaysOnTop(true);
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.moveTop();
    mainWindow.focus();
  }, 250);
  return true;
}

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

app.on("second-instance", async () => {
  // User relaunched while we sit in tray — surface the existing window
  const surfaced = mainWindow?.webContents.getURL()
    ? surfaceMainWindow()
    : false;
  logLine("launcher", `Second instance requested; window surfaced=${surfaced}`);

  const [backendHealthy, frontendHealthy] = await Promise.all([
    checkUrl(BACKEND_HEALTH_URL),
    checkUrl(FRONTEND_HEALTH_URL),
  ]);
  if ((backendHealthy && frontendHealthy) || recoveryRestarting) return;

  recoveryRestarting = true;
  logLine(
    "launcher",
    `Existing instance is unhealthy (backend=${backendHealthy}, frontend=${frontendHealthy}); restarting`,
  );
  isQuitting = true;
  await cleanup();
  app.relaunch();
  app.exit(0);
});

// ---------- SHELL-05: Orphan cleanup on startup ----------
function cleanupOrphans() {
  // In dev, DON'T sweep the backend port (8000): a developer commonly has the
  // web app's backend (python run.py) running there, and killing it silently is
  // a nasty footgun (audit #18). Only reclaim the desktop frontend port in dev.
  // In packaged mode there's no such collision, so sweep both ports.
  const ports = isDev
    ? [String(FRONTEND_PORT)]
    : [String(BACKEND_PORT), String(FRONTEND_PORT)];
  logLine(
    "launcher",
    `Cleaning up orphaned processes on ports ${ports.join(", ")} (async)...`,
  );
  return new Promise((resolve) => {
    let out = "",
      err = "";
    let proc;
    try {
      proc = spawn(
        PYTHON_EXE,
        ["-m", "app.platforms.desktop.service", "cleanup", "--ports", ...ports],
        { cwd: BACKEND_CWD, encoding: "utf-8", windowsHide: true },
      );
    } catch (e) {
      logLine(
        "launcher",
        `Orphan cleanup spawn failed (non-fatal): ${e.message}`,
      );
      return resolve();
    }
    if (proc.stdout)
      proc.stdout.on("data", (d) => {
        out += d;
      });
    if (proc.stderr)
      proc.stderr.on("data", (d) => {
        err += d;
      });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already done */
      }
      logLine("launcher", "Orphan cleanup timed out (non-fatal)");
      resolve();
    }, 8000);
    proc.on("close", () => {
      clearTimeout(timer);
      if (out.trim()) logLine("launcher", `Orphan cleanup: ${out.trim()}`);
      if (err.trim())
        logLine("launcher", `Orphan cleanup stderr: ${err.trim()}`);
      resolve();
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      logLine("launcher", `Orphan cleanup failed (non-fatal): ${e.message}`);
      resolve();
    });
  });
}

// ---------- DATA-01: Merge desktop-safe cloud configuration ----------
// Packaged desktop ships no .env. The backend reads %APPDATA%\EditFactory\.env as
// its highest-priority config source (config.py settings_customise_sources), so we
// merge the bundled credentials.env into it. Missing safe keys are added on every
// version, while non-empty existing values and Settings-wizard edits are preserved.
function seedDesktopEnv() {
  if (isDev) return; // dev loads the project-root .env directly — nothing to seed
  try {
    const appData = process.env.APPDATA;
    if (!appData) {
      logLine("launcher", "APPDATA missing — cannot seed credentials.env");
      return;
    }
    const baseDir = path.join(appData, "EditFactory");
    const target = path.join(baseDir, ".env");
    const source = path.join(process.resourcesPath, "credentials.env");
    if (!fs.existsSync(source)) {
      logLine(
        "launcher",
        `Bundled credentials.env not found at ${source} — skipping seed`,
      );
      return;
    }
    const addedKeys = mergeBundledDesktopEnv(target, source);
    if (addedKeys.length > 0) {
      logLine(
        "launcher",
        `Added missing desktop config keys to ${target}: ${addedKeys.join(", ")}`,
      );
    } else {
      logLine("launcher", "AppData .env already contains the desktop cloud configuration");
    }
  } catch (err) {
    logLine("launcher", `Credential seed failed (non-fatal): ${err.message}`);
  }
}

// DATA-02: Confirm the backend will actually have Supabase credentials before we
// start it. Desktop forces DATA_BACKEND=supabase with NO SQLite fallback, so a
// failed/empty seed would otherwise produce a silently broken data layer where
// every project/clip/render op errors with no explanation (audit #22).
function desktopCredentialsPresent() {
  if (isDev) return true; // dev uses the project-root .env (developer-managed)
  try {
    const envPath = path.join(process.env.APPDATA || "", "EditFactory", ".env");
    if (!fs.existsSync(envPath)) return false;
    const env = readEnvFile(envPath);
    const has = (key) => Boolean(env[key]?.trim());
    return has("SUPABASE_URL") && has("SUPABASE_KEY") && has("MINIO_PUBLIC_URL");
  } catch {
    return false;
  }
}

// ---------- SHELL-01: Spawn backend ----------
function startBackend() {
  logLine("launcher", "Starting backend...");
  logLine("launcher", `Uvicorn: ${UVICORN_EXE}`);
  logLine("launcher", `CWD: ${BACKEND_CWD}`);

  backendStartedAt = Date.now();
  backendProcess = spawn(
    UVICORN_EXE,
    ["app.main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)],
    {
      cwd: BACKEND_CWD,
      env: {
        ...process.env,
        DESKTOP_MODE: "true",
        // Desktop accounts use real Supabase identities, even when the project
        // .env enables the local developer bypass.
        AUTH_DISABLED: "false",
        // Cloud parity: desktop reads/writes the SAME Supabase cloud as the web
        // app (real projects/clips + per-profile API keys), instead of an empty
        // local SQLite DB. Credentials come from %APPDATA%\EditFactory\.env,
        // seeded by seedDesktopEnv() in packaged mode and from the project .env
        // in dev. Profile resolves to the cloud default profile (auth.py:310).
        DATA_BACKEND: "supabase",
        // settings.host is read from HOST (default 0.0.0.0), separate from the
        // uvicorn --host bind. Desktop mode refuses any non-localhost host, so
        // pin it — the packaged app has no .env to supply HOST=127.0.0.1.
        HOST: "127.0.0.1",
        ...(isDev ? {} : { RESOURCES_PATH: process.resourcesPath }),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  backendProcess.stdout.on("data", (data) => {
    logLine("backend", data.toString().trimEnd());
  });
  backendProcess.stderr.on("data", (data) => {
    logLine("backend", data.toString().trimEnd());
  });
  backendProcess.on("error", (err) => {
    logLine("backend", `Failed to start: ${err.message}`);
  });
  backendProcess.on("exit", (code, signal) => {
    logLine("backend", `exited code=${code} signal=${signal}`);
    backendProcess = null;
    if (isQuitting) return; // cleanup() killed it — expected

    if (Date.now() - backendStartedAt > SERVICE_STABLE_MS) {
      backendRestartCount = 0; // ran stable — fresh budget
    }

    if (backendRestartCount < SERVICE_MAX_RESTARTS) {
      backendRestartCount++;
      const delay = 1000 * 2 ** (backendRestartCount - 1); // 1s, 2s, 4s
      logLine(
        "launcher",
        `Backend died — restart ${backendRestartCount}/${SERVICE_MAX_RESTARTS} in ${delay}ms`,
      );
      setTimeout(() => {
        if (!isQuitting && !backendProcess) startBackend();
      }, delay);
      return;
    }

    // Retries exhausted.
    if (!servicesReady) {
      // Still in startup: let waitForServices()' timeout produce the single
      // "Startup Failed" dialog instead of stacking a second one here.
      logLine("launcher", "Backend restart budget exhausted during startup");
      return;
    }

    // A dialog parented to a hidden (tray) window would be invisible.
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    dialog
      .showMessageBox(mainWindow || undefined, {
        type: "error",
        title: "Backend Stopped",
        message: `The Blipost backend stopped unexpectedly (code: ${code}).`,
        detail: `Automatic restarts failed. Any running render was interrupted.\nLog file: ${LOG_FILE}`,
        buttons: ["Restart Backend", "Quit Blipost"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          backendRestartCount = 0;
          startBackend();
        } else {
          isQuitting = true;
          app.quit(); // will-quit → cleanup() → app.exit(0)
        }
      });
  });
}

// ---------- SHELL-01: Spawn frontend ----------
function resolveNodeExecutable() {
  if (!isDev) return path.join(process.resourcesPath, "node", "node.exe");

  // npm exposes the exact Node binary used to launch the script. Prefer it to
  // PATH because Electron launched through npm/nvm-windows can inherit a PATH
  // where a bare `node` lookup fails with ENOENT.
  const candidates = [process.env.npm_node_execpath, process.env.NODE];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === "win32") {
    const result = spawnSync("where.exe", ["node"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) {
      const candidate = result.stdout
        .split(/\r?\n/)
        .find((line) => line.trim());
      if (candidate && fs.existsSync(candidate.trim())) return candidate.trim();
    }
  }

  return "node";
}

function startFrontend() {
  logLine("launcher", "Starting frontend...");
  logLine("launcher", `Server: ${NEXT_SERVER}`);
  frontendStartedAt = Date.now();

  if (!fs.existsSync(NEXT_SERVER)) {
    throw new Error(
      `Frontend bundle is missing: ${NEXT_SERVER}\n` +
        "Run npm run dev again; the predev check should rebuild it automatically.",
    );
  }

  // Dev mode: use npm's exact Node executable. Packaged mode: bundled Node.js.
  const nodeExe = resolveNodeExecutable();
  if (path.isAbsolute(nodeExe) && !fs.existsSync(nodeExe)) {
    throw new Error(`Node.js runtime is missing: ${nodeExe}`);
  }
  logLine("launcher", `Node: ${nodeExe}`);

  frontendProcess = spawn(nodeExe, [NEXT_SERVER], {
    // Do not make the running process use the generated bundle as its CWD.
    // On Windows a process CWD keeps that directory locked, so the next
    // `next build` cannot replace `.next/standalone` and fails with EBUSY.
    // The generated server resolves its assets relative to server.js.
    cwd: path.dirname(NEXT_STANDALONE_DIR),
    env: {
      ...process.env,
      PORT: String(FRONTEND_PORT),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      NEXT_PUBLIC_DESKTOP_MODE: "true",
      NEXT_PUBLIC_AUTH_DISABLED: "false",
      AUTH_DISABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  frontendProcess.stdout.on("data", (data) => {
    logLine("frontend", data.toString().trimEnd());
  });
  frontendProcess.stderr.on("data", (data) => {
    logLine("frontend", data.toString().trimEnd());
  });
  frontendProcess.on("error", (err) => {
    logLine("frontend", `Failed to start: ${err.message}`);
  });
  frontendProcess.on("exit", (code, signal) => {
    logLine("frontend", `exited code=${code} signal=${signal}`);
    frontendProcess = null;
    if (isQuitting) return;

    if (Date.now() - frontendStartedAt > SERVICE_STABLE_MS) {
      frontendRestartCount = 0;
    }
    if (frontendRestartCount < SERVICE_MAX_RESTARTS) {
      frontendRestartCount++;
      const delay = 1000 * 2 ** (frontendRestartCount - 1);
      logLine(
        "launcher",
        `Frontend died — restart ${frontendRestartCount}/${SERVICE_MAX_RESTARTS} in ${delay}ms`,
      );
      setTimeout(() => {
        if (!isQuitting && !frontendProcess) startFrontend();
      }, delay);
      return;
    }
    // Retries exhausted.
    if (!servicesReady) {
      // Still starting up: let waitForServices()'s timeout raise the single
      // "Startup Failed" dialog instead of stacking a second one here.
      logLine("launcher", "Frontend restart budget exhausted during startup");
      return;
    }

    // Mirror the backend recovery dialog (audit #21) — otherwise a dead frontend
    // leaves the window stale/blank with no way for the user to recover.
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    dialog
      .showMessageBox(mainWindow || undefined, {
        type: "error",
        title: "Interface Stopped",
        message: `The Blipost interface stopped unexpectedly (code: ${code}).`,
        detail: `Automatic restarts failed, so the window may be blank or stale.\nLog file: ${LOG_FILE}`,
        buttons: ["Restart Interface", "Quit Blipost"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          frontendRestartCount = 0;
          startFrontend();
          // Best-effort: reload the window once the frontend is back up.
          setTimeout(() => {
            try {
              if (mainWindow) mainWindow.reload();
            } catch {
              /* gone */
            }
          }, 3000);
        } else {
          isQuitting = true;
          app.quit();
        }
      });
  });
}

// ---------- SHELL-02: Health check polling ----------
function checkUrl(url) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = http.get(url, (res) => {
      const ok = res.statusCode >= 200 && res.statusCode < 400;
      res.resume();
      res.once("end", () => finish(ok));
      res.once("error", () => finish(false));
    });
    req.setTimeout(HEALTH_REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      finish(false);
    });
    req.once("error", () => finish(false));
  });
}

// Supabase session restoration in the renderer decides whether login is needed.
async function checkStartupState() {
  // Open the canonical initial Pipeline URL directly. Loading `/` first would
  // cause two consecutive renderer navigations (`/` -> `/pipeline` ->
  // `/pipeline?step=1`) and abort the API requests started by the middle page.
  return `http://127.0.0.1:${FRONTEND_PORT}/pipeline?step=1`;
}

// Branded splash window: shown immediately on launch so the user sees life
// during the 30-60s two-runtime cold start instead of a hidden/frozen window.
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 760,
    height: 460,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    show: true,
    center: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: "#00000000",
    title: "Blipost",
    icon: ICON_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.webContents.on("did-finish-load", () => {
    updateSplash(splashProgress.percentage, splashProgress.label);
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html")).catch((e) => {
    logLine("launcher", `Splash load failed (non-fatal): ${e.message}`);
  });
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try {
      splashWindow.close();
    } catch {
      /* already gone */
    }
  }
  splashWindow = null;
}

function updateSplash(percentage, label) {
  const nextPercentage = Math.max(
    splashProgress.percentage,
    Math.min(100, Math.round(Number(percentage) || 0)),
  );
  splashProgress = {
    percentage: nextPercentage,
    label: label || splashProgress.label,
  };
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents
    .executeJavaScript(
      `window.__setProgress && window.__setProgress(${nextPercentage}, ${JSON.stringify(splashProgress.label)})`,
    )
    .catch(() => {});
}

function updateServiceSplash(backOk, frontOk, elapsed) {
  const timeRatio = Math.min(1, elapsed / MAX_WAIT_MS);
  if (backOk && frontOk) {
    updateSplash(88, "Services ready");
  } else if (backOk) {
    updateSplash(62 + timeRatio * 20, "Building workspace…");
  } else if (frontOk) {
    updateSplash(58 + timeRatio * 22, "Connecting creative engine…");
  } else {
    updateSplash(28 + timeRatio * 30, "Starting creative engine…");
  }
}

async function waitForServices() {
  const startedAt = Date.now();
  let previousBackOk = null;
  let previousFrontOk = null;
  if (tray) tray.setToolTip("Blipost — Starting...");

  // Poll sequentially. An async setInterval allowed requests to overlap when a
  // connection stalled, producing request bursts and a false final status.
  while (true) {
    const [backOk, frontOk] = await Promise.all([
      checkUrl(BACKEND_HEALTH_URL),
      checkUrl(FRONTEND_HEALTH_URL),
    ]);
    const elapsed = Date.now() - startedAt;

    if (backOk !== previousBackOk || frontOk !== previousFrontOk) {
      logLine(
        "launcher",
        `Service status: backend=${backOk ? "ready" : "waiting"}, frontend=${frontOk ? "ready" : "waiting"}`,
      );
      previousBackOk = backOk;
      previousFrontOk = frontOk;
    }

    if (tray) {
      const status = [
        backOk ? "API ready" : "API starting...",
        frontOk ? "UI ready" : "UI starting...",
      ];
      tray.setToolTip(`Blipost — ${status.join(", ")}`);
    }

    updateServiceSplash(backOk, frontOk, elapsed);

    if (backOk && frontOk) {
      if (tray) tray.setToolTip("Blipost");
      return;
    }
    if (elapsed >= MAX_WAIT_MS) {
      const msg =
        `Services did not start within ${MAX_WAIT_MS / 1000} seconds.\n` +
        `Backend: ${backOk ? "ready" : "not responding"}\n` +
        `Frontend: ${frontOk ? "ready" : "not responding"}\n` +
        `Log: ${LOG_FILE}`;
      throw new Error(msg);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
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
    logLine(
      "launcher",
      `WARN: icon.ico not found at: ${ICON_PATH} — tray will use a blank icon`,
    );
  }

  tray = new Tray(trayImage);
  tray.setToolTip("Blipost — Starting...");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Blipost",
      click: () => {
        surfaceMainWindow();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click tray icon opens the window
  tray.on("double-click", () => {
    surfaceMainWindow();
  });
}

// ---------- Application menu ----------
// Hide the default File/Edit/View/Window/Help bar but keep recovery
// accelerators alive (Ctrl+R reload, F12 devtools, zoom) via a hidden menu.
function setupApplicationMenu() {
  const template = [
    {
      label: "View",
      submenu: [
        { role: "reload" }, // Ctrl+R
        { role: "forceReload" }, // Ctrl+Shift+R
        { role: "toggleDevTools" }, // Ctrl+Shift+I
        {
          label: "Toggle DevTools (F12)",
          accelerator: "F12",
          visible: false,
          click: () => mainWindow && mainWindow.webContents.toggleDevTools(),
        },
        { type: "separator" },
        { role: "resetZoom" }, // Ctrl+0
        { role: "zoomIn" }, // Ctrl+Plus
        { role: "zoomOut" }, // Ctrl+-
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC: native dialogs ----------
const VIDEO_EXTENSIONS = [
  "mp4",
  "mov",
  "avi",
  "mkv",
  "wmv",
  "flv",
  "webm",
  "mpeg",
  "mpg",
  "3gp",
  "ogg",
];

function registerIpcHandlers() {
  ipcMain.on("renderer:error", (event, details) => {
    try {
      const { hostname } = new URL(event.senderFrame.url);
      if (hostname !== "localhost" && hostname !== "127.0.0.1") return;
    } catch {
      return;
    }
    const location = details?.source
      ? `${details.source}:${details.line || 0}:${details.column || 0}`
      : "unknown source";
    logLine(
      "renderer",
      `${details?.type || "error"}: ${details?.message || "Unknown error"} at ${location}\n${details?.stack || ""}`,
    );
  });

  // Custom title bar window controls (main window is frameless — see createWindow)
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:toggle-maximize", () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());
  ipcMain.handle(
    "window:is-maximized",
    () => mainWindow?.isMaximized() ?? false,
  );

  ipcMain.handle("shell:open-external", async (event, rawUrl) => {
    try {
      const sender = new URL(event.senderFrame.url);
      if (sender.hostname !== "localhost" && sender.hostname !== "127.0.0.1")
        return false;
      const target = new URL(String(rawUrl));
      if (target.protocol !== "https:" && target.protocol !== "http:")
        return false;
      await shell.openExternal(target.toString());
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("dialog:select-videos", async (event) => {
    // Defense-in-depth: only serve our own UI origin
    try {
      const { hostname } = new URL(event.senderFrame.url);
      if (hostname !== "localhost" && hostname !== "127.0.0.1") return [];
    } catch {
      return [];
    }

    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(parent, {
      title: "Select Video Files",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Video files", extensions: VIDEO_EXTENSIONS },
        { name: "All files", extensions: ["*"] },
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
    show: false, // Hidden until services are ready
    backgroundColor: "#0a0a08", // blipost ink — matches app --background
    title: "Blipost",
    icon: ICON_PATH,
    frame: false, // custom title bar (frontend/src/components/desktop-titlebar.tsx) replaces native chrome
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Hidden menu keeps accelerators; bar never shows (Alt does not reveal it)
  mainWindow.setMenuBarVisibility(false);

  // Persist renderer failures alongside backend/frontend logs. Production
  // Next.js otherwise reports only a generic client-side exception.
  mainWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      const source = sourceId
        ? `${sourceId}:${line || 0}`
        : `line:${line || 0}`;
      logLine("renderer", `[level=${level}] ${message} (${source})`);
    },
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logLine(
      "renderer",
      `Process gone: reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
  mainWindow.webContents.on("unresponsive", () => {
    logLine("renderer", "Window became unresponsive");
  });

  // Forward maximize state so the custom title bar can swap its icon
  mainWindow.on("maximize", () =>
    mainWindow.webContents.send("window:maximize-changed", true),
  );
  mainWindow.on("unmaximize", () =>
    mainWindow.webContents.send("window:maximize-changed", false),
  );

  // window.open handling:
  //  - Same-origin URLs (our backend/frontend on localhost) are almost always
  //    file downloads (?download=true). Trigger a NATIVE download via
  //    downloadURL() instead of launching the system browser pointed at
  //    localhost (which is confusing and, for some endpoints, unreachable).
  //  - Truly external links (e.g. "Get a free Gemini key →") open in the
  //    system browser. Never open a bare Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
        mainWindow.webContents.downloadURL(url);
        return { action: "deny" };
      }
    } catch {
      /* unparseable URL — fall through to external handling */
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Hide window instead of closing — tray keeps app alive
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      // One-time hint so users know closing the window did NOT quit the app —
      // the backend/frontend (and any render) keep running in the tray (audit #30).
      if (!trayHintShown && tray) {
        trayHintShown = true;
        try {
          tray.displayBalloon({
            title: "Blipost still running",
            content:
              "Minimized to the system tray. Right-click the tray icon to Quit.",
          });
        } catch {
          /* balloons unsupported on this platform */
        }
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------- SHELL-04: Graceful shutdown ----------
async function cleanup() {
  logLine("launcher", "Shutting down services...");

  // Kill the process TREES by port FIRST, while uvicorn still holds the port.
  // The port sweep kills uvicorn AND its recursive children — which is the only
  // way to catch in-flight ffmpeg render subprocesses. If we killed
  // backendProcess first, uvicorn (the port listener) would die and the
  // port-based sweep could no longer find the now-orphaned ffmpeg children,
  // leaving them running after the app exits (Pitfall 5 / audit #23).
  try {
    spawnSync(
      PYTHON_EXE,
      [
        "-m",
        "app.platforms.desktop.service",
        "cleanup",
        "--ports",
        String(BACKEND_PORT),
        String(FRONTEND_PORT),
      ],
      { cwd: BACKEND_CWD, timeout: 5000, encoding: "utf-8" },
    );
  } catch (err) {
    logLine("launcher", `Cleanup fallback failed: ${err.message}`);
  }

  // Then kill the direct child handles in case anything survived the sweep.
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch (e) {
      /* already dead */
    }
    backendProcess = null;
  }
  if (frontendProcess) {
    try {
      frontendProcess.kill();
    } catch (e) {
      /* already dead */
    }
    frontendProcess = null;
  }

  // Brief settle time for ports to release
  await new Promise((r) => setTimeout(r, 500));
  logLine("launcher", "Shutdown complete.");
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

// ---------- UPDT-01/02: Auto-update ----------
function setupAutoUpdater() {
  if (isDev) return; // No update checks in dev mode (no app-update.yml exists)

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // We control install timing

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] Update available:", info.version);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] App is up to date");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`[updater] Downloading: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] Update downloaded:", info.version);
    // UPDT-02: Prompt user — never force restart mid-session
    if (isQuitting) return; // Don't show dialog if app is shutting down
    dialog
      .showMessageBox(mainWindow || undefined, {
        type: "info",
        title: "Update Ready",
        message: `Blipost ${info.version} is ready to install.`,
        detail:
          "Restart the app now to apply the update, or continue working and restart later.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          isQuitting = true;
          autoUpdater.quitAndInstall();
        }
        // response === 1: "Later" — update applies on next launch automatically
      });
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] Auto-update error (non-fatal):", err.message);
  });

  // Start checking — download happens in background
  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[updater] Check failed (non-fatal):", err.message);
  });
}

// ---------- App lifecycle ----------

let signalQuitStarted = false;

function quitFromTerminalSignal(signal) {
  if (signalQuitStarted) return;
  signalQuitStarted = true;
  isQuitting = true;
  logLine("launcher", `Received ${signal}; quitting desktop services`);
  app.quit();
}

// In development Electron remains alive in the tray when its window closes.
// Treat terminal Ctrl+C / process termination as an explicit full quit so npm
// does not leave the standalone server and backend orphaned.
process.on("SIGINT", () => quitFromTerminalSignal("SIGINT"));
process.on("SIGTERM", () => quitFromTerminalSignal("SIGTERM"));

// Prevent app from quitting when window closes — tray keeps it alive
app.on("window-all-closed", () => {
  // Do NOT call app.quit() — tray icon keeps the app running
});

// Graceful shutdown on quit
app.on("will-quit", (event) => {
  if (!isQuitting) return; // Let normal close-to-tray behavior work
  event.preventDefault();
  cleanup().then(() => app.exit(0));
});

// ---------- Main startup ----------
app.whenReady().then(async () => {
  initLogging();
  logLine("launcher", "Blipost starting...");
  logLine("launcher", `Dev mode: ${isDev}`);
  logLine("launcher", `Project root: ${PROJECT_ROOT}`);

  // Whole startup wrapped so a throw is LOGGED + shown, never a silent zombie
  // process with no window (the original "opens but no window" bug).
  try {
    // Hidden app menu (no bar, accelerators only) + native dialog IPC
    setupApplicationMenu();
    registerIpcHandlers();

    // SHELL-03: Create tray icon
    createTray();

    // Branded splash — first thing visible; cold start can take 10-30s
    createSplash();
    updateSplash(10, "Preparing local workspace…");

    // SHELL-02: Create hidden window
    createWindow();

    // DATA-01: Seed Supabase credentials into %APPDATA%\EditFactory\.env (first
    // packaged run only) so the backend connects to the cloud, not local SQLite.
    seedDesktopEnv();

    // DATA-02: Warn loudly (not silently) if the backend will have no Supabase
    // credentials — desktop has no SQLite fallback, so every data op would fail.
    if (!desktopCredentialsPresent()) {
      logLine(
        "launcher",
        "WARNING: incomplete SUPABASE_URL/SUPABASE_KEY/MINIO_PUBLIC_URL in %APPDATA%\\EditFactory\\.env",
      );
      dialog
        .showMessageBox(undefined, {
          type: "warning",
          title: "Configuration Needed",
          message: "Blipost could not find its complete cloud configuration.",
          detail: `Projects, clips and Buffer scheduling need Supabase plus a public media URL. Reinstall or update Blipost to restore the bundled configuration.\n\nLog: ${LOG_FILE}`,
          buttons: ["Continue Anyway"],
        })
        .catch(() => {
          /* non-blocking */
        });
    }

    // SHELL-05: Kill orphaned processes from a previous crashed session.
    // Splash is already visible, so waiting here is fine — the user sees the
    // progress bar instead of a blank screen. Services must not start until
    // ports are free, otherwise uvicorn can fail to bind.
    await cleanupOrphans();
    updateSplash(20, "Workspace prepared");

    // Brief settle so killed listeners fully release their ports before we bind
    // (audit #29). On Windows, process exit != socket released immediately;
    // without this, uvicorn can hit EADDRINUSE and bounce through its restart
    // backoff, stalling the splash.
    await new Promise((r) => setTimeout(r, 400));

    // SHELL-01: Spawn services
    startBackend();
    startFrontend();
    updateSplash(28, "Starting creative engine…");

    // SHELL-02: Wait for services, then show window
    await waitForServices();
    servicesReady = true;
    updateSplash(91, "Restoring your workspace…");
    logLine("launcher", "Services ready — checking startup state...");

    // WIZD-01 / LICS-02 / LICS-04: Determine correct startup URL
    const startupUrl = await checkStartupState();
    updateSplash(95, "Opening Blipost…");

    // Robust load (audit #20): set up reveal handlers BEFORE loadURL so a
    // failed or stuck load can never leave the frameless always-on-top splash
    // hanging over a hidden main window. reveal() is idempotent.
    let windowRevealed = false;
    const reveal = () => {
      if (windowRevealed) return;
      windowRevealed = true;
      updateSplash(100, "Ready");
      try {
        mainWindow.show();
      } catch {
        /* window already gone */
      }
      // Let the final progress state register before handing off to the app.
      setTimeout(closeSplash, 180);
    };
    mainWindow.once("ready-to-show", reveal);
    mainWindow.webContents.on("did-fail-load", (_e, code, desc, failedUrl) => {
      logLine(
        "launcher",
        `Frontend load failed (${code} ${desc}) for ${failedUrl}`,
      );
      reveal(); // surface the window (even if blank) instead of an eternal splash
    });
    setTimeout(reveal, 15000); // last-resort safety net against a stuck splash

    logLine("launcher", `Loading: ${startupUrl}`);
    Promise.resolve(mainWindow.loadURL(startupUrl)).catch((e) => {
      logLine("launcher", `loadURL threw: ${e.message}`);
      reveal();
    });
    tray.setToolTip("Blipost");

    // UPDT-01: Check for updates after services are confirmed running
    setupAutoUpdater();
  } catch (err) {
    logLine("launcher", `Startup failed: ${err.stack || err.message}`);
    closeSplash(); // Don't leave the splash hanging over the error dialog
    dialog.showErrorBox("Startup Failed", String(err.stack || err.message));
    isQuitting = true;
    await cleanup();
    app.exit(1);
  }
});
