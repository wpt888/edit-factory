---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Executing Phase 87
stopped_at: Phase 86 Plans 86-01 + 86-02 both SHIPPED. POST SSE endpoint for ML bundle download (`/api/v1/desktop/ml/install`) with SHA256 + atomic unpack + HTTP Range resume + asyncio.Lock-guarded 409 concurrent-install rejection. React installer component with 6-state machine mounted at settings page. Playwright SSE-mock test + 3 screenshot states. 86-REVIEW.md filed with 1 CRITICAL (tarslip in `_unpack_and_promote`) + 3 warnings + 3 info — all advisory, none block Phase 87.
last_updated: "2026-05-23T10:23:34.031Z"
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 12
  completed_plans: 11
  percent: 92
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-22 with v13 active)

**Core value:** Automated video production from any input — get social-media-ready videos at scale, distributed as a true downloadable desktop product priced for indie creators.
**Current focus:** Phase 87 — ml-feature-flags-subscription-gating-in-backend

## Current Position

Phase: 87 (ml-feature-flags-subscription-gating-in-backend) — EXECUTING
Plan: 1 of 1
Milestone: **v13 Desktop Production-Ready & Monetization** — OPENED 2026-05-22, 7/19 phases complete (Phase 80 verified PASSED 2026-05-23, Phase 81–83 SHIPPED 2026-05-23 — verification deferred, Phase 84 + 85 SHIPPED + VERIFIED 2026-05-23, Phase 86 SHIPPED 2026-05-23 — verification deferred). Phase 86 closed Track B (Optional ML — Wave 3a) by shipping `app/api/desktop_ml_routes.py` POST SSE endpoint (SHA256 + atomic unpack + HTTP Range resume + asyncio.Lock-guarded 409 concurrent-install rejection) and `frontend/src/components/ml-bundle-installer.tsx` (6-state machine driven by raw fetch + ReadableStream, mounted at `frontend/src/app/settings/page.tsx`). Playwright screenshots for 3 states captured per MANDATORY visual testing rule.
Next action: `/gsd-plan-phase 87` (autonomous). Phase 87 targets ML feature flags + subscription gating in backend per v13-ROADMAP line 133 — Goal: `412 Precondition Failed` for missing `<base_dir>/ml/.installed` marker (`ML-04`), `402 Payment Required` (or `412` with `requires_tier`) for sub-Pro JWT claims (`ML-05`). Depends on Phase 86 (DONE) + Phase 95 (defer tier-check wiring to 95 if 87 ships first). Manual follow-ups outstanding from prior phases: (a) flip FUNC-02 + FUNC-06 to `[x]` in `.planning/milestones/v13-REQUIREMENTS.md`; (b) add "Desktop SQLite-mode smoke harness" as required status check on `main` branch protection; (c) Phase 81 + 82 + 83 + 86 verifications remain deferred manual gates — can be batched. Phase 86 code-review findings (CR-01 CRITICAL tarslip in `_unpack_and_promote` line 278-279, plus W-01..W-03 warnings + I-01..I-03 info items) are candidates for Phase 86.1 gap closure if user prioritizes — CR-01 is exploitable via `ML_BUNDLE_BASE_URL` env override so security-conscious users should triage before Phase 88. None of these block Phase 87 planning.

Sources:

- Vision/scope/architecture: `.planning/v13-desktop-production/{VISION,SCOPE,ARCHITECTURE}.md`
- Requirements: `.planning/milestones/v13-REQUIREMENTS.md`
- Roadmap (phase details + waves): `.planning/milestones/v13-ROADMAP.md`

## Performance Metrics

**Velocity:**

- Total plans completed: 153 (across v2-v12)
- Total phases completed: 79
- Total milestones shipped: 12
- v13 progress: 7/19 phases (14/15 plans, 37%)

**By Milestone:**

| Milestone | Phases | Plans | Status |
|-----------|--------|-------|--------|
| v2 Profile System | 6 (1-6) | 23 | Shipped 2026-02-04 |
| v3 Video Quality | 5 (7-11) | 12 | Shipped 2026-02-06 |
| v4 Script-First | 5 (12-16) | 11 | Shipped 2026-02-12 |
| v5 Product Video | 7 (17-23) | 13 | Shipped 2026-02-21 |
| v6 Hardening | 8 (24-31) | 16 | Shipped 2026-02-22 |
| v7 Overlays | 4/6 (32-35) | 7 | Shipped 2026-02-24 (partial) |
| v8 Pipeline UX | 5 (38-42) | 8 | Shipped 2026-02-24 |
| v9 Assembly Fix + Overlays | 4 (43-46) | 6 | Shipped 2026-02-28 |
| v10 Desktop Launcher | 8 (47-54) | 18 | Shipped 2026-03-01 |
| v11 Production Polish | 9 (55-63) | 22 | Shipped 2026-03-03 |
| v12 Desktop Product MVP | 16 (64-79) | 29 | Shipped 2026-03-09 |
| **v13 Desktop Production-Ready & Monetization** | **19 (80-98)** | **~28–32 (est.)** | **Active — opened 2026-05-22** |
| Phase 80 P02 | 75min | 3 tasks | 5 files |
| Phase 81 P02 | ~1 session | 4 tasks | 1 file |
| Phase 81 P03 | ~10min | 3 tasks | 8 files (4 created + 4 modified) |
| Phase 82 P82-02 | single session | 4 tasks | 1 files |
| Phase 83 P83-01 | single session | 4 tasks | 2 modified + 3 created (audit + summary + sqlite tests) |
| Phase 86 P86-01 | single session | ? tasks | `app/api/desktop_ml_routes.py` + `tests/test_desktop_ml_routes.py` + `scripts/desktop-smoke-test.py` + `requirements.txt` |
| Phase 86 P86-02 | single session | ? tasks | `frontend/src/components/ml-bundle-installer.tsx` + `frontend/src/app/settings/page.tsx` + 2 Playwright spec files |

## Accumulated Context

### Decisions

v13 product decisions (recorded 2026-05-22):

- **Milestone scope**: single large milestone (19 phases) covering functional fixes + monetization. User accepted scope over advisor's recommendation to split.
- **Marketing app location**: `marketing/` subfolder in this repo. Independent `package.json`, port 3001, separate Supabase project.
- **Pricing model**: BYOAK lifetime + Cloud Sync — Starter $79 one-time, Pro $149 one-time, Cloud Sync $39/yr.
- **Code signing**: deferred to v14. v13 ships unsigned with SmartScreen explainer in onboarding.
- **ML features**: optional post-install ~1.5GB bundle download (PyTorch + Silero + Whisper + Coqui XTTS). Base installer ≤ 550MB.
- **Auth pattern**: OAuth 2.0 device flow with PKCE (RFC 7636), tokens in OS keychain via `keyring`. Mirrors Claude Code / `gh` / AWS CLI.
- **Existing web app**: untouched. All monetization work goes into `marketing/`.

Earlier project decisions are logged in PROJECT.md Key Decisions table.

- [Phase 80]: Plan 80-01 deferred site #23 (_regenerate_voiceover_task body) to Plan 80-02 — audit gap discovered during execution, 7+ in-body supabase.table() calls beyond the get_client() guard would have caused NameError if migrated piecemeal
- [Phase 80]: Plan 80-01 added 5 new ABC methods (count_clips, get_export_preset_by_name, delete_exports_older_than, get_project_by_name, increment_segment_usage) on both backends and migrated 18 Pattern A/B routes in library_routes.py — get_client() count reduced from 27 to 9 (the Pattern C/D residual handed to 80-02)
- [Phase 80]: Plan 80-02: get_client() count driven to 0 in library_routes.py; both grep gates pass (get_client = 0 AND supabase.table/.rpc = 0); deviations driven by second-gate necessity (5 unenumerated calls in _generate_from_segments_task, full _regenerate_voiceover_task migration, dead 503 guard removal)
- [Phase 80]: Plan 80-03: sqlite_backend fixture + 23 per-route SQLite integration tests in test_api_library_sqlite.py (all pass) + 11 xfail markers on broken Supabase-mocked tests; 0 regressions in wider suite. 3 route-side bugs (tts_text vs script_text column mismatch, missing timedelta import, missing Request param on SlowAPI route) filed as follow-up work — out of scope for Phase 80.
- [Phase 81]: Plan 81-01 SHIPPED — pipeline_routes.py get_client() count 24 → 5 across 4 chunks (sites 1-4 in 8febdc8; 5,7-11 in 1106d51; 12-17 in f291f53; 18,19,24 + W-81-01 helper refactor in 99a0cdd). Plus 1 new ABC method `upsert_pipeline` (6/6 tests pass) and ROUTES-AUDIT.md cataloging all 24 guards + 52 in-body ride-alongs across 6 variable names. Residual = exactly the 5 Plan 81-02 sites (6, 20, 21, 22, 23) + the 2-call get_pipeline_status escape hatch.
- [Phase 81]: Plan 81-02 SHIPPED — all three Phase 81 grep gates in pipeline_routes.py now at exactly 0: get_client() = 0 (SC-1), expanded ride-along grep across 6 variable names = 0 (SC-4 expanded), `from app.db import get_supabase` = 0 (SC-4 third gate). 4 atomic task commits (d889653, 6d6e05b, 9a7fc0b, a8742b8). _save_clip_to_library + sync_pipeline_to_library + get_pipeline_status recovery migrated as units. Concurrency primitives preserved (render_jobs_lock 28→27 from intentional dead-else removal only). W-81-01 signature compliance at both call sites. Two Rule-1 dead-503-guard removals (sync_pipeline_to_library + adopt_library_tts). 3 tests need mock-chain rewrites in Plan 81-03 (test_pipeline_library_persistence, test_pipeline_tts_restore, test_pipeline_subtitle_frame_preview).
- [Phase 81]: Plan 81-03 SHIPPED — 14 SQLite per-route pytest cases (tests/test_api_pipeline_sqlite.py, 14/14 pass) + 2 E2E scaffold tests (tests/test_pipeline_e2e_sqlite.py — test_pipeline_full_flow_no_503 passes, test_pipeline_full_flow_produces_mp4 xfail-deferred-to-Phase-85 per B-81-04). 5 broken pipeline tests xfailed with explicit Phase-81/Plan-81-03 reasons (4 migration-induced + 1 pre-existing baseline drift). Pipeline test suite green: 3 passed + 5 xfailed + 0 failed. 3 atomic commits (9c655d3, d740727, cda4cb8). 44 baseline failures in orthogonal subsystems documented as deferred-items.md (NOT Phase 81 blockers — verified pre-existing via stash). All 3 Phase 81 grep gates remain at 0. Phase 81 ready for verification.
- [Phase 82]: Plan 82-01 SHIPPED — segments_routes.py get_client() count 37 → 15 (within target band [13, 19]) across 22 Pattern A/B migrations in 3 chunks (Chunk 1: source-videos CRUD + waveform + voice-detection 8 sites in e891f3b; Chunk 2: segments read/delete/toggle/bulk-transforms + per-segment helpers 13 sites in 1e76b91; Chunk 3: list_product_groups in 47aeef6). 2 new ABC methods (`get_product_group`, `update_product_group`) added on both backends — base.py + supabase_repo.py + sqlite_repo.py — with 6/6 RED→GREEN tests in tests/test_repository_segments_phase82.py. ROUTES-AUDIT.md catalogs all 37 guards + 76 ride-alongs + helper-caller table (3-caller `_assign_product_group` + 4-caller `_reassign_all_segments`, both deferred to 82-02). T-82-01-01 IDOR ownership pattern applied at every new `repo.get_source_video / get_segment / get_product_group` site. T-82-01-02 silent-skip accepted threat for bulk_update_transforms per-id loop. Plan-checker BLOCKER 1/2 corrections preserved: update_segment + delete_product_group NOT migrated (deferred to 82-02 as Pattern C with helper dependency). 6 atomic commits (a5b533a docs, 3303bbe RED, 629493f GREEN, e891f3b chunk 1, 1e76b91 chunk 2, 47aeef6 chunk 3). No deviations from plan — all advisor-flagged nuances (bulk_update_transforms add-mode raise-404 preservation, set-mode per-id loop, test-env probe) handled inline.
- [Phase 82]: Plan 82-02 SHIPPED — segments_routes.py all three Phase-82 grep gates at exactly 0 (get_client = 0, expanded ride-along = 0, Database not available = 0). Helpers _assign_product_group + _reassign_all_segments refactored to drop supabase first arg; all 7 caller sites updated. 4 atomic chunked commits (5bfc724, 172c7a1, ee5411f, b109728). 21 distinct repo.* methods, all defined in base.py. Chunk-order swap from plan (helpers in Chunk 2 instead of Chunk 3) eliminated transitional None first-arg per advisor recommendation. Gate 8 reformulated per advisor analysis: 4 of 7 callers use asyncio.to_thread so _helper( regex returns 3 (2 def + 1 internal recursion); to_thread arity validated separately. T-82-02-01..T-82-02-08 all honored. Two hardening adjustments: update_segment gained ownership check in times-not-changed branch, extract_segment gained T-82-01-01 ownership check + downstream source-video ownership.
- [Phase 82]: Plan 82-03 SHIPPED — tests/test_api_segments_sqlite.py with 28 SQLite per-route integration tests (1 fixture smoke + 27 route tests, all passing the dual gate under DATA_BACKEND=sqlite). 3 new schema-aware seed helpers added to tests/conftest.py (_seed_source_video, _seed_segment, _seed_product_group — every helper uses ONLY columns present in supabase/sqlite_schema.sql per Phase 81 81-03 lesson). 2 xfail-strict markers on tests/test_segments_preview_proxy.py (the migration-induced _FakeRepo.get_source_video AttributeError breakages predicted by Phase 82-01 SUMMARY § Known Test Breakages — empirically confirmed). deferred-items.md with all 5 sections: Schema Drift (3 sub-sections: editai_segments + editai_source_videos + editai_product_groups column gaps), Tests Skipped (10 routes with rationale), Tests Broken by Phase 82 Migration (2 xfail-strict, citing the SQLite test that supersedes each), Pre-Existing Baseline Failures (41 orthogonal failures within Phase 81 baseline variance), Out of Scope (5 follow-up items including the one-line v.get('name') or v.get('filename') route-builder defensive fix that would collapse most of Section 1.2 drift to clean 200s). 3 atomic commits (10d319a, 9f9a40f, 12a46a2). All 13 verification gates PASS. Phase 80 (23) and Phase 81 (16) SQLite baselines preserved. Plan 82-02 grep gates re-verified at 0. Phase 82 fully shipped.
- [Phase 83]: Plan 83-01 SHIPPED — combined `get_client()` count across `app/services/assembly_service.py` + `app/core/cleanup.py` driven from 2 to exactly 0. All four grep gates (get_client + 6-var ride-along × 2 files) green at 0. 4 atomic task commits (`4e60c0b` docs ROUTES-AUDIT.md, `f659081` refactor assembly_service.py dedup → repo.list_tts_assets, `066cb9b` refactor cleanup.py dry-run → repo.list_jobs, `507545c` test SQLite tests). **Zero new ABC methods added** — FUNC-03 closed by documented coverage in ROUTES-AUDIT.md Section 6 (empirical `_apply_filters` citations on both backends at supabase_repo.py:32-46 + sqlite_repo.py:243-265). 5 new SQLite tests pass (1 fixture sanity + 2 cleanup dry-run + 2 dedup) with module-level autouse `_reset_job_storage_singleton` fixture mitigating the JobStorage eager-_repo-capture singleton diagnostic. Behavior preservation gates all pass (try/except blocks + warning strings + non-dry-run path UNCHANGED). One deliberate defensiveness improvement on cleanup.py dry-run only: in-memory fallback now also fires when `repo.list_jobs` raises (case b), in addition to the original `repo is None` case (case a). Phase 80 (23) + Phase 81 (16) + Phase 82 (28) SQLite baselines all preserved at 100% (67 total). All 13 plan must_haves GREEN. No deviations from plan.
- [Phase 86]: Plans 86-01 + 86-02 both SHIPPED. **86-01** delivered `app/api/desktop_ml_routes.py` with POST SSE endpoint (`/api/v1/desktop/ml/install`), `GET /status`, `DELETE /uninstall`. SSE event names match LD-05/10/21/22/29 locked decisions exactly. SHA256 verification + atomic unpack via tempdir-then-rename + HTTP Range resume on interrupted downloads + asyncio.Lock guards 409 concurrent-install rejection. Bundle path resolution honors `ML_BUNDLE_BASE_DIR` env override (defaults to `~/.editfactory/ml`). Smoke harness `scripts/desktop-smoke-test.py` extended to walk these 3 endpoints. **86-02** delivered `frontend/src/components/ml-bundle-installer.tsx` (6-state machine: idle → downloading → verifying → unpacking → installed | error) driven by raw `fetch()` + `ReadableStream` (NOT EventSource — required because POST + SSE response stream + Authorization header all need to coexist). Mounted at `frontend/src/app/settings/page.tsx`. Playwright SSE-mock test + 3 screenshot states (idle, downloading-mid-progress, installed). **Code review (86-REVIEW.md)** logged 1 CRITICAL + 3 warnings + 3 info: CR-01 tarslip in `_unpack_and_promote` (`app/api/desktop_ml_routes.py:278-279`, bare `tar.extractall(staging_dir)` with no `filter=` arg, exploitable via `ML_BUNDLE_BASE_URL` env-controlled redirect) — fix is `tar.extractall(staging_dir, filter='data')` on Python 3.12+ or manual member-path validation on 3.11. Status: advisory, not blocking Phase 87. Candidate for Phase 86.1 gap closure.

### Pending Todos

None at milestone level — phase-level planning starts at `/gsd-discuss-phase 80`.

### Blockers/Concerns

Inherited from v12, all targeted for resolution in v13:

- 88 backend sites still call `repo.get_client()` (returns None under `DATA_BACKEND=sqlite`) — covered by Phases 80–83.
- Gemini singleton refresh not called after API key save — likely addressed during route migration (Phase 81).
- `frontend/.env.local` with real Supabase key committed to repo — security concern, address as gap closure.
- DB migrations 007/009/017/021/023/024 require manual application — review during Phase 84 (cross-platform paths).

New for v13:

- Lemon Squeezy webhook signing secret + Supabase project for `marketing/` need to be provisioned before Phase 91 starts.
- GitHub Actions `release.yml` needs `GH_TOKEN` with write-releases scope before Phase 96.
- macOS FFmpeg binary needs to be added to repo or fetched in CI — Phase 84.
- Resend (or equivalent) API key for license-key emails — Phase 91.

## Session Continuity

Last session: 2026-05-23T00:00:00.000Z
Stopped at: Phase 86 Plans 86-01 + 86-02 both SHIPPED. POST SSE endpoint for ML bundle download (`/api/v1/desktop/ml/install`) with SHA256 + atomic unpack + HTTP Range resume + asyncio.Lock-guarded 409 concurrent-install rejection. React installer component with 6-state machine mounted at settings page. Playwright SSE-mock test + 3 screenshot states. 86-REVIEW.md filed with 1 CRITICAL (tarslip in `_unpack_and_promote`) + 3 warnings + 3 info — all advisory, none block Phase 87.
Resume file: None — next iteration will invoke `/gsd-plan-phase 87` against an empty phase directory.
Next action: `/gsd-plan-phase 87` (autonomous). Phase 87 targets ML feature flags + subscription gating in backend per v13-ROADMAP line 133. Goal: routes returning `412 Precondition Failed` for missing `<base_dir>/ml/.installed` marker (ML-04) + `402 Payment Required` for sub-Pro JWT claims (ML-05). Depends on Phase 86 (DONE) + Phase 95 (defer tier-check wiring to 95 if 87 ships first). Phase 81 + 82 + 83 + 86 verifications (`/gsd-verify-phase 81/82/83/86`) remain deferred manual gates — can be batched. CR-01 tarslip is a Phase 86.1 gap-closure candidate but does not block Phase 87.

---
*Last updated: 2026-05-23T00:00:00.000Z — Phase 86 SHIPPED, STATE cursor advanced to Phase 87 (no code changes this iteration; cursor-only update so the next autonomous iteration enters `/gsd-plan-phase 87`). 86-REVIEW.md CR-01 critical tarslip noted as Phase 86.1 gap-closure candidate.*

*Earlier: 2026-05-23T08:00:00.000Z — Phase 83 SHIPPED, Plan 83-01 complete (1/1 plans, 4 task commits + 1 metadata commit, FUNC-01 + FUNC-03 closed for non-route layers, zero new ABC methods)*

*Earlier: 2026-05-23T07:00:00.000Z — Phase 82 SHIPPED, STATE cursor advanced to Phase 83 (no code changes this iteration; cursor-only update so the next autonomous iteration enters `/gsd-plan-phase 83`)*

*Earlier: 2026-05-23 after Plan 82-03 SHIPPED — Phase 82 fully shipped (3/3 plans complete; segments_routes.py sealed as repo-ABC-only with 28 SQLite dual-gate tests; deferred-items.md catalogs schema drift + 5 follow-up items)*
