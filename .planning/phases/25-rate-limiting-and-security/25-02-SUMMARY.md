---
phase: 25-rate-limiting-and-security
plan: "02"
subsystem: security
tags: [xss-prevention, caching, retry, tenacity, srt, elevenlabs, gemini]
dependency_graph:
  requires: []
  provides:
    - SRT HTML sanitization (sanitize_srt_text utility)
    - Cache-Control headers on all media stream/file endpoints
    - Tenacity retry on ElevenLabs API calls (legacy and new service)
    - Tenacity retry on Gemini API calls
  affects:
    - app/services/srt_validator.py
    - app/api/library_routes.py
    - app/api/segments_routes.py
    - app/services/elevenlabs_tts.py
    - app/services/tts/elevenlabs.py
    - app/services/gemini_analyzer.py
    - requirements.txt
tech_stack:
  added:
    - tenacity>=8.2.0 (retry library with exponential backoff)
  patterns:
    - Module-level @retry decorated async helper for ElevenLabs HTTP calls
    - Class method @retry decorator for Gemini synchronous SDK calls
    - re.sub HTML tag stripping that preserves SRT arrow (--> syntax)
key_files:
  created: []
  modified:
    - app/services/srt_validator.py (added sanitize_srt_text function)
    - app/api/library_routes.py (SRT sanitization import + usage, Cache-Control headers)
    - app/api/segments_routes.py (Cache-Control headers on stream endpoints)
    - app/services/elevenlabs_tts.py (tenacity retry helper + usage in generate_audio)
    - app/services/tts/elevenlabs.py (tenacity retry helper + usage in generate_audio + generate_audio_with_timestamps)
    - app/services/gemini_analyzer.py (tenacity retry on _call_gemini_api method)
    - requirements.txt (tenacity>=8.2.0 added)
decisions:
  - sanitize_srt_text placed at module level in srt_validator.py (not inside SRTValidator class) so it can be imported directly without instantiating the class
  - ElevenLabs new service (tts/elevenlabs.py) uses _call_elevenlabs_api_new module-level helper instead of _post_with_failover for generate_audio/generate_audio_with_timestamps — tenacity retry covers 429/500-504, while 402 key failover remains available via _post_with_failover for future use
  - Cache-Control uses public, max-age=3600 (1 hour) for media files as specified in plan
  - Gemini retry is synchronous @retry (Gemini SDK is sync, not async)
metrics:
  duration_minutes: 18
  tasks_completed: 2
  files_modified: 7
  completed_date: "2026-02-22"
---

# Phase 25 Plan 02: SRT Sanitization, Cache-Control Headers, and Tenacity Retry Summary

**One-liner:** XSS prevention via HTML tag stripping on SRT content, Cache-Control media headers, and tenacity retry on ElevenLabs/Gemini API calls with exponential backoff.

## What Was Built

### Task 1: SRT Content Sanitization and Cache-Control Headers

Added `sanitize_srt_text()` function to `app/services/srt_validator.py` that:
- Strips `<script>...</script>` blocks (including their content) via regex with DOTALL flag
- Strips all remaining HTML tags via `<[^>]+>` pattern
- Preserves SRT structure — timestamps, arrows (`-->`), sequence numbers, blank lines all untouched
- Handles `None`/empty input gracefully

Integrated sanitization in `app/api/library_routes.py` at two points:
1. `update_clip_content` endpoint — sanitizes before writing to Supabase database
2. `_render_final_clip_task` — sanitizes before writing SRT to temp file for FFmpeg

Added `Cache-Control: public, max-age=3600` headers to four file/stream endpoints:
- `serve_file` in library_routes.py (general file serving)
- `download_clip_audio` in library_routes.py (MP3 audio download)
- `stream_source_video` in segments_routes.py (source video streaming)
- `stream_segment` in segments_routes.py (extracted segment streaming)

### Task 2: Tenacity Retry Logic

Added `tenacity>=8.2.0` to `requirements.txt`.

**Legacy ElevenLabs service** (`app/services/elevenlabs_tts.py`):
- Module-level `_call_elevenlabs_api()` async helper decorated with `@retry`
- 3 attempts, exponential backoff min=2s/max=30s
- Retries on: `httpx.ConnectError`, `httpx.ReadTimeout`, `httpx.WriteTimeout`, `httpx.HTTPStatusError`
- Raises `HTTPStatusError` for 429/500/502/503/504 to trigger retry
- Replaces the raw `async with httpx.AsyncClient` block in `generate_audio()`

**New ElevenLabs service** (`app/services/tts/elevenlabs.py`):
- Module-level `_call_elevenlabs_api_new()` async helper with same retry config
- Used in both `generate_audio()` and `generate_audio_with_timestamps()` methods
- Replaces the `async with httpx.AsyncClient + _post_with_failover` pattern

**Gemini analyzer** (`app/services/gemini_analyzer.py`):
- `_call_gemini_api()` instance method with `@retry` decorator on the class
- 3 attempts, exponential backoff min=2s/max=30s
- Synchronous retry (Gemini SDK is sync)
- Replaces direct `self.client.models.generate_content()` call in `analyze_batch()`

## Verification Results

- `sanitize_srt_text('<script>alert(1)</script>Hello')` returns `'Hello'`
- `sanitize_srt_text('1\n00:00:01,000 --> 00:00:02,000\nHello world\n')` preserves arrow
- `sanitize_srt_text('<b>bold</b>')` returns `'bold'`
- `grep Cache-Control`: 4 matches across segments_routes.py + library_routes.py
- `grep @retry`: found in all 3 services
- `tenacity` in requirements.txt: confirmed
- `from app.services.elevenlabs_tts import ElevenLabsTTS`: import OK
- `from app.services.srt_validator import sanitize_srt_text`: import OK

## Deviations from Plan

**1. [Rule 1 - Bug] Fixed indentation after removing async with block in tts/elevenlabs.py**
- **Found during:** Task 2
- **Issue:** When replacing `async with httpx.AsyncClient` block with `_call_elevenlabs_api_new()`, the previously nested code (librosa duration calc, cost calc, cache store, return) remained indented at the wrong level inside the `with open()` file write block
- **Fix:** Re-indented the post-write logic to method body level (8 spaces instead of 16)
- **Files modified:** app/services/tts/elevenlabs.py
- **Commit:** c959081

**2. [Scope note] download_clip_video vs download_clip_audio**
- Plan referenced a `download_clip_video` endpoint at ~line 349 in library_routes.py
- The actual endpoint at that line is `download_clip_audio` (serves MP3 audio files)
- Applied Cache-Control header to that endpoint as intended — the intent was to cache all media file responses

## Self-Check

Files exist:
- app/services/srt_validator.py — FOUND (sanitize_srt_text defined at line 11)
- app/api/library_routes.py — FOUND (sanitize_srt_text imported at line 27, used at lines 1754 and 2185)
- app/api/segments_routes.py — FOUND (Cache-Control at lines 460 and 1080)
- app/services/elevenlabs_tts.py — FOUND (@retry at line 17)
- app/services/tts/elevenlabs.py — FOUND (@retry at line 20)
- app/services/gemini_analyzer.py — FOUND (@retry at line 159)
- requirements.txt — FOUND (tenacity>=8.2.0 at line 72)

Commits:
- 4785001: feat(25-02): SRT sanitization and Cache-Control headers on stream endpoints
- c959081: feat(25-02): Add tenacity retry logic to ElevenLabs and Gemini API calls

## Self-Check: PASSED
