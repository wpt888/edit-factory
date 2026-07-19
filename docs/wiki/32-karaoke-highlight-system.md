# Karaoke highlight system — sweep + per-word background box

**Date:** 2026-07-19 · **Status:** delivered, uncommitted on `main` (repo convention)

## Why

The "Karaoke Highlight" toggle produced no visible effect anywhere. Three independent causes:

1. **Preview dialog (FFmpeg render):** `assemble_and_render_preview` reused the Step-2 SRT unconditionally — that SRT never contains `{\k}` tags, so karaoke silently dropped. It also poisoned the disk SRT cache (tag-less content stored under `karaoke: true` keys).
2. **Every render path:** `sanitize_srt_full()` → `sanitize_srt_for_ffmpeg()` blanket-escaped `{` → `\{`, destroying `{\k}` tags before `subtitles.srt` hit disk. `build_karaoke_ass_file()` then found no tags and fell back to static captions — silently.
3. **Inline Step-3 player:** the client-side subtitle overlay rendered plain text; `karaoke`/`highlightColor` props reached `TimelineEditor` but were never read.

## Fixes (root-cause, shared functions)

- `app/services/srt_validator.py` — `sanitize_srt_for_ffmpeg` now preserves valid ASS override blocks (`{\k50}`, `{\tag...}`) while still escaping stray literal braces. Covers all 7 call sites at once.
- `app/services/assembly_service.py` — preview path mirrors the render path's karaoke guard (regenerate SRT when tags are wanted but missing) and only stores to the SRT cache when tag presence matches the key.
- `app/services/tts_cache.py` — `srt_cache_lookup` treats a `karaoke: true` key returning tag-less content as a miss (self-heals pre-fix poisoned cache entries; next store overwrites the same file).

## New feature — per-word background box ("box" mode, CapCut style)

Settings contract (both apps of the pipeline):

- `SubtitleSettings.karaokeStyle?: "color" | "box"` (default `"color"` = the existing sweep)
- `SubtitleSettings.highlightBgColor?: string` (default `#A3E635`)
- Flat render fields: `karaoke_style`, `highlight_bg_color` (folded into settings + render fingerprints in `pipeline_routes.py`)

**Burned render** (`app/services/video_effects/subtitle_styler.py`): `{\k}` cannot box a word natively and BorderStyle can't switch inline, so box mode emits **per-word Dialogue events on two layers**: Layer 0 = `Box` style (`BorderStyle=3`, `OutlineColour` = box fill, `Outline` = padding) containing only the active word with `{\an5\pos(cx,cy)\1a&HFF&}` (glyph fill hidden, box remains); Layer 1 = full line in the normal style with the active word recolored via `\c`. Word widths measured with Pillow `getlength()` on the resolved font file (Windows font resolver + module calibration factor, default 1.0); word timings parsed back from the persisted SRT's `{\kNN}` durations — zero schema changes. Header uses `WrapStyle: 2` + fixed `PlayResX/Y 1080×1920` (libass rescales for the 540×960 preview). Any resolution/font/timing failure falls back byte-identical to color mode.

**Inline Step-3 player** (`frontend/src/components/timeline-editor.tsx`): overlay extracted into a memoized `PreviewSubtitleOverlayText` with its own rAF reading `audio.currentTime` directly (bypasses the 0.1 s state throttle; no full-editor re-render). Word timing approximated client-side proportional to word length within `[srt_start, srt_end)` (`frontend/src/lib/karaoke-word-timing.ts`) — the burned render keeps exact ElevenLabs timings. Renders both sweep and box modes; strips ASS tags before display.

**Settings UI** (`frontend/src/components/video-processing/subtitle-editor.tsx`): "Highlight Style" selector (Color sweep / Background box) + "Highlight Background" color picker; the animated mock previews both modes.

## Verification

- Backend: `tests/test_karaoke_ass.py` (sanitize preservation, layered box ASS, missing-font fallback) + `tests/test_srt_cache_karaoke.py` — 66 tests green; real FFmpeg burn of a box-mode ASS exits 0 with `ass=` filter + `fontsdir`.
- Frontend: typecheck clean; `frontend/tests/karaoke-word-timing.spec.ts` (5/5) + `frontend/tests/karaoke-inline-preview.spec.ts` — a mocked-pipeline Playwright run that presses Play and asserts the highlighted word advances during real playback. Screenshots: `frontend/screenshots/karaoke-*.png`.

## Gotchas

- Backend restart required; the `:3947` standalone build needs a frontend rebuild.
- PIL/FreeType vs libass/HarfBuzz metrics drift slightly — the box `Outline` padding absorbs it; a module-level width calibration factor exists in `subtitle_styler.py` if boxes ever sit visibly off.
- Rounded box corners are impossible with `BorderStyle=3` (square only); would need `\p` vector drawings — future work if wanted.
