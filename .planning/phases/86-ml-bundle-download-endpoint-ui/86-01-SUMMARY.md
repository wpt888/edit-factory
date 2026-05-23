---
phase: 86-ml-bundle-download-endpoint-ui
plan: "01"
subsystem: backend-ml-install
tags: [ml-bundle, sse, http-range, sha256, tar-unpack, desktop, ml-02-closer]
requires:
  - "Phase 84 — get_base_dir() public accessor (cross-platform app base dir resolution)"
  - "Phase 85 — desktop smoke harness (scripts/desktop-smoke-test.py + CI workflow)"
provides:
  - "app/api/desktop_ml_routes.py — FastAPI router POST /api/v1/desktop/ml/download with SSE progress"
  - "app/main.py mount — desktop_ml_router mounted unconditionally under /api/v1"
  - "requirements.txt — sse-starlette==2.1.3 dependency"
  - "tests/test_desktop_ml_routes.py — 6 pytest cases with mocked upstream (no real 1.5 GB download)"
affects:
  - "Phase 87 — ML feature gating reads <base_dir>/ml/.installed to decide 412 vs 200"
  - "Phase 96 — Release pipeline must publish ml-bundle-{platform}-{version}.tar.gz + .sha256 sibling to GitHub Releases"
  - "Phase 86 Plan 02 — Frontend progress UI consumes this endpoint via SSE"
tech-stack:
  added:
    - "sse-starlette==2.1.3"
  patterns:
    - "EventSourceResponse from sse_starlette.sse (async generator → SSE framing)"
    - "httpx.MockTransport for unit-testing streaming HTTP without real network"
    - "asyncio.run() wrapping async test bodies (no pytest-asyncio dependency)"
    - "_AsyncClient module-level alias pattern for test-scoped httpx patching"
key-files:
  created:
    - "app/api/desktop_ml_routes.py"
    - "tests/test_desktop_ml_routes.py"
  modified:
    - "app/main.py (import + unconditional mount)"
    - "requirements.txt (sse-starlette==2.1.3)"
    - "scripts/desktop-smoke-test.py (ENDPOINTS +1)"
key-decisions:
  - "LD-01: Router prefix /desktop/ml, mounted unconditionally (not behind desktop_mode gate) so CI smoke harness can reach it"
  - "LD-02: No auth dependency — desktop routes skip JWT, matching existing desktop/* pattern"
  - "LD-03: ML_BUNDLE_VERSION=0.1.0 constant; base URL read from ML_BUNDLE_BASE_URL env at request-time; platform-specific filenames (win64/darwin-arm64/darwin-x64/linux-x64)"
  - "LD-04: Atomic layout — .partial/<filename> during download, .staging/<version>/ during unpack, .installed after success"
  - "LD-05: SSE events: progress (download/verify/unpack stages), done ({status:installed,version}), error ({error,stage})"
  - "LD-06: 3-branch Range resume — 206 append, 200 restart, 416 skip-to-verify"
  - "LD-07: SHA256 from sibling .sha256 file (sha256sum format), compared case-insensitively; mismatch deletes .partial and emits event:error stage=verify"
  - "LD-08: Atomic unpack — .staging/<version>/, promote into install_root, write .installed last, delete .partial after"
  - "LD-09: CHUNK_SIZE=1MB, throttle at 512KB AND 250ms; stream to disk, never buffer full body"
  - "LD-10: _download_lock + _download_in_progress flag; second concurrent POST → 409 JSON"
  - "LD-11: httpx.AsyncClient(follow_redirects=True, timeout=Timeout(connect=30,read=300)) — follows GitHub→S3 redirect"
  - "LD-12: Tests use httpx.ASGITransport + asyncio.run() (no pytest-asyncio); _AsyncClient alias for scoped patching; tmp_path for filesystem isolation"
requirements-completed: [ML-02]
duration: "32 minutes"
completed: "2026-05-23"
---

# Phase 86 Plan 01: ML Bundle Download Endpoint Summary

**One-liner:** FastAPI SSE endpoint `POST /api/v1/desktop/ml/download` with HTTP Range resume, SHA256 verification, atomic tar.gz unpack, and `.installed` marker — all tested with mocked upstream (no real 1.5 GB download in CI). Closes requirement ML-02.

## What Was Built

### Task 1 — RED: sse-starlette dependency + router scaffold + failing tests

Added `sse-starlette==2.1.3` to `requirements.txt`. Created `app/api/desktop_ml_routes.py` with the full public surface (router, constants, `_resolve_bundle_filename`, `_resolve_base_url`, `download_ml_bundle` endpoint, `_event_stream` stub that raises `NotImplementedError`) so imports work but behavior tests fail. Mounted `desktop_ml_router` unconditionally in `app/main.py` after `assembly_router`.

Created `tests/test_desktop_ml_routes.py` with 6 test cases using `httpx.ASGITransport` + `asyncio.run()` pattern (no pytest-asyncio required). Key infrastructure decisions:
- `_AsyncClient` module-level alias in the route file so test patches stay scoped to the module and don't replace `httpx.AsyncClient` globally (which would break the ASGI client the tests use)
- `AppStatus.should_exit_event = None` reset between tests to prevent sse-starlette's module-level asyncio.Event from binding to a stale event loop after `asyncio.run()` completes

Commit: `b3a72db` — `test(86-01): add failing tests for ML bundle download endpoint`

### Task 2 — GREEN: Full implementation

Replaced the `_event_stream` stub with the complete pipeline. Added four helpers:

- `_download_with_progress(url, partial_path)` — async generator implementing the 3-branch Range resume (206/append, 200/restart, 416/skip). Emits `event: progress` dicts mid-stream (throttled at 512 KB + 250 ms) and a `__complete__` sentinel at the end.
- `_fetch_expected_sha256(url)` — fetches `.sha256` sibling file via `_AsyncClient`, parses first whitespace-delimited token.
- `_hash_file_sha256(path)` — incremental SHA256 of the partial file using `CHUNK_SIZE` reads.
- `_unpack_and_promote(partial, staging, install_root)` — extracts `.tar.gz` into `.staging/<version>/`, promotes contents into `install_root` (skipping `.partial`/`.staging`/`.installed`), removes staging dir.

Also fixed a latent Rule 1 bug: `_resolve_bundle_filename()` is now called BEFORE setting `_download_in_progress = True`. In the original skeleton, an unsupported platform would raise `HTTPException(400)` after the flag was set, leaving `_download_in_progress = True` permanently and making every subsequent POST return 409.

Fixed the range-resume test: the test tarball is only 109 bytes, not 256+. Changed `PARTIAL_SIZE = len(_TARBALL_BYTES) // 2` (~54 bytes).

Commit: `aab9aa6` — `feat(86-01): implement ML bundle download endpoint with SSE progress + range resume + sha256 verify + atomic unpack`

### Task 3 — Smoke harness + SUMMARY

Added one entry to `scripts/desktop-smoke-test.py` ENDPOINTS flat list:
```python
{"method": "POST", "path": "/api/v1/desktop/ml/download", "json": {}},
```
Updated comment: `10 stateless endpoints` (was 9), combined count `23 total` (was 22). The endpoint returns HTTP 200 + SSE body (even when the upstream GitHub URL is unreachable — errors are conveyed via `event: error`, never via HTTP 5xx), so the smoke gate (`status >= 500` rejection) is satisfied.

Commit: `5e0ee9c` — `feat(86-01): add ml/download to desktop smoke harness ENDPOINTS list`

## Performance

| Metric | Value |
|--------|-------|
| Duration | 32 minutes |
| Tasks | 3 (RED + GREEN + smoke/SUMMARY) |
| Files created | 2 (desktop_ml_routes.py, test_desktop_ml_routes.py) |
| Files modified | 3 (main.py, requirements.txt, desktop-smoke-test.py) |
| Tests added | 6 |
| Tests passing | 6/6 |

## Verification Snapshot

| Check | Command | Result |
|-------|---------|--------|
| sse-starlette pinned | `grep -c 'sse-starlette==2.1.3' requirements.txt` | 1 |
| Router import in main.py | `grep -c 'from app.api.desktop_ml_routes import router as desktop_ml_router' app/main.py` | 1 |
| Mount present | `grep -c 'app.include_router(desktop_ml_router' app/main.py` | 1 |
| Mount NOT inside desktop_mode block | verified via script | OK |
| Router declaration | `grep -c 'router = APIRouter(prefix="/desktop/ml"' app/api/desktop_ml_routes.py` | 1 |
| Endpoint decorator | `grep -c '@router.post("/download")' app/api/desktop_ml_routes.py` | 1 |
| Version constant | `grep -c 'ML_BUNDLE_VERSION = "0.1.0"' app/api/desktop_ml_routes.py` | 1 |
| EventSourceResponse | `grep -c 'EventSourceResponse' app/api/desktop_ml_routes.py` | 2 |
| darwin-arm64 branch | `grep -c 'darwin-arm64' app/api/desktop_ml_routes.py` | 1 |
| _download_in_progress | `grep -c '_download_in_progress' app/api/desktop_ml_routes.py` | 6 |
| All tests GREEN | `pytest tests/test_desktop_ml_routes.py -v` | 6 passed |
| Smoke harness entry | `grep -c '"/api/v1/desktop/ml/download"' scripts/desktop-smoke-test.py` | 1 |
| Not in stateful walk | `grep -B1 -A1 '/desktop/ml/download' scripts/desktop-smoke-test.py` | flat ENDPOINTS only |
| _AsyncClient alias | `grep -c '_AsyncClient = httpx.AsyncClient' app/api/desktop_ml_routes.py` | 1 |
| Placeholder removed | `grep -c '_stream_download_with_resume' app/api/desktop_ml_routes.py` | 0 |
| File size sanity | `os.path.getsize('app/api/desktop_ml_routes.py')` | 11892 bytes (in range) |
| Syntax valid (route) | `python -c "import ast; ast.parse(...)"` | OK |
| Syntax valid (main) | `python -c "import ast; ast.parse(...)"` | OK |
| Syntax valid (tests) | `python -c "import ast; ast.parse(...)"` | OK |
| Regression tests | `pytest tests/test_desktop_ml_routes.py tests/test_config_base_dir.py tests/test_ffmpeg_resolver.py` | 21 passed, 1 skipped |

## Manual Follow-Up

**(a) Phase 96 release pipeline:** Must publish `ml-bundle-{platform}-{version}.tar.gz` and the sibling `ml-bundle-{platform}-{version}.tar.gz.sha256` files to GitHub Releases at the URL pattern:
```
https://github.com/wpt888/edit_factory/releases/download/ml-v{version}/
```
(where `{version}` = `ML_BUNDLE_VERSION` = `"0.1.0"`). The `.sha256` file must be in standard `sha256sum -b` format: `<64-hex-chars>  <filename>` (two spaces).

**(b) ML_BUNDLE_BASE_URL env var:** In production deployment, set this env var if the public GitHub repo URL differs from the default (`https://github.com/wpt888/edit_factory/...`). The default is hardcoded and baked into the desktop installer.

**(c) Smoke harness behavior until (a):** The smoke harness will see `event: error` with `stage: download` for the new endpoint (upstream GitHub URL is unreachable in CI). This is expected and does NOT fail the gate (5xx-only rejection per Phase 85 LD). The smoke entry proves route mounting + SSE framing works.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] _download_in_progress flag leak on unsupported platform**
- **Found during:** Task 1 (advisor pre-review)
- **Issue:** The plan's skeleton set `_download_in_progress = True` BEFORE calling `_resolve_bundle_filename()`. If the platform is unsupported, `HTTPException(400)` is raised AFTER the flag is set, leaving it `True` permanently. Every subsequent POST would return 409.
- **Fix:** Moved `_resolve_bundle_filename()` call to BEFORE the `async with _download_lock` block.
- **Files modified:** `app/api/desktop_ml_routes.py`
- **Commit:** `aab9aa6`

**2. [Rule 3 - Infrastructure] Test tarball too small for 256-byte partial pre-seed**
- **Found during:** Task 2 (test failure)
- **Issue:** The range-resume test pre-seeded 256 bytes as an existing partial download, but the test tarball is only 109 bytes. The mock transport's assertion on the Range header failed with `bytes=109-` instead of `bytes=256-`.
- **Fix:** Changed `PARTIAL_SIZE = len(_TARBALL_BYTES) // 2` (~54 bytes) so the partial is always a valid fraction of the tarball.
- **Files modified:** `tests/test_desktop_ml_routes.py`
- **Commit:** `aab9aa6`

**3. [Rule 3 - Infrastructure] Python 3.13 httpx + urllib URL parsing issue**
- **Found during:** Task 1 (test environment)
- **Issue:** `httpx.ASGITransport` with `base_url="http://test"` and relative path triggers a Python 3.13 `urllib.request` regression where `Request.__init__` rejects relative URLs. Also, patching `httpx.AsyncClient` globally via `app.api.desktop_ml_routes.httpx.AsyncClient` replaced the class in the global `httpx` module, breaking the test's own ASGI client.
- **Fix:** (a) Use absolute URL `http://localhost/api/v1/desktop/ml/download` in `ac.stream()`. (b) Add `_AsyncClient = httpx.AsyncClient` alias in the route module and patch `app.api.desktop_ml_routes._AsyncClient` instead. (c) Reset `AppStatus.should_exit_event = None` between tests to avoid sse-starlette's module-level event binding to a stale asyncio event loop.
- **Files modified:** `app/api/desktop_ml_routes.py`, `tests/test_desktop_ml_routes.py`
- **Commit:** `b3a72db`, `aab9aa6`

## Known Stubs

None — the endpoint is fully wired end-to-end (download → verify → unpack → .installed marker). The GitHub Release asset URL (`ML_BUNDLE_BASE_URL` default) is not yet published (see Manual Follow-Up item a), but that is an ops gap, not a code stub.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-86-01-01 | `app/api/desktop_ml_routes.py:279` | `tarfile.extractall(staging_dir)` without path filter — zip-slip risk if a malicious bundle is published. SHA256 sibling check prevents tampering from outside the repository owner, but defense-in-depth (Python 3.12+ `filter="data"` or manual member-path validation) deferred to Phase 87 hardening. Python 3.13 already emits a DeprecationWarning. |
| T-86-01-02 | `app/api/desktop_ml_routes.py` | Concurrent invocation guard — second POST returns 409. Implemented via `_download_lock` + `_download_in_progress` flag. Tested in `test_download_409_on_concurrent_invocation`. |
| T-86-01-03 | `app/api/desktop_ml_routes.py` | Range-resume appends attacker-controlled bytes if prior partial is corrupted. Mitigated: SHA256 verify runs BEFORE unpack; mismatch deletes `.partial` and emits `event: error stage=verify`. |

## Self-Check

- [x] `grep -c 'sse-starlette==2.1.3' requirements.txt` = 1
- [x] `grep -c 'from app.api.desktop_ml_routes import router as desktop_ml_router' app/main.py` = 1
- [x] `grep -c 'app.include_router(desktop_ml_router' app/main.py` = 1
- [x] Mount NOT inside `if settings.desktop_mode:` block (verified)
- [x] `grep -c 'router = APIRouter(prefix="/desktop/ml"' app/api/desktop_ml_routes.py` = 1
- [x] `grep -c '@router.post("/download")' app/api/desktop_ml_routes.py` = 1
- [x] `grep -c 'ML_BUNDLE_VERSION = "0.1.0"' app/api/desktop_ml_routes.py` = 1
- [x] `grep -c 'EventSourceResponse' app/api/desktop_ml_routes.py` = 2
- [x] `grep -c '_download_in_progress' app/api/desktop_ml_routes.py` = 6
- [x] `grep -c '_resolve_bundle_filename' app/api/desktop_ml_routes.py` = 2
- [x] `grep -c 'darwin-arm64' app/api/desktop_ml_routes.py` = 1
- [x] `grep -c 'test_download_emits_done_and_writes_installed_marker' tests/test_desktop_ml_routes.py` = 2
- [x] `grep -c 'test_download_resumes_with_range_header' tests/test_desktop_ml_routes.py` = 2
- [x] `grep -c 'test_download_409_on_concurrent_invocation' tests/test_desktop_ml_routes.py` = 2
- [x] `grep -c 'test_download_unsupported_platform_returns_400' tests/test_desktop_ml_routes.py` = 2
- [x] `grep -c 'test_download_emits_error_on_sha256_mismatch' tests/test_desktop_ml_routes.py` = 2
- [x] `grep -cE 'httpx\.(ASGITransport|MockTransport)' tests/test_desktop_ml_routes.py` = 11
- [x] `pytest tests/test_desktop_ml_routes.py -v` → 6 passed (GREEN)
- [x] `python -c "import ast; ast.parse(...desktop_ml_routes.py...)"` → OK
- [x] `python -c "import ast; ast.parse(...app/main.py...)"` → OK
- [x] `python -c "import ast; ast.parse(...tests/test_desktop_ml_routes.py...)"` → OK
- [x] `grep -c '"/api/v1/desktop/ml/download"' scripts/desktop-smoke-test.py` = 1
- [x] New ENDPOINTS entry NOT inside `_run_pipeline_walk` or `_run_library_walk` functions
- [x] `python -c "import ast; ast.parse(...desktop-smoke-test.py...)"` → OK
- [x] `pytest tests/test_desktop_ml_routes.py tests/test_config_base_dir.py tests/test_ffmpeg_resolver.py` → 21 passed, 1 skipped (no regression)
- [x] SUMMARY.md file exists at `.planning/phases/86-ml-bundle-download-endpoint-ui/86-01-SUMMARY.md`
- [x] `grep -c 'requirements-completed: \[ML-02\]' 86-01-SUMMARY.md` = 1

## Self-Check: PASSED

All acceptance criteria verified. 6/6 tests green. No regressions in Phase 84/85 test baselines.
