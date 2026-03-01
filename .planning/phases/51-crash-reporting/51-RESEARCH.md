# Phase 51: Crash Reporting - Research

**Researched:** 2026-03-01
**Domain:** Sentry Python SDK (FastAPI), conditional crash reporting initialization, PII scrubbing
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UPDT-03 | Sentry crash reporting initialized only when user has opted in | `sentry_sdk.init()` is a no-op when DSN is not provided. Opt-in flag from `config.json` gates initialization at FastAPI startup. |
| UPDT-04 | `before_send` filter scrubs API keys from Sentry stack frame locals | `EventScrubber` with extended denylist covers `api_key` / `apikey` by default; add `gemini_api_key`, `supabase_key`, `supabase_url`, `elevenlabs_api_key`, `anthropic_api_key` to custom denylist. |
</phase_requirements>

---

## Summary

Phase 51 adds opt-in Sentry crash reporting to the FastAPI backend. The user sets the preference in the Setup Wizard (Phase 50 already writes `crash_reporting_enabled` to `config.json` and wires the toggle in the Settings page). This phase wires the backend to read that flag at startup and conditionally call `sentry_sdk.init()`.

The critical architectural constraint is that **`sentry_sdk.init()` must not be called more than once per process**. Sentry maintainers confirmed: "Initializing the SDK multiple times leads to undefined behavior." This rules out the naive "call init again when the user toggles" approach. Instead, the toggle-takes-effect-immediately requirement (Success Criterion 4) is satisfied by initializing Sentry once with a `before_send` hook that reads a mutable module-level flag — when the user saves the toggle in Settings, a backend endpoint updates the flag and Sentry respects it within the same session.

The PII scrubbing requirement (UPDT-04) is straightforward: `EventScrubber` with a custom denylist extension covers all project-specific key names. The `DEFAULT_DENYLIST` already covers generic `api_key` and `apikey` but does NOT cover `gemini_api_key`, `supabase_key`, `supabase_url`, or `elevenlabs_api_key` — these must be added explicitly.

**Primary recommendation:** Initialize `sentry_sdk.init()` once in `app/main.py` (after FastAPI app creation), gated by `crash_reporting_enabled` read from `config.json`. Use a mutable module-level flag in a `app/services/crash_reporter.py` service that `before_send` checks, so the Settings toggle takes immediate effect via a `POST /api/v1/desktop/crash-reporting` endpoint.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sentry-sdk` | `>=2.0.0` (latest 2.53.0) | Python error reporting SDK | Official Sentry SDK; includes FastAPI auto-integration |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sentry_sdk.scrubber.EventScrubber` | bundled with sentry-sdk | Scrub sensitive fields from frame locals | Always — extend DEFAULT_DENYLIST with project key names |
| `sentry_sdk.scrubber.DEFAULT_DENYLIST` | bundled | Base list of scrubbed field names | Import and extend rather than replace |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `EventScrubber` | custom `before_send` walk | EventScrubber is battle-tested and recursive; custom walk is error-prone |
| Module-level flag for toggle | Calling `sentry_sdk.init()` twice | Calling init twice is explicitly unsupported by Sentry; module flag is safe |

**Installation:**
```bash
pip install "sentry-sdk>=2.0.0"
```

Add to `requirements.txt`:
```
sentry-sdk>=2.0.0
```

---

## Architecture Patterns

### Recommended Project Structure

```
app/
├── main.py                    # Call init_sentry() AFTER FastAPI app creation
├── services/
│   └── crash_reporter.py      # NEW: sentry init, module flag, before_send hook
└── api/
    └── desktop_routes.py      # Add POST /crash-reporting toggle endpoint
```

### Pattern 1: Conditional initialization at startup

**What:** Read `crash_reporting_enabled` from `config.json` at lifespan startup. If true, call `sentry_sdk.init()` with the project DSN. If false, never call `sentry_sdk.init()` — the SDK stays in no-op state (no network requests, no data collection).

**When to use:** Always — this satisfies UPDT-03 (no init if opt-out).

**Key fact (HIGH confidence — Sentry official docs):** "If the DSN option is not set, the SDK will just not send any data." Calling `sentry_sdk.init()` with `dsn=None` or not calling it at all are both valid no-op states. The SDK does not make any network requests until a DSN is provided.

**Example:**
```python
# Source: https://docs.sentry.io/platforms/python/integrations/fastapi/
# app/services/crash_reporter.py

import sentry_sdk
from sentry_sdk.scrubber import EventScrubber, DEFAULT_DENYLIST

# Mutable flag — checked by before_send on every event
_crash_reporting_enabled: bool = False

# Project-specific key names NOT covered by DEFAULT_DENYLIST
_CUSTOM_DENYLIST = DEFAULT_DENYLIST + [
    "gemini_api_key",
    "supabase_key",
    "supabase_url",
    "elevenlabs_api_key",
    "anthropic_api_key",
    "license_key",
    "instance_id",
]

def _before_send(event, hint):
    """Drop event if user has toggled crash reporting OFF mid-session."""
    if not _crash_reporting_enabled:
        return None  # Drop — Sentry SDK sends nothing
    return event


def init_sentry(dsn: str, enabled: bool) -> None:
    """Initialize Sentry. Call ONCE after FastAPI app is created."""
    global _crash_reporting_enabled
    _crash_reporting_enabled = enabled
    if not enabled or not dsn:
        return  # Stay in no-op — no sentry_sdk.init() call at all
    sentry_sdk.init(
        dsn=dsn,
        send_default_pii=False,          # Never send PII
        include_local_variables=True,    # Required to capture frame locals
        event_scrubber=EventScrubber(
            denylist=_CUSTOM_DENYLIST,
            recursive=True,              # Scrub nested dicts too
        ),
        before_send=_before_send,
        traces_sample_rate=0.0,          # Error-only; no performance tracing
    )


def set_crash_reporting(enabled: bool) -> None:
    """Toggle crash reporting at runtime (immediate effect via before_send)."""
    global _crash_reporting_enabled
    _crash_reporting_enabled = enabled
```

### Pattern 2: FastAPI integration placement

**What:** Call `init_sentry()` AFTER `app = FastAPI(...)` is created. This is required — Sentry's FastAPI integration instruments the app object. If called before, errors won't be captured.

**Why it matters:** There is an open Sentry bug (#2353) confirming that initializing before the app is created breaks instrumentation. The fix is simple: place `init_sentry()` after app creation.

**Example in `app/main.py`:**
```python
# After FastAPI app creation and middleware registration:
app = FastAPI(title="Edit Factory", ...)
app.add_middleware(CORSMiddleware, ...)
app.add_middleware(SlowAPIMiddleware)

# THEN initialize Sentry (desktop-mode only)
if settings.desktop_mode:
    from app.services.crash_reporter import init_sentry
    config = _read_desktop_config(settings.base_dir)
    init_sentry(
        dsn="https://YOUR_SENTRY_DSN@o0.ingest.sentry.io/0",
        enabled=config.get("crash_reporting_enabled", False),
    )
```

### Pattern 3: Runtime toggle via backend endpoint

**What:** Settings page calls `POST /api/v1/desktop/crash-reporting` with `{"enabled": true/false}`. The endpoint calls `crash_reporter.set_crash_reporting(enabled)` to update the module flag AND writes the preference back to `config.json`.

**When to use:** Satisfies Success Criterion 4 — toggle takes immediate effect without a restart.

**Important:** The module-level flag is the only mechanism for in-session toggle. `sentry_sdk.init()` MUST NOT be called a second time. Sentry maintainers confirmed this leads to undefined behavior (issue #3059).

**Example:**
```python
# In app/api/desktop_routes.py
from app.services import crash_reporter

@router.post("/crash-reporting")
async def set_crash_reporting(body: dict):
    enabled = bool(body.get("enabled", False))
    # Update in-memory state (immediate effect)
    crash_reporter.set_crash_reporting(enabled)
    # Persist to config.json
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    existing = _read_config(config_file)
    existing["crash_reporting_enabled"] = enabled
    config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    return {"crash_reporting_enabled": enabled}
```

### Pattern 4: Settings page toggle wiring

**What:** Settings page already links to `/setup?mode=edit` for the Setup Wizard. For immediate toggle without re-running the wizard, add a "Crash Reporting" section directly in `frontend/src/app/settings/page.tsx` that calls the new endpoint.

**When to use:** Satisfies Success Criterion 4 — the toggle in Settings must take immediate effect, not require wizard re-run.

**State pattern (consistent with existing Settings page):**
```typescript
const [crashReporting, setCrashReporting] = useState(false)

// Load from GET /desktop/settings on mount (already returns crash_reporting_enabled)
useEffect(() => {
  if (process.env.NEXT_PUBLIC_DESKTOP_MODE !== 'true') return
  apiGet('/desktop/settings')
    .then(r => r.json())
    .then((data: any) => setCrashReporting(data.crash_reporting_enabled ?? false))
    .catch(() => {})
}, [])

// On toggle:
const handleCrashReportingToggle = async (enabled: boolean) => {
  setCrashReporting(enabled)
  await apiPost('/desktop/crash-reporting', { enabled })
}
```

### Anti-Patterns to Avoid

- **Calling `sentry_sdk.init()` more than once:** Undefined behavior; Sentry SDK integrations are hooked during first init only. The process must be restarted to re-initialize with new config — which contradicts Success Criterion 4.
- **Initializing before FastAPI app creation:** FastAPI instrumentation won't attach. Always place `init_sentry()` after `app = FastAPI(...)`.
- **Setting `send_default_pii=True`:** This would add request headers, user IPs, and other PII. Must stay `False`.
- **Not including local variables:** Setting `include_local_variables=False` prevents Sentry from capturing the frame locals that are needed for stack trace debugging — but also prevents scrubbing from working. Keep `include_local_variables=True` paired with `EventScrubber`.
- **Relying only on DEFAULT_DENYLIST:** It covers `api_key` and `apikey` but NOT `gemini_api_key`, `supabase_key`, `supabase_url`, or `elevenlabs_api_key`. Custom extension is mandatory.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sensitive field scrubbing | Custom regex-walk over event dict | `EventScrubber(recursive=True)` | Handles nested dicts, lists, and the full Sentry event schema; well-tested |
| PII removal from frames | Manual `del frame['vars']['key']` in before_send | `EventScrubber` with extended denylist | EventScrubber also scrubs breadcrumbs, request data, extra fields — not just frames |
| Error deduplication | Custom fingerprinting | Sentry built-in fingerprinting | Sentry deduplicates automatically by stack trace |

**Key insight:** EventScrubber with recursive=True is the correct, complete solution for PII scrubbing. The `before_send` hook should only be used for the opt-out flag check, not for manual field deletion.

---

## Common Pitfalls

### Pitfall 1: Initializing Sentry before FastAPI app creation

**What goes wrong:** Sentry's FastAPI middleware fails to attach; unhandled route exceptions are not captured in Sentry.

**Why it happens:** The FastAPI integration instruments the app object during `sentry_sdk.init()`. If the app doesn't exist yet, there is nothing to instrument.

**How to avoid:** Call `init_sentry()` AFTER `app = FastAPI(...)` and AFTER all middleware is added.

**Warning signs:** Sentry dashboard shows no events even though errors are occurring.

### Pitfall 2: Calling `sentry_sdk.init()` a second time to handle toggle

**What goes wrong:** Integrations are double-hooked; events may be sent twice; duplicate background workers are spawned; behavior is undefined.

**Why it happens:** Sentry Python SDK is designed for one-time initialization per process.

**How to avoid:** Use a module-level `_crash_reporting_enabled` flag checked in `before_send`. Toggle the flag via `set_crash_reporting()`, never reinitialize.

**Warning signs:** Duplicate events in Sentry dashboard; errors in logs about "already initialized".

### Pitfall 3: DEFAULT_DENYLIST not covering project-specific key names

**What goes wrong:** API keys appear in Sentry frame locals (e.g. `gemini_api_key="AIza..."`) because the generic scrubber only covers the word `api_key` (exact match), not `gemini_api_key`.

**Why it happens:** DEFAULT_DENYLIST uses partial keyword matching but relies on exact field name patterns. `gemini_api_key` contains `api_key` as a substring — testing needed to confirm if substring matching applies.

**How to avoid:** Explicitly add all project-specific key names to the custom denylist. This is the safe, explicit approach regardless of substring matching behavior.

**Warning signs:** Sentry events show `gemini_api_key`, `supabase_key`, or similar in frame vars.

### Pitfall 4: Crash reporting initializing in non-desktop mode

**What goes wrong:** Sentry runs in dev or web deployment mode, potentially sending dev-machine stack traces to the production Sentry project.

**Why it happens:** If the init code is not gated on `settings.desktop_mode`, it runs everywhere.

**How to avoid:** Gate `init_sentry()` behind `if settings.desktop_mode:` in `app/main.py`.

### Pitfall 5: DSN hardcoded in source code

**What goes wrong:** Sentry DSN is committed to a public or semi-public repo.

**Why it happens:** Convenience — the DSN is needed at init time.

**How to avoid:** Embed the DSN as a build-time constant in `crash_reporter.py` (acceptable — DSN is a public endpoint, not a secret). OR store in `config.json` written by the installer. The Sentry DSN is not a secret — it only allows sending events TO your project, not reading them. Embedding in source code is standard practice.

---

## Code Examples

Verified patterns from official sources:

### EventScrubber with custom denylist
```python
# Source: https://docs.sentry.io/platforms/python/data-management/sensitive-data/
from sentry_sdk.scrubber import EventScrubber, DEFAULT_DENYLIST

denylist = DEFAULT_DENYLIST + [
    "gemini_api_key",
    "supabase_key",
    "supabase_url",
    "elevenlabs_api_key",
    "anthropic_api_key",
    "license_key",
    "instance_id",
]

sentry_sdk.init(
    dsn="...",
    send_default_pii=False,
    event_scrubber=EventScrubber(denylist=denylist, recursive=True),
)
```

### before_send drop pattern
```python
# Source: https://docs.sentry.io/platforms/python/configuration/filtering/
def before_send(event, hint):
    if not _crash_reporting_enabled:
        return None  # Drop — no data leaves the machine
    return event

sentry_sdk.init(dsn="...", before_send=before_send)
```

### No-op when not opted in (UPDT-03)
```python
# Source: https://docs.sentry.io/platforms/python/configuration/options/ — "If DSN not set, SDK sends no data"
if not crash_reporting_enabled:
    return  # Don't call sentry_sdk.init() at all — stays fully silent
```

### DEFAULT_DENYLIST contents (HIGH confidence — verified from sentry-python source)
The following field names are scrubbed by default (case-insensitive substring match):
`password, passwd, secret, api_key, apikey, auth, credentials, mysql_pwd, privatekey, private_key, token, session, csrftoken, sessionid, x_csrftoken, x_forwarded_for, set_cookie, cookie, authorization, x_api_key, aiohttp_session`

Note: `gemini_api_key` contains `api_key` as a substring. Whether EventScrubber does substring matching vs. exact matching needs a quick test. To be safe, add all project-specific names explicitly.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `raven` (legacy Python SDK) | `sentry-sdk` | 2018 | `sentry-sdk` is the only supported SDK; raven is end-of-life |
| Hub-based API (`with Hub(...)`) | Scope-based API (`sentry_sdk.new_scope()`) | sentry-sdk 2.x | Hub API still works but is deprecated; scope API is current |
| Manual before_send PII scrubbing | `EventScrubber` class | sentry-sdk ~1.40 | EventScrubber handles schema complexity automatically |
| `include_locals=True` | `include_local_variables=True` | sentry-sdk 1.x | Parameter rename; old name no longer documented |

**Deprecated/outdated:**
- `raven-python`: Do not use — EOL since 2019
- Hub direct instantiation: Works but EventScrubber is the recommended PII approach
- Calling `sentry_sdk.init()` with `dsn=""` (empty string): This may cause a parse error in some SDK versions; using `dsn=None` or not calling `init()` is safer

---

## Open Questions

1. **Does EventScrubber substring-match field names?**
   - What we know: DEFAULT_DENYLIST contains `api_key`; project uses `gemini_api_key`
   - What's unclear: Whether the scrubber matches on `api_key` as a substring of `gemini_api_key` or only exact-key matches
   - Recommendation: Add all project-specific names explicitly to custom denylist regardless — eliminates ambiguity, costs nothing

2. **Sentry DSN source: hardcoded vs. config.json?**
   - What we know: DSN is a public endpoint (not a secret); embedding in source is standard
   - What's unclear: Whether to obtain a DSN for this project (requires a Sentry account/project)
   - Recommendation: The planner should note this as a one-time setup step. Hardcode DSN in `crash_reporter.py`. The DSN value itself is determined by whoever owns the Sentry project for Edit Factory.

3. **Settings page toggle location: new section or wizard-only?**
   - What we know: Setup Wizard Step 3 already has the toggle; Settings page links to wizard
   - What's unclear: Success Criterion 4 says "toggling in Settings immediately takes effect" — this implies Settings page must have its own toggle, not just a link to the wizard
   - Recommendation: Add a dedicated "Crash Reporting" card to `frontend/src/app/settings/page.tsx` with a Switch component wired to `POST /api/v1/desktop/crash-reporting`. The wizard toggle writes the initial value; the Settings toggle allows in-session change.

---

## Sources

### Primary (HIGH confidence)
- https://docs.sentry.io/platforms/python/integrations/fastapi/ — FastAPI integration, auto-instrumentation, initialization
- https://docs.sentry.io/platforms/python/configuration/options/ — `dsn`, `before_send`, `send_default_pii`, `include_local_variables`, `event_scrubber`
- https://docs.sentry.io/platforms/python/data-management/sensitive-data/ — EventScrubber, DEFAULT_DENYLIST, custom denylist
- https://getsentry.github.io/sentry-python/_modules/sentry_sdk/scrubber.html — EventScrubber class source, full DEFAULT_DENYLIST contents
- https://pypi.org/project/sentry-sdk/ — Latest version 2.53.0, Python >=3.6

### Secondary (MEDIUM confidence)
- https://github.com/getsentry/sentry-python/issues/2353 — Confirmed: init must happen AFTER FastAPI app creation
- https://github.com/getsentry/sentry-python/issues/3059 — Confirmed: `sentry_sdk.init()` cannot be safely called twice in one process; workaround is separate Hubs (not applicable here) or module-level flag

### Tertiary (LOW confidence)
- WebSearch general results — corroborated by PRIMARY sources above

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — sentry-sdk 2.53.0 verified on PyPI; official docs consulted
- Architecture: HIGH — placement after app creation verified from GitHub issue #2353; init-twice constraint verified from issue #3059
- Pitfalls: HIGH — DEFAULT_DENYLIST contents verified from sentry-python source module; EventScrubber behavior from official docs
- Toggle approach: MEDIUM — module-level flag pattern is sound but EventScrubber substring matching behavior should be tested

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (sentry-sdk is stable; API unlikely to change in 30 days)
