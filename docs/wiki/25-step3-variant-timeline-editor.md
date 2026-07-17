# Step 3 "Variant Previews" timeline editor rework

## Scope

The Step 3 "Variant Previews" screen renders one card per variant, each
embedding the shared `TimelineEditor`. This pass fixed a broken Instant
Preview clock, removed a duplicate segment view, switched the Video lane to
per-phrase clips, added a full-screen editor per variant, and corrected the
timeline lane order to match the visual layer stack.

Main implementation files:

- `frontend/src/components/timeline-editor.tsx`
- `frontend/src/app/pipeline/components/step3-preview.tsx`

## Instant Preview clock fix (frozen playhead)

The inline continuous preview stitches source segments together using the TTS
audio element as the master clock; a `requestAnimationFrame` loop reads
`audio.currentTime` to advance the playhead and trigger segment cuts.

Symptom: pressing Play showed the video moving, but the displayed time stayed
at 0:00 and no cut ever happened.

Root cause: `activatePreview` primes a muted, looping `audio.play()`
synchronously from the click gesture (so Chromium keeps the user-activation
for later playback). Chromium flips `audio.paused` to `false` the instant
`play()` is called — even while that promise is still pending or about to
reject. The startup code then hit `if (audio.paused)`, read `false`, skipped
its own authoritative `play()`, and started the rAF loop anyway. When the
primed play was interrupted (by the `currentTime = 0` reset), the audio never
actually advanced, so the loop spun forever against a clock stuck at 0 — no
time update, no segment transition.

Fix: `playAudioAndStartLoop(audio, activationId?)` makes the master clock
authoritative — it calls `play()` unconditionally and starts the rAF loop
only once the promise resolves; on rejection it clears the playing state so
the UI never claims to be playing dead audio. It replaced the
`if (audio.paused)` + unconditional loop pattern in every startup path
(non-intro start, intro clock, intro timeout fallback) and the non-intro
resume in `togglePreviewPlayPause`. The intro branch of the toggle keeps its
own play/loop because it deliberately pauses and holds the audio.

## Single timeline (storyboard strip removed)

Each card previously showed every segment twice: once in a horizontal
storyboard strip and once in the multi-track timeline's Video lane. The strip
was removed; the multi-track timeline is now the sole representation.

Its one unique affordance — inserting an attention image via a "+" — moved to
the Attention images lane header; the new cue can then be dragged along the
lane (the lane already supported drag-to-move and resize). Every other action
the strip offered survives through the Video-lane block selection and the
inline panel: select, swap, assign an unmatched phrase, enter AI generation,
adjust duration, and pin. The stale "insert one with the + buttons in the
strip above" hint was rewritten.

## Per-phrase Video-lane clips (NLE semantics)

Merge groups (phrases sharing one source segment) previously rendered as a
single wide concatenated block. The Video lane now renders one clip block per
phrase using its real SRT boundaries, like a manual edit in a non-linear
editor. `merge_group` is unchanged in the data model; only the visual is
per-phrase.

Adjacent clips of the same merge group get a subtle "linked" affordance:
their touching corners flatten and a shared `chart-2` tint bar sits along the
top (the same color the List view uses to mark merge groups). The pin
indicator, previously only on the removed strip, now renders on each pinned
clip.

## Maximize: full-screen editor per variant

Each card header gained a Maximize control. It opens a near-fullscreen shadcn
`Dialog` (92vh x 96vw) that reuses the same `TimelineEditor` through a new
`displayMode` prop (`"card"` | `"full"`). In `"full"` mode the inline preview
frame is enlarged; everything else is identical, so nothing was re-implemented.
The card and the modal are bound to the same per-variant change handlers, so
edits made in either stay in sync. The card view is unchanged.

## Lane order = visual layer stack

The multi-track lanes rendered Video above Attention images, contradicting the
actual stack. Lanes now render top = topmost visual layer: Subtitles >
Attention images > Video, then the audio lanes (Voiceover, SFX). This matches
the preview z-index (subtitles `z-50` > attention `z-10+zIndex` > video
`z-0/1`) and is applied by sorting the lane list against an explicit
`laneOrder`.

The backend compositor was checked and is already correct: in
`app/services/assembly_service.py`, `assemble_video()` bakes attention
overlays into the assembled clip, then `_render_with_preset()` burns subtitles
on top — final order video < attention < subtitles. No backend change was
needed.

## Commits

- `116cfac` fix(preview): start rAF clock only after audio.play() resolves
- `c082ec5` refactor(timeline): remove duplicate storyboard strip, single timeline
- `bd4fa9b` feat(timeline): render one Video-lane clip per phrase (NLE semantics)
- `9c775bd` fix(timeline): order lanes top=topmost layer (Subtitles > Attention > Video)
- `adb36bf` feat(step3): maximize control opens full-screen editor per variant
- `fbcff77` docs(wiki): Step 3 variant timeline editor rework page + index/log

## Verification

`npx next build` compiles cleanly (all routes, including `/pipeline`);
`tsc --noEmit` and `eslint` report no errors on the touched files (only the
codebase's pre-existing `<img>` and ref-cleanup warnings remain). Browser
verification of the live Step 3 screen was not performed: it requires a
fully-populated pipeline (source videos, generated TTS, preview assembly) that
cannot be driven headlessly here, and the app instance was actively running.
