# Timeline transitions V1 — dip to black + flash white

Step 3 timeline boundaries can now carry a transition: **Dip to black** or
**Flash white**, with three duration presets (Fast 200ms / Normal 350ms /
Slow 500ms). Everything else remains a hard cut. Spec: `goals/transitions-prompt.md`
+ `goals/transitions-details.md` (the binding brief this was built from).

## Model

- `CompositionClip.transitionIn?: { kind: "dip_black" | "flash_white"; durationMs } | null`
  (`frontend/src/types/composition-timeline.ts`) — the transition INTO the
  clip, i.e. the boundary between it and its predecessor. Absent/null = hard
  cut; first clip ignored. Mirrored as `TimelineEntry.transition_in`
  (`app/services/assembly_service.py`). Additive, no migration — legacy
  compositions parse and render byte-identically.
- Per-variant default: `PreviewData.defaultTransition?`
  (`frontend/src/app/pipeline/pipeline-types.ts`). A boundary without an
  explicit `transitionIn` inherits it; `resolveCompositionTransitions()`
  (`composition-timeline.ts`) expands default → concrete values **client-side**
  before any preview/render request, so the backend never sees indirection.

## Validation (backend)

One shared validator, `normalize_transition_in()` (`assembly_service.py`),
wired at every composition ingress: the save-composition clip loop,
`PipelineRenderRequest.composition_overrides`,
`PreviewRenderRequest.composition_override`, and a last-guard re-validate in
`_timeline_from_composition()`. Unknown kind / non-numeric duration → 422;
out-of-range numeric → clamped to [150, 600]; `transitionIn` on
`kind: "intro"` clips → stripped. FFmpeg filter args are built only from the
validated enum + clamped int — user strings never reach a filtergraph.

## Render (no-overlap family)

Not crossfades: fade-out on the tail of clip N−1 + fade-in on the head of
clip N (durationMs/2 each, `color=black|white`), appended to the existing
`-vf` chain in `extract_segment()`. Timeline duration is therefore unchanged
by construction (ffprobe-verified ±1 frame in
`tests/test_transitions_ffmpeg.py` against real FFmpeg). `resolve_fade_spec()`
derives each segment's `{in?, out?}` fade ingredients from its own and its
successor's `transitionIn`; the same spec feeds `segment_cache.make_key`
**only when present**, so legacy cache keys stay byte-identical and editing a
boundary invalidates exactly the two adjacent segments. Zero-transition
compositions keep the concat `-c copy` fast path (asserted in tests). Guards:
no transitions on intro clips, on boundaries where either side is shorter
than 2×durationMs, or on interstitial-slide boundaries.

## UI + instant preview

- Variant card (Step 3): "Default transition" + "Duration" selects
  (`step3-preview.tsx`), persisted with the composition save.
- Timeline: a dot on each body-clip boundary (z-40, above the z-30 trim
  handle — see fix `a0cfb6f`) opens a popover: Cut / Dip to black / Flash
  white, duration preset, "Use variant default"; the dot's fill shows
  cut / inherited / override state (`BoundaryTransitionMarker`,
  `timeline-editor.tsx`).
- Instant preview: a `z-[5]` overlay div per preview mount, opacity written
  imperatively every rAF from the TTS-audio master clock
  (`timeline-editor.tsx`) — triangular fade around the boundary, correct
  under pause/scrub, no dual video playback (the ping-pong idle slot stays
  paused). Subtitles and attention cues render at higher z and never fade;
  the FFmpeg render keeps them separate by architecture (overlay pass runs
  after concat).

## Verification (2026-07-18)

- Backend: full `pytest tests/` → 711 passed; transitions files 61/61.
- Frontend: `tsc --noEmit` clean; eslint 0 new; `next build` green.
- Real-render proof: 3-clip composition rendered with dip_black /
  flash_white / control — boundary frames solid black / solid white / clean
  cut, all outputs exactly 6.000000s (`screenshots/transitions/ffmpeg_probe/`
  in the delivery worktree).
- Live app (worktree instance :8010/:3010, pipeline "hugo, test", Variant
  2 A): selects + popover present, black overlay at the 6.505s boundary with
  the cyan subtitle unfaded on top, white flash on an overridden boundary,
  no overlay after reverting to None; defaults persist across reload
  (`screenshots/transitions/*.png`).

## Known limits / follow-ups

- Cross dissolve / slide / zoom (`xfade`, overlapping) — deliberately out of
  scope; separate future goal.
- Interstitial-slide boundaries are not configurable in V1.
- Pre-existing flake (not transitions): first `/pipeline?id=…&step=3` load
  sometimes misses `restore-previews`; reload recovers.
- Delivered on branch `worktree-agent-a22083ccab05e3f25` (base `2994250`);
  merge into the mainline once the parallel attention-images work settles.
