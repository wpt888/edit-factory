# Unified timeline playhead — one cursor per timeline

Date: 2026-07-21 · Branch: `main` (uncommitted)

## Problem

Every consumer of the shared `MultiTrackTimeline` shell drew its own playback
cursors, and `TimelineRuler` drew one more on top:

- **Pipeline Step 3** (`frontend/src/components/timeline-editor.tsx`): one lime
  line injected into every lane's content, plus a rose tick in the ruler — two
  colors, N DOM elements per timeline.
- **Footage & Segments** (`frontend/src/components/video-segment-player.tsx`):
  a white line on the Video lane driven straight to the DOM at 60 fps, plus a
  rose ruler tick driven by React state throttled to ~10 Hz. During playback
  the two visibly diverged — the bug users actually saw as "two cursors". The
  Audio lane had no cursor at all.
- **Attention Templates** (`frontend/src/app/attention-templates/page.tsx`):
  its own rose line per lane, duplicating the rose ruler tick.

Root cause: two sources of truth for the same position (throttled React state
for the ruler vs. rAF-driven DOM writes for the lanes), multiplied by each
consumer re-implementing the cursor.

## Fix

The shell now owns the cursor. `MultiTrackTimeline`
(`frontend/src/components/timeline/multi-track-timeline.tsx`) accepts a
`playhead` prop and renders exactly **one** line
(`data-timeline-lane-playhead`, `bg-primary`) spanning every lane, layered
above lane content (z-30) but under the sticky label gutter (z-40) and ruler
row (z-50) — the opaque sticky ruler clips it naturally on vertical scroll, so
no clipping logic is needed.

```ts
playhead?: {
  style?: CSSProperties;        // static left:% OR CSS-var transform
  lineRef?: Ref<HTMLDivElement>; // imperative 60fps updates (left/display)
  handle?: ReactNode;            // optional grab handle (pointer-events:auto)
}
```

Consumers position it however they already tracked time:

- **timeline-editor**: passes the existing `--timeline-playhead-x` CSS-var
  transform style; deleted its per-lane cursor injection.
- **video-segment-player**: passes `lineRef` (its `updatePlayheadDOM` rAF loop
  keeps writing `style.left`/`display` unchanged) plus the draggable
  "Move playhead" handle button, recolored to `bg-primary`.
- **attention-templates**: passes a static `left: %` style from `previewMs`.

`TimelineRuler` (`timeline-primitives.tsx`) lost its `currentTime` /
`playheadStyle` props and no longer draws a tick — the lane-spanning line is
the single indicator. The shell was the ruler's only consumer, so no other
call sites existed.

## Gotchas

- The overlay container must **not** be unconditionally `aria-hidden`: the
  Segments grab handle lives inside it and `getByRole("button", { name:
  "Move playhead" })` disappears from the accessibility tree (caught by
  `tests/segments-timeline-drag.spec.ts`). It is `aria-hidden` only when no
  handle is passed.
- `tests/pipeline-composition-timeline.spec.ts` had codified the old
  behavior (`count > 1` cursors, all aligned). It now asserts
  `toHaveCount(1)`, guarding against per-lane cursor regressions.
- The green progress sweep in the TTS Library waveform (`audio-waveform.tsx`)
  is a standalone audio player, not a MultiTrackTimeline — intentionally left
  alone.

## Verification

- `npx tsc --noEmit` — clean for all touched files (pre-existing unrelated
  errors in `subtitle-templates/page.tsx` WIP).
- `npx playwright test tests/segments-timeline-drag.spec.ts
  tests/pipeline-composition-timeline.spec.ts` — 2 passed.
- Screenshot of the Attention Templates timeline confirmed a single cursor
  and no ruler tick.

## Future

If a Premiere-style needle head in the ruler is wanted later, add it as a
shell-rendered element driven by the same `playhead.style` — never as a
consumer-drawn or state-driven duplicate.
