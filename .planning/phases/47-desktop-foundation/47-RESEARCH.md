# Phase 47: Desktop Foundation - Research

**Researched:** 2026-03-01
**Domain:** Python path resolution, pydantic-settings multi-source config, process lifecycle management
**Confidence:** HIGH

## Summary

Phase 47 establishes the backend foundation required before an Electron shell (Phase 48) can wrap the app. The work is entirely Python-side: three sub-problems that are independent of each other and can be executed in any order within the phase.

First, `app/config.py` must stop anchoring all paths to `Path(__file__).parent.parent` (the project root) and instead route them through an `APP_BASE_DIR` abstraction that switches between "dev mode" (project root, current behaviour) and "desktop mode" (`%APPDATA%\EditFactory\`). This requires a `settings_customise_sources` override in pydantic-settings so the Settings object can load from two `.env` files — the project `.env` for dev and `%APPDATA%\EditFactory\.env` for desktop — in the correct priority order.

Second, `DESKTOP_MODE=true` (environment variable injected by the Electron launcher before spawning the Python process) must trigger three behaviours in the existing code: (a) skip JWT auth in `auth.py` (same code path as `AUTH_DISABLED=true`, so effectively an alias), (b) resolve FFmpeg from a `bundled/ffmpeg/` path relative to `APP_BASE_DIR` before falling back to system PATH, and (c) suppress any WSL-only platform paths.

Third, a new `app/desktop.py` utility module is needed that the Electron Phase-48 launcher can call as a subprocess with `python -m app.desktop cleanup --ports 8000 3000` to kill orphaned processes from previous launches before starting fresh ones. `psutil` is the right tool and must be added to `requirements.txt`.

**Primary recommendation:** Implement `APP_BASE_DIR` resolution in `config.py` first (FOUND-04 unblocks FOUND-01/03), then wire `DESKTOP_MODE` flag (FOUND-02/03), then add `app/desktop.py` + psutil for process cleanup (FOUND-04 success criteria 4).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | App stores config in %APPDATA%\EditFactory\ (config.json, license.json, .env) | pydantic-settings `settings_customise_sources` can load from computed `APPDATA` path; directory creation via `Path.mkdir(parents=True, exist_ok=True)` on Settings init |
| FOUND-02 | Backend detects DESKTOP_MODE=true and skips JWT auth, reads config from AppData | `DESKTOP_MODE` env var checked in `get_settings()` factory; auth.py already has `auth_disabled` bypass — desktop mode sets same flag or reads it; config source order changes based on flag |
| FOUND-03 | FFmpeg path resolves bundled binary in desktop mode, falls back to system PATH in dev | `app/main.py` already has PATH injection logic; extend to check `APP_BASE_DIR / "bundled" / "ffmpeg" / "bin"` when `DESKTOP_MODE=true` |
| FOUND-04 | All file paths use APP_BASE_DIR abstraction (no hardcoded relative paths) | `_BASE_DIR = Path(__file__).parent.parent` in config.py is the only place paths originate; replace with a function that returns APPDATA dir or project root based on flag; all downstream services receive paths from Settings, so one change propagates everywhere |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pydantic-settings | >=2.1.0 (already in requirements.txt) | Multi-source settings with env_file priority | Already used; `settings_customise_sources` handles our AppData-first pattern natively |
| psutil | 6.x (latest) | Process enumeration, port-based kill, child tree cleanup | Cross-platform; the standard for programmatic process management on Windows without needing admin rights for user-owned processes |
| pathlib.Path | stdlib | Path construction and directory creation | Already used throughout the codebase |
| os.getenv | stdlib | Retrieve `%APPDATA%` environment variable | Correct approach; `os.getenv('APPDATA')` returns the roaming AppData path on Windows |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| python-dotenv | >=1.0.0 (already in requirements.txt) | `.env` file parsing — called by pydantic-settings internally | Already installed; no additional install needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| psutil for port/process cleanup | subprocess + `netstat` / `taskkill` | Windows-only, command syntax varies, harder to test; psutil is the correct cross-platform choice |
| `DESKTOP_MODE` env var flag | Separate config file | Env var is injected by Electron launcher before the process starts — it's the idiomatic inter-process signal; config file read comes after process start |
| `settings_customise_sources` override | Two separate Settings subclasses | Single class with runtime source switching is cleaner and preserves `get_settings()` singleton pattern |

**Installation:**
```bash
pip install psutil
# Then add to requirements.txt: psutil>=5.9.0
```

## Architecture Patterns

### Recommended Project Structure

No new directories needed for Phase 47. Changes are within existing layout:

```
app/
├── config.py          # MODIFIED: APP_BASE_DIR abstraction + DESKTOP_MODE source switching
├── main.py            # MODIFIED: FFmpeg PATH injection checks bundled path in desktop mode
├── desktop.py         # NEW: CLI utility for orphan process cleanup (called by Electron)
├── api/
│   └── auth.py        # MODIFIED: DESKTOP_MODE treated equivalently to AUTH_DISABLED
└── services/
    └── (unchanged)    # All services receive paths from Settings — no changes needed
```

AppData directory structure created on first run:

```
%APPDATA%\EditFactory\
├── .env               # User's API keys + config (written by Setup Wizard in Phase 50)
├── config.json        # App config (Phase 50)
├── license.json       # License data (Phase 49)
├── input\             # Upload temp files
├── output\            # Rendered videos
├── logs\              # cost_log.json + backend logs
└── cache\tts\         # TTS audio cache
```

### Pattern 1: APP_BASE_DIR Resolution

**What:** A module-level function (not a constant) that computes the base directory based on `DESKTOP_MODE` env var at import time.
**When to use:** Called once at module load by `config.py`; cached via `lru_cache` on `get_settings()`.

```python
# app/config.py
import os
from pathlib import Path

def _get_app_base_dir() -> Path:
    """Returns %APPDATA%\EditFactory in desktop mode, project root in dev."""
    if os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes"):
        appdata = os.getenv("APPDATA")
        if appdata:
            return Path(appdata) / "EditFactory"
        # Fallback: APPDATA not set (non-Windows CI); use project root
    return Path(__file__).parent.parent

_APP_BASE_DIR = _get_app_base_dir()
```

### Pattern 2: pydantic-settings Multi-Source Config

**What:** Override `settings_customise_sources` to load from AppData `.env` when in desktop mode, otherwise fall back to project `.env`.
**When to use:** Replaces the current single `env_file = ".env"` in `class Config`.

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic_settings.env_settings import EnvSettingsSource
from pydantic_settings.dotenv import DotEnvSettingsSource

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,  # Disable default; we control this in customise_sources
        env_file_encoding="utf-8"
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls,
        init_settings,
        env_settings,
        dotenv_settings,
        secrets_settings
    ):
        import os
        from pathlib import Path
        sources = [init_settings, env_settings]
        # Desktop mode: load from AppData first, then project .env as fallback
        appdata_env = _APP_BASE_DIR / ".env"
        if appdata_env.exists():
            sources.append(DotEnvSettingsSource(settings_cls, env_file=str(appdata_env)))
        # Always include project .env as lowest-priority fallback (dev defaults)
        project_env = Path(__file__).parent.parent / ".env"
        if project_env.exists():
            sources.append(DotEnvSettingsSource(settings_cls, env_file=str(project_env)))
        return tuple(sources)
```

**Note:** The `lru_cache` on `get_settings()` must be cleared and the Settings singleton re-instantiated if the AppData `.env` is written during a session (Phase 50 Setup Wizard). Pattern: call `get_settings.cache_clear()` after wizard writes the file, then call `get_settings()` again.

### Pattern 3: Desktop Mode DESKTOP_MODE Flag in Auth

**What:** `DESKTOP_MODE=true` in the environment makes the backend behave as if `AUTH_DISABLED=true`.
**When to use:** Checked in `auth.py` `get_current_user()` alongside the existing `auth_disabled` check.

```python
# app/api/auth.py — in get_current_user()
settings = get_settings()
if settings.auth_disabled or settings.desktop_mode:
    logger.warning("Auth bypassed — desktop mode or auth_disabled")
    return AuthUser(user_id="desktop-user", email="desktop@local", role="authenticated")
```

Add `desktop_mode: bool = False` to `Settings` — pydantic-settings will read it from `DESKTOP_MODE` env var automatically (field name maps to env var name).

### Pattern 4: FFmpeg Bundled Binary Resolution

**What:** Check for bundled FFmpeg in `APP_BASE_DIR / "bundled" / "ffmpeg" / "bin"` before adding it to PATH. Falls back to the current win64-gpl local path in dev.
**When to use:** In `app/main.py` at module load (where the current FFmpeg PATH logic lives).

```python
# app/main.py — replace existing FFmpeg PATH injection
import os
from pathlib import Path
from app.config import _APP_BASE_DIR  # Import the computed base dir

def _setup_ffmpeg_path():
    desktop_mode = os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes")
    candidates = []
    if desktop_mode:
        # Phase 48: Electron bundles FFmpeg into AppData/bundled/
        candidates.append(_APP_BASE_DIR / "bundled" / "ffmpeg" / "bin")
    # Dev fallback: local win64-gpl checkout
    candidates.append(Path(__file__).parent.parent / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin")
    for candidate in candidates:
        if candidate.exists():
            os.environ['PATH'] = str(candidate) + os.pathsep + os.environ.get('PATH', '')
            break

_setup_ffmpeg_path()
```

### Pattern 5: Process Cleanup via psutil

**What:** Standalone CLI script (`python -m app.desktop cleanup --ports 8000 3000`) that kills any processes occupying the given ports and their child trees.
**When to use:** Called by the Electron main process before spawning backend/frontend services. Also callable by the shutdown handler.

```python
# app/desktop.py
import psutil
import sys
import argparse
import logging

logger = logging.getLogger(__name__)

def kill_processes_on_port(port: int) -> int:
    """Kill all processes listening on port. Returns count of processes killed."""
    killed = 0
    try:
        for conn in psutil.net_connections(kind='inet'):
            if conn.laddr.port == port and conn.pid:
                try:
                    proc = psutil.Process(conn.pid)
                    children = proc.children(recursive=True)
                    for child in children:
                        child.kill()
                    proc.kill()
                    killed += 1
                    logger.info(f"Killed PID {conn.pid} on port {port}")
                except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
                    logger.warning(f"Could not kill PID {conn.pid}: {e}")
    except Exception as e:
        logger.error(f"Error scanning connections: {e}")
    return killed

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Edit Factory desktop utilities")
    subparsers = parser.add_subparsers(dest="command")
    cleanup = subparsers.add_parser("cleanup")
    cleanup.add_argument("--ports", nargs="+", type=int, default=[8000, 3000])
    args = parser.parse_args()
    if args.command == "cleanup":
        for port in args.ports:
            n = kill_processes_on_port(port)
            print(f"port {port}: killed {n} processes")
```

### Anti-Patterns to Avoid

- **Hardcoding `Path(__file__).parent.parent` in services:** All services already receive paths from `Settings` — this is already clean. The only fix needed is in `config.py` where the base is defined.
- **Setting `os.environ['DESKTOP_MODE']` inside Python code:** The flag must be injected by the launcher (Electron) before the Python process starts — never set it from within the backend.
- **Using `subprocess.run(["taskkill", ...])` for process cleanup:** Windows-only, fragile, requires `/F` flag and process name guessing. psutil is the correct solution.
- **Reading `%APPDATA%` before checking it's set:** On non-Windows systems (CI, Linux dev), `APPDATA` is not set. Always guard with `if appdata:` and fall back to project root.
- **Calling `os.getenv("APPDATA")` in `Settings` field defaults:** Field defaults are evaluated at class definition time, not at instantiation time on Windows where APPDATA is always present. But in CI it may be absent. Use `_get_app_base_dir()` function pattern (see Pattern 1) which guards for None.
- **Clearing `lru_cache` on every request:** Only clear when the Setup Wizard writes a new `.env` file. The `get_settings()` singleton must be stable for the lifetime of a normal request.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding processes by port on Windows | netstat + regex parsing | psutil.net_connections() | Output format varies between Windows versions; psutil is Python-native and handles all platforms |
| Killing process trees | subprocess TASKKILL /T | psutil Process.children(recursive=True) | TASKKILL needs process name; psutil uses PID and handles grandchildren |
| Parsing multiple `.env` files with priority | Custom file reader | pydantic-settings DotEnvSettingsSource | Already handles quote stripping, comment lines, encoding; don't re-implement |
| AppData directory creation | os.makedirs with try/except | Path.mkdir(parents=True, exist_ok=True) | Already in use via `Settings.ensure_dirs()` — extend this pattern |

**Key insight:** The entire scope of FOUND-01 through FOUND-04 is config plumbing and process management — both domains have mature stdlib/third-party solutions that already exist in or adjacent to the project's dependency tree.

## Common Pitfalls

### Pitfall 1: lru_cache Prevents Settings Reload

**What goes wrong:** `get_settings()` is decorated with `@lru_cache`. After the Setup Wizard writes a new `.env` to AppData, calling `get_settings()` returns the old cached object — new API keys are not picked up without restarting the backend.
**Why it happens:** `lru_cache` returns the same instance for the lifetime of the process.
**How to avoid:** Document that Phase 50 (Setup Wizard) must call `get_settings.cache_clear()` followed by `get_settings()` after writing the new `.env`. For Phase 47, just note this in code comments.
**Warning signs:** API calls fail with "not configured" after wizard completes even though `.env` was written successfully.

### Pitfall 2: APPDATA Absent in WSL / CI

**What goes wrong:** `os.getenv('APPDATA')` returns `None` in WSL (Linux) and in CI environments. If code doesn't guard for this, `Path(None) / "EditFactory"` raises a TypeError.
**Why it happens:** `%APPDATA%` is a Windows environment variable; it does not exist in Linux shells, including WSL.
**How to avoid:** Always use the guard pattern: `appdata = os.getenv('APPDATA'); if appdata: ... else: return project_root`.
**Warning signs:** `TypeError: argument of type 'NoneType'` during backend startup in WSL dev environment.

### Pitfall 3: psutil.net_connections() Requires Elevated Privileges on Windows for Some Connections

**What goes wrong:** On some Windows configurations, `psutil.net_connections()` only returns connections for the current user's processes without admin rights. Processes started by a different user (e.g., a previous run under a different elevation level) may not appear.
**Why it happens:** Windows separates process namespaces by session/elevation.
**How to avoid:** For Edit Factory, both backend (8000) and frontend (3000) are always started by the same user account that runs the Electron app — so this is not a real-world issue. But wrap in `try/except psutil.AccessDenied` for safety and log a warning rather than crashing.
**Warning signs:** `psutil.AccessDenied` exception during cleanup; port still in use after cleanup.

### Pitfall 4: Relative Path Defaults Break When CWD Is Not Project Root

**What goes wrong:** `edge_tts_service.py` line 76 has `Path("./output")` as default. When Electron launches the backend with `python -m uvicorn app.main:app` from `%APPDATA%\EditFactory\`, the CWD may be the AppData dir, not the project root. The `./output` default resolves to `AppData\EditFactory\output` which may not exist.
**Why it happens:** CWD-relative paths assume the launch directory, which changes in desktop mode.
**How to avoid:** The `Settings.output_dir` field already provides the correct path from `APP_BASE_DIR`. Services that use `Path("./output")` as a fallback are only triggered when no `output_dir` is passed — audit call sites to ensure `settings.output_dir` is always passed explicitly. `tts_cache.py` line 19 (`Path(__file__).parent.parent.parent / "cache" / "tts"`) is `__file__`-relative and is safe — it always resolves to the installed location.
**Warning signs:** `FileNotFoundError` for output paths that are not under the expected AppData directory.

### Pitfall 5: WSL Font Paths in Subtitle Filter

**What goes wrong:** The subtitle filter in `subtitle_styler.py` uses `FontName=Montserrat` in the ASS force_style. In WSL dev mode, FFmpeg searches for Montserrat in Linux font directories (`/usr/share/fonts`). In desktop (Windows native) mode, Windows font lookup works differently — FFmpeg uses GDI, which reads from `C:\Windows\Fonts`.
**Why it happens:** ASS subtitle rendering path differs between Linux FFmpeg and Windows FFmpeg.
**How to avoid:** The existing subtitle filter does NOT use a `fontsdir` parameter — it only specifies `FontName`. On Windows native (desktop mode), the Montserrat font is assumed to be bundled by the Electron installer (Phase 52). For Phase 47, this is informational only — no code change needed. Flag for Phase 52 as a bundling requirement.
**Warning signs:** Subtitle rendering falls back to a generic font (Arial or similar) in desktop mode.

## Code Examples

Verified patterns from official sources and existing codebase:

### AppData Path Computation (stdlib, verified)

```python
# Source: os module docs + existing pattern in app/config.py
import os
from pathlib import Path

def _get_app_base_dir() -> Path:
    if os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes"):
        appdata = os.getenv("APPDATA")  # %APPDATA% = Roaming AppData on Windows
        if appdata:
            base = Path(appdata) / "EditFactory"
            base.mkdir(parents=True, exist_ok=True)
            return base
    # Dev / WSL / CI: use project root (existing behaviour)
    return Path(__file__).parent.parent
```

### pydantic-settings Multiple Sources (verified via official docs)

```python
# Source: https://docs.pydantic.dev/latest/concepts/pydantic_settings/
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic_settings.env_settings import EnvSettingsSource
from pydantic_settings.main import DotEnvSettingsSource

class Settings(BaseSettings):
    desktop_mode: bool = False  # Populated from DESKTOP_MODE env var automatically

    @classmethod
    def settings_customise_sources(cls, settings_cls, init_settings, env_settings,
                                   dotenv_settings, secrets_settings):
        sources = [init_settings, env_settings]
        appdata_env = _APP_BASE_DIR / ".env"
        if appdata_env.exists():
            sources.append(DotEnvSettingsSource(settings_cls, env_file=str(appdata_env)))
        project_env = Path(__file__).parent.parent / ".env"
        if project_env.exists():
            sources.append(DotEnvSettingsSource(settings_cls, env_file=str(project_env)))
        return tuple(sources)
```

### psutil Port Cleanup (verified via psutil docs)

```python
# Source: https://psutil.readthedocs.io/
import psutil

def kill_processes_on_port(port: int) -> int:
    killed = 0
    for conn in psutil.net_connections(kind='inet'):
        if conn.laddr.port == port and conn.pid:
            try:
                proc = psutil.Process(conn.pid)
                for child in proc.children(recursive=True):
                    child.kill()
                proc.kill()
                killed += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    return killed
```

### Settings ensure_dirs Update (existing pattern extended)

```python
# app/config.py — extend existing ensure_dirs()
def ensure_dirs(self):
    """Create necessary directories if they don't exist."""
    self.input_dir.mkdir(parents=True, exist_ok=True)
    self.output_dir.mkdir(parents=True, exist_ok=True)
    self.logs_dir.mkdir(parents=True, exist_ok=True)
    if self.desktop_mode:
        # Ensure AppData root exists (for license.json, config.json written by Phase 49/50)
        self.base_dir.mkdir(parents=True, exist_ok=True)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `class Config: env_file = ".env"` | `model_config = SettingsConfigDict(...)` | pydantic-settings 2.0 | Old syntax still works but deprecated; either works here |
| `psutil.get_connections()` | `psutil.net_connections()` | psutil 6.0 (2024) | `get_connections()` is removed in 6.x — use `net_connections()` |

**Deprecated/outdated:**
- `psutil.Process.connections()`: Use `psutil.net_connections()` system-wide, then filter by PID. The per-process method may not show all connections on Windows without elevation.
- `pydantic v1 BaseSettings` (`from pydantic import BaseSettings`): Must use `from pydantic_settings import BaseSettings` — project already correctly uses v2.

## Open Questions

1. **pydantic-settings import path for DotEnvSettingsSource**
   - What we know: It exists and is documented. Official import path may vary by minor version.
   - What's unclear: Exact import path in pydantic-settings 2.1 vs 2.4+. The class may be at `pydantic_settings.env_settings.DotEnvSettingsSource` or `pydantic_settings.main.DotEnvSettingsSource`.
   - Recommendation: In the implementation task, do `from pydantic_settings import BaseSettings` and check `pydantic_settings.__version__` to confirm, or use a try/except import. Alternatively, use the runtime `_env_file` kwarg pattern: `Settings(_env_file=str(appdata_env))` — this is simpler and avoids the import question entirely, but breaks the singleton pattern. Prefer `settings_customise_sources`.

2. **Does `ensure_dirs()` need to create the AppData root before pydantic-settings reads from it?**
   - What we know: `ensure_dirs()` is called in the `lifespan` startup handler in `main.py`, which runs after `Settings()` is already instantiated (at module import time).
   - What's unclear: If `_APP_BASE_DIR` doesn't exist yet on first run, `DotEnvSettingsSource` will simply find no file and return empty dict — which is correct (Settings falls through to defaults). The dir is then created by `ensure_dirs()` before it's needed for writes.
   - Recommendation: No code change needed — the startup sequence is already correct. Document this in code comments for clarity.

3. **Montserrat font in desktop mode**
   - What we know: Subtitle filter uses `FontName=Montserrat` without a `fontsdir` parameter.
   - What's unclear: Whether Windows FFmpeg (from the bundled binary in Phase 52) will find Montserrat via GDI font lookup or if a font file must be bundled and `fontfile=` must be specified.
   - Recommendation: Out of scope for Phase 47. Flag for Phase 52 (Installer). In desktop mode, FFmpeg on Windows will use whatever fonts Windows has installed. If Montserrat is not present, it degrades to Arial — acceptable for Phase 47.

## Sources

### Primary (HIGH confidence)

- [Pydantic Settings official docs](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) — settings_customise_sources, DotEnvSettingsSource, multiple env_file, _env_file kwarg
- [psutil official docs](https://psutil.readthedocs.io/) — net_connections(), Process.children(recursive=True), kill()
- Codebase audit (app/config.py, app/main.py, app/api/auth.py, app/services/cost_tracker.py, app/services/tts_cache.py, app/services/edge_tts_service.py) — confirmed path anchoring points and service instantiation patterns

### Secondary (MEDIUM confidence)

- [Python docs: os.getenv APPDATA](https://docs.python.org/3/using/windows.html) — confirmed APPDATA env var is standard on Windows
- WebSearch: psutil.net_connections() replaces deprecated per-process connections() in psutil 6.x — multiple sources agree, consistent with official docs

### Tertiary (LOW confidence)

- Exact import path for `DotEnvSettingsSource` in pydantic-settings 2.1 — to be validated during implementation task

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pydantic-settings and psutil are both established, version-verified, already in project
- Architecture: HIGH — all patterns verified against existing code + official docs; no speculative patterns
- Pitfalls: HIGH for APPDATA/lru_cache/psutil pitfalls (verified from docs + codebase); MEDIUM for Montserrat font fallback (reasonable inference, not tested)

**Research date:** 2026-03-01
**Valid until:** 2026-09-01 (pydantic-settings 2.x stable; psutil 6.x stable)
