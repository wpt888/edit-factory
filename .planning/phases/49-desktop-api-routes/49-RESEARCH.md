# Phase 49: Desktop API Routes - Research

**Researched:** 2026-03-01
**Domain:** FastAPI router for licensing (Lemon Squeezy), version endpoint, AppData settings I/O
**Confidence:** HIGH

## Summary

Phase 49 adds a new FastAPI router (`app/api/desktop_routes.py`) plus a `LicenseService` (`app/services/license_service.py`). The router provides four capability areas: version reporting, license activation, license validation with offline grace period, and settings read/write for `%APPDATA%\EditFactory\config.json`. All endpoints are specific to DESKTOP_MODE and are only mounted when `settings.desktop_mode` is true.

The Lemon Squeezy License API is well-documented and uses simple form-encoded POSTs (not JSON, not bearer auth). The activate call returns an `instance.id` that must be persisted to `license.json` — it is required for all future validate calls. The `valid` boolean in the validate response is the single truth source; status values (`active`, `expired`, `disabled`, `inactive`) provide detail for user-facing messages. The 7-day grace period is implemented entirely client-side in `LicenseService`: if the last successful validation timestamp is within 7 days, the cached valid=true result is returned without a network call.

Settings I/O writes directly to `%APPDATA%\EditFactory\config.json` (a plain JSON object holding API keys and user preferences). This is separate from the `.env` file that drives `pydantic-settings`; the Setup Wizard in Phase 50 writes `.env`, while the settings endpoints read/write `config.json`. The version endpoint reads from a constants file or `electron/package.json` — the simplest approach is a `VERSION` constant in `app/config.py` kept in sync with `electron/package.json`.

**Primary recommendation:** Build `LicenseService` as the core object, write `desktop_routes.py` as a thin FastAPI wrapper around it, and use `httpx` (already in `requirements.txt`) for Lemon Squeezy HTTP calls. All license state lives in `license.json`; all non-license user settings live in `config.json`. Both files are in `settings.base_dir` (`%APPDATA%\EditFactory\`).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LICS-01 | License activated via Lemon Squeezy POST /v1/licenses/activate on first run | `LicenseService.activate(key)` calls `POST https://api.lemonsqueezy.com/v1/licenses/activate` with form data `license_key` + `instance_name`. Returns `{ activated, error, license_key, instance }`. Store `instance.id` + `license_key` in `license.json`. Use `httpx` (already in requirements.txt). |
| LICS-02 | License validated via POST /v1/licenses/validate on each startup | `LicenseService.validate()` calls `POST https://api.lemonsqueezy.com/v1/licenses/validate` with `license_key` + `instance_id` from `license.json`. On success, writes `last_validated_at` timestamp to `license.json`. Endpoint exposed at `POST /api/v1/desktop/license/validate`. |
| LICS-03 | 7-day offline grace period with cached last-successful validation timestamp | In `LicenseService.validate()`: read `last_validated_at` from `license.json`. If `(now - last_validated_at).days < 7`, return cached `valid=true` without network call. If network call fails (no internet / LS outage) but within 7 days, return grace period result. If beyond 7 days with network failure, return 403. |
| LICS-04 | Invalid/expired license blocks app access with re-activation prompt | Validate endpoint returns HTTP 403 with `{"detail": "License invalid or expired. Please re-activate your license key."}` when Lemon Squeezy returns `valid=false` AND grace period has expired. Frontend Phase 50 will read this 403 and show the re-activation UI. |
| UPDT-05 | Backend GET /api/v1/desktop/version returns current version number | Simple endpoint reads `APP_VERSION` constant from `app/config.py` (set to match `electron/package.json` `version`). Returns `{"version": "0.1.0"}`. No external calls needed. |
| UPDT-06 | Version displayed in Settings page footer | Frontend change: `settings/page.tsx` calls `GET /api/v1/desktop/version` when `NEXT_PUBLIC_DESKTOP_MODE=true` and renders the version string in the page footer. Requires no backend change beyond UPDT-05. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| httpx | >=0.25.0 (already in requirements.txt) | Async HTTP client for Lemon Squeezy API calls | Already used throughout the project (feed_routes, elevenlabs_tts, db.py); supports both sync and async; timeout control |
| FastAPI APIRouter | (project dependency) | Desktop-specific endpoints | Consistent with all 14 existing routers; no new framework needed |
| pathlib.Path + json | stdlib | Read/write license.json and config.json | Already the established pattern in cost_tracker.py, tts_cache.py |
| datetime / timezone | stdlib | Grace period timestamp comparison | No library needed; `datetime.now(timezone.utc)` + ISO 8601 format |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| socket.gethostname() | stdlib | Generate instance_name for license activation | `"EditFactory-{hostname}"` makes instances identifiable in LS dashboard |
| uuid (stdlib) | stdlib | Fallback instance_name if hostname unavailable | Already used throughout the project |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| httpx for Lemon Squeezy calls | requests | `requests` is synchronous only; `httpx` already in project and supports both sync and async — use `httpx.AsyncClient` in async route handlers |
| Storing version in app/config.py | Reading electron/package.json at runtime | Reading a JSON file at runtime is fragile (path changes between dev and packaged modes); a constant is simpler and always correct |
| Plain JSON for license.json | SQLite or Supabase | License state is a single record; JSON file in AppData is the established pattern and matches FOUND-01 requirement |

**Installation:**
```bash
# No new packages needed — httpx is already in requirements.txt
# No pip install step required for Phase 49
```

## Architecture Patterns

### Recommended Project Structure

```
app/
├── api/
│   └── desktop_routes.py    # NEW: /api/v1/desktop/* endpoints
├── services/
│   └── license_service.py   # NEW: LicenseService (LS API + license.json)
└── config.py                 # MODIFIED: add APP_VERSION constant

frontend/src/app/settings/
└── page.tsx                  # MODIFIED: add version display in footer

%APPDATA%\EditFactory\
├── license.json              # Written by LicenseService (Phase 49)
└── config.json               # Written by desktop settings endpoints (Phase 49)
```

### Pattern 1: Desktop Router Registration (Conditional Mount)

**What:** The desktop router is registered in `app/main.py` only when `settings.desktop_mode` is true. This keeps the router entirely invisible in web/dev mode.
**When to use:** Any endpoint that only makes sense in desktop context.

```python
# app/main.py — add after existing router registrations
settings = get_settings()
if settings.desktop_mode:
    from app.api.desktop_routes import router as desktop_router
    app.include_router(desktop_router, prefix="/api/v1", tags=["Desktop"])
```

Note: `get_settings()` is already called at module level in `main.py` — reuse that reference or call `get_settings()` again (safe since it's lru_cached).

### Pattern 2: Desktop Router with No Auth Dependency

**What:** Desktop endpoints skip authentication entirely — `settings.desktop_mode` guarantees the user is local. No `Depends(get_current_user)` on any desktop route.
**When to use:** All endpoints in `desktop_routes.py`.

```python
# app/api/desktop_routes.py
from fastapi import APIRouter, HTTPException
from app.config import get_settings

router = APIRouter(prefix="/desktop")

@router.get("/version")
async def get_version():
    from app.config import APP_VERSION
    return {"version": APP_VERSION}
```

The router prefix `/desktop` combined with the mount prefix `/api/v1` results in `/api/v1/desktop/*`.

### Pattern 3: LicenseService — File Layout and Grace Period Logic

**What:** All Lemon Squeezy state is persisted in a single `license.json` in `base_dir`. The service is a plain class (not a FastAPI singleton), instantiated in each route handler.
**When to use:** Every license-related route.

```python
# license.json schema
{
    "license_key": "38b1460a-...",
    "instance_id": "f90ec370-...",
    "activated_at": "2026-03-01T12:00:00+00:00",
    "last_validated_at": "2026-03-01T12:00:00+00:00",
    "status": "active"   # Last known LS status string
}
```

```python
# app/services/license_service.py
import json
import httpx
import socket
from datetime import datetime, timezone, timedelta
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

LS_BASE_URL = "https://api.lemonsqueezy.com"
GRACE_PERIOD_DAYS = 7


class LicenseService:
    def __init__(self, base_dir: Path):
        self._license_file = base_dir / "license.json"

    def _read(self) -> dict:
        if not self._license_file.exists():
            return {}
        try:
            return json.loads(self._license_file.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _write(self, data: dict) -> None:
        self._license_file.write_text(
            json.dumps(data, indent=2, default=str),
            encoding="utf-8"
        )

    def is_activated(self) -> bool:
        data = self._read()
        return bool(data.get("license_key") and data.get("instance_id"))

    async def activate(self, license_key: str) -> dict:
        """Call LS activate endpoint. Persist instance_id on success."""
        instance_name = f"EditFactory-{socket.gethostname()}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{LS_BASE_URL}/v1/licenses/activate",
                data={"license_key": license_key, "instance_name": instance_name},
                headers={"Accept": "application/json"},
            )
        body = resp.json()
        if not body.get("activated"):
            return {"success": False, "error": body.get("error", "Activation failed")}

        now = datetime.now(timezone.utc).isoformat()
        self._write({
            "license_key": license_key,
            "instance_id": body["instance"]["id"],
            "activated_at": now,
            "last_validated_at": now,
            "status": body["license_key"]["status"],
        })
        return {"success": True, "instance_id": body["instance"]["id"]}

    async def validate(self) -> dict:
        """
        Validate license. Implements offline grace period.
        Returns {"valid": bool, "grace_period": bool, "error": str|None}
        """
        data = self._read()
        if not data.get("license_key") or not data.get("instance_id"):
            return {"valid": False, "grace_period": False, "error": "No license stored"}

        # Check grace period
        last_validated_str = data.get("last_validated_at")
        within_grace = False
        if last_validated_str:
            try:
                last_validated = datetime.fromisoformat(last_validated_str)
                within_grace = (datetime.now(timezone.utc) - last_validated) < timedelta(days=GRACE_PERIOD_DAYS)
            except ValueError:
                pass

        # Try online validation
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{LS_BASE_URL}/v1/licenses/validate",
                    data={
                        "license_key": data["license_key"],
                        "instance_id": data["instance_id"],
                    },
                    headers={"Accept": "application/json"},
                )
            body = resp.json()
            if body.get("valid"):
                # Update last_validated_at
                data["last_validated_at"] = datetime.now(timezone.utc).isoformat()
                data["status"] = body["license_key"]["status"]
                self._write(data)
                return {"valid": True, "grace_period": False, "error": None}
            else:
                status = body.get("license_key", {}).get("status", "unknown")
                error = body.get("error") or f"License status: {status}"
                return {"valid": False, "grace_period": False, "error": error}

        except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as e:
            logger.warning(f"License validation network error: {e}")
            if within_grace:
                return {"valid": True, "grace_period": True, "error": None}
            return {
                "valid": False,
                "grace_period": False,
                "error": "Cannot reach license server and grace period expired",
            }
```

### Pattern 4: Settings Read/Write (config.json)

**What:** GET /api/v1/desktop/settings reads config.json and returns a redacted view (no raw API keys). POST writes new values and calls `get_settings.cache_clear()` if any env-mapped keys changed.
**When to use:** Setup Wizard (Phase 50) and Settings page.

```python
# app/api/desktop_routes.py

@router.get("/settings")
async def get_settings_endpoint():
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    config = {}
    if config_file.exists():
        try:
            config = json.loads(config_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    # Return hints (last 4 chars) not raw keys
    def hint(key: str) -> str:
        return f"***{key[-4:]}" if key and len(key) > 4 else ("set" if key else "")
    return {
        "gemini_api_key": hint(config.get("gemini_api_key", "")),
        "elevenlabs_api_key": hint(config.get("elevenlabs_api_key", "")),
        "supabase_url": config.get("supabase_url", ""),
        "supabase_key": hint(config.get("supabase_key", "")),
    }

@router.post("/settings")
async def save_settings_endpoint(body: dict):
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    # Read existing, merge
    existing = {}
    if config_file.exists():
        try:
            existing = json.loads(config_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    existing.update({k: v for k, v in body.items() if v is not None})
    config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    return {"saved": True}
```

Note: Phase 50 (Setup Wizard) writes `.env` directly (to drive pydantic-settings). Phase 49 settings endpoints use `config.json` as a separate user-preferences store. This separation is intentional — the two files serve different purposes.

### Pattern 5: Version Constant

**What:** A module-level `APP_VERSION` string constant in `app/config.py`, manually kept in sync with `electron/package.json`.
**When to use:** Version endpoint; also used by health endpoint to stop hardcoding `"1.0.0"`.

```python
# app/config.py — add near top of file, before Settings class
APP_VERSION = "0.1.0"  # Keep in sync with electron/package.json version
```

```python
# app/api/desktop_routes.py
@router.get("/version")
async def get_version():
    from app.config import APP_VERSION
    return {"version": APP_VERSION}
```

### Anti-Patterns to Avoid

- **Mounting desktop_router unconditionally:** If `desktop_routes.py` is mounted in all modes, the license endpoints become accessible in web/cloud deployments. Always gate with `if settings.desktop_mode`.
- **Calling LS validate on every API request:** License validation is expensive and blocks the startup flow if Lemon Squeezy is slow. Call once at startup, cache result in memory or `license.json`. Grace period is the fallback — not re-validation.
- **Returning raw API keys from GET /settings:** Always redact to last-4-char hints. Keys are write-only from the frontend's perspective.
- **Treating httpx connection errors as "invalid license":** Network errors during validation should trigger grace period logic, not a 403. Only a `valid: false` response from Lemon Squeezy (with a successful HTTP request) means the license is actually invalid.
- **Using `requests` library:** The project standardized on `httpx` — use `httpx.AsyncClient` in async endpoints and `httpx.Client` in sync contexts. Adding `requests` would be a redundant dependency.
- **Hardcoding Lemon Squeezy product_id checks:** The requirements do not call for product_id verification in Phase 49. TIER enforcement is deferred (TIER-01 is a Future requirement). Keep validate() simple — just check `valid: true`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client for Lemon Squeezy | Custom urllib calls | `httpx.AsyncClient` | Already in requirements.txt; handles timeouts, redirects, and connection errors cleanly |
| JSON persistence for license.json | SQLite or Supabase | `pathlib.Path.write_text(json.dumps(...))` | Established pattern in `cost_tracker.py` and `tts_cache.py`; single record, no queries needed |
| Grace period clock | Third-party library | `datetime.now(timezone.utc)` + `timedelta(days=7)` | stdlib is sufficient; no timezone library needed |
| API key redaction | Regex | `f"***{key[-4:]}"` | Simple slice operation; no regex needed for "show last 4 chars" |

**Key insight:** The Lemon Squeezy License API is intentionally simple — no authentication headers, no OAuth, just form-encoded POST with `license_key` and `instance_id`. Don't over-engineer the client.

## Common Pitfalls

### Pitfall 1: Lemon Squeezy Returns 400 for Already-Activated Instances

**What goes wrong:** If the same `license_key` + `instance_name` combination is activated twice (e.g., on app reinstall), Lemon Squeezy returns `activated: false` with an error about reaching the activation limit.
**Why it happens:** Each `activate` call creates a new instance. If the previous `license.json` was deleted (uninstall/reinstall), the old instance still counts against `activation_limit`.
**How to avoid:** Phase 49 does not need to handle this — the Setup Wizard (Phase 50) handles the UI flow. But `LicenseService.activate()` should return the LS error message verbatim so the frontend can display it. A future improvement (Phase 52 uninstaller) would call `POST /v1/licenses/deactivate` on uninstall.
**Warning signs:** User enters valid key but gets "activation limit reached" error immediately.

### Pitfall 2: Content-Type Must Be application/x-www-form-urlencoded

**What goes wrong:** Sending JSON body to Lemon Squeezy License API returns 422 Unprocessable Entity.
**Why it happens:** The License API (separate from the main LS API) requires form-encoded body, not JSON.
**How to avoid:** Use `httpx` `data=` parameter (not `json=`). The `data=` kwarg sends `application/x-www-form-urlencoded`.

```python
# CORRECT
resp = await client.post(url, data={"license_key": key, "instance_name": name}, headers={"Accept": "application/json"})

# WRONG — sends JSON, LS returns 422
resp = await client.post(url, json={"license_key": key, "instance_name": name})
```

**Warning signs:** HTTP 422 from Lemon Squeezy even with a valid license key.

### Pitfall 3: validate() Returns valid=false for inactive status

**What goes wrong:** After a machine's license instance is deactivated (e.g., by the user from the LS dashboard), `validate()` returns `valid: false` even though the license key itself is active on other machines.
**Why it happens:** Validating with `instance_id` checks that specific instance. If it was deactivated, it returns `valid: false` for that instance.
**How to avoid:** The 403 response from the validate endpoint must include a clear re-activation message, not just "invalid license." The user should be prompted to activate again (which creates a new instance). The `status` field in the LS response distinguishes `inactive` (instance deactivated) from `expired` (key expired).
**Warning signs:** Valid license key user suddenly gets locked out; LS dashboard shows instance as "inactive."

### Pitfall 4: license.json Missing on First Run

**What goes wrong:** `LicenseService.validate()` is called on startup before the user has activated their license. `license.json` does not exist. The endpoint returns a confusing error.
**Why it happens:** Phase 50 (Setup Wizard) will redirect users to activate before the app is usable. But Phase 49 must handle the pre-wizard state gracefully.
**How to avoid:** `validate()` checks `is_activated()` first. If not activated, return `{"valid": false, "error": "Not activated"}` — NOT a 403. The 403 is only for expired/invalid licenses post-activation. The frontend (Phase 50) distinguishes "not yet activated" (redirect to wizard) from "expired" (show re-activation prompt).
**Warning signs:** App shows error dialogs before the Setup Wizard is shown.

### Pitfall 5: settings.base_dir is Project Root in Dev Mode

**What goes wrong:** When `DESKTOP_MODE` is not set (dev mode), `settings.base_dir` is the project root. Writing `config.json` and `license.json` there pollutes the project directory.
**How to avoid:** Desktop routes must only be mounted when `settings.desktop_mode` is true (Pattern 1). In dev mode, the router does not exist. But as a defensive measure, `LicenseService.__init__` should also check:

```python
def __init__(self, base_dir: Path):
    # Sanity: in dev mode, base_dir is project root — never write there
    # But this code path is only reached when desktop_mode=True (router gated)
    self._license_file = base_dir / "license.json"
```

**Warning signs:** `license.json` appearing in the project root during local dev.

### Pitfall 6: httpx Timeout on Slow Networks

**What goes wrong:** Startup validation blocks the health endpoint if Lemon Squeezy is slow. Users see a long delay before the app is usable.
**Why it happens:** A synchronous (blocking) HTTP call in the startup path with no timeout.
**How to avoid:** Set explicit timeouts on all httpx calls:
- Activate: `timeout=15.0` (user is waiting, first-run, longer is ok)
- Validate: `timeout=10.0` (startup path, must be fast)

If validate times out, treat it as a network error and apply grace period logic.

## Code Examples

Verified patterns from official Lemon Squeezy docs and existing codebase:

### Lemon Squeezy Activate (form-encoded POST)

```python
# Source: https://docs.lemonsqueezy.com/api/license-api/activate-license-key
async with httpx.AsyncClient(timeout=15.0) as client:
    resp = await client.post(
        "https://api.lemonsqueezy.com/v1/licenses/activate",
        data={
            "license_key": "38b1460a-5104-4067-a91d-77b872934d51",
            "instance_name": "EditFactory-DESKTOP-ABC123"
        },
        headers={"Accept": "application/json"},
    )
body = resp.json()
# Response: { "activated": bool, "error": str|null, "license_key": {...}, "instance": {"id": str, ...} }
```

### Lemon Squeezy Validate (form-encoded POST)

```python
# Source: https://docs.lemonsqueezy.com/api/license-api/validate-license-key
async with httpx.AsyncClient(timeout=10.0) as client:
    resp = await client.post(
        "https://api.lemonsqueezy.com/v1/licenses/validate",
        data={
            "license_key": "38b1460a-5104-4067-a91d-77b872934d51",
            "instance_id": "f90ec370-fd83-46a5-8bbd-44a241e78665"
        },
        headers={"Accept": "application/json"},
    )
body = resp.json()
# Response: { "valid": bool, "error": str|null, "license_key": {"status": "active"|"expired"|"disabled"|"inactive", ...} }
```

### License Status Values (from official docs)

| Status | Meaning |
|--------|---------|
| `active` | License is valid and active |
| `inactive` | This specific instance was deactivated |
| `expired` | License period ended (product-based or subscription-based) |
| `disabled` | Manually disabled from LS dashboard |

### Validate Endpoint (FastAPI route)

```python
# app/api/desktop_routes.py
@router.post("/license/validate")
async def validate_license():
    """Validate license on startup. Called by frontend during app boot."""
    settings = get_settings()
    svc = LicenseService(settings.base_dir)
    result = await svc.validate()
    if not result["valid"] and not result.get("grace_period"):
        raise HTTPException(
            status_code=403,
            detail=result.get("error") or "License invalid or expired. Please re-activate your license key."
        )
    return result  # {"valid": true, "grace_period": bool, "error": null}
```

### Activate Endpoint (FastAPI route)

```python
# app/api/desktop_routes.py
from pydantic import BaseModel

class ActivateRequest(BaseModel):
    license_key: str

@router.post("/license/activate")
async def activate_license(body: ActivateRequest):
    """Activate a new license key. Stores instance_id to license.json."""
    settings = get_settings()
    svc = LicenseService(settings.base_dir)
    result = await svc.activate(body.license_key)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Activation failed"))
    return result
```

### Version Endpoint

```python
# app/api/desktop_routes.py
@router.get("/version")
async def get_version():
    """Return current app version. Used by frontend Settings page footer (UPDT-06)."""
    from app.config import APP_VERSION
    return {"version": APP_VERSION}
```

### Frontend Version Display (Settings page footer)

```tsx
// frontend/src/app/settings/page.tsx — add to component
const [appVersion, setAppVersion] = useState<string | null>(null)

useEffect(() => {
  const isDesktop = process.env.NEXT_PUBLIC_DESKTOP_MODE === 'true'
  if (!isDesktop) return
  apiGet('/desktop/version')
    .then((data: { version: string }) => setAppVersion(data.version))
    .catch(() => {}) // Non-critical — ignore errors
}, [])

// In JSX, add at bottom of return:
{appVersion && (
  <div className="text-center text-xs text-muted-foreground mt-8 pb-4">
    Edit Factory v{appVersion}
  </div>
)}
```

### JSON File Read/Write Pattern (from existing codebase)

```python
# Pattern from app/services/cost_tracker.py
import json
from pathlib import Path

def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

def _write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Validating license on every request | Validate once at startup, cache in license.json | Standard for desktop apps | Prevents LS rate limiting (60 req/min); enables offline grace period |
| Hard-blocking on license failure | Grace period + clear UX message | Industry standard | Prevents lockout when LS has outages |
| Separate auth token for LS calls | No auth header — License API is public | Always | The License API (distinct from main LS API) requires no API key; license_key IS the credential |

**Important distinction:** The Lemon Squeezy **License API** (`/v1/licenses/activate`, `/v1/licenses/validate`) does NOT require an `Authorization: Bearer` header. The license key itself authenticates the request. This is different from the main Lemon Squeezy REST API which requires a bearer token. Do not add any auth header.

## Open Questions

1. **Should validate() be called automatically on startup or only on demand?**
   - What we know: LICS-02 says "validates on each startup." The frontend (Phase 50) will call `POST /api/v1/desktop/license/validate` during the app boot sequence.
   - What's unclear: Whether validation should happen before or after the user sees the main UI. The ARCHITECTURE.md suggests "non-blocking" validation — show the app, validate in background.
   - Recommendation: For Phase 49, expose the endpoint; Phase 50 (Setup Wizard) decides the call timing. The endpoint itself just returns a result — it doesn't auto-trigger anything.

2. **What instance_name format to use?**
   - What we know: `socket.gethostname()` returns the Windows machine name (e.g., `DESKTOP-ABC123`). This is stable across reboots and identifies the instance in the LS dashboard.
   - What's unclear: What happens if hostname changes (domain join, rename). The instance_id stored in `license.json` still works — the name is cosmetic only.
   - Recommendation: Use `f"EditFactory-{socket.gethostname()}"`. If `gethostname()` raises, fall back to `f"EditFactory-{uuid.uuid4().hex[:8]}"`.

3. **Should GET /settings and POST /settings use config.json or .env?**
   - What we know: ARCHITECTURE.md describes `config.json` for settings, `.env` for pydantic-settings (API keys that drive the backend). Phase 50 Setup Wizard writes `.env`. Phase 49 desktop settings read/write `config.json`.
   - What's unclear: Whether the same `config.json` should also write to `.env` to drive pydantic-settings reload, or whether the two files remain separate with different purposes.
   - Recommendation: Keep them separate for Phase 49. `config.json` is a user-preferences store for UI display. Writing to `.env` + calling `get_settings.cache_clear()` is Phase 50's job. The UPDT-05/UPDT-06 requirements only need the version endpoint — the settings endpoints are adjacent scope, implement as minimal read/write of `config.json`.

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` (key absent). Skipping automated test mapping.

The existing pytest infrastructure at `tests/` (conftest.py, test_job_storage.py, test_cost_tracker.py) can host a `tests/test_license_service.py` if desired, but it is not required by the workflow configuration.

## Sources

### Primary (HIGH confidence)

- [Lemon Squeezy Activate License API](https://docs.lemonsqueezy.com/api/license-api/activate-license-key) — endpoint URL, request parameters (form data), response schema (`activated`, `error`, `license_key`, `instance`)
- [Lemon Squeezy Validate License API](https://docs.lemonsqueezy.com/api/license-api/validate-license-key) — endpoint URL, parameters (`license_key`, `instance_id`), response schema (`valid`, `error`, `license_key.status`)
- [Lemon Squeezy License API overview](https://docs.lemonsqueezy.com/api/license-api) — base URL, rate limit (60/min), content-type requirement (form-encoded), status values (`active`, `inactive`, `expired`, `disabled`)
- [Lemon Squeezy License Keys guide](https://docs.lemonsqueezy.com/guides/tutorials/license-keys) — instance_id persistence requirement, instance_name best practice, desktop app patterns
- Codebase audit: `app/config.py` (Settings, get_settings, base_dir pattern), `app/api/routes.py` (health endpoint, router pattern), `app/api/auth.py` (desktop_mode bypass), `app/main.py` (router registration pattern), `app/services/cost_tracker.py` (json file read/write pattern), `app/api/feed_routes.py` (httpx.AsyncClient pattern), `requirements.txt` (httpx already present), `frontend/src/app/settings/page.tsx` (current settings page structure)

### Secondary (MEDIUM confidence)

- `.planning/research/ARCHITECTURE.md` — Phase 49 component spec (`desktop_routes.py` + `license_service.py`), license.json schema, settings endpoint design
- WebSearch: Lemon Squeezy License API form-encoded requirement, 60 req/min rate limit — consistent with official docs

### Tertiary (LOW confidence)

- Grace period implementation pattern — derived from ARCHITECTURE.md spec and general offline licensing best practices; no official LS documentation on grace periods (they don't provide this, it's an app-side pattern)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — httpx already in project, stdlib for file I/O; no new dependencies
- Architecture: HIGH — endpoint shapes verified against ARCHITECTURE.md and REQUIREMENTS.md; LS API verified against official docs
- Pitfalls: HIGH for form-encoding and instance_id pitfalls (verified from LS docs); MEDIUM for reinstall activation-limit scenario (logical inference, not tested against real LS account)

**Research date:** 2026-03-01
**Valid until:** 2026-09-01 (Lemon Squeezy License API is stable; httpx 0.25+ stable)
