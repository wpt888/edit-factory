# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.
**Current focus:** Phase 2 - Backend Profile Context

## Current Position

Phase: 2 of 6 (Backend Profile Context)
Plan: 1 of 3 in phase complete
Status: In progress
Last activity: 2026-02-03 — Completed 02-01-PLAN.md (Profile CRUD API)

Progress: [██░░░░░░░░] 20%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 16 min
- Total execution time: 0.53 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-foundation | 1 | 30 min | 30 min |
| 02-backend-profile-context | 1 | 2 min | 2 min |

**Recent Trend:**
- Last 5 plans: 01-01 (30m), 02-01 (2m)
- Trend: Rapid velocity on backend implementation

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

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 2 (Current) considerations:**
- Backend service role assumption: Current FastAPI backend uses service role key (bypasses RLS). Service layer modifications needed to pass profile_id to Supabase queries.
- jobs/api_costs profile tracking: Profile_id on these tables is nullable. Backend must populate profile_id explicitly for new records when profile context is available.
- Background task isolation: Jobs spawned via BackgroundTasks need profile_id preserved in job data JSONB (not just in-memory context).

**Phase 4 considerations:**
- Python version compatibility: If running Python 3.13+, venv downgrade to 3.11 required before Kokoro installation
- Coqui XTTS requires PyTorch (large dependency)
- Kokoro requires espeak-ng system dependency
- Voice cloning workflow needs 6-second sample validation

**Phase 5 considerations:**
- Verify Postiz service supports multiple API configurations (currently uses global singleton)

## Session Continuity

Last session: 2026-02-03 (plan execution)
Stopped at: Completed 02-01-PLAN.md - Profile CRUD API
Next action: Continue Phase 2 execution (02-02-PLAN.md - Library Profile Isolation)
Resume file: None
