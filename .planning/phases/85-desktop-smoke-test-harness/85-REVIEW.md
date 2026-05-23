---
phase: 85
status: warnings
depth: standard
files_reviewed: 3
files_reviewed_list:
  - scripts/desktop-smoke-test.py
  - .github/workflows/desktop-smoke.yml
  - tests/test_pipeline_e2e_sqlite.py
findings_count: 5
critical: 0
high: 0
medium: 2
low: 1
info: 2
generated: "2026-05-23T00:00:00Z"
---

# Phase 85: Code Review Report

**Reviewed:** 2026-05-23
**Depth:** standard
**Files Reviewed:** 3
**Status:** warnings (medium severity only — advisory, no blockers)

## Summary

Three files were reviewed: the new 479-line smoke harness (`scripts/desktop-smoke-test.py`), the new 36-line CI workflow (`.github/workflows/desktop-smoke.yml`), and the single-function xfail-reason update in `tests/test_pipeline_e2e_sqlite.py`.

The harness is correctly structured — env bootstrap precedes any app import, mocks are installed before route calls, seed data is laid down before walks begin, and the 5xx-only rejection criterion is correctly implemented. The CI workflow installs the right system dependencies (`libmagic1 ffmpeg`), pins Python 3.11, and correctly sets all four environment variables. The xfail update in `test_pipeline_e2e_sqlite.py` preserves both the B-81-04 citation and `strict=False`.

Two medium findings: the CI job has no `timeout-minutes`, and the stateful walk functions buffer all rows before printing (silencing progress output if the job is killed mid-walk). One low finding: mock-install failures are silently swallowed with no warning. Two info items: `EDIT_FACTORY_BASE_DIR` is set but never read by any app code (self-documented as harmless), and `profile_id` is duplicated as a string literal in two places.

---

## Medium Issues

### MD-01: CI job has no `timeout-minutes` — hung route burns 6-hour GitHub default

**File:** `.github/workflows/desktop-smoke.yml:10`
**Issue:** The `desktop-smoke` job has no `timeout-minutes` limit. If any route hangs inside `TestClient` (e.g., an async background task that doesn't complete in test mode), the job will consume the GitHub Actions 6-hour default before failing. On a busy PR queue this silently blocks the merge gate for hours.

**Fix:**
```yaml
jobs:
  desktop-smoke:
    name: Desktop SQLite-mode smoke harness
    runs-on: ubuntu-latest
    timeout-minutes: 10   # add this line
```

10 minutes is generous for a 22-endpoint SQLite harness; the full run should complete in under 2 minutes.

---

### MD-02: Stateful walk functions buffer rows — live progress is lost if job is killed mid-walk

**File:** `scripts/desktop-smoke-test.py:448-455`
**Issue:** `_run_pipeline_walk` and `_run_library_walk` return all rows to `main()`, which prints them after the walk returns. If the process is killed or a route hangs mid-walk, the stdout lines for completed steps are never printed — defeating the per-endpoint audit trail that FUNC-06 requires. `_walk()` (the flat-table walker) correctly prints inline during iteration, so the inconsistency is not intentional.

```python
# main() currently:
pipeline_rows = _run_pipeline_walk(client)
for row in pipeline_rows:              # line 449 — prints AFTER walk completes
    _print_row(row["method"], row["path"], row["status"])

library_rows = _run_library_walk(client)
for row in library_rows:              # line 454 — same problem
    _print_row(row["method"], row["path"], row["status"])
```

**Fix:** Call `_print_row` inside each walk function immediately after receiving the response, then still append to `rows` for the caller. Example for `_run_pipeline_walk`:

```python
# After each r = client.post(...) / client.get(...) call, add:
_print_row("POST", "/api/v1/pipeline/generate", r.status_code)
rows.append({"method": "POST", "path": "/api/v1/pipeline/generate", "status": r.status_code})
# (remove the duplicate _print_row loop in main())
```

Apply the same pattern inside `_run_library_walk`. Remove the for-loop print passes in `main()` (lines 449-450 and 454-455), which become redundant.

---

## Low Issues

### LW-01: Silent zero-patch outcome in mock-install functions — future renames go undetected

**File:** `scripts/desktop-smoke-test.py:119-133, 148-162`
**Issue:** `_install_script_generator_mock` and `_install_tts_mock` iterate over (module, attr) pairs and swallow all `ImportError`/`AttributeError` exceptions with `continue`. If a future refactor renames `ScriptGenerator`, `GeminiService`, or `TTSProvider`, every iteration silently skips, zero patches succeed, and the harness runs against the live Gemini/ElevenLabs code paths — which will fail in CI without API keys. This is a CLAUDE.md silent-failure concern.

**Fix:** Track a patch counter per function and print a warning when it reaches zero:

```python
patched = 0
for target_module, attr_name in [...]:
    try:
        ...
        setattr(cls, method_name, _mocked_generate)
        patched += 1
    except (...):
        continue
if patched == 0:
    print("WARNING: _install_script_generator_mock: no targets patched — "
          "Gemini API may be called live", flush=True)
```

The warning does not need to be fatal (live call will likely produce a 4xx/5xx that fails the gate anyway), but visible output makes debugging faster.

---

## Info

### IN-01: `EDIT_FACTORY_BASE_DIR` environment variable is set but never read by app code

**File:** `scripts/desktop-smoke-test.py:51`
**Issue:** Line 51 sets `os.environ["EDIT_FACTORY_BASE_DIR"]` with the comment "harmless if not." A grep of `app/` confirms no code reads this variable. The line is dead but not harmful.

**Fix:** Either remove it (tightest) or leave the comment — it documents intent if the app ever adds a base-dir override hook. No action required.

---

### IN-02: `profile_id` string `"test-profile-001"` duplicated in `HEADERS` constant and `main()`

**File:** `scripts/desktop-smoke-test.py:68, 421`
**Issue:** The `X-Profile-Id` header value `"test-profile-001"` is written twice: once as the value of the `HEADERS` dict and once as the `profile_id` literal inside `main()`. If the value is ever changed, one site is easy to miss.

**Fix:** Extract to a module-level constant:

```python
_PROFILE_ID = "test-profile-001"
HEADERS = {"X-Profile-Id": _PROFILE_ID}
# in main():
profile_id = _PROFILE_ID
```

---

## xfail Update Verification (test_pipeline_e2e_sqlite.py)

The xfail reason on `test_pipeline_full_flow_produces_mp4` (lines 142-153) correctly:
- Cites "Phase 85 plan 85-01 closes FUNC-02 via `scripts/desktop-smoke-test.py` + `.github/workflows/desktop-smoke.yml`"
- Preserves "Phase 81 B-81-04 escape hatch" wording
- Keeps `strict=False`
- Keeps the original function body unchanged

The update meets the plan's task-6 requirement.

---

_Reviewed: 2026-05-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
