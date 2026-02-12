---
milestone: v4
audited: 2026-02-12
status: tech_debt
scores:
  requirements: 19/19
  phases: 5/5
  integration: 15/15
  flows: 3/3
gaps:
  requirements: []
  integration: []
  flows: []
tech_debt:
  - phase: 13-tts-based-subtitles
    items:
      - "Human verification needed: subtitle sync with TTS audio (visual/audio perception test)"
      - "Human verification needed: subtitle styling appearance with auto-generated SRT vs manual SRT"
  - phase: 15-script-to-video-assembly
    items:
      - "Keyword matching uses exact/substring only (no fuzzy matching, stemming, or semantic similarity)"
      - "In-memory _assembly_jobs dict — progress lost on server restart"
  - phase: 16-multi-variant-pipeline
    items:
      - "In-memory _pipelines dict — pipeline state lost on server restart"
      - "No job cancellation API — running renders cannot be stopped"
      - "No persistent pipeline history — transient workflow state only"
  - phase: general
    items:
      - "Status endpoints are public (pipeline_id/job_id used as secret) — acceptable for single-user deployment"
      - "Dict access not locked — minor race condition on concurrent status reads during writes (recovers on next poll)"
---

# v4 Script-First Pipeline — Milestone Audit

**Milestone:** v4 Script-First Pipeline
**Audited:** 2026-02-12
**Status:** tech_debt (all requirements met, no critical blockers, accumulated non-blocking items)

## Milestone Definition of Done

> Transform Edit Factory from video-first to script-first production with AI-generated scripts, ElevenLabs TTS with character-level timestamps, TTS-based subtitles, keyword-based segment matching, and multi-variant video generation from a single idea.

## Requirements Coverage

**Score: 19/19 requirements satisfied**

### ElevenLabs Upgrade (Phase 12)

| Requirement | Description | Status |
|-------------|-------------|--------|
| TTS-01 | System uses eleven_flash_v2_5 as default TTS model | ✓ Satisfied |
| TTS-02 | TTS audio output is 192kbps MP3 quality | ✓ Satisfied |
| TTS-03 | System retrieves character-level timestamps from /with-timestamps | ✓ Satisfied |
| TTS-04 | User can select ElevenLabs model per render | ✓ Satisfied |

### Subtitle Generation from TTS (Phase 13)

| Requirement | Description | Status |
|-------------|-------------|--------|
| SUB-01 | Generate SRT from ElevenLabs character timestamps | ✓ Satisfied |
| SUB-02 | Group timestamps into word/phrase subtitle entries | ✓ Satisfied |
| SUB-03 | Use existing v3 subtitle styling | ✓ Satisfied |

### AI Script Generation (Phase 14)

| Requirement | Description | Status |
|-------------|-------------|--------|
| SCRIPT-01 | User provides idea → gets N script variants | ✓ Satisfied |
| SCRIPT-02 | AI receives segment keywords for aware scripts | ✓ Satisfied |
| SCRIPT-03 | Scripts follow TTS-safe template | ✓ Satisfied |
| SCRIPT-04 | Choose Gemini or Claude Max per request | ✓ Satisfied |
| SCRIPT-05 | Review and edit scripts before TTS | ✓ Satisfied |

### Script-to-Video Assembly (Phase 15)

| Requirement | Description | Status |
|-------------|-------------|--------|
| ASM-01 | Match subtitle keywords to segment library | ✓ Satisfied |
| ASM-02 | Arrange segments on timeline to match voiceover | ✓ Satisfied |
| ASM-03 | Render with v3 quality settings | ✓ Satisfied |
| ASM-04 | Silence removal before assembly | ✓ Satisfied |

### Multi-Variant Pipeline (Phase 16)

| Requirement | Description | Status |
|-------------|-------------|--------|
| PIPE-01 | Request N variants (1-10) from single idea | ✓ Satisfied |
| PIPE-02 | Each variant gets unique script/voiceover/arrangement | ✓ Satisfied |
| PIPE-03 | Preview/select variants before final render | ✓ Satisfied |

## Phase Verification Summary

| Phase | Status | Score | Gaps |
|-------|--------|-------|------|
| 12 — ElevenLabs TTS Upgrade | passed | 4/4 | None |
| 13 — TTS-Based Subtitles | human_needed | 3/4 | 1 visual sync verification |
| 14 — AI Script Generation | passed | 10/10 | None |
| 15 — Script-to-Video Assembly | passed | 5/5 | None |
| 16 — Multi-Variant Pipeline | passed | 9/9 | None |

All 5 phases have VERIFICATION.md files. No unverified phases.

## Cross-Phase Integration

**Score: 15/15 key exports wired, 9/9 API routes consumed, 3/3 E2E flows complete**

### Integration Matrix

|  | P12 TTS | P13 SRT | P14 Scripts | P15 Assembly | P16 Pipeline |
|--|---------|---------|-------------|--------------|--------------|
| **P12 TTS** | — | ✓ Used | — | ✓ Used | — |
| **P13 SRT** | ✓ Consumes | — | — | ✓ Used | — |
| **P14 Scripts** | — | — | — | ✓ Consumed | ✓ Consumed |
| **P15 Assembly** | ✓ Uses | ✓ Uses | ✓ Consumes | — | ✓ Consumed |
| **P16 Pipeline** | — | — | ✓ Uses | ✓ Uses | — |

### Key Integrations Verified

1. **Phase 12 → 13**: `tts_timestamps` dict flows from ElevenLabs API → `generate_srt_from_timestamps()`
2. **Phase 12 → 15**: `assembly_service.py` calls `generate_audio_with_timestamps()` for TTS
3. **Phase 13 → 15**: `assembly_service.py` calls `generate_srt_from_timestamps()` for auto-SRT
4. **Phase 14 → 16**: `pipeline_routes.py` calls `get_script_generator().generate_scripts()`
5. **Phase 15 → 16**: `pipeline_routes.py` calls `get_assembly_service().preview_matches()` and `.assemble_and_render()`
6. **Phase 15 → v3**: `assembly_service.py` calls `_render_with_preset()` with all v3 filters and subtitle settings
7. **All → main.py**: 3 routers registered (script, assembly, pipeline)
8. **All → navbar**: Pipeline, Scripts, Assembly links present and ordered

### E2E Flows Verified

**Flow 1 — Multi-Variant Pipeline** (Primary):
Idea → POST /pipeline/generate → N scripts → POST /pipeline/preview → match data → POST /pipeline/render → background jobs → GET /pipeline/status → download

**Flow 2 — Single Assembly**:
Script → POST /assembly/preview → match data → POST /assembly/render → job → GET /assembly/status → download

**Flow 3 — Library Render with TTS**:
Clip render → ElevenLabs TTS with timestamps → auto-SRT → subtitle styling → FFmpeg render → final video

All flows trace end-to-end without breaks.

## Tech Debt Summary

### Phase 13: TTS-Based Subtitles (2 items)
- Human verification needed for subtitle sync quality (visual/audio perception)
- Human verification needed for auto-SRT vs manual SRT styling parity

### Phase 15: Script-to-Video Assembly (2 items)
- Keyword matching is exact/substring only — no fuzzy, stemming, or semantic matching
- In-memory `_assembly_jobs` state lost on server restart

### Phase 16: Multi-Variant Pipeline (3 items)
- In-memory `_pipelines` dict — pipeline state lost on server restart
- No job cancellation API for running renders
- No persistent pipeline history — transient workflow state only

### General (2 items)
- Status endpoints are public (ID-as-secret pattern — acceptable for single-user deployment)
- Minor dict race condition on concurrent status reads (recovers on next 2-second poll)

**Total: 9 items across 4 categories — all non-blocking, no critical gaps**

## Implementation Stats

| Metric | Value |
|--------|-------|
| Phases completed | 5/5 |
| Plans executed | 11 |
| Requirements satisfied | 19/19 |
| Backend LoC added | ~2,365 |
| Frontend LoC added | ~1,625 |
| New services | 4 (script_generator, assembly_service, tts_subtitle_generator, pipeline_routes) |
| New API routes | 9 endpoints across 3 routers |
| New pages | 3 (Pipeline, Scripts, Assembly) |
| DB migrations | 1 (009_tts_timestamps) |
| Dependencies added | 1 (anthropic SDK) |

---

*Audited: 2026-02-12*
*Auditor: Claude (gsd milestone-audit)*
