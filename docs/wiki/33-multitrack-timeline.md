# Multi-track timeline — Phase A: generic tracks + images as clips

Date: 2026-07-19 · Branch: `feat/multitrack-timeline`

## What changed

Pipeline Step 3's timeline editor no longer hardcodes five content-named lanes
("Video", "Attention images", "Subtitles", "Voiceover", "SFX"). Lanes are now
generic, Premiere-style tracks built dynamically:

| Position (top → bottom) | Lane | Notes |
|---|---|---|
| 1 | Subtitles | unchanged, always on top |
| 2… | Vn … V2 | image tracks (attention cues as clips), addable |
| … | V1 | magnetic main-video lane (the composition) |
| … | A1 Voiceover | existing TTS waveform lane, relabeled |
| … | A2 Music | empty stub — wiring lands in a later phase |
| last | SFX | conditional, unchanged |

**Track order = z-order.** The lane stack is built directly in that order (the
old `laneOrder` label sort is gone), and the instant-preview overlay mirrors it:
behind-zone cues render at `zIndex = 10 + (track - 2) * 20 + layer.zIndex`, so a
cue on V3 composites in front of one on V2. Front-zone cues stay pinned above
subtitles at 60+.

## The `track` field on attention cues

Persistence format did NOT change shape — images remain attention cues; they
gained one additive field:

- Frontend: `AttentionCue.track?: number` (`frontend/src/types/attention-timeline.ts`),
  absent = 2 (first image track, V2).
- Backend: `track: int = Field(default=2, ge=2, le=99)` on the Pydantic
  `AttentionCue` in `app/api/pipeline_routes.py`. This MUST exist server-side:
  Pydantic strips unknown fields on PUT, so without it every cross-track drag
  would silently un-persist. `tests/test_attention_cue_track.py` pins the
  round-trip and the default.

## Interactions

- **Vertical cue drag**: the move branch of `beginCueTimingDrag` uses
  `document.elementFromPoint(...).closest("[data-track-index]")` to pick the
  hovered image lane and commits `{startMs, durationMs, track}` through the
  existing debounced attention PUT. Dropping outside any image lane keeps the
  origin track.
- **Left-edge trim**: image clips have a symmetric left handle — new
  `"resize-start"` branch moves `startMs` while pinning the right edge,
  floored at 100ms.
- **Snapping**: cue drags now snap to V1 clip boundaries in addition to
  subtitle boundaries (150ms threshold, Alt bypass, unchanged).
- **Per-lane "+"**: each image lane's insert button creates the cue with that
  lane's track index.
- **Add video track**: button on the topmost image lane; the count is
  **session-only** (`addedVideoTracks` state — not persisted; deriveTracks also
  grows the lane count to fit any cue whose `track` exceeds the current max, so
  reloading a timeline with cues on V4 still shows V4).

## Where the code lives

- `frontend/src/components/timeline/timeline-tracks.ts` — pure `deriveTracks` /
  `cuesOnTrack` (single source of truth for track derivation).
- `frontend/src/components/timeline/lanes/video-lane.tsx` — V1 lane content +
  `BoundaryTransitionMarker` + transition constants (extracted, dumb component).
- `frontend/src/components/timeline/lanes/image-lane.tsx` — one image track's
  cue blocks + both trim handles (dumb component).
- `frontend/src/lib/composition-reflow.ts` — `reflowComposition`,
  `fitCompositionToDuration`, `buildLegacyComposition`,
  `rollCompositionBoundary` (pure, extracted from the editor;
  `rollCompositionBoundary` now takes `availableSegments` explicitly).
- `frontend/src/components/timeline-editor.tsx` — still owns all state; builds
  the lane list dynamically.
- `frontend/src/components/timeline/multi-track-timeline.tsx` — ruler row is
  now sticky (`top-0 z-50`, solid bg); card mode caps the timeline at
  `max-h-[45vh]` with vertical scroll.

## Testids preserved

`composition-clip-*`, `composition-drop-indicator`, `attention-layer-*`,
`data-attention-track`, `data-timeline-block` all survive the extraction —
the pre-existing timeline specs pass unmodified. New: `data-track-index` on
image lanes, `data-cue-id`/`data-cue-track` on cue blocks, covered by
`frontend/tests/timeline-tracks.spec.ts`.

## Phase B/C outlook

- **B**: A2 Music becomes real (BGM asset + ducking — see goals/02), cue clips
  render thumbnails, per-track mute/solo.
- **C**: multiple video clips per image track with overlap rules, dissolve/xfade
  transitions between image clips, persisted track count if users ask for it.
