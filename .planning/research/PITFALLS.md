# Pitfalls Research

**Domain:** Adding desktop distribution (launcher, installer, auto-update, licensing, crash reporting) to an existing Python+Node.js web app
**Researched:** 2026-03-01
**Confidence:** HIGH (Windows process management, antivirus behavior) / MEDIUM (licensing, auto-update patterns)

---

## Critical Pitfalls

Mistakes that cause rewrites, broken installs, or silent failures at launch time.

---

### Pitfall 1: Hardcoded Relative Paths Break After Installation

**What goes wrong:**
The existing codebase uses relative paths like `./ffmpeg/...`, `../logs/`, `os.path.dirname(__file__)`, and similar patterns that resolve correctly when run from the project root during development. After installation via NSIS, the working directory is no longer the project root — it is typically `C:\Windows\System32` or wherever the launcher was invoked from. All relative paths silently resolve to the wrong location, causing missing files, failed FFmpeg calls, and config not being read.

**Why it happens:**
Development always runs from the project root (`python run.py`, `npm run dev`). Every relative path works. The team never notices because the CWD is always correct in dev. Installation changes the CWD assumption entirely.

**How to avoid:**
Establish a single `APP_BASE_DIR` constant resolved at startup using the executable's location, not CWD. In the launcher (Python):
```python
import sys
import os

if getattr(sys, 'frozen', False):
    # Running as packaged .exe — use the extracted temp dir
    APP_BASE_DIR = sys._MEIPASS
    # For user data that must survive updates, use APPDATA:
    APP_DATA_DIR = Path(os.environ['APPDATA']) / 'EditFactory'
else:
    # Development — use project root
    APP_BASE_DIR = Path(__file__).parent.parent
    APP_DATA_DIR = APP_BASE_DIR / 'data'
```
Do a codebase sweep for every `os.path.join`, `Path(...)`, and `open(...)` call and replace relative paths with `APP_BASE_DIR`-relative or `APP_DATA_DIR`-relative paths before packaging.

**Warning signs:**
- App launches then immediately crashes with `FileNotFoundError` on logs, config, or temp dir
- FFmpeg path resolution fails on first launch despite FFmpeg being bundled
- `app.log` file appears in `C:\Windows\System32\` instead of `%APPDATA%\EditFactory\`
- Works perfectly when launched from project root folder via terminal, fails from desktop shortcut

**Phase to address:** Phase 1 (Desktop launcher foundation) — establish path resolution before any packaging work begins.

---

### Pitfall 2: Antivirus and SmartScreen Block the Installer on First Download

**What goes wrong:**
PyInstaller-generated executables and unsigned NSIS installers are systematically flagged by Windows Defender, SmartScreen, and third-party AV tools. The reason is structural: PyInstaller embeds a bootloader that is common to all PyInstaller-built executables, including malware. AV tools match on the bootloader pattern. Windows 11 Smart App Control (SAC) blocks execution of any unsigned executable by default — no bypass option for users. Windows Defender may quarantine the installer before the user can even run it.

**Why it happens:**
Unsigned executables have no reputation score with Microsoft SmartScreen. Every new executable starts with zero reputation and gets blocked until enough users run it safely. PyInstaller makes this worse because its bootloader pattern is shared with known-malicious software.

**How to avoid:**
- **Sign the installer.** A code signing certificate ($70-350/year from DigiCert, Sectigo, or similar) is the only reliable fix. Windows Defender and SmartScreen both reduce severity for signed executables. Smart App Control (Windows 11) requires a valid EV or OV certificate to bypass.
- Use `--onedir` mode in PyInstaller (folder, not single-file exe) — this reduces bootloader exposure compared to `--onefile`.
- Submit the unsigned installer to Microsoft for manual whitelisting as a stopgap: https://www.microsoft.com/en-us/wdsi/filesubmission
- Consider Nuitka as an alternative to PyInstaller — it compiles Python to C, which has a lower false-positive rate than PyInstaller's bootloader approach.
- If code signing is deferred: document the workaround clearly in install instructions (Settings > Windows Security > Virus & threat protection > Protection history > Allow).

**Warning signs:**
- Test user reports installer was quarantined before running
- VirusTotal scan of the installer shows 5+ detections
- SmartScreen shows "Unknown publisher" warning that cannot be dismissed by ordinary users
- Windows 11 machines silently refuse to run the installer with no UI dialog

**Phase to address:** Phase 2 (Windows installer / NSIS) — decide on code signing strategy before building the installer. Unsigned installers should not be given to real users.

---

### Pitfall 3: Backend Not Ready When Frontend Browser Opens

**What goes wrong:**
The launcher starts the FastAPI backend (uvicorn process) and then immediately opens the browser to `http://localhost:3000`. The backend and frontend both take 2-8 seconds to initialize (Python import time, Next.js hydration). If the browser opens before either service is ready, the user sees a connection error page. On slower machines or first run (pip dependencies not pre-compiled), this can take 15-30 seconds. The user assumes the app is broken and closes it.

**Why it happens:**
The current `start-dev.bat` uses a fixed sleep delay. Packaging as a product requires health-check polling instead of guessing startup time. Developers test on their own fast machine and never notice the issue.

**How to avoid:**
In the launcher, poll both services before opening the browser:
```python
import time
import urllib.request

def wait_for_service(url: str, timeout: int = 60) -> bool:
    """Poll URL until it responds 200 or timeout."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False

# Start backend and frontend processes
backend_proc = subprocess.Popen([...])
frontend_proc = subprocess.Popen([...])

# Wait for both health endpoints
backend_ready = wait_for_service("http://localhost:8000/api/v1/health")
frontend_ready = wait_for_service("http://localhost:3000")

if backend_ready and frontend_ready:
    webbrowser.open("http://localhost:3000")
else:
    show_error_dialog("Startup failed. Check logs.")
```
Show a system tray "Starting..." status during the wait so the user knows something is happening.

**Warning signs:**
- Users report "the app shows a blank page"
- `http://localhost:3000` shows "This site can't be reached" on first launch
- On first run, loading takes longer than test machine
- No visible feedback between clicking the icon and the browser appearing

**Phase to address:** Phase 1 (Desktop launcher foundation) — implement health-check polling in the launcher before any user-facing testing.

---

### Pitfall 4: Orphaned Backend Processes After Launcher Closes

**What goes wrong:**
When the system tray icon is right-clicked and "Quit" is selected, the launcher process exits. However, the uvicorn (FastAPI) child process and the Next.js (`node`) child process continue running as orphans. On the next launch, the new processes try to bind to port 8000 and port 3000 and fail with `address already in use`. The user sees no obvious error and the app silently fails to start. The only fix is Task Manager.

**Why it happens:**
`subprocess.Popen()` creates child processes that are not automatically killed when the parent exits on Windows. Unlike Unix, Windows does not have process groups that propagate signals. Additionally, uvicorn spawns its own worker subprocesses, so killing the main uvicorn process may leave workers running.

**How to avoid:**
Use Windows Job Objects via the `psutil` library to create a kill-on-parent-exit relationship, OR implement explicit port-based cleanup on every startup and shutdown:
```python
import psutil

def kill_port(port: int):
    """Kill any process listening on the given port."""
    for proc in psutil.process_iter(['pid', 'connections']):
        try:
            for conn in proc.connections():
                if conn.laddr.port == port and conn.status == 'LISTEN':
                    proc.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

def shutdown():
    """Called on tray icon Quit or system shutdown."""
    kill_port(8000)  # FastAPI
    kill_port(3000)  # Next.js
    # Also terminate tracked subprocess handles
    for proc in [backend_proc, frontend_proc]:
        if proc and proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=5)
```
Call `kill_port()` at startup (before launching new processes) as a cleanup of any previous orphans.

**Warning signs:**
- "Address already in use" errors on second launch
- Task Manager shows multiple `python.exe` and `node.exe` processes after "quitting"
- App works on first launch but fails on every subsequent launch until reboot
- Port 8000 or 3000 occupied after the app was quit

**Phase to address:** Phase 1 (Desktop launcher foundation) — process lifecycle management must be airtight before the system tray icon is implemented.

---

### Pitfall 5: Auto-Update Cannot Replace a Running Executable

**What goes wrong:**
On Windows, a running `.exe` file is locked by the OS and cannot be overwritten. Auto-update systems that download a new version and try to replace the current executable in-place get `PermissionError: [WinError 5]` or `[WinError 32] The process cannot access the file because it is being used by another process`. The update download succeeds, but application of the update silently fails (or crashes the updater). The user sees "update complete" but is still running the old version.

**Why it happens:**
This is a Windows-specific constraint. Developers testing on macOS or Linux don't encounter it. The pattern works fine in dev (the .py source file is not locked when running), but breaks with compiled .exe deployments.

**How to avoid:**
Use the two-process update pattern:
1. Download the new installer/exe to `%TEMP%\EditFactory\update\`
2. Write a small batch script (or a separate `updater.exe`) to:
   - Wait for the main app to exit
   - Replace the old exe with the new one
   - Restart the app
3. The main app launches the updater script, then exits immediately

```python
def apply_update(new_exe_path: Path, current_exe_path: Path):
    """Write and launch an updater batch script, then exit."""
    update_bat = Path(os.environ['TEMP']) / 'ef_update.bat'
    update_bat.write_text(
        f'@echo off\n'
        f'timeout /t 2 /nobreak > NUL\n'  # Wait for main process to exit
        f'copy /Y "{new_exe_path}" "{current_exe_path}"\n'
        f'start "" "{current_exe_path}"\n'
        f'del "%~f0"\n'  # Self-delete the batch script
    )
    subprocess.Popen(['cmd.exe', '/c', str(update_bat)],
                     creationflags=subprocess.CREATE_NO_WINDOW)
    sys.exit(0)  # Exit immediately so the batch can overwrite
```
For NSIS-based updates (full reinstall approach), the new installer can run silently in the background without this complexity.

**Warning signs:**
- Update "succeeds" but version number does not change after restart
- Error log shows `PermissionError` or `WinError 32` during file copy
- Update works when the app is not running (manual update) but fails when triggered from inside the app

**Phase to address:** Phase 3 (Auto-update system) — this constraint must drive the update architecture design, not be retrofitted later.

---

### Pitfall 6: License Key Checked Only at Startup, Not Periodically

**What goes wrong:**
License validation fires once at app startup. If the user's license is revoked (chargeback, refund, Gumroad dispute), the app continues running indefinitely because there is no re-validation after the initial check. Additionally, a user can activate on one machine, image their drive, and use on multiple machines because the activation count is only checked once.

**Why it happens:**
"Check the license key and open the app" is the natural mental model. Developers implement it as a startup gate and consider it done. The temporal dimension (ongoing validity) is an afterthought.

**How to avoid:**
Implement periodic re-validation: check the license key against the Lemon Squeezy or Gumroad API every N hours (24h is reasonable for a personal-use tool). Cache the result locally (signed JSON with a timestamp) so the app works offline within the grace period:
```python
VALIDATION_CACHE_TTL_HOURS = 48  # Allow 48h offline grace period

def is_license_valid() -> bool:
    """Check license: use cache if fresh, re-validate if stale."""
    cache = load_license_cache()

    if cache and cache_is_fresh(cache, VALIDATION_CACHE_TTL_HOURS):
        return cache['valid']

    # Re-validate against API
    result = validate_with_api(get_stored_license_key())
    save_license_cache(result)
    return result['valid']
```
Also verify the `product_id` in the API response matches your product — Lemon Squeezy requires this to prevent license keys from other products being used for yours.

**Warning signs:**
- License revoked in Gumroad but user continues using the app
- No mechanism to inform user that their license became invalid post-activation
- User activates on 5 machines without triggering activation limit

**Phase to address:** Phase 4 (License key validation) — design periodic validation and offline grace period before implementing the activation UI.

---

### Pitfall 7: Sensitive API Keys Stored in Plaintext or Bundled in Executable

**What goes wrong:**
Two separate failures:
1. User API keys (Gemini, ElevenLabs, Supabase) entered in the first-run wizard get written to a plaintext `.env` file in the install directory (`C:\Program Files\EditFactory\.env`). Any process on the machine can read this.
2. The developer's own API keys (Supabase project URL, anon key, etc.) get bundled into the executable by PyInstaller because they are imported via `config.py` which reads `os.environ`. If `.env` is accidentally included in the bundle, those keys ship to every user.

**Why it happens:**
The existing dev setup uses `.env` files. It's natural to keep that pattern. Developers forget that install directories are readable by other processes, and forget to audit what files PyInstaller includes.

**How to avoid:**
- Store user API keys in Windows Credential Manager via `keyring` library, not in a flat file:
```python
import keyring

SERVICE_NAME = "EditFactory"

def save_api_key(key_name: str, value: str):
    keyring.set_password(SERVICE_NAME, key_name, value)

def get_api_key(key_name: str) -> str | None:
    return keyring.get_password(SERVICE_NAME, key_name)
```
- If using a config file, store it in `%APPDATA%\EditFactory\config.json` (not the install directory), and never include the actual key values — store a reference that retrieves from keyring.
- Explicitly exclude `.env` files from the PyInstaller spec file. Audit with `--log-level DEBUG` to see everything being bundled.
- For app-level credentials (Supabase), use environment variables injected at build time for cloud calls, or architect so the desktop app connects to Supabase directly using the user's own project.

**Warning signs:**
- `.env` file visible in `C:\Program Files\EditFactory\` after installation
- PyInstaller build includes a `.env` file in the bundle (check build log)
- Other local processes can read the ElevenLabs API key

**Phase to address:** Phase 1 (Desktop launcher foundation, config system) and Phase 4 (License key validation, first-run wizard) — establish secure storage before any API key flows are implemented.

---

### Pitfall 8: First-Run Wizard Skipped With No Recovery Path

**What goes wrong:**
The first-run wizard collects critical API keys (Gemini, ElevenLabs, Supabase). If the user skips it, closes it mid-way, or completes it with invalid keys, the app opens to a broken state: every backend call fails with `KeyError` or `None` key errors, and there is no clear message explaining why or how to fix it. The user cannot find where to re-enter their keys.

**Why it happens:**
Developers test the happy path (wizard completed successfully) and never test the abandoned wizard scenario. Backend routes that call `config.GEMINI_API_KEY` assume the key exists because development always has `.env` populated.

**How to avoid:**
- Add explicit key validation after the wizard: ping each API with the provided key before saving it and before letting the user proceed.
- Add a Settings page (reachable from tray icon menu) that re-opens the wizard for any key.
- At backend startup, log a clear warning if any required key is missing: "GEMINI_API_KEY not configured — AI features will be unavailable."
- Design all API-dependent features to show a "Key not configured — click here to set up" message rather than a generic error.
- Guard the wizard with a completion flag stored in `%APPDATA%\EditFactory\config.json`. If incomplete, re-show the wizard on next launch instead of forcing users to find settings.

**Warning signs:**
- User reports "nothing works" after installation but gives no specific error
- Backend shows `KeyError: 'GEMINI_API_KEY'` in logs
- No way to re-open the wizard after it was dismissed
- Wizard validates no keys — user enters garbage and the app proceeds

**Phase to address:** Phase 5 (First-run setup wizard) — implement API key validation and recovery before the wizard is shown to any user.

---

## Moderate Pitfalls

---

### Pitfall 9: PyInstaller Bundles the Wrong Python Environment

**What goes wrong:**
PyInstaller bundles the Python environment active at build time. If the build runs in the system Python or a shared virtualenv that has extra unrelated packages, the resulting bundle is oversized (500 MB+ instead of 150 MB). More critically, if the build runs against Python 3.12 but the app code has a dependency that only works on Python 3.10, the bundle ships with silent runtime failures.

**How to avoid:**
Always build from a clean, dedicated virtualenv with only production dependencies installed. Document the exact build command in a `build.bat` script. Pin Python version in the spec file. Run the final bundle on a clean Windows machine (not the dev machine) before distribution.

**Warning signs:**
- `EditFactory.exe` is over 400 MB when the dependency tree doesn't warrant it
- Bundle works on dev machine but fails on test machine with import errors
- `pip list` inside the build env includes unrelated packages from other projects

**Phase to address:** Phase 2 (Windows installer / NSIS) — establish clean build environment before packaging.

---

### Pitfall 10: NSIS 2GB Installer Size Limit

**What goes wrong:**
NSIS has a hard 2 GB compressed installer size limit. Python runtime + venv + FFmpeg + bundled Next.js assets can easily exceed 1 GB compressed. If the bundle grows past 2 GB (unlikely but possible if bundling large models like Whisper or Demucs locally), the installer is silently malformed — it appears to build successfully but extracts incorrectly or produces a corrupt output exe.

**How to avoid:**
Audit bundle size at every phase. Current expected size breakdown:
- Python 3.11 runtime: ~60 MB
- Production pip deps (FastAPI, uvicorn, ffmpeg-python, Whisper, etc.): ~300-500 MB
- FFmpeg binary: ~80 MB
- Next.js production build: ~50 MB
Total target: ~500-700 MB (well within limit).

Keep Whisper model weights out of the bundle — download on first use to `%APPDATA%\EditFactory\models\`. Do not bundle Demucs inside the installer.

**Warning signs:**
- Installer `.exe` is exactly ~300 MB despite containing more content (classic malformed NSIS)
- Extracted files are missing or truncated after install
- Build completes without error but installed app crashes on launch with missing module

**Phase to address:** Phase 2 (Windows installer / NSIS) — check bundle size before scripting the installer.

---

### Pitfall 11: Crash Reporting Captures User's API Keys in Stack Frames

**What goes wrong:**
Sentry captures local variable values in stack frames by default. If a crash occurs inside a function that has `api_key`, `SUPABASE_KEY`, or `ELEVENLABS_API_KEY` in scope (which is common in config and service init code), those values are sent to Sentry's servers in plain text. The user's keys are now in a third-party error tracking service.

**Why it happens:**
Sentry's Python SDK is powerful but sends aggressive amounts of context by default. Developers enable it, set a DSN, and move on without reviewing what data is being sent.

**How to avoid:**
Configure Sentry with an explicit `before_send` filter and set `send_default_pii=False` (which is the default but should be explicit):
```python
import sentry_sdk

SENSITIVE_KEYS = {
    'api_key', 'apikey', 'api_secret', 'password', 'token',
    'elevenlabs_api_key', 'gemini_api_key', 'supabase_key',
    'supabase_url', 'license_key'
}

def scrub_sensitive(event, hint):
    """Remove sensitive keys from all stack frames before sending."""
    if 'exception' in event:
        for exc in event['exception'].get('values', []):
            for frame in exc.get('stacktrace', {}).get('frames', []):
                for scope in ['vars', 'pre_context', 'post_context']:
                    if scope in frame:
                        if isinstance(frame[scope], dict):
                            for k in list(frame[scope].keys()):
                                if k.lower() in SENSITIVE_KEYS:
                                    frame[scope][k] = '[Filtered]'
    return event

sentry_sdk.init(
    dsn="...",
    send_default_pii=False,
    before_send=scrub_sensitive,
)
```
Make crash reporting **opt-in** with a clear consent dialog on first launch. Do not enable it silently.

**Warning signs:**
- Sentry event inspector shows `api_key` or `token` values in frame locals
- No `before_send` filter configured in Sentry initialization
- Crash reporting enabled without user consent dialog

**Phase to address:** Phase 6 (Crash reporting / Sentry) — configure scrubbing before enabling reporting.

---

### Pitfall 12: Auto-Update Downloads Over Unverified HTTPS

**What goes wrong:**
The auto-update system fetches a version manifest and downloads the new installer from a URL. If certificate verification is disabled (common Python workaround for SSL errors), a man-in-the-middle attacker can serve a malicious executable. Even with correct SSL, if the downloaded file is not hash-verified against a manifest signed with the developer's private key, a compromised CDN can serve malicious updates.

**How to avoid:**
- Always verify SSL certificates (do not use `verify=False`).
- Publish a SHA256 hash of every release artifact in the version manifest. Verify the hash after download before executing:
```python
import hashlib

def verify_download(file_path: Path, expected_sha256: str) -> bool:
    sha256 = hashlib.sha256()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)
    return sha256.hexdigest() == expected_sha256
```
- Host the version manifest on HTTPS with a valid cert.
- Consider signing the manifest itself with a private key (public key embedded in the app). This is the TUF (The Update Framework) approach — overkill for a personal tool, but hash verification is mandatory.

**Warning signs:**
- Update code uses `verify=False` or catches SSL errors and ignores them
- No hash verification after download
- Version manifest served over HTTP

**Phase to address:** Phase 3 (Auto-update system) — security requirements must be specified before implementation.

---

### Pitfall 13: WSL-Specific Paths Shipped in the Desktop Build

**What goes wrong:**
The existing codebase has WSL-specific path handling: `/mnt/c/` path prefixes, Linux-side font paths, `wsl.exe` references. The desktop installer targets native Windows Python (not WSL). If any WSL path assumption leaks into the packaged build, it fails silently: files are not found, FFmpeg uses wrong font paths, the app runs but produces broken output.

**How to avoid:**
Add an explicit `DESKTOP_MODE=true` environment variable set by the launcher before starting the backend. Audit all path-handling code for WSL assumptions:
```python
IS_WSL = 'microsoft' in platform.uname().release.lower()
IS_DESKTOP = os.getenv('DESKTOP_MODE', 'false').lower() == 'true'

def get_font_path() -> str:
    if IS_WSL and not IS_DESKTOP:
        return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    else:
        # Native Windows: use bundled font
        return str(APP_BASE_DIR / 'assets' / 'fonts' / 'DejaVuSans.ttf')
```
Bundle a copy of the required fonts (DejaVu Sans) in the installer to avoid relying on system font availability.

**Warning signs:**
- FFmpeg drawtext fails on native Windows build but works in WSL dev
- Log shows path patterns like `/mnt/c/` in a native Windows run
- Font rendering produces fallback glyphs on clean Windows machines without DejaVu installed

**Phase to address:** Phase 1 (Desktop launcher foundation) — add `DESKTOP_MODE` flag and audit path assumptions during the first phase, before packaging.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Fixed `time.sleep(5)` for startup wait | Simple to implement | Slow on fast machines; too short on slow machines; users see broken page | Never — use health-check polling |
| Store API keys in plaintext `.env` in install dir | Zero additional code | Keys readable by other processes; ships to user machines accidentally in bundle | Never for production distribution |
| Skip code signing "for now" | Saves $70-350/year | Users blocked by SmartScreen/Defender; no viable workaround for Windows 11 SAC | Acceptable for internal/personal use only; required before any commercial distribution |
| License check only at startup | Simple gate | Revoked licenses keep working indefinitely | Only if distribution is free/no-license-control |
| Bundle Whisper model weights in installer | No download on first run | Installer grows by 150-300 MB per model; NSIS size limit risk | Only if model is small (<50 MB) |
| In-place update (overwrite running exe) | Simplest update logic | Windows file lock causes silent update failure | Never on Windows |
| `subprocess.Popen()` without explicit cleanup | Matches existing patterns | Orphaned processes accumulate; port conflicts on relaunch | Never for a packaged product |
| Crash reporting without user consent | All errors captured | Privacy violation; could capture API keys; regulatory risk | Never — always opt-in |

---

## Integration Gotchas

Common mistakes when connecting the desktop wrapper to the existing FastAPI+Next.js app.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| FastAPI backend startup | Spawn uvicorn with `--reload` flag in the packaged build | Never use `--reload` in production; it watches for file changes and adds unnecessary overhead |
| Next.js frontend | Bundle Next.js dev server (`npm run dev`) | Bundle the production build (`npm run build` + `npm start` or serve static files with a minimal HTTP server) |
| Existing `.env` config | Read `.env` from project root in the launcher | Read from `%APPDATA%\EditFactory\config.json` populated by first-run wizard; never rely on project-root `.env` in packaged build |
| FFmpeg path | `ffmpeg/ffmpeg-master.../bin/` relative path in `run.py` | Use `APP_BASE_DIR / 'ffmpeg' / 'bin'` absolute path; inject into `PATH` before starting backend |
| Supabase JWT auth | Leave `AUTH_DISABLED=false` in packaged build | Set `AUTH_DISABLED=true` and `DESKTOP_MODE=true` in the launcher for single-user desktop deployment |
| Job status polling | Frontend polls `/api/v1/jobs/{id}` via network | This works unchanged — localhost network calls are fine; no change needed |
| `psutil` dependency | Assume it is already installed | Add `psutil` to requirements explicitly; it is not a dev dependency today |

---

## Performance Traps

Patterns that work fine during development but degrade the desktop experience.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Next.js dev server in packaged build | ~8-15 second cold start; high CPU on idle; hot-reload file watching active | Use `next build` + `next start` (production mode) | Every launch |
| Launcher opens browser too fast | Browser shows "site can't be reached" on slow machines | Poll health endpoints before opening browser | First launch on any machine slower than dev machine |
| No startup progress indicator | User sees nothing for 10-30 seconds, assumes crash | System tray icon with "Starting..." tooltip or splash screen | Every launch where backend is slow |
| Whisper model download at first TTS use | First TTS job stalls for 3-5 minutes with no progress | Pre-download in first-run wizard with a progress bar | First use after install |
| Background update download on metered connection | User on mobile hotspot gets unexpected data usage | Respect Windows metered connection API before downloading updates | Mobile/metered connections |

---

## Security Mistakes

Desktop distribution introduces security concerns absent from the localhost dev workflow.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Bundle developer's Supabase service-role key in the exe | All users share one database with admin access; key extractable via binary inspection | Each user connects with their own Supabase project (configured in first-run wizard) OR use a proxy API that validates per-user license before DB access |
| License key stored in Windows Registry without ACL | Any process can read `HKCU\Software\EditFactory\LicenseKey` | Use Windows Credential Manager via `keyring` library — provides OS-level access control |
| Auto-update downloads to temp dir with predictable name | DLL planting / update hijacking attack via symlink | Use a random UUID in the temp path; verify SHA256 before executing |
| Crash reports include user's full video file paths | Paths reveal `C:\Users\<username>\...` structure and personal folder names | Scrub file paths in Sentry `before_send` — anonymize to `...\<filename>` |
| No license key transmission encryption | License key in plaintext HTTP to validation endpoint | Always use HTTPS for license validation; Lemon Squeezy and Gumroad APIs require HTTPS by default |

---

## UX Pitfalls

Desktop product UX fails that do not exist in the localhost dev workflow.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visual indicator that app is loading | User double-clicks icon, sees nothing for 15 seconds, clicks again, starts two instances | Show a system tray icon immediately, animate it while starting; prevent double-launch with a lock file |
| No way to see logs after a crash | User cannot provide useful bug reports | Expose a "View logs" option in the tray icon menu; open `%APPDATA%\EditFactory\logs\` folder |
| Update notification appears mid-work | User is mid-render; update requires restart; work context is lost | Notify about update, offer "Update on next restart" as the default option |
| License validation blocks offline use | User on airplane cannot use app despite having a valid license | Implement 48h offline grace period using a locally-cached, timestamped validation result |
| First-run wizard has no "Skip for now" | User wants to explore the UI before entering API keys | Allow deferring non-critical keys (e.g., Sentry opt-in, ElevenLabs) while requiring Supabase for DB access |
| Uninstaller leaves `%APPDATA%\EditFactory\` behind | User re-installs, gets wrong config from previous install | NSIS uninstaller should offer to remove user data, or document the location clearly |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Launcher process cleanup:** Test that quitting the tray icon kills backend AND frontend — verify ports 8000 and 3000 are free after quit
- [ ] **Path resolution on clean machine:** Install on a machine that has never had the dev environment — verify no paths reference `C:\Users\dev-username\...`
- [ ] **Antivirus test:** Run the installer through VirusTotal before distribution — verify detection count is 0 or document the false-positive status
- [ ] **Offline license grace period:** Disconnect from internet after activation — verify the app launches and functions for 48 hours without network
- [ ] **License revocation:** Revoke a test license key in Gumroad/Lemon Squeezy — verify the app refuses to open within 48 hours of revocation
- [ ] **Auto-update file lock test:** Trigger an update while the app is actively rendering a video — verify update is deferred and does not corrupt the running render
- [ ] **API key scrubbing in Sentry:** Trigger a crash inside a function that has `api_key` in scope — verify Sentry event shows `[Filtered]` not the actual key value
- [ ] **DESKTOP_MODE flag:** Verify that `DESKTOP_MODE=true` is set in the backend's environment when launched via the desktop launcher — check in backend startup logs
- [ ] **First-run wizard recovery:** Close the wizard mid-way — verify re-opening the app re-shows the wizard rather than opening a broken app
- [ ] **Double-launch prevention:** Double-click the desktop icon rapidly — verify only one instance starts, not two

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Relative paths break after install | HIGH — must rebuild | Grep entire codebase for `./`, `../`, `os.getcwd()`, add `APP_BASE_DIR` abstraction, rebuild installer |
| Antivirus quarantines installer | MEDIUM | Submit to Defender for manual review (1-3 days), update install instructions with SmartScreen bypass, expedite code signing purchase |
| Orphaned processes blocking port | LOW — self-service | Add startup port cleanup to next launcher release; document manual fix: `netstat -ano \| findstr :8000` then `taskkill /PID <pid> /F` |
| API keys captured in Sentry event | HIGH — security incident | Rotate affected API keys immediately, add `before_send` scrubbing, purge affected Sentry events from dashboard |
| Auto-update applies corrupt file | MEDIUM | Distribute a manual patch; implement rollback in next release (backup old exe before applying update) |
| License validation broken by API change | MEDIUM | Push an emergency update that extends offline grace period to 30 days; fix validation logic |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Hardcoded relative paths (#1) | Phase 1: Desktop launcher foundation | Install on a clean machine at a non-standard path; verify no FileNotFoundError on launch |
| Antivirus blocks installer (#2) | Phase 2: Windows installer | VirusTotal scan of installer before distribution; test on fresh Windows 11 VM |
| Backend not ready on browser open (#3) | Phase 1: Desktop launcher foundation | Time backend startup on a slow machine (HDD, 4-core); verify no "can't be reached" page |
| Orphaned processes (#4) | Phase 1: Desktop launcher foundation | Quit and relaunch 3 times; verify no "address in use" error |
| Auto-update can't replace running exe (#5) | Phase 3: Auto-update system | Trigger update while app is running; verify version increments correctly after restart |
| License checked only at startup (#6) | Phase 4: License key validation | Revoke license, restart app 24h later; verify rejection |
| API keys in plaintext / bundled (#7) | Phase 1 (config) + Phase 4 (wizard) | Inspect `%APPDATA%\EditFactory\` for plaintext key files; inspect PyInstaller bundle manifest |
| First-run wizard not recoverable (#8) | Phase 5: First-run setup wizard | Close wizard mid-way; verify relaunch re-shows wizard |
| PyInstaller bundles wrong env (#9) | Phase 2: Windows installer | Build in a fresh venv; verify bundle size is under 600 MB |
| NSIS 2 GB size limit (#10) | Phase 2: Windows installer | Measure bundle components before scripting NSIS |
| Sentry captures API keys (#11) | Phase 6: Crash reporting | Trigger a controlled crash with key in scope; inspect Sentry event |
| Update without hash verification (#12) | Phase 3: Auto-update system | Verify SHA256 check is in code before auto-update is enabled |
| WSL paths in desktop build (#13) | Phase 1: Desktop launcher foundation | Run packaged build on native Windows (not WSL); verify no `/mnt/c/` paths in logs |

---

## Sources

**HIGH Confidence (official documentation, reproducible Windows behavior):**
- [PyInstaller: When Things Go Wrong](https://pyinstaller.org/en/stable/when-things-go-wrong.html) — `sys._MEIPASS`, path resolution, onefile behavior
- [NSIS False Positives documentation](https://nsis.sourceforge.io/NSIS_False_Positives) — AV false positive causes and workarounds
- [Sentry Python: Scrubbing Sensitive Data](https://docs.sentry.io/platforms/python/data-management/sensitive-data/) — `before_send`, `send_default_pii`, frame variable scrubbing
- [Lemon Squeezy: Validating License Keys](https://docs.lemonsqueezy.com/guides/tutorials/license-keys) — product_id verification requirement, activation limits
- [PyInstaller antivirus false positives — GitHub Issue #6754](https://github.com/pyinstaller/pyinstaller/issues/6754) — bootloader pattern cause

**MEDIUM Confidence (community sources, multiple reports):**
- [NSIS installer flagged as trojan — electron-builder #6347](https://github.com/electron-userland/electron-builder/issues/6347) — real-world AV detection reports
- [FastAPI server stuck on Windows — rolisz.ro](https://rolisz.ro/2024/fastapi-server-stuck-on-windows/) — Windows-specific process issues
- [Child Processes Not Terminating with Uvicorn — GitHub Discussion #2281](https://github.com/Kludex/uvicorn/discussions/2281) — orphaned child process behavior
- [Offline license key validation — Beyond Code](https://beyondco.de/course/desktop-apps-with-electron/licensing-your-apps/offline-license-key-validation) — grace period pattern
- [How a program can update itself — codestudy.net](https://www.codestudy.net/blog/i-don-t-get-how-a-program-can-update-itself-how-can-i-make-my-software-update/) — two-process update pattern
- [PyInstaller EXE detected as virus — CodersLegacy](https://coderslegacy.com/pyinstaller-exe-detected-as-virus-solutions/) — solutions and SmartScreen relationship

**Edit Factory Codebase (direct inspection):**
- `app/main.py` — existing PATH injection for FFmpeg (WSL pattern to audit)
- `run.py` — existing startup sequence (relative paths to replace)
- `start-dev.bat` / `start-dev.sh` — sleep-based startup (to replace with health polling)
- `.planning/PROJECT.md` — confirmed: Windows/WSL environment, AUTH_DISABLED pattern, DESKTOP_MODE flags planned

---
*Pitfalls research for: Desktop distribution (launcher, installer, auto-update, licensing, crash reporting) added to Edit Factory v10*
*Researched: 2026-03-01*
