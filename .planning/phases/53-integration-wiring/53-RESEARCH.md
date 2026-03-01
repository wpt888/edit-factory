# Phase 53: Cross-Phase Integration Wiring — Research

**Researched:** 2026-03-01
**Domain:** Electron process environment injection, FastAPI lru_cache invalidation, FFmpeg path resolution
**Confidence:** HIGH (all three gaps identified from direct source code inspection; no external library uncertainty)

---

## Summary

Phase 53 is a pure gap-closure phase. All 6 v10 phases passed their individual verifications, but milestone audit found 3 wiring gaps at phase boundaries. Every fix is a small, targeted code change — no new dependencies, no architectural shifts. This is the lowest-risk phase of v10.

**Gap 1 (NEXT_PUBLIC_DESKTOP_MODE)** is the highest-impact fix. It blocks 7 requirements (WIZD-01 through WIZD-06, UPDT-06). The root cause is that `electron/src/main.js` injects `DESKTOP_MODE=true` into the uvicorn subprocess env (line 88) but omits `NEXT_PUBLIC_DESKTOP_MODE=true` from the Next.js standalone server subprocess env (lines 129-134). The frontend build also never has this env var baked in. Two complementary fixes address both the runtime path (Electron injects it at runtime into the `node server.js` subprocess) and the build path (a `frontend/.env.production` file bakes it in during `next build`).

**Gap 2 (settings cache)** is a one-line fix. `desktop_routes.py::save_desktop_settings` (and `mark_first_run_complete`) writes config.json but never calls `get_settings.cache_clear()`. The `@lru_cache` on `get_settings()` in `app/config.py` (line 134) means the backend serves stale Settings until process restart. The fix: call `get_settings.cache_clear(); get_settings()` after each config write.

**Gap 3 (FFmpeg path)** requires a one-line env var injection in `electron/src/main.js` and a small update to `app/main.py::_setup_ffmpeg_path()`. The installer's `extraResources` copies FFmpeg to `process.resourcesPath/ffmpeg/bin`, but the backend currently looks in `%APPDATA%\EditFactory\bundled\ffmpeg\bin`. The cleanest fix: pass `RESOURCES_PATH=<process.resourcesPath>` from Electron into the backend subprocess env, then update `_setup_ffmpeg_path()` to check `RESOURCES_PATH/ffmpeg/bin` in desktop mode.

**Primary recommendation:** Three surgical code changes across 3 files (`electron/src/main.js`, `app/main.py`, `app/api/desktop_routes.py`) plus one new file (`frontend/.env.production`) close all gaps with zero new dependencies.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WIZD-01 | /setup page detects first run via %APPDATA% flag and redirects new users | Fixed by injecting NEXT_PUBLIC_DESKTOP_MODE=true — setup/page.tsx line 59 guard will pass |
| WIZD-02 | Step 1: License key entry with Lemon Squeezy activation | Fixed by same env var injection — license step will render |
| WIZD-03 | Step 2: API key configuration with test connection | Fixed by same env var injection — API key step will render |
| WIZD-04 | Step 3: Crash reporting consent | Fixed by same env var injection — crash consent step will render |
| WIZD-05 | Wizard writes config to %APPDATA% and marks first_run_complete | Fixed by adding cache_clear() after POST /desktop/settings — new values load immediately |
| WIZD-06 | Wizard re-accessible from Settings page at any time | Fixed by same env var injection — Setup Wizard card at settings/page.tsx line 1078 will render |
| UPDT-05 | Backend GET /api/v1/desktop/version returns current version number | Already works; unblocked by env var fix (settings page useEffect guard at line 250 passes) |
| UPDT-06 | Version displayed in Settings page footer | Already works; unblocked by env var fix (appVersion state is set via the same useEffect) |
| FOUND-01 | App stores config in %APPDATA%\EditFactory\ | Partially satisfied; cache_clear() fix makes the write immediately effective |
| FOUND-03 | FFmpeg path resolves bundled binary in desktop mode | Fixed by passing RESOURCES_PATH from Electron and updating _setup_ffmpeg_path() |
| INST-02 | Installer bundles Python venv, FFmpeg binary, Next.js standalone, portable Node.js 22.x | FFmpeg extraResources entry already bundles to process.resourcesPath/ffmpeg/bin; path fix wires it |
</phase_requirements>

---

## Standard Stack

### Core (no new dependencies)

| Component | File | What Changes |
|-----------|------|--------------|
| Electron main process | `electron/src/main.js` | Add `NEXT_PUBLIC_DESKTOP_MODE: 'true'` and `RESOURCES_PATH: process.resourcesPath` to frontend spawn env |
| FastAPI backend startup | `app/main.py` | Update `_setup_ffmpeg_path()` to check `RESOURCES_PATH/ffmpeg/bin` before AppData path |
| FastAPI desktop routes | `app/api/desktop_routes.py` | Add `get_settings.cache_clear(); get_settings()` after config writes |
| Next.js build env | `frontend/.env.production` | New file: `NEXT_PUBLIC_DESKTOP_MODE=true` |

### No New Dependencies Required

All fixes use existing modules and patterns already in the codebase:
- `os.getenv()` — already used in `app/main.py` and `app/config.py`
- `get_settings.cache_clear()` — `@lru_cache` already on `get_settings` in `app/config.py`
- `process.env` / `process.resourcesPath` — standard Electron Node.js globals, already used in `main.js`
- `.env.production` — standard Next.js convention, no build config changes needed

---

## Architecture Patterns

### Pattern 1: Next.js NEXT_PUBLIC_* Environment Variables — Two Propagation Modes

**What:** `NEXT_PUBLIC_*` variables can be set at build time (baked into JS bundle) OR at runtime (via Next.js standalone server's process.env).

**Build-time baking** (`frontend/.env.production`):
```
NEXT_PUBLIC_DESKTOP_MODE=true
```
When `npm run build` runs, Next.js reads `.env.production` and replaces all `process.env.NEXT_PUBLIC_DESKTOP_MODE` references in the emitted JS with the literal string `"true"`. This is a compile-time substitution.

**Runtime injection** (Electron `startFrontend()`):
```javascript
// electron/src/main.js — startFrontend()
frontendProcess = spawn(nodeExe, [NEXT_SERVER], {
  env: {
    ...process.env,
    PORT: String(FRONTEND_PORT),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    NEXT_PUBLIC_DESKTOP_MODE: 'true',   // <-- ADD THIS
  },
  ...
})
```
Next.js standalone server reads `process.env.NEXT_PUBLIC_*` at runtime for SSR pages. However, **for client-side (`"use client"`) components, the value is baked at build time** — runtime injection via process.env does NOT reach the browser for client components.

**Critical insight for this codebase:** Both `setup/page.tsx` and `settings/page.tsx` are `"use client"` components. Their `process.env.NEXT_PUBLIC_DESKTOP_MODE` references are baked at build time. Therefore:

- Runtime injection via `startFrontend()` env is **not sufficient** for client components
- `frontend/.env.production` is **required** so the build bakes in `"true"`
- Both changes should be applied (belt-and-suspenders): `.env.production` for the client bundle, runtime env for any server-side rendering paths

**Confidence: HIGH** — verified by Next.js documentation behavior and direct inspection of the component files confirming both are `"use client"`.

### Pattern 2: lru_cache Invalidation After Config Write

**What:** `get_settings()` is decorated with `@lru_cache` (Python stdlib, `app/config.py` line 134). Calling `get_settings.cache_clear()` drops the cached `Settings` instance; next call reconstructs from current env vars / .env files.

**Correct pattern (already documented in config.py line 131 comment):**
```python
# In desktop_routes.py — after writing to config.json or AppData .env:
from app.config import get_settings
get_settings.cache_clear()
settings = get_settings()  # Re-instantiate with fresh values
```

**Scope:** Must be applied to ALL three write endpoints:
1. `save_desktop_settings` (POST /desktop/settings) — writes API keys to config.json
2. `mark_first_run_complete` (POST /desktop/first-run/complete) — writes first_run_complete flag

Note: `set_crash_reporting_toggle` (POST /desktop/crash-reporting) modifies in-memory state via `set_crash_reporting()` and persists to config.json, but crash reporting is managed separately via the crash reporter module, not via Settings. This endpoint does NOT need `cache_clear()` since nothing re-reads `crash_reporting_enabled` from Settings after startup.

**Confidence: HIGH** — pattern documented in the code's own comment at config.py line 131.

### Pattern 3: Passing Electron resourcesPath to Python Backend

**What:** `process.resourcesPath` is the Electron path to the `resources/` directory inside the installed app. This is where `extraResources` places bundled files. The backend needs this path to locate FFmpeg.

**Electron side (main.js, `startBackend()`):**
```javascript
backendProcess = spawn(UVICORN_EXE, [...], {
  env: {
    ...process.env,
    DESKTOP_MODE: 'true',
    RESOURCES_PATH: process.resourcesPath,   // <-- ADD THIS
  },
  ...
})
```

**Python side (app/main.py, `_setup_ffmpeg_path()`):**
```python
def _setup_ffmpeg_path():
    desktop_mode = os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes")
    candidates = []
    if desktop_mode:
        # Primary: electron-builder extraResources places FFmpeg here
        resources_path = os.getenv("RESOURCES_PATH")
        if resources_path:
            candidates.append(Path(resources_path) / "ffmpeg" / "bin")
        # Fallback: legacy AppData path (keep for backwards compat)
        appdata = os.getenv("APPDATA")
        if appdata:
            candidates.append(Path(appdata) / "EditFactory" / "bundled" / "ffmpeg" / "bin")
    # Dev fallback: local win64-gpl checkout in project root
    candidates.append(Path(__file__).parent.parent / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin")
    for candidate in candidates:
        if candidate.exists():
            os.environ['PATH'] = str(candidate) + os.pathsep + os.environ.get('PATH', '')
            break
```

**Why not move FFmpeg to AppData instead?** The alternative approach (copying FFmpeg from resourcesPath to AppData on first run) adds complexity: needs file copy logic, needs to handle partial copies, needs admin privilege concern. Passing the path is simpler, correct, and doesn't touch the installer.

**Confidence: HIGH** — `process.resourcesPath` is standard Electron API; electron/package.json line 62 confirms the FFmpeg `to` destination is `"ffmpeg/bin"` under resourcesPath.

### Pattern 4: .env.production vs .env.local Priority

**Next.js .env file loading priority (highest to lowest):**
1. `process.env` (actual environment variables)
2. `.env.$(NODE_ENV).local` (e.g., `.env.production.local`) — gitignored
3. `.env.local` — gitignored, not loaded in `test` environment
4. `.env.$(NODE_ENV)` (e.g., `.env.production`) — this is what we create
5. `.env`

Since `NODE_ENV=production` during standalone server run, `.env.production` is loaded by Next.js build. The file is committed to git (not gitignored), making the desktop build configuration explicit and reproducible.

**Warning:** `.env.production` with `NEXT_PUBLIC_DESKTOP_MODE=true` means ALL production builds (web deployment at editai.obsid.ro AND desktop) would have this flag set at build time. This could cause the web deployment's settings page to show the desktop-only cards (Setup Wizard, Crash Reporting).

**Resolution options:**
- Option A: Accept it — the cards call `/api/v1/desktop/version` and `/api/v1/desktop/settings` which return 404 on web (desktop router not mounted). The cards would render but the API calls would silently fail (`.catch(() => {})` already handles this).
- Option B: Use a separate build command for desktop vs web (e.g., `NEXT_PUBLIC_DESKTOP_MODE=true npm run build`) and do NOT create `.env.production`. Desktop card in settings would show but with failed API calls — acceptable since web users wouldn't see the desktop-specific endpoints.
- Option C: Keep `.env.production` for desktop, add a separate `.env.production.web` pattern — but this is non-standard and complex.

**Recommendation: Option A.** The desktop-mode UI cards render but API calls fail silently on web — this is already handled by `.catch(() => {})`. The Settings page version footer only appears if `appVersion` is truthy (it's null when API call fails). The crash reporting toggle and Setup Wizard link would be visible on web but non-functional — acceptable for a developer-facing tool at this stage.

**Confidence: MEDIUM** — Next.js env file priority is well-documented; the web/desktop build separation concern is a real tradeoff.

### Anti-Patterns to Avoid

- **Don't use `NEXT_PUBLIC_DESKTOP_MODE` in `.env.local`** — `.env.local` is gitignored and not copied into the Next.js standalone output. It would work in dev but not in the packaged app.
- **Don't try to inject `NEXT_PUBLIC_*` vars at runtime for client components** — these are compiled away at build time. Runtime env injection only works for server-side code (middleware, API routes, server components).
- **Don't call `get_settings.cache_clear()` at module import time** — only call it after a config write, inside the request handler that performed the write.
- **Don't change the FFmpeg `extraResources` destination in package.json** — the existing `"to": "ffmpeg/bin"` config is correct; only the Python lookup path needs updating.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Settings reload after config write | Custom file watcher, reload-on-next-request middleware | `get_settings.cache_clear()` — already supported by `@lru_cache` |
| Electron-to-Python communication channel | IPC, named pipes, HTTP callbacks | Environment variables passed to subprocess (already established pattern in this codebase) |
| Next.js build-time env baking | Custom webpack plugin, build script env injection | `.env.production` file — standard Next.js convention |

---

## Common Pitfalls

### Pitfall 1: "use client" vs Server Component env var resolution

**What goes wrong:** Developer adds `NEXT_PUBLIC_DESKTOP_MODE=true` to runtime env (Electron `startFrontend`) and assumes it will reach the browser. It does not — client components have their `process.env.*` references replaced with literal values during the webpack build step.

**Why it happens:** Confusion between server-side (runtime) and client-side (build-time) env var access. `"use client"` components are bundled to static JS; `process.env.NEXT_PUBLIC_*` is a build-time replacement, not a runtime lookup.

**How to avoid:** Always use `.env.production` (build-time) for values needed in `"use client"` components. Verify by searching for `"use client"` at the top of files that use the env var.

**Warning signs:** Runtime injection via process.env "works in dev" (because `next dev` re-reads env vars) but fails in the packaged standalone build.

### Pitfall 2: cache_clear() Without Re-instantiation

**What goes wrong:** Calling `get_settings.cache_clear()` but not immediately calling `get_settings()` — the next actual call that reads settings re-instantiates from the same env vars that haven't changed. If the wizard writes to config.json (not .env), the config.json values are read at Settings construction time, not via env vars.

**Why it happens:** The pydantic-settings Settings class reads `config.json` values through `settings_customise_sources`. These are loaded fresh each time `Settings()` is instantiated. Clearing the cache and then calling `get_settings()` immediately forces fresh instantiation with current file state.

**How to avoid:** Always follow the two-step pattern: `get_settings.cache_clear()` then `get_settings()`.

### Pitfall 3: RESOURCES_PATH in Dev Mode

**What goes wrong:** In dev mode (`isDev=true`), `process.resourcesPath` is undefined/wrong (it points to the electron source directory, not a built resources directory). If `RESOURCES_PATH` is always passed to the backend, `_setup_ffmpeg_path()` would look for `undefined/ffmpeg/bin` and fail before falling through to the dev fallback.

**Why it happens:** `process.resourcesPath` is only meaningful in a packaged Electron app.

**How to avoid:** In `electron/src/main.js`, only pass `RESOURCES_PATH` when NOT in dev mode:
```javascript
env: {
  ...process.env,
  DESKTOP_MODE: 'true',
  ...(isDev ? {} : { RESOURCES_PATH: process.resourcesPath }),
},
```
The dev fallback path in `_setup_ffmpeg_path()` (the local `ffmpeg-master-latest-win64-gpl/bin` entry) handles dev mode automatically.

### Pitfall 4: config.json vs .env writes and cache_clear scope

**What goes wrong:** The wizard's `handleFinish` calls `POST /desktop/settings` which writes API keys to `config.json` (not to `AppData/.env`). The `Settings` class reads these from config.json? — actually NO. Looking at config.py, the `Settings` class reads its fields from env vars and `.env` files via pydantic-settings. The `config.json` written by `save_desktop_settings` is a separate config store.

**What this means:** `get_settings.cache_clear()` after writing `config.json` is only relevant if `save_desktop_settings` also writes to the `AppData/.env` file that pydantic-settings reads. Currently it only writes to `config.json`. The `get_settings()` `Settings` object fields (like `gemini_api_key`, `supabase_url`) come from `.env` sources, not from `config.json`.

**Implication for Phase 53:** The `get_settings.cache_clear()` fix is needed for `first_run_complete` and `crash_reporting_enabled` if those are read from `Settings` — but they are NOT; they're read directly from `config.json` by `get_desktop_settings()`. However, `save_desktop_settings` might also need to write to the `AppData/.env` file for the API key values to take effect in the backend (since `Settings.gemini_api_key` etc. come from `.env`).

**Current state:** `save_desktop_settings` only writes to `config.json`. The backend `Settings.gemini_api_key` would only be updated if the wizard ALSO writes to `AppData/.env` and then `cache_clear()` is called. This is the actual WIZD-05 gap: wizard writes to config.json but the backend Settings singleton still has the old (empty) API keys.

**Resolution:** `save_desktop_settings` should write API keys BOTH to `config.json` (for UI display) AND to `AppData/.env` (for pydantic-settings), then call `get_settings.cache_clear(); get_settings()`. The `AppData/.env` write ensures the backend immediately serves requests with the new API keys.

**Confidence: HIGH** — confirmed by tracing through config.py lines 80-119 showing Settings reads from .env sources.

---

## Code Examples

### Fix 1: frontend/.env.production (NEW FILE)

```
# frontend/.env.production
# Baked into Next.js build for desktop distribution
NEXT_PUBLIC_DESKTOP_MODE=true
```

### Fix 2: electron/src/main.js — startBackend() and startFrontend() with correct env

```javascript
// In startBackend() — add RESOURCES_PATH (packaged only)
backendProcess = spawn(UVICORN_EXE, [...], {
  cwd: BACKEND_CWD,
  env: {
    ...process.env,
    DESKTOP_MODE: 'true',
    ...(isDev ? {} : { RESOURCES_PATH: process.resourcesPath }),
  },
  ...
})

// In startFrontend() — add NEXT_PUBLIC_DESKTOP_MODE (belt-and-suspenders for SSR)
frontendProcess = spawn(nodeExe, [NEXT_SERVER], {
  cwd: NEXT_STANDALONE_DIR,
  env: {
    ...process.env,
    PORT: String(FRONTEND_PORT),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    NEXT_PUBLIC_DESKTOP_MODE: 'true',
  },
  ...
})
```

### Fix 3: app/main.py — _setup_ffmpeg_path() updated

```python
def _setup_ffmpeg_path():
    desktop_mode = os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes")
    candidates = []
    if desktop_mode:
        # Primary: electron-builder extraResources places FFmpeg at resourcesPath/ffmpeg/bin
        resources_path = os.getenv("RESOURCES_PATH")
        if resources_path:
            candidates.append(Path(resources_path) / "ffmpeg" / "bin")
        # Fallback: legacy AppData path (kept for backwards compat)
        appdata = os.getenv("APPDATA")
        if appdata:
            candidates.append(Path(appdata) / "EditFactory" / "bundled" / "ffmpeg" / "bin")
    # Dev fallback: local win64-gpl checkout in project root
    candidates.append(Path(__file__).parent.parent / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin")
    for candidate in candidates:
        if candidate.exists():
            os.environ['PATH'] = str(candidate) + os.pathsep + os.environ.get('PATH', '')
            break
```

### Fix 4: app/api/desktop_routes.py — cache_clear after config writes

```python
# In save_desktop_settings (POST /desktop/settings):
@router.post("/settings")
async def save_desktop_settings(body: dict):
    """Write settings to config.json and AppData .env. Merges with existing values."""
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    existing = _read_config(config_file)
    existing.update({k: v for k, v in body.items() if v is not None})
    config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")

    # Write API keys to AppData .env so pydantic-settings picks them up
    _write_env_keys(settings.base_dir, body)

    # Clear settings cache so next request sees fresh values
    get_settings.cache_clear()
    get_settings()

    return {"saved": True}


# In mark_first_run_complete (POST /desktop/first-run/complete):
@router.post("/first-run/complete")
async def mark_first_run_complete():
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    existing = _read_config(config_file)
    existing["first_run_complete"] = True
    config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    get_settings.cache_clear()
    get_settings()
    logger.info("Setup wizard completed — first_run_complete written to config.json")
    return {"completed": True}


def _write_env_keys(base_dir: Path, payload: dict) -> None:
    """Write API key values from settings payload to AppData .env for pydantic-settings reload."""
    env_key_map = {
        "gemini_api_key": "GEMINI_API_KEY",
        "elevenlabs_api_key": "ELEVENLABS_API_KEY",
        "supabase_url": "SUPABASE_URL",
        "supabase_key": "SUPABASE_KEY",
    }
    env_file = base_dir / ".env"
    # Read existing lines (preserve any non-API-key entries)
    lines = []
    if env_file.exists():
        lines = env_file.read_text(encoding="utf-8").splitlines()

    # Build dict of existing key=value pairs
    existing_env = {}
    for line in lines:
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            existing_env[k.strip()] = v.strip()

    # Update with new values from payload
    for payload_key, env_var in env_key_map.items():
        if payload.get(payload_key):
            existing_env[env_var] = payload[payload_key]

    # Write back
    new_lines = [f"{k}={v}" for k, v in existing_env.items()]
    env_file.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
```

---

## Open Questions

1. **Web deployment concern with .env.production**
   - What we know: `frontend/.env.production` with `NEXT_PUBLIC_DESKTOP_MODE=true` affects all `next build` outputs, including the web deployment at editai.obsid.ro
   - What's unclear: Whether the web build uses this .env.production or overrides it via CI/CD env vars
   - Recommendation: Accept Option A (desktop cards visible but non-functional on web) for now. Add a comment in `.env.production` explaining this is the desktop-specific value and web deployments should override it via CI env var.

2. **_write_env_keys helper — should AppData .env use quoting for special chars in API keys?**
   - What we know: Supabase anon keys (JWT format) and Gemini keys contain dots/hyphens but no shell special characters. ElevenLabs keys start with `sk_`.
   - What's unclear: Whether keys could contain `=` characters (unlikely but possible in base64 padding)
   - Recommendation: Wrap values in double quotes in the .env file: `SUPABASE_KEY="eyJ..."`

3. **Does pydantic-settings re-read the .env file on cache_clear() + re-instantiation?**
   - What we know: `settings_customise_sources` in config.py adds the AppData `.env` as a `DotEnvSettingsSource` — this source is instantiated fresh each time `Settings()` is constructed
   - What's unclear: Whether `DotEnvSettingsSource` reads the file at source-creation time or at settings-resolution time
   - Recommendation: HIGH confidence it re-reads the file each time `Settings()` is constructed (pydantic-settings reads files eagerly at init). The pattern is already documented in the config.py comment.

---

## State of the Art

| Old Approach (Phase 47 plan) | Current State | Gap |
|------------------------------|---------------|-----|
| FFmpeg at AppData/EditFactory/bundled/ffmpeg/bin | electron-builder puts it at process.resourcesPath/ffmpeg/bin | Path mismatch — this phase fixes it |
| get_settings.cache_clear() noted as obligation in config.py comment | Not called in desktop_routes.py | This phase implements it |
| NEXT_PUBLIC_DESKTOP_MODE assumed to be set | Never set in any .env or process env | This phase adds both .env.production and runtime injection |

---

## Validation Architecture

> nyquist_validation is not set in .planning/config.json (workflow block has research/plan_check/verifier, not nyquist_validation). Skipping this section.

---

## Sources

### Primary (HIGH confidence — direct source code inspection)

- `/mnt/c/OBSID SRL/n8n/edit_factory/electron/src/main.js` — confirmed NEXT_PUBLIC_DESKTOP_MODE absence (lines 129-134), DESKTOP_MODE injection (line 88), process.resourcesPath usage
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/main.py` — confirmed _setup_ffmpeg_path() checks AppData path (lines 9-23), not resourcesPath
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/desktop_routes.py` — confirmed save_desktop_settings (line 183) and mark_first_run_complete (line 107) lack cache_clear()
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/config.py` — confirmed @lru_cache on get_settings (line 134), cache_clear obligation comment (line 131), settings_customise_sources pattern (lines 86-119)
- `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/setup/page.tsx` — confirmed NEXT_PUBLIC_DESKTOP_MODE check at lines 59 and 198
- `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/settings/page.tsx` — confirmed NEXT_PUBLIC_DESKTOP_MODE gates at lines 250, 1049, 1078
- `/mnt/c/OBSID SRL/n8n/edit_factory/electron/package.json` — confirmed extraResources FFmpeg destination `"to": "ffmpeg/bin"` (line 62)
- `/mnt/c/OBSID SRL/n8n/edit_factory/.planning/v10-MILESTONE-AUDIT.md` — complete gap analysis with root causes and affected requirements

### Secondary (MEDIUM confidence)

- Next.js documentation behavior: `NEXT_PUBLIC_*` in `"use client"` components is baked at build time — verified by Next.js stable behavior (consistent across versions 13-15)
- `process.resourcesPath` Electron API — standard Electron API, used extensively in existing main.js

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all existing patterns
- Architecture: HIGH — all changes are in files directly inspected; patterns are verified from source
- Pitfalls: HIGH — pitfall 4 (config.json vs .env separation) is particularly important and derived from direct config.py analysis

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable codebase, no external library changes needed)
