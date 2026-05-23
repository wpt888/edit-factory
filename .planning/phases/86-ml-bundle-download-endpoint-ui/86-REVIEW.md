---
phase: 86-ml-bundle-download-endpoint-ui
reviewed: 2026-05-23T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - app/api/desktop_ml_routes.py
  - app/main.py
  - requirements.txt
  - scripts/desktop-smoke-test.py
  - tests/test_desktop_ml_routes.py
  - frontend/src/components/ml-bundle-installer.tsx
  - frontend/src/app/settings/page.tsx
  - frontend/tests/features/ml/ml-bundle-installer.spec.ts
  - frontend/tests/screenshots/screenshot-ml-installer.spec.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 86: Code Review Report

**Reviewed:** 2026-05-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 86 delivers a POST SSE endpoint for ML bundle download with SHA256 verification,
atomic unpack, and HTTP Range resume, plus a React component with a 6-state machine
driven by raw fetch (not EventSource). The locked decisions (LD-05/10/21/22/29) are
all implemented correctly: SSE event names match, the asyncio.Lock + 409 path is
correct, the component uses fetch + ReadableStream, and the 409/400/5xx branching
matches the spec.

One critical issue was found: the tarball extraction uses bare `tar.extractall()` with
no path filter, which enables path traversal (tarslip) for a malicious archive. Three
warnings cover non-atomic install promotion, an unguarded real network call in the smoke
harness, and SSRF exposure via env-controlled redirect follow. Three info items cover a
misleading Playwright comment, a minor AbortController ordering nit, and unused imports.

---

## Critical Issues

### CR-01: Tarball path traversal (tarslip) in `_unpack_and_promote`

**File:** `app/api/desktop_ml_routes.py:278-279`

**Issue:** `tarfile.extractall(staging_dir)` is called without a `filter` argument.
A tarball entry whose name begins with `../` (or an absolute path) will write files
outside `staging_dir`, potentially overwriting arbitrary filesystem paths. The
Python 3.12+ runtime issues a `DeprecationWarning` for this; on Python 3.14 it becomes
an error; on the pinned Python 3.11 CI environment it is completely silent. Because the
download URL is configurable via `ML_BUNDLE_BASE_URL` (env var, line 58-62), any
operator or CI system that sets a non-GitHub URL can supply a crafted archive. In
desktop mode the backend runs on a local machine, making this a direct privilege
escalation vector.

**Fix:**
```python
# Python 3.12+ supports filter="data" which strips absolute paths and .. components.
# For Python < 3.12 compatibility, manually validate member paths before extraction.
import sys as _sys

def _safe_extract(tar: tarfile.TarFile, dest: Path) -> None:
    if _sys.version_info >= (3, 12):
        tar.extractall(dest, filter="data")
    else:
        for member in tar.getmembers():
            # Reject absolute paths and path traversal
            member_path = Path(member.name)
            if member_path.is_absolute():
                raise RuntimeError(f"Absolute path in archive: {member.name}")
            resolved = (dest / member_path).resolve()
            if not resolved.is_relative_to(dest.resolve()):
                raise RuntimeError(f"Path traversal attempt: {member.name}")
        tar.extractall(dest)

# In _unpack_and_promote, replace:
#   tar.extractall(staging_dir)
# With:
#   _safe_extract(tar, staging_dir)
```

---

## Warnings

### WR-01: Non-atomic install promotion — crash window between delete and move

**File:** `app/api/desktop_ml_routes.py:282-294`

**Issue:** `_unpack_and_promote` deletes existing `install_root` entries first (lines
282-288), then moves staging contents in (lines 291-292), then the caller writes
`.installed` (line 141). A crash after the delete step but before the move completes
leaves `install_root` partially emptied with no rollback path. The prior installed
state is permanently destroyed. The caller also writes `.installed` outside the function
so a crash after the file moves but before line 141 leaves the directory populated but
not marked, causing the status probe to report `not installed` even though the files
are present.

**Fix:** Move `.installed` writing into `_unpack_and_promote` after the final
`shutil.rmtree(staging_dir)` so the marker is written atomically with the promotion.
For a stronger guarantee, collect staging contents into a temp dir sibling to
`install_root` and use `os.rename()` at the final step (works reliably on same-
filesystem Linux/macOS; Windows requires a fallback).

```python
def _unpack_and_promote(partial_path: Path, staging_dir: Path, install_root: Path,
                        version: str) -> None:
    # ... existing steps 1-4 ...
    shutil.rmtree(staging_dir)
    # Write marker last — if we crash before here the directory is populated but unmarked,
    # which the status probe detects. No half-written state is exposed to the application.
    (install_root / ".installed").write_text(f"{version}\n", encoding="utf-8")
```

Then in `_event_stream` (line 140-141) remove the standalone `.installed` write so it
is only written inside `_unpack_and_promote`.

---

### WR-02: Smoke harness makes real network request to GitHub for ML download

**File:** `scripts/desktop-smoke-test.py:236`

**Issue:** The ENDPOINTS table includes `POST /api/v1/desktop/ml/download` (line 236)
with no httpx mock installed for `desktop_ml_routes._AsyncClient`. Unlike the pytest
suite (`tests/test_desktop_ml_routes.py`), the smoke harness never patches
`app.api.desktop_ml_routes._AsyncClient`. When the smoke harness executes that entry,
the endpoint resolves the platform filename then opens a live `httpx.AsyncClient` and
attempts to stream from `github.com/wpt888/edit_factory/releases/...`. In CI this
either hangs for up to 30 s (the configured `read` timeout) or produces a 404 that
propagates as `event: error` — the harness considers anything `< 500` a pass, so it
will not fail CI, but it introduces a non-deterministic 30-second penalty and a
dependency on GitHub availability.

**Fix:** Either (a) patch `_AsyncClient` in the smoke harness before the endpoint
table walk (mirror `_patch_httpx_client` from the pytest helpers), or (b) gate the
entry behind a flag:

```python
# Option A — install mock before endpoint walk
import app.api.desktop_ml_routes as _ml_mod
import httpx as _httpx

_FAKE_TARBALL = b""  # empty body is fine; endpoint will emit error, not 5xx
_ml_mod._AsyncClient = lambda *a, **kw: _httpx.AsyncClient(
    transport=_httpx.MockTransport(
        lambda req: _httpx.Response(200, content=_FAKE_TARBALL)
    )
)
```

---

### WR-03: SSRF via `follow_redirects=True` on operator-controlled URL

**File:** `app/api/desktop_ml_routes.py:179, 243`

**Issue:** Both `_download_with_progress` (line 179) and `_fetch_expected_sha256`
(line 243) create `_AsyncClient(follow_redirects=True)`. The base URL comes from
`ML_BUNDLE_BASE_URL` env var (line 58-62). In a compromised or misconfigured
environment (or when desktop mode binds to `0.0.0.0` as warned at `app/main.py:283`),
an attacker who controls the environment can set `ML_BUNDLE_BASE_URL` to an internal
service URL (e.g. `http://169.254.169.254/` on AWS, or an internal Redis/Postgres
endpoint). The redirect chain is then followed silently. The redirect-follow is
necessary for GitHub Releases CDN redirects, but the URL should be validated against
an allowlist or at minimum scheme+host checked before the request is made.

**Fix (minimum):** Validate the base URL at startup or at request time:

```python
from urllib.parse import urlparse

def _resolve_base_url() -> str:
    template = os.getenv(
        "ML_BUNDLE_BASE_URL",
        "https://github.com/wpt888/edit_factory/releases/download/ml-v{version}/",
    )
    url = template.format(version=ML_BUNDLE_VERSION)
    parsed = urlparse(url)
    if parsed.scheme not in ("https",):
        raise HTTPException(status_code=500, detail="ML_BUNDLE_BASE_URL must use https")
    return url
```

---

## Info

### IN-01: Playwright route-registration-order comment is inverted

**File:** `frontend/tests/features/ml/ml-bundle-installer.spec.ts:51`
**Also:** `frontend/tests/screenshots/screenshot-ml-installer.spec.ts` (catch-all comment)

**Issue:** The comment on line 51 of `ml-bundle-installer.spec.ts` reads:
> "registered AFTER the catch-all, so Playwright matches the more-recently-registered
> specific route first for the same URL pattern"

This is factually correct — Playwright does match in **reverse** registration order
(last registered wins). However the comment on the catch-all handler itself
(`mockSettingsPage`) says "Playwright matches in registration order" by implication
(the inline comment "will be overridden per test" is accurate, but the base assumption
is not stated, making the ordering surprising to future readers). Both test files share
the same catch-all + per-test override pattern; the ordering rationale should be
clarified to avoid an "it only works by accident" perception.

**Fix:** Add a one-line comment to `mockSettingsPage` in both files:
```typescript
// NOTE: Playwright matches routes in reverse registration order (last-registered wins).
// Per-test overrides registered after this catch-all therefore take precedence.
await page.route('**/*', async (route) => { ... });
```

---

### IN-02: `abortRef` is replaced without aborting the previous controller

**File:** `frontend/src/components/ml-bundle-installer.tsx:107`

**Issue:** `abortRef.current = new AbortController()` replaces the ref without first
calling `abortRef.current?.abort()`. `inFlightRef` prevents re-entry so this path is
never actually reached with a live controller — but if the guard ever changes, or if
a unit test bypasses it, the stale `AbortController` leaks silently and the signal
attached to an in-flight `fetch` becomes unabortable.

**Fix:**
```typescript
// Before line 107:
abortRef.current?.abort()   // defensive: cancel any stale in-flight request
abortRef.current = new AbortController()
```

---

### IN-03: Unused imports in test file

**File:** `tests/test_desktop_ml_routes.py:11, 15`

**Issue:** `gzip` (line 11) and `time` (line 15) are imported but never referenced in
the test file. `io` is used (line 65). These are harmless but add noise to the import
block.

**Fix:** Remove the two unused imports:
```python
# Remove:
import gzip
import time
```

---

_Reviewed: 2026-05-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
