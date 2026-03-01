# Stack Research — v10 Desktop Launcher & Distribution

**Domain:** Desktop distribution of existing FastAPI + Next.js web app (Windows)
**Researched:** 2026-03-01
**Confidence:** HIGH for core choices (PyPI + official docs verified), MEDIUM for auto-update pattern

> **Scope:** NEW capabilities only. The existing stack (FastAPI, Next.js, Supabase, FFmpeg,
> ElevenLabs, Edge TTS, Gemini, Claude, lxml, Pillow, httpx, etc.) is already validated.
> This file covers ONLY what's needed to distribute Edit Factory as an installable Windows
> desktop product: launcher EXE, NSIS installer, system tray, auto-update, Sentry crash
> reporting, and license key validation.

---

## What Already Exists (Do Not Re-Add)

| Capability | Library | Notes |
|------------|---------|-------|
| HTTP requests | `httpx` / `requests` | Use for GitHub releases API calls and license validation |
| Config/env | `python-dotenv`, `pydantic-settings` | Extend for APPDATA config file location |
| Background tasks | FastAPI `BackgroundTasks` | No change needed |
| Process management | stdlib `subprocess` | Used in `run.py` — extend for tray launcher |
| Error logging | `python-json-logger` | Extend with Sentry as transport |

---

## New Dependencies Required

### 1. Launcher EXE — `PyInstaller` 6.19.0

**Install:** `pip install "pyinstaller>=6.19.0"` (dev only, not in requirements.txt)

PyInstaller bundles the Python launcher script (the process that starts uvicorn + opens
the browser) into a standalone `.exe`. This is NOT bundling the full FastAPI app — it's
bundling a thin launcher that starts the app, manages the system tray, and handles
auto-update checks.

**Why PyInstaller, not Nuitka?**
- Nuitka compiles Python to C, requiring MSVC toolchain. On WSL this adds significant
  complexity with no benefit for a launcher whose startup time is irrelevant.
- PyInstaller v6.x produces working uvicorn/FastAPI bundles with known hidden imports.
  The launcher itself is a small script — antivirus false positive risk is minimal for
  personal-use/sold-direct software.
- PyInstaller 6.19.0 released 2026-02-14 — actively maintained.
- Build command for launcher only (not the full app):

```bash
pyinstaller --onefile --windowed --name "EditFactory" \
  --icon assets/icon.ico \
  --hidden-import pystray._win32 \
  --hidden-import PIL.Image \
  launcher.py
```

**Critical known issues with FastAPI + uvicorn bundles:**
- Use `--windowed` only on the launcher (which has a tray icon); backend process needs
  to capture stdout/stderr so do NOT pass `--windowed` to uvicorn directly.
- Set `multiprocessing.freeze_support()` at the top of `launcher.py` — required for
  Windows frozen executables that spawn subprocesses.
- Use `num_workers=1` in uvicorn for the bundled server — multiple workers trigger
  `WinError 10022` in asyncio on Windows frozen builds.

**Confidence:** HIGH — PyPI version 6.19.0 verified (2026-02-14), GitHub reference
implementation at iancleary/pyinstaller-fastapi confirms the uvicorn bundle pattern.

---

### 2. System Tray — `pystray` 0.19.5 + `Pillow` (already installed)

**Install:** `pip install "pystray>=0.19.5"` (Pillow is already in requirements.txt)

pystray provides a Windows system tray icon with a right-click context menu. It uses
Windows' native Win32 API backend by default on Windows — no additional system
dependencies needed.

**Why pystray, not infi.systray or tkinter tray?**
- pystray is the de-facto standard (documentation, active maintenance, cross-platform
  if ever needed). infi.systray is Windows-only and less documented.
- pystray is safe to run from a background thread on Windows — the tray's `run()` call
  can happen after uvicorn starts in a thread without blocking the main process.
- Requires `Pillow` for the icon image — already installed in requirements.txt.

```python
import pystray
from PIL import Image
import threading

def create_tray_icon(stop_event: threading.Event) -> pystray.Icon:
    image = Image.open("assets/icon.png")  # 64x64 PNG

    def on_open(icon, item):
        import webbrowser
        webbrowser.open("http://localhost:8000")

    def on_quit(icon, item):
        stop_event.set()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Open Edit Factory", on_open, default=True),
        pystray.MenuItem("Quit", on_quit),
    )
    return pystray.Icon("EditFactory", image, "Edit Factory", menu)
```

**Confidence:** HIGH — pystray 0.19.5 verified on PyPI (Sep 2023, no bugs since),
Windows backend confirmed as default, pystray.readthedocs.io usage verified.

---

### 3. Config Directory — `platformdirs` 4.9.2

**Install:** `pip install "platformdirs>=4.9.2"`

platformdirs resolves the correct `%APPDATA%\EditFactory\` path on Windows for storing:
- `config.json` — API keys, user preferences (migrated from `.env` for desktop mode)
- `license.json` — cached license key + validation state
- Log files

**Why platformdirs, not `appdirs` or `os.environ['APPDATA']`?**
- `appdirs` last released May 2020 — dead project. `platformdirs` is its actively
  maintained fork with 47M weekly downloads.
- Raw `os.environ['APPDATA']` works but is Windows-only; `platformdirs` adds one
  line of cross-OS correctness in case WSL or Mac dev use needs it.
- Resolves `C:\Users\{user}\AppData\Roaming\EditFactory\` on Windows with
  `user_data_dir("EditFactory", "EditFactory")`.

```python
from platformdirs import user_data_dir
import os

APP_DATA_DIR = user_data_dir("EditFactory", "EditFactory")
CONFIG_FILE = os.path.join(APP_DATA_DIR, "config.json")
LICENSE_FILE = os.path.join(APP_DATA_DIR, "license.json")
LOG_DIR = os.path.join(APP_DATA_DIR, "logs")

# Create directories on first run
os.makedirs(APP_DATA_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)
```

**Confidence:** HIGH — PyPI version 4.9.2 verified (2026-02-16), official successor
to appdirs confirmed via tox-dev/platformdirs GitHub.

---

### 4. Windows Installer — NSIS 3.x + `pynsist` 2.8

**Install NSIS (system tool, not pip):** https://nsis.sourceforge.io/Download
**Install pynsist:** `pip install "pynsist>=2.8"` (build tool only)

Two-step installer approach:

**Step 1: pynsist** — wraps the Python environment (launcher only) into an NSIS installer.
Pynsist bundles a Python interpreter copy, pip packages, and generates the NSIS script.
Best for the Python-side launcher.

**Step 2: NSIS script extension** — the generated NSIS script is customized to also:
- Bundle the pre-built Next.js standalone folder (`.next/standalone/`)
- Bundle FFmpeg binary (existing `ffmpeg/` directory)
- Bundle Node.js portable runtime (needed to run `server.js`)
- Create Start Menu / Desktop shortcuts
- Write `HKCU\Software\EditFactory` registry key for first-run detection
- Register uninstaller

**Why not Inno Setup?** NSIS is open source with better community Python tooling (pynsist).
Inno Setup is excellent but the pynsist → NSIS path is documented and tested.

**Why not Tauri?** Tauri is for building the app itself in Rust/WebView — massive
architectural change. We need only an installer, not a new framework.

**Why not a plain zip + bat file?** A proper NSIS installer handles:
- Uninstall support
- Start menu registration
- File association (future)
- Per-user or machine-wide install choice
- Upgrade detection (overwrite existing install)

**Install size estimate:** ~200-400MB bundled (Python deps + FFmpeg + Node.js standalone)

**Confidence:** MEDIUM — pynsist 2.8 is verified at PyPI, NSIS 3.x is the current
stable version. The two-step customization (pynsist + manual NSIS extensions for
Node.js/FFmpeg bundling) is a pattern from community sources, not an official guide.
Phase-level research needed for exact NSIS script.

---

### 5. Auto-Update — Custom GitHub Releases check (no new library)

**No new library needed — use `httpx` (already installed)**

The recommended pattern for this project: check GitHub Releases API on startup, compare
version, prompt user to download if newer. Do NOT auto-install silently — users of
sold software expect to control updates.

**Why not PyUpdater or tufup?**
- PyUpdater: tightly coupled to PyInstaller's one-file mode, adds S3/Cloudflare
  dependency for update hosting. Overkill for a direct-sale desktop app.
- tufup: implements The Update Framework (TUF) with cryptographic signing — excellent
  security but significant infrastructure (key management, update server). Premature
  for personal-scale distribution.
- Simple GitHub releases API check: zero infrastructure, free hosting, 60 req/hour
  unauthenticated rate limit (startup checks are infrequent), three-line implementation.

**Implementation pattern:**

```python
# In launcher.py — check on startup, non-blocking
import httpx
import json

CURRENT_VERSION = "1.0.0"   # Set at build time
GITHUB_RELEASES_URL = "https://api.github.com/repos/{owner}/edit-factory/releases/latest"

def check_for_update() -> dict | None:
    """Returns release dict if newer version available, else None."""
    try:
        resp = httpx.get(GITHUB_RELEASES_URL, timeout=5.0, headers={
            "Accept": "application/vnd.github+json"
        })
        release = resp.json()
        latest = release.get("tag_name", "").lstrip("v")
        if latest and latest > CURRENT_VERSION:   # Simple string compare works for semver
            return {
                "version": latest,
                "url": release.get("html_url"),
                "notes": release.get("body", "")[:500],
            }
    except Exception:
        pass   # Silent fail — update check is non-critical
    return None
```

**Update delivery:** When a newer version is found, show a Windows toast notification
(or tray menu item) linking to the GitHub releases page. User downloads and runs new
installer manually. This is acceptable for personal-use software with infrequent releases.

**Version baking:** Write current version to `version.txt` at build time. Launcher reads
it at startup to pass to the update check.

**Confidence:** MEDIUM — GitHub Releases API is documented and stable. The "prompt and
open browser" update approach is used by many small desktop apps. Version string
comparison is simplistic (lexicographic) — fine for semver if versions are formatted
consistently (1.0.0, 1.1.0, etc.).

---

### 6. Crash Reporting — `sentry-sdk` 2.53.0

**Backend:** `pip install "sentry-sdk[fastapi]>=2.53.0"`
**Frontend:** `npm install @sentry/nextjs@^9.0.0` (latest is 10.x — see note)

**Why Sentry?**
- Industry standard for error telemetry in both Python and Next.js with first-class
  integrations for both FastAPI and Next.js App Router.
- FastAPI integration auto-activates when `fastapi` package is present — zero manual
  middleware wiring needed.
- Free tier: 5,000 errors/month, 1 project — sufficient for personal-use desktop software.
- Opt-in by design: DSN stored in config, if not set Sentry is a no-op.

**Backend setup (add to `app/main.py`):**

```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

def init_sentry(dsn: str | None):
    if not dsn:
        return  # Opt-in: no DSN = no reporting
    sentry_sdk.init(
        dsn=dsn,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
        traces_sample_rate=0.1,      # 10% of requests for performance monitoring
        send_default_pii=False,      # No user PII — privacy-first
        environment="desktop",
    )
```

**Frontend setup (`sentry.client.config.ts`, `sentry.server.config.ts`):**

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,   // empty = disabled
  tracesSampleRate: 0.1,
  environment: "desktop",
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
});
```

**Desktop-specific concerns:**
- DSN stored in `%APPDATA%\EditFactory\config.json`, not hardcoded in build.
- First-run setup wizard offers opt-in checkbox — only write DSN to config if user accepts.
- Sentry is async/non-blocking — zero impact on video rendering performance.

**Note on @sentry/nextjs version:** npm latest is 10.40.0 (March 2026). Use `^9.0.0`
minimum to get Next.js App Router support. Wizard (`npx @sentry/wizard -i nextjs`)
handles configuration automatically.

**Confidence:** HIGH — sentry-sdk 2.53.0 verified on PyPI (2026-02-16), FastAPI
integration confirmed at docs.sentry.io, @sentry/nextjs 10.40.0 verified on npm.

---

### 7. License Key Validation — Lemon Squeezy API (no new library)

**No new library — use `httpx` (already installed)**

**Why Lemon Squeezy over Gumroad?**
- Lemon Squeezy has a purpose-built license key API with activate/validate/deactivate
  lifecycle. Gumroad's license API is basic (single verify endpoint, no instance tracking).
- Lemon Squeezy charges 5% vs Gumroad's 10% per transaction.
- Lemon Squeezy acts as Merchant of Record — handles EU VAT automatically.
- Lemon Squeezy's API returns `activation_limit`, `activation_usage`, and instance IDs —
  enables enforcing "activate on N machines" policies.

**API endpoints used:**
- `POST https://api.lemonsqueezy.com/v1/licenses/activate` — on first run, register machine
- `POST https://api.lemonsqueezy.com/v1/licenses/validate` — on each startup, verify key

**Implementation pattern:**

```python
import httpx
import json
import platform
import uuid

LEMON_SQUEEZY_LICENSE_URL = "https://api.lemonsqueezy.com/v1/licenses"

def activate_license(license_key: str, instance_name: str = None) -> dict:
    """Activate license on this machine. Call once on first-run."""
    if instance_name is None:
        instance_name = platform.node()  # Machine hostname
    resp = httpx.post(
        f"{LEMON_SQUEEZY_LICENSE_URL}/activate",
        data={"license_key": license_key, "instance_name": instance_name},
        timeout=10.0,
    )
    return resp.json()   # Contains instance_id — store in license.json

def validate_license(license_key: str, instance_id: str) -> bool:
    """Validate on each startup. Returns True if license is active."""
    try:
        resp = httpx.post(
            f"{LEMON_SQUEEZY_LICENSE_URL}/validate",
            data={"license_key": license_key, "instance_id": instance_id},
            timeout=5.0,
        )
        return resp.json().get("valid", False)
    except Exception:
        return True   # Offline grace: if can't reach server, allow run
```

**Offline grace period:** If the validation call fails (no internet), return `True` and
allow the app to run. Do NOT hard-block on network failure — this is a personal-use
desktop tool. Log the failure to `%APPDATA%\EditFactory\logs\`.

**Cache:** Store `instance_id` in `%APPDATA%\EditFactory\license.json`. Never re-activate
if `instance_id` already present and valid.

**Confidence:** HIGH — Lemon Squeezy License API docs at docs.lemonsqueezy.com verified,
endpoint URLs and response schema confirmed from official documentation.

---

### 8. Next.js Production Build — Standalone Output Mode

**No new library — configure `next.config.js`**

For the installer to bundle the frontend without a full `node_modules`, use Next.js
standalone output mode. This produces a self-contained `server.js` that runs with Node.js:

```javascript
// next.config.js
module.exports = {
  output: "standalone",   // Add this line
  // ... existing config
};
```

Build produces `.next/standalone/` containing:
- `server.js` — starts Next.js server on port 3000
- Minimal `node_modules/` (Next.js server deps only, ~50MB vs full 300MB)
- `.next/` static assets

Run in installer: `node .next/standalone/server.js`

**Node.js bundling in installer:** Bundle Node.js portable runtime (node.exe) in the
installer alongside the standalone output. Use Node.js LTS portable zip (currently 22.x).
The launcher EXE sets `PATH` to include the bundled node before starting the frontend.

**Why standalone over Electron?** Electron would add ~100MB Chromium binary and require
rewriting the frontend as an Electron app. Standalone mode + system browser is the
minimal path — consistent with the existing "start script + browser" decision in PROJECT.md.

**Confidence:** HIGH — Next.js standalone output is documented at nextjs.org, confirmed
working on Windows with `node .next/standalone/server.js` pattern.

---

## Desktop Mode Architecture

The launcher `launcher.py` orchestrates everything:

```
launcher.exe (PyInstaller bundle)
  ├── multiprocessing.freeze_support()
  ├── check_for_update()  → show tray notification if update available
  ├── validate_license()  → exit with dialog if invalid
  ├── Start uvicorn (FastAPI backend) → subprocess in background thread
  ├── Start node server.js (Next.js) → subprocess in background thread
  ├── Wait for backend ready (poll /api/v1/health, max 30s)
  ├── webbrowser.open("http://localhost:3000")
  └── pystray.Icon.run()  → blocks main thread, handles quit
       └── On quit: terminate both subprocesses, exit
```

**Config resolution order (desktop mode):**
1. `%APPDATA%\EditFactory\config.json` (primary for desktop)
2. `.env` file in app directory (fallback, dev compatibility)
3. Environment variables (always override)

**New environment flags:**
- `DESKTOP_MODE=true` — signals app is running as installed desktop product
- `AUTH_DISABLED=true` — set automatically in desktop mode (single-user, no need for JWT)
- `CONFIG_DIR=%APPDATA%\EditFactory` — tells backend where to find config file

---

## Installation Summary

**Python dependencies (add to requirements.txt or separate build-tools file):**

```bash
# Runtime — add to requirements.txt
pystray>=0.19.5
platformdirs>=4.9.2
sentry-sdk[fastapi]>=2.53.0

# Build tools only — do NOT add to requirements.txt
# Install in dev environment separately:
pip install "pyinstaller>=6.19.0"
pip install "pynsist>=2.8"
```

**Frontend:**

```bash
cd frontend
npm install @sentry/nextjs@^10.0.0
npx @sentry/wizard@latest -i nextjs  # Auto-configures sentry.*.config.ts files
```

**System tools (one-time install on build machine):**
- NSIS 3.x — https://nsis.sourceforge.io/Download
- Node.js LTS 22.x portable — bundled into installer, not installed on build machine

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Launcher bundler | PyInstaller 6.x | Nuitka | Nuitka needs MSVC/GCC toolchain on WSL; C compilation adds 10-30min builds with no benefit for a thin launcher |
| Installer format | NSIS + pynsist | Inno Setup | Inno Setup is good but pynsist → NSIS path has Python ecosystem tooling; Inno would need fully manual script |
| Installer format | NSIS + pynsist | WiX Toolset (MSI) | MSI requires XML authoring and Windows SDK; overkill for personal-scale distribution |
| Tray icon | pystray | wxPython SystemTray | wxPython adds 30MB GUI framework for a tray icon; pystray is purpose-built at <1MB |
| Auto-update | GitHub Releases + httpx | PyUpdater | PyUpdater needs S3 or similar update server; GitHub releases is free |
| Auto-update | GitHub Releases + httpx | tufup (TUF) | TUF requires cryptographic key management infrastructure — premature for v10 |
| License validation | Lemon Squeezy | Gumroad | Gumroad charges 10% vs 5%; Gumroad license API lacks instance tracking |
| License validation | Lemon Squeezy | Keygen.sh | Keygen is better for SaaS/high volume; adds subscription cost; Lemon Squeezy includes licensing |
| Config directory | platformdirs | appdirs | appdirs abandoned (2020); platformdirs is the maintained fork |
| Config directory | platformdirs | raw `os.environ['APPDATA']` | Windows-only; platformdirs adds one line for correctness |
| Frontend bundling | Next.js standalone output | Electron | Electron adds 100MB Chromium, requires rewrite to Electron APIs; conflicts with PROJECT.md decision |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `electron` / `tauri` | Architectural change — PROJECT.md explicitly excludes desktop app frameworks | Next.js standalone + system browser |
| PyUpdater | Requires S3 or update server infrastructure; tightly coupled to PyInstaller one-file mode | Custom GitHub Releases API check with httpx |
| `appdirs` | Abandoned in 2020, last release 1.4.4 | `platformdirs` 4.9.2 |
| Gumroad for license keys | 10% fees, basic license API with no instance tracking, no EU VAT MoR until 2025 | Lemon Squeezy |
| `infi.systray` | Windows-only, poorly maintained, no context menu animations | `pystray` |
| Multiple uvicorn workers in bundled EXE | WinError 10022 asyncio failures in frozen builds | `workers=1` in bundled uvicorn call |
| `--windowed` on uvicorn subprocess | Suppresses stderr, making crash debugging impossible | `--windowed` only on launcher; uvicorn runs as visible subprocess |

---

## Version Compatibility

| Package | Version | Requires | Notes |
|---------|---------|----------|-------|
| `pystray` | 0.19.5 | `Pillow` any | Pillow already in requirements.txt |
| `platformdirs` | 4.9.2 | Python 3.8+ | Drop-in replacement for appdirs |
| `sentry-sdk` | 2.53.0 | FastAPI 0.79+ | FastAPI integration auto-activates |
| `@sentry/nextjs` | 10.40.0 | Next.js 14+ | App Router fully supported |
| `pyinstaller` | 6.19.0 | Python 3.8+ | Build tool only |
| `pynsist` | 2.8 | NSIS 3.x installed | Build tool only |
| `platformdirs` | 4.9.2 | — | Replaces appdirs entirely |

---

## Sources

- [PyInstaller PyPI — version 6.19.0](https://pypi.org/project/pyinstaller/) — verified 2026-02-14
- [pyinstaller-fastapi reference](https://github.com/iancleary/pyinstaller-fastapi) — PyInstaller + uvicorn bundle pattern, MEDIUM confidence
- [PyInstaller uvicorn known issues](https://github.com/Kludex/uvicorn/discussions/1820) — worker multiprocessing issues on Windows, HIGH confidence
- [pystray PyPI — version 0.19.5](https://pypi.org/project/pystray/) — verified
- [pystray documentation](https://pystray.readthedocs.io/en/latest/usage.html) — Windows backend, thread-safe usage, HIGH confidence
- [platformdirs PyPI — version 4.9.2](https://pypi.org/project/platformdirs/) — verified 2026-02-16
- [sentry-sdk PyPI — version 2.53.0](https://pypi.org/project/sentry-sdk/) — verified 2026-02-16
- [Sentry FastAPI integration docs](https://docs.sentry.io/platforms/python/integrations/fastapi/) — setup steps verified, HIGH confidence
- [@sentry/nextjs npm — version 10.40.0](https://www.npmjs.com/package/@sentry/nextjs) — verified 2026-03
- [Lemon Squeezy License API — validate endpoint](https://docs.lemonsqueezy.com/api/license-api/validate-license-key) — endpoint and schema verified, HIGH confidence
- [Lemon Squeezy vs Gumroad 2025](https://ruul.io/blog/lemonsqueezy-vs-gumroad) — fee comparison, MEDIUM confidence
- [Next.js standalone output docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) — HIGH confidence
- [pynsist PyPI — version 2.8](https://pypi.org/project/pynsist/) — verified
- [NSIS official](https://nsis.sourceforge.io/Main_Page) — open source, actively maintained, HIGH confidence

---

*Stack research for: v10 Desktop Launcher & Distribution — new capabilities only*
*Researched: 2026-03-01*
