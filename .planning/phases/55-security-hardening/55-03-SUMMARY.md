---
phase: 55-security-hardening
plan: "03"
subsystem: subtitle-pipeline
tags: [security, ffmpeg, srt, libass, injection-prevention]
dependency_graph:
  requires: []
  provides: [sanitize_srt_for_ffmpeg, sanitize_srt_full]
  affects: [video_processor, edge_tts_service, assembly_service, tts_subtitle_generator, library_routes, product_generate_routes]
tech_stack:
  added: []
  patterns: [srt-sanitization-at-write-layer, tdd-red-green]
key_files:
  created:
    - tests/test_srt_validator.py (extended with 20 new tests)
  modified:
    - app/services/srt_validator.py
    - app/services/video_processor.py
    - app/services/edge_tts_service.py
    - app/services/assembly_service.py
    - app/services/tts_subtitle_generator.py
    - app/api/library_routes.py
    - app/api/product_generate_routes.py
decisions:
  - "Escape only backslashes and curly braces in SRT file content (apostrophes/colons/brackets are safe inside SRT files — path escaping in video_processor.py handles the FFmpeg filter string)"
  - "Apply sanitize_srt_full (HTML + FFmpeg) at file-write layer, not at generation layer, to catch all code paths"
  - "Use sanitize_srt_for_ffmpeg (not full) in tts_subtitle_generator.py since TTS-generated content contains no HTML"
metrics:
  duration_seconds: 223
  completed_date: "2026-03-02"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 7
---

# Phase 55 Plan 03: FFmpeg Subtitle Content Sanitization Summary

**One-liner:** libass ASS control sequence injection prevention via backslash/curly-brace escaping at all 6 SRT write points.

## What Was Built

Added `sanitize_srt_for_ffmpeg` and `sanitize_srt_full` functions to `app/services/srt_validator.py`, then applied them at every SRT file write point in the codebase. This prevents user-provided script text containing `\N`, `\n`, `\h` (ASS newline/space sequences) or `{\b1}`, `{\i1}` (ASS override tags) from being interpreted as control sequences by FFmpeg's libass subtitle renderer.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Create FFmpeg subtitle content sanitizer (TDD) | 70afaa3 | app/services/srt_validator.py, tests/test_srt_validator.py |
| 2 | Apply sanitization to all SRT write points | e99198d | 6 files across app/services/ and app/api/ |

## Implementation Details

### sanitize_srt_for_ffmpeg

Processes SRT content line-by-line, skipping sequence number lines, timestamp lines (`-->` present), and blank lines. Only text lines are modified:

1. Backslashes `\` → `\\` (prevents `\N`, `\n`, `\h` ASS control sequences)
2. Curly braces `{` → `\{`, `}` → `\}` (prevents `{\b1}`, `{\i1}` ASS override tags)

Apostrophes, colons, and square brackets are **not** escaped — these are safe inside SRT file content. The FFmpeg filter string escaping (for the `-vf subtitles='path'` argument) already exists in `video_processor.py` add_subtitles method.

### sanitize_srt_full

Chains `sanitize_srt_text` (HTML/XSS stripping from Plan 55-01) and `sanitize_srt_for_ffmpeg` (FFmpeg/libass escaping) as a single convenience function.

### SRT Write Points Covered

| File | Write Point | Function Applied |
|------|-------------|-----------------|
| video_processor.py:1929 | variant SRT files | sanitize_srt_full |
| edge_tts_service.py:247 | Edge TTS SRT output | sanitize_srt_full |
| assembly_service.py:1262 | assembly pipeline SRT | sanitize_srt_full |
| tts_subtitle_generator.py:335 | TTS timestamp-generated SRT | sanitize_srt_for_ffmpeg |
| library_routes.py:2312 | user-provided SRT | sanitize_srt_full |
| library_routes.py:2338 | auto-generated SRT | sanitize_srt_full |
| product_generate_routes.py:709 | product video SRT | sanitize_srt_full |

## Test Coverage

20 new pytest tests added to `tests/test_srt_validator.py`:

- Plain text passes through unchanged
- Apostrophes preserved as-is
- Backslashes escaped to `\\`
- Colons preserved as-is
- Curly braces escaped to `\{` and `\}`
- Square brackets preserved as-is
- Mixed special characters handled correctly
- SRT structure (timestamps, indices, blank lines) preserved
- Only text lines are modified
- Empty/None inputs handled gracefully
- `sanitize_srt_full` applies both HTML stripping and FFmpeg escaping

All 29 tests pass (1 pre-existing failure in `test_sanitize_removes_html_tags` unrelated to this plan — `sanitize_srt_text` intentionally preserves `<b>` as a valid SRT formatting tag).

## Decisions Made

1. **Escape only backslashes and curly braces in SRT content**: Apostrophes, colons, and brackets are safe inside the SRT file. The path escaping for the FFmpeg filter string already exists in `video_processor.py`.
2. **Write-layer sanitization**: Applied at every `f.write()` / `.write_text()` call rather than at generation time, ensuring all code paths are covered regardless of how SRT content enters the system.
3. **TTS generator uses sanitize_srt_for_ffmpeg (not full)**: TTS-generated content has no HTML, so HTML stripping step is unnecessary overhead.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: app/services/srt_validator.py
- FOUND: tests/test_srt_validator.py
- FOUND commit 05c788f: test(55-03): add failing tests
- FOUND commit 70afaa3: feat(55-03): add sanitize_srt_for_ffmpeg
- FOUND commit e99198d: feat(55-03): apply sanitization to all SRT write points
