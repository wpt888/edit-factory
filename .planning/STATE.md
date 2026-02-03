# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.
**Current focus:** Phase 2 - Backend Profile Context

## Current Position

Phase: 2 of 6 (Backend Profile Context)
Plan: 4 of 5 in phase (partial completion - 02-04 incomplete)
Status: In progress
Last activity: 2026-02-03 — Partially completed 02-04-PLAN.md (API Routes Profile Context)

Progress: [███░░░░░░░] 35%

## Performance Metrics

**Velocity:**
- Total plans completed: 4.5 (4 full, 1 partial)
- Average duration: 9 min
- Total execution time: 0.78 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-foundation | 1 | 30 min | 30 min |
| 02-backend-profile-context | 3.5 | 19 min | 5.4 min |

**Recent Trend:**
- Last 5 plans: 01-01 (30m), 02-01 (2m), 02-02 (3m), 02-05 (7m), 02-04 (7m partial)
- Trend: Consistent rapid velocity on backend tasks; 02-04 incomplete due to scope

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap creation: Six-phase structure following database → backend → frontend → TTS → Postiz → DX dependency chain
- Phase 4 flagged for research: TTS integration has complex installation requirements (Kokoro, Coqui, Piper system dependencies)
- **01-01**: Profile cascade delete - profiles.id → editai_projects.profile_id uses ON DELETE CASCADE (deleting profile deletes all projects)
- **01-01**: jobs and api_costs have nullable profile_id with SET NULL on delete (preserve records even if profile deleted)
- **01-01**: Manual migration application - migrations applied via Supabase Dashboard SQL Editor (not CLI) for control over timing
- **02-01**: Missing X-Profile-Id header auto-selects default profile (no 400 error for convenience)
- **02-01**: Missing default profile returns 503 with actionable message (data inconsistency requires support intervention)
- **02-01**: Profile validation returns 404 for not found, 403 for foreign ownership (standard REST semantics)
- **02-01**: Default profile protection - cannot delete until another is set as default (ensures at least one default always exists)
- **02-02**: profile_id as Optional parameter (None = all profiles) for backward compatibility
- **02-02**: Store profile_id in both table column and JSONB data field for job_storage fallback
- **02-02**: Phase 2 only adds logging to Postiz - full per-profile credentials deferred to Phase 5
- **02-02**: Filter costs by profile_id in details dict for local JSON fallback
- **02-05**: Default profile_id='default' for backward compatibility while preparing for profile context injection
- **02-05**: Cleanup functions scope operations by profile_id (per-profile cleanup) or clean all when None (admin cleanup)
- **02-05**: Legacy flat temp/ files cleaned alongside profile subdirectories for gradual migration
- **02-04**: source_videos table lacks profile_id - routes require auth but don't filter (future migration needed)
- **02-04**: Ownership verification chains - segments via project.profile_id, clips via clip→project→profile_id join
- **02-04**: Background tasks accept profile_id as explicit parameter for logging and persistence

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 2 (Current) considerations:**
- ~~Backend service role assumption: Current FastAPI backend uses service role key (bypasses RLS). Service layer modifications needed to pass profile_id to Supabase queries.~~ RESOLVED in 02-02
- ~~jobs/api_costs profile tracking: Profile_id on these tables is nullable. Backend must populate profile_id explicitly for new records when profile context is available.~~ RESOLVED in 02-02
- ~~Background task isolation: Jobs spawned via BackgroundTasks need profile_id preserved in job data JSONB (not just in-memory context).~~ RESOLVED in 02-02 (profile_id stored in JSONB)
- ~~FFmpeg temp directory isolation: Multiple profiles processing video concurrently can have file name collisions in shared temp/ directory.~~ RESOLVED in 02-05 (profile-scoped subdirectories)
- **CRITICAL**: routes.py incomplete - 20 routes and 5 background tasks still need profile context (Plan 02-06 required before Phase 3)
  - Missing routes: detect-voice, mute-voice, analyze, video-info, multi-video, tts/add-to-videos
  - Missing background task updates: process_job, process_voice_mute_job, process_multi_video_job, process_tts_job, process_tts_generate_job
  - Missing service calls: JobStorage.create_job, JobStorage.update_job, CostTracker logging throughout

**Phase 4 considerations:**
- Python version compatibility: If running Python 3.13+, venv downgrade to 3.11 required before Kokoro installation
- Coqui XTTS requires PyTorch (large dependency)
- Kokoro requires espeak-ng system dependency
- Voice cloning workflow needs 6-second sample validation

**Phase 5 considerations:**
- Verify Postiz service supports multiple API configurations (currently uses global singleton)

## Session Continuity

Last session: 2026-02-03 (plan execution)
Stopped at: Partially completed 02-04-PLAN.md - API Routes Profile Context (65% complete)
Next action: Create and execute 02-06-PLAN.md to complete routes.py profile context integration
Resume file: None

**Immediate next steps:**
1. Create `.planning/phases/02-backend-profile-context/02-06-PLAN.md` for routes.py completion
2. Execute 02-06 to add profile context to remaining 20 routes
3. Update all 5 background task signatures with profile_id parameter
4. Update all JobStorage and CostTracker calls with profile_id
