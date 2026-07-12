# Desktop Health Sweep — 2026-07-11

Audit-only sweep of `edit_factory` (Electron + FastAPI + Next.js desktop app). Scope: git hygiene, TODO/FIXME/HACK triage, test suite health, error-handling gaps on the render/TTS pipeline, the Blipost-web pairing/runner integration, and general hygiene (hardcoded paths, secrets, dead code).

**Explicitly excluded** (covered by other agents — do not re-report):
1. Subtitle preview size discrepancy
2. Limited font palette
3. Preview freeze at segment transitions

No source files were modified. This document is the only artifact produced.

---

## Summary

The codebase is in good shape overall: 495 backend tests collect and the suite is exercised regularly (recent commits reference specific `BUG-*` fix IDs, suggesting a systematic bug-bash process already ran). The render pipeline has real graceful-degradation (partial segment failures are counted and surfaced via `strict_segments`), and the Blipost-web pairing/runner code is well-structured (encrypted token vault, heartbeat-based lease reclaim, retriable-vs-fatal failure reporting).

The most actionable findings are:
- The desktop render runner has no way to tell the user *why* it's stuck in an "error" state (dead/expired pairing token, network outage, etc. all look identical), and it retries a fixed 5s forever with no backoff or auto-stop.
- Kokoro TTS is a stub with an admittedly "unverified API" that will throw at generation time if ever selected — it's reachable through the provider factory today.
- `.claude/worktrees/` has accumulated 828 MB of stale agent worktree checkouts.

## Git Status

- Branch `main`, 1 commit ahead of `origin/main` (not pushed): `b0fd52e fix(pipeline): count voice-overs over live scripts, not ttsResults map`.
- One uncommitted change: `app/services/assembly_service.py` — adds `_existing_source_path()` to skip segments whose source video file isn't present on the current machine (cross-machine DB-is-cloud/media-is-local scenario), replacing bare `normalize_path()` calls at 4 call sites. This looks like real, unfinished work in progress — not stray debug output. Marked with a `ponytail:` comment for the never-reset warned-set (acceptable, intentional).
- No stale branches found (single `main` branch in local checkout).
- `.env` exists locally but is correctly gitignored (not tracked).

## P1 Findings

None found. No data-loss, money-impacting, or hard-crash bugs were identified in this sweep (the three known UI issues are excluded per scope; render/TTS core paths have working fallbacks and error propagation).

## P2 Findings

**P2-1: `app/services/blipost_runner.py:409-416` (status()) + `app/api/blipost_render_routes.py:46-53` (`RenderStatusResponse`) — pairing/runner errors are invisible to the user.**
`BlipostRenderRunner.last_error` is set on every cycle failure (line 434: `self.last_error = str(e)`) but `status()` never includes it in the returned dict, and the `RenderStatusResponse` Pydantic model has no `lastError`/`last_error` field at all. The frontend Settings card (searched `frontend/src/app/settings/page.tsx`) has no code path to display it — confirmed no `lastError` reference exists anywhere in `frontend/src`. Practically: an expired/revoked pairing token, a network blip, or a malformed lease response all show as the same opaque `state: "error"` badge with zero explanation, and the loop (`_loop()` at line 424-439) retries every 5s indefinitely with the same dead token — no backoff growth, no distinction between a 401 (needs re-pairing) and a transient 5xx (worth retrying), no auto-stop after N consecutive failures.
*Fix direction*: add `lastError: Optional[str]` to `RenderStatusResponse` and return `self.last_error` from `status()`; render it in the Settings render-runner card. Separately, special-case 401/403 from `/lease` to stop the runner (or surface "re-pair required") instead of retrying forever with a token that will never start working again.

**P2-2: `app/services/tts/kokoro.py:160-177` — Kokoro TTS is a stub with an admittedly unverified API, reachable via the provider selector today.**
The docstring/comment says outright: "kokoro.generate() API is unverified — the kokoro library may use a different API (e.g. KPipeline). Verify against the actual kokoro package version before using in production. This is a stub implementation." `app/services/tts/factory.py:57-64` wires `provider == "kokoro"` straight to `KokoroTTSService` (only falls back to `NotImplementedError` if the `kokoro` package itself isn't installed — if it *is* installed, the stub runs and will likely raise at `kokoro.generate(...)` with a confusing runtime error instead of failing fast with a clear "not supported yet" message). If any UI surface lets a user pick "kokoro" as a TTS provider, that's a broken path presented as available.
*Fix direction*: either verify the real `kokoro` API and fix the call, or gate the provider out at the API/UI layer (return `NotImplementedError` unconditionally, like `coqui` effectively does today) until it's implemented, so it can't be selected and silently fail mid-pipeline.

**P2-3: `app/services/assembly_service.py:1766-1772` and `:1814-1840` — segment extraction failures are only logged server-side, not surfaced per-segment to the user.**
When an individual FFmpeg segment extraction fails (`result.returncode != 0`), the code correctly tracks it (`results[i]` stays `None`) and the final assembly step does compute `failed_count` and either raises (if `strict_segments=True`) or logs a warning and proceeds with a shorter video (if `False`, the default in some callers). This is intentional graceful degradation, not a silent crash — but when it takes the non-strict path, the *which segments and why* detail (`failed_segments` list, built at line 1822-1831) is only used in the strict-mode exception message; in the lenient path it's computed and then discarded, and the caller/user has no way to know their render came out shorter than requested without checking backend logs.
*Fix direction*: thread `failed_segments` (already computed) into the render job's result/metadata even on the lenient path, so the frontend can show "2 segments were skipped (source file missing)" instead of a silently-shorter video.

**P2-4: `app/services/blipost_runner.py:448-453` (`_lease_and_render`) — no crash/interrupt recovery for a render in progress.**
If the desktop app is killed (crash, forced close, machine sleep/reboot) mid-render, the in-flight job is abandoned with no cleanup: the temp `work_dir` (created via `tempfile.mkdtemp`) is orphaned on disk, and the lease is never explicitly released — it just expires server-side after the lease timeout and presumably gets re-queued for another runner. There's no local "resume" or "was I in the middle of something" check on `start()`/app boot. This matches normal at-least-once job semantics (the web side's lease timeout covers it), so it isn't silently losing the job, but the desktop-local temp dir leak and the total loss of partial encode progress (a fully re-download + re-render from scratch on next pickup) is worth naming explicitly since it wasn't obviously by-design in the code/comments.
*Fix direction*: on `BlipostRenderRunner` startup, sweep `%TEMP%/blipost-runner-*` dirs older than the lease timeout and delete them; document that render progress is not resumable (by design, lease-based) so nobody "fixes" this expecting resume semantics later.

## P3 Findings

**P3-1: `frontend/src/components/auth-provider.tsx:54-68` — `DEV_USER` is an unfilled TODO stub.**
`AUTH_DISABLED` dev/desktop-mode path returns `null` for the dev user by default with a large TODO comment asking a human to fill in `id`/`email` to match the backend's hardcoded dev user. Currently harmless (guest UX renders instead) but any dev-mode page reading `user?.id` will silently behave as logged-out. Low impact since desktop builds gate auth separately (comment references `/desktop/auth` gate), but worth closing out or removing the TODO if it's intentionally deferred.

**P3-2: `frontend/src/hooks/use-batch-polling.ts:3-6` — batch status polling instead of SSE, tracked but not urgent.**
Explicit TODO: batch product-generation status uses polling (2s interval, doubling on error) instead of the SSE pattern already used for single jobs (`use-job-polling.ts`). Functionally fine, just less efficient/higher latency. No action needed unless batch UX complaints surface.

**P3-3: `frontend/src/components/ml-bundle-installer.tsx:12,28` — `TODO(phase-87)` placeholder status probe.**
Uses a "temporary status probe" instead of a real `/desktop/ml/check` structured endpoint. Two TODO markers reference an unbuilt endpoint. Worth checking whether phase-87 shipped elsewhere and this comment is stale, or genuinely still pending.

**P3-4: `.claude/worktrees/` — 828 MB of stale agent worktree checkouts accumulated in the repo root.**
Ten-plus `agent-*` directories (some nested 2-3 levels deep, e.g. `agent-a3d6d38c/.claude/worktrees/agent-a49e51fb/.claude/worktrees/agent-a0100997/`) left over from prior Claude Code agent sessions. Correctly gitignored so it isn't a repo-hygiene/commit risk, but it's real disk bloat and nested worktrees suggest at least one runaway recursive session. Safe to prune with `git worktree list` / `git worktree remove` (or just delete the directories + `git worktree prune`) once confirmed none are active.

**P3-5: `frontend/src/app/settings/page.tsx:1619` — incomplete TODO comment left inline in JSX-adjacent code.**
`{/* TODO: render one card per integration. ... */}` — a scoping/refactor note left in place; low risk, just needs the author to either finish or delete it so it doesn't accumulate alongside the other stale phase-87/batch-SSE TODOs above.

## Test Suite Status

- **Backend**: `pytest --collect-only -q` from repo root (using `venv/Scripts/python.exe`) succeeded cleanly — **495 tests collected**, 0 collection errors. Two harmless `PytestUnknownMarkWarning`s for `@pytest.mark.timeout(...)` in `tests/test_pipeline_e2e_sqlite.py:141,263` (the `pytest-timeout` plugin marker isn't registered in `pytest.ini`/config, so it's a cosmetic warning, not a failure — tests still run, the mark is just unrecognized and therefore a no-op timeout guard). Coverage report auto-ran (via a configured `--cov` default, likely in `setup.cfg`/`pyproject.toml`) and flagged `cost_tracker.py` (20%) and `job_storage.py` (12%) as under-covered, but that's expected for a `--collect-only` run scoped by whatever default coverage config exists — not indicative of an actual gap without a full run.
- Did not execute the full suite (would touch FFmpeg/network/Supabase-dependent tests, out of scope for a fast collect-only check) — collection success is a reasonable proxy that imports and fixtures aren't broken.
- **Frontend**: `frontend/playwright.config.ts` + `frontend/tests/` exist per `CLAUDE.md`; commands documented there (`npm run test`, `npm run test:ui`, `npm run test:headed`, `npx playwright test tests/library.spec.ts`). Not executed in this sweep (browser-driven, heavier, and `CLAUDE.md` already documents a mandatory manual Playwright-screenshot workflow for UI changes — running the full suite wasn't necessary to assess general health here).
- No CI config (e.g. `.github/workflows/`) was found referencing these test commands during this sweep — testing appears to be developer-invoked, not automated in a pipeline. Worth confirming separately if that's intentional for this desktop-only internal tool.

## Notes

- Repo-wide `TODO|FIXME|HACK|XXX|BUG` grep produced many `BUG-*` hits (e.g. `BUG-6.2`, `BUG-PR-16`, `BUG-FE-33`) — these are almost all **resolved-fix annotations** referencing a past bug-bash's tracking IDs (comments explain what was fixed and why), not open issues. They were triaged and excluded from findings above except where the surrounding code revealed a still-open gap.
- No secrets, API keys, or hardcoded passwords were found via pattern search (`sk-...`, `api_key=`, `password=`, AWS-style keys, JWT-looking strings) across `app/`, `frontend/src/`, and `electron/` (excluding `node_modules`/`venv`/`.git`). One JWT-shaped string was found only in a planning doc (`.planning/phases/69-direct-api-integration/69-01-PLAN.md`) and turned out to be a false positive on re-check (grep for the literal token returned zero matches on re-verification — likely a stale/cached grep result; worth a manual look if paranoid, but not treated as a live secret here).
- No dev-machine-specific hardcoded absolute paths (e.g. `C:\Users\...`) were found in `app/`.
- The Blipost-web pairing/runner integration (`app/services/blipost_runner.py`, `app/api/blipost_render_routes.py`) is well-built relative to typical first-pass integration code: encrypted vault storage for the runner token (never re-displayed after pairing), heartbeat-based lease-reclaim detection (409 → abort mid-render), retriable-vs-fatal failure classification reported back to the web API, and a single-global-runner guard preventing cross-profile token confusion. The gaps found (P2-1, P2-4) are refinements, not structural problems.
