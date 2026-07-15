# BlipStudio web remediation: local boundaries and asynchronous pipeline jobs

Status on 2026-07-15: phases B–D of the BlipStudio remediation are implemented,
committed, and verified locally. No production deploy or database migration was
executed.

## Web-mode filesystem boundary

`GET /api/v1/segments/browse-local` and
`GET /api/v1/segments/find-local` are desktop capabilities. When
`DESKTOP_MODE=false`, both now return `501 Not Implemented` immediately with a
clear desktop-only message. The web UI does not render the local browse/find
controls; Electron keeps the previous behavior.

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

- Backend: 22 focused compatibility and async-job tests passed, including DB
  restore after in-memory eviction, per-variant TTS persistence, duplicate-job
  rejection, and the existing full SQLite pipeline flow.
- Frontend: `tsc --noEmit` passed; focused ESLint reported zero errors and 13
  pre-existing warnings.
- Browser: Playwright MCP showed script progress surviving reload, History
  restoring an active script job, and three TTS variants retaining independent
  progress values across reload.
- Browser/API tests used a dedicated temporary SQLite database. User data and
  production infrastructure were not mutated.

Related deployment constraints remain documented in
[BlipStudio production deployment](21-blipstudio-production-deployment.md).
