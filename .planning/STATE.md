# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-12)

**Core value:** Script-first video production: describe an idea, get multiple social-media-ready videos with AI-generated voiceover, perfectly synced subtitles, and keyword-matched visuals.
**Current focus:** Phase 15 - Script-to-Video Assembly

## Current Position

Milestone: v4 Script-First Video Production Pipeline
Phase: 15 of 16 (Script-to-Video Assembly)
Plan: 2 of 2 in current phase
Status: Phase 15 complete - All assembly plans executed (backend + frontend)
Last activity: 2026-02-12 — Plan 15-02 complete (frontend assembly UI)

Progress: [███████████████████████████████████████████░░░] 94% (15 of 16 phases complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 47
- Total phases completed: 15
- Total execution time: ~2.7 hours (v2) + ~2 days (v3) + ~32 min (v4)

**By Milestone:**

| Milestone | Phases | Plans | Status |
|-----------|--------|-------|--------|
| v2 Profile System | 6 | 23 | Complete (2026-02-04) |
| v3 Video Quality | 5 | 13 | Complete (2026-02-06) |
| v4 Script-First | 5 | 8 | In progress |

**Recent Trend:**
- v2: 23 plans in 2.7 hours
- v3: 13 plans in 2 days
- v4: 9 plans in 32 min (avg 3.6 min/plan)
- Trend: Consistent velocity, Phase 15 complete

**Recent Plans:**
| Plan | Duration (min) | Tasks | Files |
|------|---------------|-------|-------|
| Phase 13 P02 | 1.0 | 1 tasks | 1 files |
| Phase 14 P01 | 2.9 | 2 tasks | 5 files |
| Phase 14 P02 | 1.9 | 2 tasks | 2 files |
| Phase 15 P01 | 3.6 | 2 tasks | 3 files |
| Phase 15 P02 | 9.2 | 3 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting v4 work:

- **eleven_flash_v2_5 as default model**: 50% cheaper (0.5 credits/char), 32 languages, 75ms latency, 40k char limit
- **TTS timestamps over Whisper for subtitles**: Perfect sync with voiceover, no extra processing step
- **Timestamp persistence strategy**: Store raw timestamp dict from ElevenLabs as JSONB for flexibility in Phase 13
- **Model tracking**: Persist tts_model alongside timestamps to enable cost tracking and debugging
- **Model selector always visible**: Always show TTS model dropdown in render section (not conditional on TTS text) for simpler UX
- **Cost/latency transparency**: Display cost per 1k chars and latency inline in model dropdown for informed user decisions
- **Gemini + Claude Max for script generation**: Two AI providers, user chooses per project
- **Script-first over video-first workflow**: Script drives segment selection and assembly
- [Phase 13]: Manual SRT generation without external library dependency for TTS subtitle generation
- [Phase 14]: Dual-provider AI script generation (Gemini + Claude) with keyword awareness and TTS-safe sanitization
- [Phase 15]: Keyword substring matching with confidence scoring (exact word=1.0, substring=0.7) balances precision and recall
- [Phase 15]: Silence removal applied BEFORE timeline calculation to ensure timeline matches trimmed audio duration
- [Phase 15]: Preview-before-render workflow (preview endpoint avoids expensive render)
- [Phase 15]: Assembly link positioned between Scripts and Segments in navbar for logical workflow progression
- [Phase 15]: Two-column responsive layout matches Scripts page pattern for frontend consistency

### Pending Todos

None.

### Blockers/Concerns

**Database migrations pending:**
- Migration 007 (v3 encoding presets) requires manual application via Supabase SQL Editor
  - Application works without it (falls back to hardcoded EncodingPreset values)
- Migration 009 (v4 TTS timestamps) requires manual application via Supabase SQL Editor
  - Application works without it (timestamps simply won't be persisted)
  - Required for Phase 13 subtitle generation

**Research flags (v3):**
- Scoring weights (40/20/20/15/5) need A/B testing with platform performance data

## Session Continuity

Last session: 2026-02-12
Stopped at: Completed Phase 15 Plan 02 (frontend assembly UI) - Phase 15 complete
Resume file: None

**Next step:** Plan and execute Phase 16 (TTS Segment Library)

---
*Last updated: 2026-02-12 after Phase 15 Plan 02 execution*
