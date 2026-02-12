# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-12)

**Core value:** Script-first video production: describe an idea, get multiple social-media-ready videos with AI-generated voiceover, perfectly synced subtitles, and keyword-matched visuals.
**Current focus:** Phase 12 - ElevenLabs TTS Upgrade

## Current Position

Milestone: v4 Script-First Video Production Pipeline
Phase: 12 of 16 (ElevenLabs TTS Upgrade)
Plan: 3 of 3 in current phase
Status: Phase 12 Complete
Last activity: 2026-02-12 — Completed 12-03-PLAN.md (ElevenLabs model selector UI)

Progress: [██████████████████████████████████████░░░░░░░░] 69% (11 of 16 phases complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 41
- Total phases completed: 11
- Total execution time: ~2.7 hours (v2) + ~2 days (v3) + 11.8 min (v4)

**By Milestone:**

| Milestone | Phases | Plans | Status |
|-----------|--------|-------|--------|
| v2 Profile System | 6 | 23 | Complete (2026-02-04) |
| v3 Video Quality | 5 | 13 | Complete (2026-02-06) |
| v4 Script-First | 5 | 3 | In progress |

**Recent Trend:**
- v2: 23 plans in 2.7 hours
- v3: 13 plans in 2 days
- v4: 3 plans in 11.8 min (avg 3.9 min/plan)
- Trend: Stable execution, milestone completed successfully

**Recent Plans:**
| Plan | Duration (min) | Tasks | Files |
|------|---------------|-------|-------|
| Phase 12 P01 | 2.5 | 2 tasks | 1 file |
| Phase 12 P02 | 2.3 | 2 tasks | 2 files |
| Phase 12 P03 | 7 | 2 tasks | 2 files |

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
Stopped at: Completed 12-03-PLAN.md (ElevenLabs model selector UI) - Phase 12 Complete
Resume file: None

**Next step:** Phase 12 complete. Ready for Phase 13 or next milestone phase.

---
*Last updated: 2026-02-12 after completing 12-03-PLAN.md*
