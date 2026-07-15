# BlipStudio web remediation: local boundaries and asynchronous pipeline jobs

Status on 2026-07-15: phases B–D of the BlipStudio remediation are implemented,
committed, and verified locally. No production deploy or database migration was
executed.

## Web-mode filesystem boundary

`GET /api/v1/segments/browse-local` and
`GET /api/v1/segments/find-local` are desktop capabilities. When
`DESKTOP_MODE=false`, both now return `501 Not Implemented` immediately with a
clear desktop-only message. The web UI does not render the local browse/find
controls. (Superseded 2026-07-15 for `browse-local`: it now returns 501 in
every mode — see Post-verification fixes below.)

The follow-up router audit found no additional obvious user-facing server-home
scans in scope. TTS intermediates, pipeline output paths, managed file routes,
and upload destinations are backend-owned storage and remain valid in web mode.

## Pipeline Step 1 contract

The default route through Step 1 is intentionally small:

1. Select footage that contains at least one segment.
2. Enter the Video Idea.
3. Generate scripts.

Script Set Name is optional and is derived from the first seven idea words when
left blank. AI provider, Reference Context, catalog browsing, and script rules
live in an Advanced disclosure that starts collapsed. With zero available
segments the Generate action is disabled and the empty state opens the upload
dialog directly, so the prerequisite is enforced before script generation.

## Asynchronous scripts and TTS

Script generation and per-variant TTS follow the existing render pattern:

- dispatch endpoints return `202 Accepted` with a persisted job immediately;
- FastAPI `BackgroundTasks` performs the work outside the request lifecycle;
- status endpoints expose `queued`, `processing`, `completed`, `failed`, or
  `cancelled`, together with progress, current step, result, and error;
- cancellation endpoints persist the requested state and workers check it at
  safe stage boundaries;
- all TTS variants are dispatched in parallel from the frontend, not from a
  blocking sequential loop;
- one frontend poll updates independent progress bars and only counts variants
  with completed audio as ready.

Job mutation and its focused DB write share the same per-pipeline critical
section. This prevents out-of-order concurrent TTS snapshots from dropping a
variant. Terminal states are authoritative, so a late generation/TTS worker
cannot overwrite a cancellation after returning from a slow provider call.

The pipeline record stores `generation_job` plus the `tts_jobs` map as JSON.
SQLite schema bootstrap and the additive Supabase migration
`054_add_pipeline_async_jobs.sql` define the same contract. The migration file
was reviewed and committed but deliberately not applied during remediation.

## Refresh and history recovery

The page restores active job state from the pipeline API, including after a
browser refresh. Opening an active Pipeline History entry restores the pipeline
ID and resumes polling. A completed script job advances to Step 2; active TTS
jobs restore their own progress and completed results.

This satisfies browser lifecycle recovery, not cross-process execution. The
actual `BackgroundTasks` worker still belongs to one FastAPI process. Do not
scale the backend or treat a process crash as resumable until a shared durable
queue is introduced in a separately approved scope.

## Verification record

- Backend: 30 focused compatibility and async-job tests passed, including DB
  restore after in-memory eviction, race-safe per-variant TTS persistence,
  cancellation precedence, duplicate-job rejection, and the existing full
  SQLite pipeline flow.
- Frontend: `tsc --noEmit` passed; focused ESLint reported zero errors and 13
  pre-existing warnings.
- Browser: Playwright MCP showed script progress surviving reload, History
  restoring an active script job, and three TTS variants retaining independent
  progress values across reload.
- Browser/API tests used a dedicated temporary SQLite database. User data and
  production infrastructure were not mutated.

Related deployment constraints remain documented in
[BlipStudio production deployment](21-blipstudio-production-deployment.md).

## Post-verification fixes (2026-07-15)

An adversarial re-verification of the remediation (commits `4c8b7cc`…`b07d256`)
surfaced six follow-ups. All are fixed and committed locally, unpushed.

- **generate_raw_clips guard test.** `4c8b7cc` also guarded
  `POST /library/projects/{id}/generate` when a bare `video_path` is supplied
  with no upload. That branch resolves `Path(video_path)` against the *server*
  disk in web mode, so the guard is semantically correct. The pre-existing
  `test_generate_raw_clips_returns_non_503` now asserts `501` in web mode and
  runs the non-503 check under desktop mode.
- **browse-local in desktop mode.** The remediation left
  `GET /segments/browse-local` spawning a tkinter subprocess in desktop mode.
  No client calls it — the native picker is the Electron IPC bridge
  (`window.editFactory.selectVideoFiles`, `frontend/src/lib/desktop.ts`), and
  even the former web caller was already removed. The endpoint is now an
  always-`501` stub in both modes and the dead `_PICKER_SCRIPT` is gone, so
  tkinter can never abort the packaged backend (`0xC0000409`).
- **Pipeline state lock key.** `save_matches` resolved its per-pipeline state
  lock with a profile-scoped key (`profile:pipeline`) while every async-job
  mutator and `_evict_stale_pipelines` use the bare pipeline id, so one pipeline
  mapped to two locks. The `profile_id` parameter was removed from
  `_get_pipeline_state_lock`, making the divergence structurally impossible;
  the lock body nests no second acquire, so no deadlock is introduced.
- **Superseded specs.** The desktop-only screenshot scratch
  `verify-local-button.spec.ts` and `segments-local-processing.spec.ts` were
  removed; `segments-source-video-management.spec.ts` carries the same
  polling regression against the new Upload Video flow.
- **CodeGraph state.** `.codegraph/` is now gitignored and its tracked
  `daemon.pid`/`.gitignore` were dropped from the index (pid file never
  committed).

### Migration 054 status — pending, run at deploy

`054_add_pipeline_async_jobs.sql` (additive `generation_job`/`tts_jobs` JSONB
columns, `DEFAULT '{}'`) is still **not applied**. The repository has no
consecrated migration path: there is no `supabase/config.toml`, no migration
runner, and the Supabase REST API cannot execute DDL. Direct `psql` against the
live database (which has desktop users) is out of scope and was not attempted.
The code degrades gracefully without the migration — missing-column errors are
caught and only cross-restart job persistence is unavailable. Apply at deploy
via the Supabase SQL editor (or a linked `supabase db push`), then verify:

```sql
select generation_job, tts_jobs from public.editai_pipelines limit 1;
```

### Full backend suite

`venv/Scripts/python.exe -m pytest` (no coverage): **550 passed, 5 failed,
1 skipped, 18 xfailed** in ~139 s. Frontend `tsc --noEmit` is clean. None of the
five failures come from the remediation or these fixes:

- 3× `test_api_routes.py::TestTTSGenerate` — the TTS endpoint requires
  `provider`/`voice_id`; these tests predate that and send neither (`422`).
- `test_output_naming.py::test_build_output_basename_uses_human_readable_labels`
  — a label-truncation mismatch in an untouched module.
- `test_ml_gating.py::test_generate_from_segments_skips_ml_when_mute_false` —
  `sqlite3 database is locked`; it passes in isolation and is a contention
  artifact of parallel test runs sharing the dev database.

Environment note: the suite cannot complete unless the broken `import magic`
(python-magic hangs in this environment) is neutralized. `validate_file_mime_type`
already degrades gracefully when magic is absent, so the run blocked the import;
this is an environment defect, not a code issue.
