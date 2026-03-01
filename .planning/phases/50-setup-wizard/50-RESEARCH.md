# Phase 50: Setup Wizard - Research

**Researched:** 2026-03-01
**Domain:** Next.js multi-step wizard, first-run detection, desktop API integration, AppData config persistence
**Confidence:** HIGH

## Summary

Phase 50 builds the Setup Wizard as a single Next.js page (`/setup`) with three sequential steps: license activation, API key configuration, and crash reporting consent. The wizard is the first screen a new user sees, automatically redirected to on first launch, and re-accessible from Settings at any time.

All backend API infrastructure is already built by Phase 49. The wizard calls `POST /api/v1/desktop/license/activate`, `POST /api/v1/desktop/settings` (to write API keys), and the backend's existing desktop settings endpoints for connection testing. The frontend reads `first_run_complete` status via `POST /api/v1/desktop/license/validate` — a 404 response means "not yet activated" and implies first run; a 200 means license is valid; a 403 means expired/invalid. First-run gating uses this 404 signal plus a localStorage flag as a fast-path cache.

The wizard writes user config by calling `POST /api/v1/desktop/settings` for API keys, and writes a separate `first_run_complete` flag via a new lightweight backend endpoint (or as a field written to `config.json`). After completion, the wizard redirects to `/librarie` (the main app). The Settings page already exists at `/settings` — Phase 50 adds a "Setup" button there that navigates to `/setup?mode=edit` so the wizard pre-fills current values and skips the first-run redirect guard.

The wizard page must hide the navbar (like `/login` and `/signup` already do) since it's a full-screen onboarding experience. The tech stack is entirely within the existing project footprint: no new npm packages, no new Python packages.

**Primary recommendation:** Build `/setup/page.tsx` as a single-file multi-step wizard using `useState` for step tracking (no external stepper library needed). Call existing Phase 49 endpoints for all backend interaction. Add one new backend endpoint `POST /api/v1/desktop/first-run/complete` that writes `first_run_complete: true` to `config.json`. Gate the wizard redirect using `GET /api/v1/desktop/license/validate` (404 = not activated = first run) checked in a useEffect on the main layout or a middleware-equivalent.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WIZD-01 | /setup page detects first run via %APPDATA% flag and redirects new users | Backend: `GET /api/v1/desktop/config` reads `config.json` and returns `first_run_complete` boolean. Frontend: check in `useEffect` on `/librarie` or via a root-level guard in `layout.tsx` (desktop mode only). Alternative: check via `POST /api/v1/desktop/license/validate` — 404 means not-activated = first run. Phase 49 already set `404 vs 403` distinction exactly for this purpose. |
| WIZD-02 | Step 1: License key entry with Lemon Squeezy activation and success/error feedback | `POST /api/v1/desktop/license/activate` already built in Phase 49. Request body: `{ license_key: string }`. Success: 200 `{ success: true, instance_id }`. Error: 400 with `detail` string from LS. Frontend: controlled input + loading state + inline success/error display using `Alert` component. |
| WIZD-03 | Step 2: API key configuration (Supabase required, Gemini/ElevenLabs optional) with test connection | `POST /api/v1/desktop/settings` already built in Phase 49 — writes to `config.json`. For "test connection": Supabase can be tested via a simple `GET` to the Supabase URL. Gemini and ElevenLabs connection tests need a dedicated endpoint or can be deferred (flag as optional with skip option). Simple connection test: `POST /api/v1/desktop/test-connections` is the cleanest approach. |
| WIZD-04 | Step 3: Crash reporting consent toggle defaulting to OFF with data explanation | Frontend-only step. A `Switch` component (already in `/components/ui/switch.tsx`) with OFF default. On wizard completion, if toggle is ON, write `crash_reporting_enabled: true` to config via `POST /api/v1/desktop/settings`. Sentry initialization in Phase 51 will read this flag. |
| WIZD-05 | Wizard writes all values to %APPDATA%\EditFactory\ and marks first_run_complete | Two writes on "Finish" button: (1) `POST /api/v1/desktop/settings` with API keys + `crash_reporting_enabled`. (2) `POST /api/v1/desktop/first-run/complete` which sets `first_run_complete: true` in `config.json`. Then `get_settings.cache_clear()` + `get_settings()` to reload. Redirect to `/librarie`. |
| WIZD-06 | Wizard re-accessible from Settings page at any time with current values pre-filled | Settings page already at `/settings/page.tsx`. Add a "Setup Wizard" button that navigates to `/setup?mode=edit`. The `/setup` page checks for `?mode=edit` query param: if present, skip the first-run guard and pre-fill values from `GET /api/v1/desktop/settings` (already returns redacted hints; full values only writable). |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React `useState` | React 19 (in project) | Step tracking, form state, loading/error state | Established pattern throughout all project pages; no global state needed for a single-page wizard |
| Next.js App Router | ^16.1.1 (in project) | `/setup/page.tsx` route | All pages use App Router; `"use client"` at top |
| `apiPost` / `apiGet` from `@/lib/api` | (project lib) | HTTP calls to Phase 49 endpoints | All pages use this wrapper; handles timeout, error, Content-Type |
| Shadcn/UI components | (in project) | Card, Button, Input, Alert, Switch, Progress | All already installed via Radix UI; used consistently throughout the app |
| `sonner` toast | ^2.0.7 (in project) | User feedback on success/error | Already used on all pages; `toast.success()`, `toast.error()` |
| `lucide-react` | ^0.556.0 (in project) | Icons (CheckCircle, AlertCircle, ChevronRight, etc.) | All pages use this icon set |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `useRouter` from `next/navigation` | (in project) | Redirect to `/librarie` on finish, back navigation | Used on login page and other pages |
| `useSearchParams` from `next/navigation` | (in project) | Detect `?mode=edit` for re-entry from Settings | Standard Next.js hook for query params |
| `Progress` component | (in project, `@radix-ui/react-progress`) | Step progress indicator (1/3, 2/3, 3/3) | Already installed and used; found at `frontend/src/components/ui/progress.tsx` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom step state with `useState` | `react-hook-form` + stepper library | Overkill for 3 steps with simple validation; adds npm package; project uses uncontrolled inputs pattern |
| `POST /api/v1/desktop/first-run/complete` new endpoint | Write `first_run_complete` via existing `POST /api/v1/desktop/settings` | Using settings endpoint is simpler (one less endpoint); but mixing concerns — a dedicated endpoint is cleaner and makes the intent explicit |
| Connection test via dedicated endpoint | Client-side fetch to Supabase URL | Direct client fetch to Supabase works but bypasses the backend pattern; a backend test endpoint validates from the server context where the API will actually be used |

**Installation:**
```bash
# No new packages needed — all dependencies already in project
# No pip install step required for Phase 50
```

## Architecture Patterns

### Recommended Project Structure

```
frontend/src/app/
├── setup/
│   └── page.tsx              # NEW: Full-screen wizard (WIZD-01 through WIZD-06)
├── settings/
│   └── page.tsx              # MODIFIED: Add "Setup Wizard" button (WIZD-06)
└── layout.tsx or page.tsx    # NOT MODIFIED: wizard guard lives in /setup itself

frontend/src/components/
└── navbar-wrapper.tsx        # MODIFIED: Add /setup to hideNavbarPaths

app/api/
└── desktop_routes.py         # MODIFIED: Add first-run endpoints

%APPDATA%\EditFactory\
├── config.json               # Written by wizard: API keys + first_run_complete + crash_reporting_enabled
└── license.json              # Written by Phase 49 activate (unchanged)
```

### Pattern 1: Multi-Step Wizard with useState

**What:** Three-step wizard using `currentStep` state (1, 2, or 3). Each step is a conditional render block. "Next" button validates current step before advancing.
**When to use:** Linear multi-step flows with up to 5 steps where each step is self-contained.

```tsx
// frontend/src/app/setup/page.tsx
"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { apiPost, apiGet } from "@/lib/api"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { CheckCircle, AlertCircle, Loader2, Film } from "lucide-react"

export default function SetupPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isEditMode = searchParams.get("mode") === "edit"

  const [currentStep, setCurrentStep] = useState(1)
  const [licenseKey, setLicenseKey] = useState("")
  const [licenseValid, setLicenseValid] = useState(false)
  const [supabaseUrl, setSupabaseUrl] = useState("")
  const [supabaseKey, setSupabaseKey] = useState("")
  const [geminiKey, setGeminiKey] = useState("")
  const [elevenlabsKey, setElevenlabsKey] = useState("")
  const [crashReporting, setCrashReporting] = useState(false) // DEFAULT OFF
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const progressPercent = ((currentStep - 1) / 3) * 100

  // First-run guard — only active when NOT in edit mode and DESKTOP_MODE
  useEffect(() => {
    if (isEditMode) return
    if (process.env.NEXT_PUBLIC_DESKTOP_MODE !== "true") return
    // If already activated (validate returns 200), redirect to app
    apiPost("/desktop/license/validate")
      .then(() => router.replace("/librarie"))
      .catch((err: any) => {
        if (err.status === 404) return  // Not activated — stay on wizard
        if (err.status === 403) return  // Expired — still show wizard for re-activation
      })
  }, [isEditMode, router])

  // Pre-fill values in edit mode
  useEffect(() => {
    if (!isEditMode) return
    // GET /desktop/settings returns redacted hints — show empty fields since we can't pre-fill masked keys
    // Supabase URL is returned unredacted (it's not a secret)
    apiPost("/desktop/settings")
      .then((res) => res.json())
      .then((data) => {
        setSupabaseUrl(data.supabase_url || "")
        // Hints like "***xxxx" indicate key is set; show placeholder but don't fill
      })
      .catch(() => {})
  }, [isEditMode])

  // ... step render logic
}
```

### Pattern 2: First-Run Guard via License Validate

**What:** On the `/setup` page mount, call `POST /api/v1/desktop/license/validate`. If it returns 200 (already activated), the user has already completed setup — redirect to `/librarie`. If it returns 404 (not activated), stay on wizard. If 403, show re-activation UI.
**When to use:** Any page that needs to conditionally show based on first-run state.
**Key insight from Phase 49 STATE.md:** "404 for not-activated (wizard redirect), 403 for invalid/expired (re-activation)" — this distinction was designed specifically for Phase 50 to use.

```typescript
// Pattern: use apiPost, catch ApiError by status
import { ApiError } from "@/lib/api-error"

useEffect(() => {
  if (process.env.NEXT_PUBLIC_DESKTOP_MODE !== "true") return
  if (isEditMode) return

  apiPost("/desktop/license/validate")
    .then(() => {
      // 200 = license valid = setup already done = redirect
      router.replace("/librarie")
    })
    .catch((err: unknown) => {
      if (err instanceof ApiError) {
        if (err.status === 404) return  // Not activated — stay on wizard Step 1
        if (err.status === 403) {
          // License invalid/expired — go to step 1 for re-activation
          setError("Your license has expired. Please re-activate.")
          return
        }
      }
      // Network error — assume first run, stay on wizard
    })
}, [isEditMode, router])
```

### Pattern 3: Inline Connection Test

**What:** Each API key field has a "Test" button that calls a backend endpoint. Success shows a green checkmark inline; failure shows the error message. Does not block progression (optional fields can be skipped).
**When to use:** Optional API key fields where immediate feedback reduces user confusion.

```tsx
// Supabase connection test
const [supabaseStatus, setSupabaseStatus] = useState<"idle" | "testing" | "ok" | "error">("idle")

const testSupabase = async () => {
  setSupabaseStatus("testing")
  try {
    await apiPost("/desktop/test-connection", {
      service: "supabase",
      url: supabaseUrl,
      key: supabaseKey,
    })
    setSupabaseStatus("ok")
  } catch {
    setSupabaseStatus("error")
  }
}
```

### Pattern 4: New Backend Endpoint — `first-run/complete`

**What:** `POST /api/v1/desktop/first-run/complete` writes `{ "first_run_complete": true }` to `config.json`. Called as the final step before redirecting to `/librarie`.
**When to use:** The last action of the wizard after all config has been saved.

```python
# app/api/desktop_routes.py — add to existing router

@router.post("/first-run/complete")
async def mark_first_run_complete():
    """Mark setup wizard as complete. Writes first_run_complete to config.json."""
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    existing = _read_config(config_file)
    existing["first_run_complete"] = True
    config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    return {"completed": True}
```

### Pattern 5: New Backend Endpoint — `test-connection`

**What:** `POST /api/v1/desktop/test-connection` accepts `{ service, url, key }` and performs a lightweight connectivity check. For Supabase, calls the REST API health endpoint. For Gemini and ElevenLabs, makes a minimal API call.
**When to use:** Step 2 of the wizard to validate API keys before persisting them.

```python
# app/api/desktop_routes.py — add to existing router

class TestConnectionRequest(BaseModel):
    service: str  # "supabase" | "gemini" | "elevenlabs"
    url: str = ""
    key: str = ""

@router.post("/test-connection")
async def test_connection(body: TestConnectionRequest):
    """Test connectivity for a given service and API key."""
    if body.service == "supabase":
        # Test: GET {url}/rest/v1/ with apikey header
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{body.url.rstrip('/')}/rest/v1/",
                headers={"apikey": body.key, "Authorization": f"Bearer {body.key}"},
            )
        if resp.status_code in (200, 400):  # 400 means connected but no table specified
            return {"connected": True, "service": "supabase"}
        raise HTTPException(status_code=400, detail=f"Supabase connection failed: HTTP {resp.status_code}")

    elif body.service == "gemini":
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={body.key}",
            )
        if resp.status_code == 200:
            return {"connected": True, "service": "gemini"}
        raise HTTPException(status_code=400, detail="Gemini API key invalid or quota exceeded")

    elif body.service == "elevenlabs":
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://api.elevenlabs.io/v1/user",
                headers={"xi-api-key": body.key},
            )
        if resp.status_code == 200:
            return {"connected": True, "service": "elevenlabs"}
        raise HTTPException(status_code=400, detail="ElevenLabs API key invalid")

    raise HTTPException(status_code=400, detail=f"Unknown service: {body.service}")
```

### Pattern 6: Navbar Hiding for /setup

**What:** Add `/setup` to `hideNavbarPaths` in `navbar-wrapper.tsx`. The wizard is a full-screen onboarding experience like `/login` and `/signup` — the navbar is not appropriate there.
**When to use:** Full-screen onboarding/auth pages.

```tsx
// frontend/src/components/navbar-wrapper.tsx — MODIFIED
const hideNavbarPaths = ["/login", "/signup", "/setup"]  // Add /setup
```

### Pattern 7: Settings Page "Setup Wizard" Link (WIZD-06)

**What:** A button in `settings/page.tsx` that navigates to `/setup?mode=edit`. The `?mode=edit` query param tells the wizard to skip the first-run guard and go directly to edit mode.
**When to use:** Any time the user wants to revisit wizard configuration.

```tsx
// Add near bottom of settings/page.tsx return, before the Save button section
import Link from "next/link"
// Only show in desktop mode
{process.env.NEXT_PUBLIC_DESKTOP_MODE === "true" && (
  <Card>
    <CardHeader>
      <CardTitle>Setup Wizard</CardTitle>
      <CardDescription>Re-run the setup wizard to update your license or API keys</CardDescription>
    </CardHeader>
    <CardContent>
      <Button variant="outline" asChild>
        <Link href="/setup?mode=edit">Open Setup Wizard</Link>
      </Button>
    </CardContent>
  </Card>
)}
```

### Pattern 8: `config.json` — First Run and Crash Reporting Fields

**What:** The `config.json` in `%APPDATA%\EditFactory\` gains two new fields written by the wizard. These are persisted alongside API keys.

```json
// Full config.json schema after Phase 50
{
  "supabase_url": "https://xxx.supabase.co",
  "supabase_key": "eyJh...",
  "gemini_api_key": "AIza...",
  "elevenlabs_api_key": "sk_...",
  "crash_reporting_enabled": false,
  "first_run_complete": true
}
```

**Note:** `crash_reporting_enabled` defaults to `false` (opt-in per WIZD-04). Phase 51 (Crash Reporting) reads this field to initialize Sentry.

### Anti-Patterns to Avoid

- **Redirecting from layout.tsx:** Do NOT put the first-run guard in the root `layout.tsx`. It would run on every page mount, and the guard logic (async API call) can't block SSR. Put the guard inside `/setup/page.tsx` itself (where 200 from validate = redirect away) AND in the main app pages (where 404 from validate = redirect TO /setup). The simplest approach: just guard in `/setup` page.
- **Using a stepper component library:** The project uses 0 external form libraries. A 3-step wizard with `useState([1, 2, 3])` is sufficient. Adding a dependency for 3 steps is premature.
- **Blocking app on first-run check:** The check should be a background async check, not a synchronous gate. If the backend is slow, the wizard should show step 1 immediately and the redirect happens when the response returns.
- **Showing the navbar on /setup:** The wizard is full-screen. The navbar is confusing during onboarding. Add `/setup` to `hideNavbarPaths`.
- **Writing .env from the wizard (Phase 50):** Phase 49 RESEARCH.md noted that the Setup Wizard writes `.env` to drive `pydantic-settings`. However, Phase 49 was actually implemented using `config.json` for the settings endpoint. The wizard should call `POST /api/v1/desktop/settings` which writes to `config.json`, and after that, call `get_settings.cache_clear()`. Writing directly to `.env` from the frontend introduces a timing problem (pydantic-settings only reads at startup). The established pattern: call `POST /api/v1/desktop/settings`, backend writes `config.json`, backend calls `get_settings.cache_clear()` + `get_settings()` internally if needed.
- **Pre-filling masked API keys:** `GET /api/v1/desktop/settings` returns `***xxxx` hints for API keys. Do NOT try to pre-fill input fields with these hints — users would see `***1234` and not know whether they're entering a new key or editing the hint. Instead: show the hint next to an empty field as "Key set (ends in ...1234)" with a placeholder `Enter new key to update`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Step progress indicator | Custom CSS progress bar | `Progress` component (`@radix-ui/react-progress`, already installed) | Already in `/components/ui/progress.tsx`; handles accessibility and animation |
| Toggle switch for crash reporting | Custom checkbox | `Switch` component (`@radix-ui/react-switch`, already installed) | Already in `/components/ui/switch.tsx`; matches design system |
| Inline error display | Custom div with red text | `Alert` component with `variant="destructive"` (already installed) | Consistent with rest of app; includes icon slot |
| HTTP client for connection tests | fetch() directly in component | `apiPost` from `@/lib/api` | Handles timeout, error parsing, JSON content-type automatically |
| Router navigation | window.location.href | `useRouter().push()` / `replace()` from `next/navigation` | Next.js client-side navigation; no page reload |

**Key insight:** Phase 50 is predominantly frontend work. The backend already has all endpoints. The wizard is a UI assembly task using existing components, existing API client, and two new backend endpoints (first-run/complete, test-connection).

## Common Pitfalls

### Pitfall 1: ApiError is Not a Standard Error

**What goes wrong:** Calling `apiPost("/desktop/license/validate")` and catching with `catch (err)` then checking `err.status` — this fails silently because `err` is typed as `unknown`.
**Why it happens:** TypeScript's catch clause types `err` as `unknown`. The `ApiError` class from `@/lib/api-error` must be used with `instanceof` check.
**How to avoid:**
```typescript
import { ApiError } from "@/lib/api-error"

.catch((err: unknown) => {
  if (err instanceof ApiError) {
    if (err.status === 404) { /* not activated */ }
    if (err.status === 403) { /* expired */ }
  }
  // Network error — assume first run
})
```
**Warning signs:** Error handler always falls through to network error case even when backend returns 404.

### Pitfall 2: `apiPost` Without Body Sends `undefined` (Not Empty Body)

**What goes wrong:** `apiPost("/desktop/license/validate")` calls `POST` with `body: undefined` — FastAPI might reject it if expecting a JSON body.
**Why it happens:** `apiPost` skips setting the body when argument is undefined.
**How to avoid:** Phase 49's `POST /license/validate` has no request body (it reads license.json from disk) — the endpoint signature is `async def validate_license()` with no Pydantic model. So `apiPost("/desktop/license/validate")` is correct — it sends POST with no body, which FastAPI handles fine.
**Note for test-connection endpoint:** Must accept a Pydantic model body, not form data.

### Pitfall 3: NEXT_PUBLIC_DESKTOP_MODE Check in SSR Context

**What goes wrong:** Checking `process.env.NEXT_PUBLIC_DESKTOP_MODE` in server-side code returns `undefined` even when the env var is set, because `NEXT_PUBLIC_` vars are embedded at build time. If the build didn't have `NEXT_PUBLIC_DESKTOP_MODE=true`, no amount of runtime setting will make it work.
**Why it happens:** Next.js `NEXT_PUBLIC_` variables are replaced at build time (static substitution). In standalone mode (desktop), the build must include the variable.
**How to avoid:** The Electron main.js sets `NEXT_PUBLIC_DESKTOP_MODE: 'true'` in the environment when spawning the frontend process. But since standalone build is pre-compiled, this env var must be set at `npm run build` time, not at runtime. This is an Electron packaging concern (Phase 48/52 handled this), but the wizard code must be tolerant: wrap all `NEXT_PUBLIC_DESKTOP_MODE` checks in client components with `"use client"` and `useEffect` (not in server components).
**Established pattern from Phase 49:** "Desktop-only features: check `process.env.NEXT_PUBLIC_DESKTOP_MODE === 'true'` at `useEffect` level, return early if not desktop" — follow this exactly.

### Pitfall 4: Wizard Redirect Loop

**What goes wrong:** `/setup` calls `POST /license/validate` → 200 → redirects to `/librarie`. Then a guard on `/librarie` checks validation again → 200 → stays. But if `/librarie` also redirects to `/setup` on any error, the app could loop between the two pages.
**Why it happens:** Over-eager redirect guards on every page.
**How to avoid:** Only put the first-run guard in `/setup/page.tsx` itself (redirect AWAY from setup). Do NOT add a guard on `/librarie` or other app pages that redirects TO `/setup`. The wizard is opt-in for re-entry (via Settings link) — the app does not force the wizard after first run is complete.

### Pitfall 5: `POST /api/v1/desktop/settings` Writes Empty Strings

**What goes wrong:** The wizard sends `{ gemini_api_key: "" }` when the user leaves an optional field blank — overwriting a previously set key with an empty string.
**Why it happens:** The existing `save_desktop_settings` endpoint merges `{k: v for k, v in body.items() if v is not None}` — but an empty string `""` is not None, so it overwrites.
**How to avoid:** The wizard should only send fields where the user entered a non-empty value:
```typescript
const payload: Record<string, string> = {}
if (supabaseUrl.trim()) payload.supabase_url = supabaseUrl.trim()
if (supabaseKey.trim()) payload.supabase_key = supabaseKey.trim()
if (geminiKey.trim()) payload.gemini_api_key = geminiKey.trim()
if (elevenlabsKey.trim()) payload.elevenlabs_api_key = elevenlabsKey.trim()
payload.crash_reporting_enabled = String(crashReporting) // always write this
await apiPost("/desktop/settings", payload)
```
**Warning signs:** Previously configured API keys stop working after wizard re-run.

### Pitfall 6: httpx Import in test-connection Endpoint

**What goes wrong:** `desktop_routes.py` does not currently import `httpx` — it's used in `license_service.py` but not directly in the routes file. Adding `test-connection` endpoint that makes direct httpx calls requires adding the import.
**How to avoid:** Add `import httpx` at the top of `desktop_routes.py` when adding the test-connection endpoint. `httpx` is already in `requirements.txt`.

### Pitfall 7: Supabase Connection Test — Correct Endpoint

**What goes wrong:** Testing Supabase by calling `{url}/rest/v1/` returns 400 (no table specified) not 200. Code that checks `resp.status_code == 200` would incorrectly report failure.
**Why it happens:** Supabase REST API requires a table name in the URL. The root `/rest/v1/` returns 400 with "No schema found" but the connection itself succeeded.
**How to avoid:** Accept both 200 and 400 as "connection success" for Supabase:
```python
if resp.status_code in (200, 400):
    return {"connected": True, "service": "supabase"}
```
Or use the Supabase health endpoint: `GET {url}/rest/v1/?apikey={key}` which returns valid JSON on success.

## Code Examples

Verified patterns from existing codebase and Phase 49:

### Complete Wizard Step 1 (License Activation)

```tsx
// Step 1 render block within SetupPage
const [activating, setActivating] = useState(false)
const [licenseError, setLicenseError] = useState<string | null>(null)

const handleActivate = async () => {
  if (!licenseKey.trim()) {
    setLicenseError("Please enter a license key")
    return
  }
  setActivating(true)
  setLicenseError(null)
  try {
    await apiPost("/desktop/license/activate", { license_key: licenseKey.trim() })
    setLicenseValid(true)
    toast.success("License activated successfully!")
    setCurrentStep(2)
  } catch (err: unknown) {
    const msg = err instanceof ApiError ? err.detail || "Activation failed" : "Network error"
    setLicenseError(msg)
  } finally {
    setActivating(false)
  }
}

// Render:
{currentStep === 1 && (
  <div className="space-y-4">
    <div className="space-y-2">
      <label className="text-sm font-medium">License Key</label>
      <Input
        value={licenseKey}
        onChange={(e) => setLicenseKey(e.target.value)}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        disabled={activating || licenseValid}
      />
    </div>
    {licenseError && (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{licenseError}</AlertDescription>
      </Alert>
    )}
    {licenseValid && (
      <Alert>
        <CheckCircle className="h-4 w-4 text-green-500" />
        <AlertDescription>License activated successfully!</AlertDescription>
      </Alert>
    )}
    <Button onClick={handleActivate} disabled={activating || licenseValid}>
      {activating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Activating...</> : "Activate License"}
    </Button>
  </div>
)}
```

### Complete Step 3 (Crash Reporting Consent)

```tsx
{currentStep === 3 && (
  <div className="space-y-6">
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="space-y-1">
        <p className="text-sm font-medium">Enable Crash Reporting</p>
        <p className="text-xs text-muted-foreground">
          Automatically send anonymous crash reports to help improve Edit Factory.
          Data collected: error messages, stack traces, and OS version.
          Your video content and API keys are never included.
        </p>
      </div>
      <Switch
        checked={crashReporting}
        onCheckedChange={setCrashReporting}
      />
    </div>
    <p className="text-xs text-muted-foreground">
      Defaults to OFF. You can change this anytime in Settings.
    </p>
  </div>
)}
```

### Wizard Completion Handler

```typescript
const handleFinish = async () => {
  setLoading(true)
  try {
    // 1. Write API keys (only non-empty values)
    const settingsPayload: Record<string, string | boolean> = {
      crash_reporting_enabled: crashReporting,
    }
    if (supabaseUrl.trim()) settingsPayload.supabase_url = supabaseUrl.trim()
    if (supabaseKey.trim()) settingsPayload.supabase_key = supabaseKey.trim()
    if (geminiKey.trim()) settingsPayload.gemini_api_key = geminiKey.trim()
    if (elevenlabsKey.trim()) settingsPayload.elevenlabs_api_key = elevenlabsKey.trim()
    await apiPost("/desktop/settings", settingsPayload)

    // 2. Mark first run complete
    await apiPost("/desktop/first-run/complete")

    toast.success("Setup complete! Welcome to Edit Factory.")
    router.replace("/librarie")
  } catch {
    toast.error("Failed to save settings. Please try again.")
  } finally {
    setLoading(false)
  }
}
```

### First-Run/Complete Backend Endpoint

```python
# Add to app/api/desktop_routes.py

@router.post("/first-run/complete")
async def mark_first_run_complete():
    """Mark setup wizard as complete. Called at the end of the wizard flow."""
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    existing = _read_config(config_file)
    existing["first_run_complete"] = True
    config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    logger.info("Setup wizard completed — first_run_complete written to config.json")
    return {"completed": True}
```

### Test Connection Backend Endpoint

```python
# Add to app/api/desktop_routes.py

class TestConnectionRequest(BaseModel):
    service: str
    url: str = ""
    key: str = ""

@router.post("/test-connection")
async def test_connection(body: TestConnectionRequest):
    """Test API connectivity for a service. Used by Setup Wizard Step 2."""
    if body.service == "supabase":
        if not body.url or not body.key:
            raise HTTPException(status_code=400, detail="Supabase URL and key are required")
        async with httpx.AsyncClient(timeout=8.0) as client:
            try:
                resp = await client.get(
                    f"{body.url.rstrip('/')}/rest/v1/",
                    headers={"apikey": body.key, "Authorization": f"Bearer {body.key}"},
                )
                if resp.status_code in (200, 400):  # 400 = "no table" but connected
                    return {"connected": True, "service": "supabase"}
                raise HTTPException(status_code=400, detail=f"Supabase returned HTTP {resp.status_code}")
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                raise HTTPException(status_code=400, detail=f"Cannot reach Supabase: {e}")

    elif body.service == "gemini":
        if not body.key:
            raise HTTPException(status_code=400, detail="Gemini API key required")
        async with httpx.AsyncClient(timeout=8.0) as client:
            try:
                resp = await client.get(
                    f"https://generativelanguage.googleapis.com/v1beta/models?key={body.key}",
                )
                if resp.status_code == 200:
                    return {"connected": True, "service": "gemini"}
                raise HTTPException(status_code=400, detail="Gemini API key invalid or quota exceeded")
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                raise HTTPException(status_code=400, detail=f"Cannot reach Gemini: {e}")

    elif body.service == "elevenlabs":
        if not body.key:
            raise HTTPException(status_code=400, detail="ElevenLabs API key required")
        async with httpx.AsyncClient(timeout=8.0) as client:
            try:
                resp = await client.get(
                    "https://api.elevenlabs.io/v1/user",
                    headers={"xi-api-key": body.key},
                )
                if resp.status_code == 200:
                    return {"connected": True, "service": "elevenlabs"}
                raise HTTPException(status_code=400, detail="ElevenLabs API key invalid")
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                raise HTTPException(status_code=400, detail=f"Cannot reach ElevenLabs: {e}")

    raise HTTPException(status_code=400, detail=f"Unknown service: {body.service}")
```

### Navbar Wrapper Update

```tsx
// frontend/src/components/navbar-wrapper.tsx
const hideNavbarPaths = ["/login", "/signup", "/setup"]  // Add /setup
```

### ApiError Import Pattern (Established by Codebase)

```typescript
// frontend/src/lib/api.ts re-exports ApiError
import { ApiError } from "@/lib/api-error"
// OR
import { ApiError } from "@/lib/api"  // re-exported
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Wizard as modal overlay | Wizard as full dedicated page `/setup` | Phase 50 design decision | Simpler routing; no z-index issues; matches login/signup pattern already in project |
| Writing API keys directly to `.env` | Writing to `config.json` via `POST /api/v1/desktop/settings` | Phase 49 implementation | Consistent with established `_read_config` / merge pattern; avoids restart requirement |
| IPC for wizard operations | Direct HTTP to backend endpoints | Phase 49 decision | No Electron IPC needed for this; backend endpoints are sufficient; simpler testing |

**Deprecated/outdated:**
- The ARCHITECTURE.md described the wizard calling IPC (`window.electronAPI.activateLicense`) — Phase 49 built direct HTTP endpoints instead. Phase 50 must use HTTP (`apiPost`) not IPC. The Phase 49 decision is the authoritative one.

## Open Questions

1. **Should the wizard show a "Skip" option for API keys (Step 2)?**
   - What we know: WIZD-03 says "Supabase required, Gemini/ElevenLabs optional." Edge TTS (free) works without API keys. So API key step can technically be skipped if Supabase is also optional for the user's use case.
   - What's unclear: Can the app function without any Supabase credentials? The backend has in-memory fallback for jobs (CLAUDE.md: "Supabase → in-memory storage for jobs and costs") — so technically yes.
   - Recommendation: Show a "Skip for now" link for Step 2, make only Supabase URL+key have a visual "required" indicator. ElevenLabs and Gemini clearly labeled "(optional)." The "Required" label on Supabase should be informational, not a hard block on progression.

2. **Does `POST /api/v1/desktop/license/validate` require a request body?**
   - What we know: Phase 49's `validate_license()` signature is `async def validate_license()` — no body. The call reads `license.json` from disk.
   - What's unclear: The `apiPost` client adds `Content-Type: application/json` even with no body. FastAPI is fine with this.
   - Recommendation: Use `apiPost("/desktop/license/validate")` (no second argument). This sends POST with empty body, which FastAPI handles correctly.

3. **How should the wizard handle the case where Electron is not running (pure dev mode)?**
   - What we know: `NEXT_PUBLIC_DESKTOP_MODE` is not set in dev mode. The wizard should not render or redirect in dev mode.
   - Recommendation: Wrap all wizard logic in `if (process.env.NEXT_PUBLIC_DESKTOP_MODE !== 'true') return <DevModePlaceholder />` at the top of the component. In dev mode, show a message: "Setup wizard is only available in desktop mode."

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json`. Skipping automated test mapping per research instructions.

Playwright tests (`frontend/tests/`) can verify the wizard visually per CLAUDE.md mandatory screenshot requirement after every frontend UI change. The CLAUDE.md specifies: "After EVERY frontend UI implementation/modification, you MUST: 1. Take a Playwright screenshot."

## Sources

### Primary (HIGH confidence)

- **Codebase direct reads** (2026-03-01):
  - `app/api/desktop_routes.py` — Phase 49 built endpoints; `POST /license/activate`, `POST /license/validate`, `GET /settings`, `POST /settings` all exist
  - `app/config.py` — `get_settings.cache_clear()` pattern confirmed; `Settings.base_dir` resolves to `%APPDATA%\EditFactory` in desktop mode
  - `frontend/src/components/navbar-wrapper.tsx` — `hideNavbarPaths` array confirmed; `/setup` must be added
  - `frontend/src/app/settings/page.tsx` — Phase 49's UPDT-06 pattern confirmed; `NEXT_PUBLIC_DESKTOP_MODE` check in `useEffect` is the established pattern
  - `frontend/src/lib/api.ts` — `apiPost`, `apiGet`, `ApiError` export confirmed; `apiFetch` handles Content-Type, timeout, error parsing
  - `frontend/src/components/ui/switch.tsx` — Switch component confirmed installed (Radix UI)
  - `frontend/src/components/ui/progress.tsx` — Progress component confirmed installed (Radix UI)
  - `frontend/package.json` — No stepper library; all needed Radix primitives already present
- **`.planning/STATE.md`** — "404 for not-activated (wizard redirect), 403 for invalid/expired (re-activation)" — Phase 49 key decision for Phase 50 to use
- **`.planning/phases/49-desktop-api-routes/49-01-SUMMARY.md`** — confirmed which endpoints Phase 49 built and their exact behavior
- **`.planning/research/ARCHITECTURE.md`** — Component 5 (`/setup` wizard design), data flow for first launch, config.json schema

### Secondary (MEDIUM confidence)

- **Supabase REST API connection test pattern** (`/rest/v1/` returns 400 for no table) — derived from Supabase documentation behavior; 400 vs 200 acceptance is a common pattern in connection testing for REST APIs
- **ElevenLabs `/v1/user` endpoint** for API key validation — consistent with how `elevenlabs_accounts_routes.py` validates keys in the existing codebase (verified by grep)

### Tertiary (LOW confidence)

- **Gemini API key validation via `/v1beta/models` endpoint** — derived from general Gemini API documentation patterns; should be verified against current Gemini API docs before implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed present in `package.json` and `frontend/src/components/ui/`; no new dependencies
- Architecture: HIGH — backend endpoints verified in `desktop_routes.py`; Phase 49 decision log in STATE.md confirms the 404/403 pattern; frontend patterns confirmed in existing pages
- Pitfalls: HIGH for ApiError instanceof check and empty-string overwrite (verified from code); MEDIUM for NEXT_PUBLIC build-time substitution (general Next.js knowledge, not project-specific test); MEDIUM for Supabase 400 acceptance

**Research date:** 2026-03-01
**Valid until:** 2026-09-01 (stable APIs; Next.js App Router pattern stable)
