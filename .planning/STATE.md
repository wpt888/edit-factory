# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.
**Current focus:** v6 Production Hardening — Phase 25 (Rate Limiting & Security)

## Current Position

Milestone: v6 Production Hardening
Phase: 25 of 29 (Rate Limiting & Security)
Plan: 2 of 2 complete
Status: Phase complete
Last activity: 2026-02-22 — Completed 25-02 (SRT Sanitization, Cache-Control Headers, Tenacity Retry) — 2/2 tasks

Progress: [████░░░░░░] 40% (4/10 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 65 (across v2-v6)
- Total phases completed: 24
- Total milestones shipped: 5

**By Milestone:**

| Milestone | Phases | Plans | Status |
|-----------|--------|-------|--------|
| v2 Profile System | 6 (1-6) | 23 | Shipped 2026-02-04 |
| v3 Video Quality | 5 (7-11) | 12 | Shipped 2026-02-06 |
| v4 Script-First | 5 (12-16) | 11 | Shipped 2026-02-12 |
| v5 Product Video | 7 (17-23) | 13 | Shipped 2026-02-21 |
| v6 Hardening | 6 (24-29) | — | In progress |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v6 Roadmap: Phase 24 (backend stability) is prerequisite — phases 25, 26, 28 can run in parallel after it completes
- v6 Roadmap: Phase 27 (frontend refactoring) depends on Phase 26 (resilience patterns in place first)
- 24-01: In-memory dict is primary progress source; Supabase is durability layer — all DB calls try/except so DB outage never blocks generation
- 24-01: 409 Conflict returned at endpoint level (not inside background task) via is_project_locked() non-blocking check
- 24-01: editai_generation_progress uses TEXT PK for project_id to match backend string UUID usage
- 24-02: Created app/api/validators.py as shared module for validate_upload_size() rather than duplicating in each route
- 24-02: generate_audio_trimmed and process_video_with_tts made async to propagate async generate_audio change
- 24-02: json.JSONDecodeError now raises HTTPException 400 at both subtitle_settings parse sites in routes.py
- 25-01: slowapi default_limits=['60/minute'] on Limiter applies globally without per-route decorators; SlowAPIMiddleware added before CORSMiddleware (FastAPI reverse order)
- 25-01: MAX_TTS_CHARS=5000 defined once in validators.py — all route files import rather than redefine; validate_tts_text_length() validates, strips, and returns text for downstream use
- 25-02: sanitize_srt_text placed at module level in srt_validator.py (not in SRTValidator class) so it can be imported without instantiation
- 25-02: ElevenLabs new service uses _call_elevenlabs_api_new module-level helper (tenacity handles 429/500-504); 402 key failover remains in _post_with_failover for future use
- 25-02: Cache-Control: public, max-age=3600 added to all 4 media file/stream endpoints
- 25-02: Gemini retry uses synchronous @retry (Gemini SDK is sync, not async)

### Pending Todos

None.

### Blockers/Concerns

**Database migrations pending:**
- Migration 007 (v3 encoding presets) requires manual application via Supabase SQL Editor
- Migration 009 (v4 TTS timestamps) requires manual application via Supabase SQL Editor
- Migration 017 (editai_generation_progress) requires manual application via Supabase SQL Editor

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 25-02-PLAN.md (SRT Sanitization, Cache-Control, Tenacity Retry)
Resume file: None

---
*Last updated: 2026-02-22 after 25-02 executed*
