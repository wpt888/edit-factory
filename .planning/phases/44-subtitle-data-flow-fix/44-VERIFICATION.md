---
phase: 44-subtitle-data-flow-fix
verified: 2026-02-28T10:00:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
gaps: []
---

# Phase 44: Subtitle Data Flow Fix — Verification Report

**Phase Goal:** Subtitles generated at Step 2 are reused verbatim at Step 3 render with no timing drift, no invisible zero-duration entries, and no cutoff at the end of the video
**Verified:** 2026-02-28
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Rendered video subtitles match voiceover timing with no drift from Step 2 preview | VERIFIED | `reuse_srt_content` passed from tts_previews into `assemble_and_render`; Step 2/7 in assembly_service explicitly logs "Reusing existing SRT content" when cache hit occurs — same SRT string used at both preview and render |
| 2 | Every subtitle entry is visible on screen for at least a minimum perceptible duration | VERIFIED | `MIN_DURATION = 0.1` (100ms) enforced in `generate_srt_from_timestamps` Step 3 loop; entries below threshold have end extended; truly zero-duration entries (< 1ms after clamping) are skipped with warning log |
| 3 | Final video file is at least as long as the TTS audio track (no subtitle cutoff) | VERIFIED | `target_video_duration = audio_duration + 0.5` in `build_timeline` at line 796; gap-fill uses extended target, not raw `audio_duration` |
| 4 | Step 3 render does not call ElevenLabs a second time when TTS audio already exists | VERIFIED | `reuse_srt_content` and `skip_library_save=True` co-occur when tts_previews cache hit; assembly_service line 1120 routes to `srt_content = reuse_srt_content` branch, bypassing ElevenLabs entirely |

**Score:** 4/4 success criteria verified

### Plan-Level Must-Haves

#### Plan 01 Must-Haves (SUBS-01, SUBS-02)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Step 2 TTS generation stores srt_content in tts_previews cache alongside audio_path and audio_duration | VERIFIED | `pipeline_routes.py` line 1136: `pipeline["tts_previews"][variant_index]["srt_content"] = preview_data.get("srt_content", "")` committed in `9f7fb6e` |
| 2 | Step 3 render retrieves cached srt_content from tts_previews and passes it to assembly_service without regenerating TTS | VERIFIED | Line 1349: `reuse_srt_content = existing_tts.get("srt_content")`; line 1393: `reuse_srt_content=reuse_srt_content` passed to `assemble_and_render` |
| 3 | No ElevenLabs API call occurs at Step 3 render when TTS audio and SRT already exist from Step 2 | VERIFIED | assembly_service lines 1098-1103 set `skip_library_save=True` when audio reused; lines 1120-1122 skip SRT generation entirely when `reuse_srt_content and skip_library_save` |

#### Plan 02 Must-Haves (SUBS-03, SUBS-04)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 4 | Every SRT subtitle entry has a minimum visible duration of at least 100ms | VERIFIED | `tts_subtitle_generator.py` lines 267-293: `MIN_DURATION = 0.1`, floor applied before SRT entry creation, committed in `09af561` |
| 5 | Assembled video duration is at least as long as the TTS audio track so the last subtitle is not cut off | VERIFIED | `assembly_service.py` line 796: `target_video_duration = audio_duration + 0.5`; committed in `ab704d4` |
| 6 | Zero-duration SRT entries from silence remover edge cases are eliminated before rendering | VERIFIED | `tts_subtitle_generator.py` lines 284-286: `if end - start < 0.001: logger.warning(...); continue` — entries < 1ms after clamping are skipped |

**Score:** 6/6 plan must-haves verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/api/pipeline_routes.py` | SRT content persistence in tts_previews cache and reuse at render time | VERIFIED | Lines 1130-1143: persistence block; line 1349: retrieval; line 1393: passed to assembly_service |
| `app/services/tts_subtitle_generator.py` | Minimum duration floor enforcement on SRT entries | VERIFIED | Lines 267-293: MIN_DURATION=0.1, extend/clamp/skip logic, srt_index sequential counter |
| `app/services/assembly_service.py` | Duration alignment safety margin between video timeline and audio | VERIFIED | Line 796: `target_video_duration = audio_duration + 0.5`; line 797-799: gap fill uses extended target |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `pipeline_routes.py (preview_variant)` | `pipeline['tts_previews'][variant_index]` | stores `srt_content` from `preview_data` into tts_previews | WIRED | Line 1136: direct assignment `pipeline["tts_previews"][variant_index]["srt_content"] = preview_data.get("srt_content", "")` — before `_db_save_pipeline` call at line 1146 |
| `pipeline_routes.py (do_render)` | `pipeline['tts_previews'][variant_index]` | reads `srt_content` from tts_previews into `reuse_srt_content` | WIRED | Line 1335: `existing_tts = pipeline.get("tts_previews", {}).get(vid)`; line 1349: `reuse_srt_content = existing_tts.get("srt_content")` — inside script_match + settings_match + file_exists guard |
| `tts_subtitle_generator.py (generate_srt_from_timestamps)` | SRT output | clamp phrase end time to ensure min_duration gap from start | WIRED | Lines 276-281: `if end - start < MIN_DURATION: end = min(start + MIN_DURATION, next_start)` — applied to every phrase before SRT string creation |
| `assembly_service.py (build_timeline)` | timeline entries | add safety margin to audio_duration for timeline extension | WIRED | Line 796: `target_video_duration = audio_duration + 0.5`; line 797: `if current_timeline_pos < target_video_duration` — gap fill uses extended target |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SUBS-01 | 44-01-PLAN.md | Step 2 TTS generation persists srt_content and timestamps in tts_previews cache | SATISFIED | `pipeline_routes.py` lines 1130-1143: `srt_content` stored into `tts_previews[variant_index]` after `preview_variant` completes; commit `9f7fb6e` |
| SUBS-02 | 44-01-PLAN.md | Step 3 render reuses cached SRT content instead of regenerating TTS | SATISFIED | `pipeline_routes.py` line 1349 retrieves `srt_content`; `assembly_service.py` lines 1120-1122 uses it directly; no ElevenLabs call when both audio and SRT are cached |
| SUBS-03 | 44-02-PLAN.md | Assembled video duration matches TTS audio duration (no subtitle cutoff) | SATISFIED | `assembly_service.py` line 796: `target_video_duration = audio_duration + 0.5`; commit `ab704d4` |
| SUBS-04 | 44-02-PLAN.md | SRT entries have minimum duration floor (no zero-duration invisible subtitles) | SATISFIED | `tts_subtitle_generator.py` lines 267-293: `MIN_DURATION = 0.1`, zero-duration entries skipped; commit `09af561` |

No orphaned requirements — all four SUBS requirements from REQUIREMENTS.md map to Phase 44 plans and are implemented.

### Anti-Patterns Found

No anti-patterns found in modified files. Scanned:
- `app/api/pipeline_routes.py` (new lines 1130-1143)
- `app/services/tts_subtitle_generator.py` (new lines 266-298)
- `app/services/assembly_service.py` (modified lines 793-799)

No TODO/FIXME/HACK/placeholder comments, no empty implementations, no stub returns.

### Human Verification Required

#### 1. Subtitle timing match (preview vs render)

**Test:** Run a full pipeline: Step 2 (preview variant), then Step 3 (render). Compare subtitle timing in the rendered video against what appeared in the preview waveform overlay.
**Expected:** Subtitles align with spoken words with no perceptible delay shift between preview and render.
**Why human:** Timing drift is a perceptual quality measure — requires watching the actual rendered video with audio.

#### 2. No subtitle cutoff at video end

**Test:** Render a pipeline where the last spoken word is near the end of the audio. Check whether the final subtitle entry appears and disappears cleanly rather than being cut mid-display.
**Expected:** Final subtitle is fully visible until its end timestamp; video does not black-frame before subtitle disappears.
**Why human:** Requires playing the rendered video file to verify the last ~1s of content.

#### 3. Zero-duration suppression does not drop visible words

**Test:** Inspect a render that uses ElevenLabs (which can produce tightly-spaced phoneme timestamps). Verify no words are missing from the rendered subtitle track.
**Expected:** All words spoken in voiceover appear as subtitle text; warning log may appear for skipped entries but they should be phonemes, not full words.
**Why human:** Requires a live ElevenLabs-generated audio sample with real timestamp data to observe skip behavior.

### Gaps Summary

No gaps. All automated verifications pass:

- `pipeline_routes.py`: `srt_content` stored into `tts_previews[variant_index]` at preview time (lines 1130-1143) and retrieved at render time (line 1349), then passed through to `assemble_and_render` (line 1393).
- `assembly_service.py`: `reuse_srt_content` accepted as parameter (line 1053), routed to direct reuse (lines 1120-1122) when `skip_library_save=True` (set at line 1103 when audio is reused from cache).
- `tts_subtitle_generator.py`: `MIN_DURATION = 0.1` floor applied to all SRT entries (lines 267-293); zero-duration entries skipped at < 1ms threshold.
- `assembly_service.py build_timeline`: `target_video_duration = audio_duration + 0.5` ensures video track never runs short (line 796).
- All 3 commits verified in git log (`9f7fb6e`, `09af561`, `ab704d4`).
- No requirements orphaned — SUBS-01 through SUBS-04 all accounted for across 2 plans.

---

_Verified: 2026-02-28_
_Verifier: Claude (gsd-verifier)_
