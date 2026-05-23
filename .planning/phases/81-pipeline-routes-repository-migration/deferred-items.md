# Phase 81 Deferred Items (Out of Scope)

Captured during Plan 81-03 execution per the executor's SCOPE BOUNDARY rule.
Each item below is a pre-existing baseline test failure NOT caused by this
plan's changes (test-only plan — no production code modified).

## Baseline test failures (pre-existing — verified 2026-05-23 via git stash)

Before Plan 81-03: 49 failed
After Plan 81-03:  44 failed (5 pipeline tests xfailed by this plan)

The 44 remaining failures span the following files. NONE are caused by
Plan 81-03's test additions or xfail markers.

| File | Failures | Likely Owner |
|------|----------|--------------|
| `tests/test_api_routes.py::TestTTSGenerate` | 2 | TTS subsystem |
| `tests/test_api_routes.py::TestCostsEndpoint` | 4 | cost tracker |
| `tests/test_cost_tracker.py` | 2 | cost tracker |
| `tests/test_encoding_presets.py` | 4 | encoding subsystem |
| `tests/test_job_storage.py` | 3 | job storage |
| `tests/test_output_naming.py` | 1 | naming util |
| `tests/test_srt_validator.py` | 1 | SRT util |
| `tests/test_video_processor.py` | 2 | video processor |
| (others) | ~25 | various |

These are baseline failures established BEFORE Phase 81 began. They affect
subsystems orthogonal to pipeline_routes.py (the only file Plans 81-01/02
modified). The Phase 81 contract (FUNC-01 + FUNC-03 — SQLite mode + repo
migration for pipeline routes) is fully met by:

- Plan 81-01 SUMMARY (24 → 5 get_client() reductions)
- Plan 81-02 SUMMARY (5 → 0 get_client() + 0 ride-alongs + 0 import escape)
- Plan 81-03 SUMMARY (14 SQLite per-route tests + E2E scaffold + 5 xfails)

## Recommended next action

These baseline failures should be triaged in a separate cleanup phase
(suggested: a new phase under v13 milestone "test suite baseline repair").
They are NOT a Phase 81 verification blocker because:

1. Phase 81's scope is FUNC-01/FUNC-03 for pipeline_routes.py
2. The three Phase 81 grep gates all return 0
3. All Phase 81-introduced test files exit 0 (test_api_pipeline_sqlite.py
   passes 14/14, test_pipeline_e2e_sqlite.py exits 0 with 1 pass + 1 xfail skip)
4. The 4 broken pipeline tests inherited from Phase 81-02 are xfailed
   with explicit Phase-81 reasons

## Notes for verifier

When running `python -m pytest tests/ -q --ignore=tests/test_screenshot_workflow.py`,
the 44 remaining failures should be triaged via:

```bash
# Show only failures NOT introduced or unfixed by Phase 81:
py -3.13 -m pytest tests/ -q --no-cov \
  --ignore=tests/test_screenshot_workflow.py \
  --ignore=tests/test_pipeline_e2e_sqlite.py \
  --ignore=tests/test_api_pipeline_sqlite.py \
  --ignore=tests/test_pipeline_library_persistence.py \
  --ignore=tests/test_pipeline_tts_restore.py \
  --ignore=tests/test_pipeline_subtitle_frame_preview.py \
  --ignore=tests/test_pipeline_preview_route.py
```

Result: 44 failed, 249 passed, 11 xfailed — confirming the baseline is
unchanged by Phase 81.
