---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Ready to execute
stopped_at: Plan 82-02 SHIPPED — segments_routes.py all three Phase-82 grep gates at exactly 0; helpers refactored; 4 atomic commits (5bfc724, 172c7a1, ee5411f, b109728). Plan 82-03 next (per-route SQLite tests + deferred-items.md).
last_updated: "2026-05-23T03:00:03.477Z"
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 9
  completed_plans: 8
  percent: 89
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-22 with v13 active)

**Core value:** Automated video production from any input — get social-media-ready videos at scale, distributed as a true downloadable desktop product priced for indie creators.
**Current focus:** Phase 82 — segments-routes-repository-migration

## Current Position

Phase: 82 (segments-routes-repository-migration) — EXECUTING
Plan: 2 of 3
Milestone: **v13 Desktop Production-Ready & Monetization** — OPENED 2026-05-22, 2/19 phases complete (Phase 80 verified PASSED 2026-05-23, Phase 81 SHIPPED 2026-05-23 — verification deferred to next batch). Phase 82 in flight: Plan 82-01 SHIPPED 2026-05-23, Plan 82-02 next.
Next action: `/gsd-execute-phase 82` (resume) to ship Plan 82-02 (Pattern C fat-fn migration: update_segment + delete_product_group + 5 BG/insert paths + create_segment + extract_segment + create/update product groups + reassign + match-srt + assign_segments_to_project + get_project_segments; helper refactors `_assign_product_group` 3-caller + `_reassign_all_segments` 4-caller drop their `supabase` first arg; drives all three grep gates to 0). Plan 82-03 (per-route SQLite tests + deferred-items.md) follows. Phase 81 verification (`/gsd-verify-phase 81`) remains a deferred manual gate.

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
| Phase 81 P03 | ~10min | 3 tasks | 8 files (4 created + 4 modified) |
| Phase 82 P82-02 | single session | 4 tasks | 1 files |

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

Last session: 2026-05-23T03:00:03.472Z
Stopped at: Plan 82-02 SHIPPED — segments_routes.py all three Phase-82 grep gates at exactly 0; helpers refactored; 4 atomic commits (5bfc724, 172c7a1, ee5411f, b109728). Plan 82-03 next (per-route SQLite tests + deferred-items.md).
Resume file: None
Next action: `/gsd-execute-phase 82` (resume) to ship Plan 82-02 (drives all 3 grep gates to 0 in segments_routes.py). Plan 82-03 (per-route SQLite tests + deferred-items.md) follows.

---
*Last updated: 2026-05-23 after Plan 82-01 SHIPPED (segments_routes.py 37 → 15 get_client; 2 new ABC methods on both backends; T-82-01-01 IDOR applied; 6 atomic commits)*
