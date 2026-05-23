---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Executing Phase 81
stopped_at: Phase 81 Plan 81-02 SHIPPED — all three Phase 81 grep gates in pipeline_routes.py at exactly 0 (get_client = 0, expanded ride-along = 0, get_supabase import = 0). The three fat units (_save_clip_to_library, sync_pipeline_to_library, get_pipeline_status recovery) migrated as units. Next action: Plan 81-03 (test rewrite).
last_updated: "2026-05-23T12:00:00.000Z"
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 6
  completed_plans: 5
  percent: 83
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-22 with v13 active)

**Core value:** Automated video production from any input — get social-media-ready videos at scale, distributed as a true downloadable desktop product priced for indie creators.
**Current focus:** Phase 81 — pipeline-routes-repository-migration

## Current Position

Phase: 81 (pipeline-routes-repository-migration) — EXECUTING
Plan: 2 of 3 (Plan 81-02 SHIPPED — all 3 grep gates at 0; awaiting Plan 81-03)
Milestone: **v13 Desktop Production-Ready & Monetization** — OPENED 2026-05-22, 1/19 phases complete (Phase 80 verified PASSED on 2026-05-23).
Next action: `/gsd-execute-phase 81` to execute Plan 81-03 (pytest cases + E2E pipeline test scaffold). Mock-chain rewrites needed for: test_pipeline_library_persistence.py, test_pipeline_tts_restore.py, test_pipeline_subtitle_frame_preview.py. Plus one pre-existing signature drift in test_pipeline_preview_route.py.

Sources:

- Vision/scope/architecture: `.planning/v13-desktop-production/{VISION,SCOPE,ARCHITECTURE}.md`
- Requirements: `.planning/milestones/v13-REQUIREMENTS.md`
- Roadmap (phase details + waves): `.planning/milestones/v13-ROADMAP.md`

## Performance Metrics

**Velocity:**

- Total plans completed: 152 (across v2-v12)
- Total phases completed: 79
- Total milestones shipped: 12
- v13 progress: 0/19 phases

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

Last session: 2026-05-23T12:00:00.000Z
Stopped at: Phase 81 Plan 81-02 SHIPPED — all three Phase 81 grep gates in pipeline_routes.py at exactly 0. Three fat units migrated as units; concurrency primitives preserved; W-81-01 signature compliance honored.
Resume file: .planning/phases/81-pipeline-routes-repository-migration/81-02-SUMMARY.md (handoff to Plan 81-03)
Next action: `/gsd-execute-phase 81` to execute Plan 81-03 (pytest cases + E2E pipeline test scaffold; rewrite mock-chain tests for test_pipeline_library_persistence, test_pipeline_tts_restore, test_pipeline_subtitle_frame_preview to mock repo ABC methods directly).

---
*Last updated: 2026-05-23 after Plan 81-02 completion (Task 4 committed in a8742b8; SUMMARY.md created)*
