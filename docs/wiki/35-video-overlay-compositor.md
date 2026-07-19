# Video-on-video overlay compositor — Phase C

Date: 2026-07-19 · Branch: `feat/multitrack-timeline`

## What changed

The composition (`video_timeline`) can now place **VIDEO** clips on tracks
`>= 2`: free-positioned overlays (picture-in-picture / B-roll) composited over
the sequential V1 base. Track order is z-order — a higher track sits in front.
This is the backend path + validation + tests; the timeline UI lands separately.

Image clips are unchanged — they stay attention cues (Phase A model), not
composition clips. Phase C's scope is **video overlay clips only**.

## Composition-clip shape (what the frontend sends)

A clip in `video_timeline` gains two optional fields:

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `track` | int | `1` (absent) | `1` = magnetic V1 base. `2..4` = free video overlay lane. Out of range → 422. |
| `overlay_box` | object | full-frame | Fractional box for track `>= 2`: `{x, y, width, height, fit}`, all `0..1`; `fit` ∈ `contain\|cover`. Absent → `{0,0,1,1,"contain"}`. |

Rules enforced at `save_composition` (422 on violation):

- `track` is an int in `1..4`.
- **Magnetic** clips (track 1/absent) behave **bit-for-bit as before**: reflowed
  by cursor, may carry `transitionIn`, may be `kind:"intro"`, count toward
  `intro_offset_sec`.
- **Free** clips (track `>= 2`): `timeline_start` is honored as an **absolute**
  position (validated `finite, >= 0`), excluded from the cursor reflow and from
  `intro_offset_sec`; `kind` is forced to `body`; `transitionIn` is stripped;
  `overlay_box` bounds are validated (mirrors the AttentionLayer box rule).
- No two free clips on the **same track** may overlap in time (different tracks
  may overlap — that is the point of stacking lanes).
- At most **50** free clips; at most **4** tracks.

The render/preview request path (`composition_override(s)`) carries these fields
verbatim; `_validate_composition_transitions` skips (strips) `transitionIn` on
track `>= 2`. The preview cache fingerprint already includes the composition
verbatim, so the new fields invalidate it automatically — nothing added there.

## Assembly path

`assemble_and_render` splits the composition:

- base clips (track 1/absent) → `_timeline_from_composition` → the sequential
  `TimelineEntry` list, exactly as before;
- overlay clips (track `>= 2`) → `_build_video_overlay_clips` → specs
  `{entry, box (fractional), fit, z}`, where `entry.timeline_start` is the
  absolute position and `z = track*1000 + index` (so a V3 video sits above a V2
  video/image).

Segment resolution + source-window clamping is factored into
`_build_segment_resolver` + `_resolve_and_clamp_clip`, shared by both paths (no
duplicate validation).

Overlays are **extracted with the existing per-segment machinery** — the
extraction body is factored into `_extract_entry(entry, out_file, fade_spec,
tag)`, reused by both the base timeline (per-slot fades) and overlays
(`fade_spec=None`). Overlays get transforms-v2 + segment-cache reuse for free,
into full-frame trimmed intermediates. They are **excluded** from xfade planning
and from the concat list.

The behind-zone step is now **one combined** `apply_overlay_timeline` pass:
behind-zone attention image items + video overlay items, z-sorted (attention
items keep their existing collection-order z, all `< 1000`; videos are `>= 2000`).
Front-zone attention cues remain a post-encode pass, unchanged. The split is
wired into both `assemble_and_render` and `assemble_and_render_preview` (which
delegates), so the 540x960 preview works — fractional boxes → px against the
render target dims make this free.

## Filtergraph (`apply_overlay_timeline`)

Items sorted ascending by z; input 0 is the base, each item is one input
(image = `-loop 1 -i`, video = plain `-i`). Per item:

```
[k:v]scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:...:color=black@0,   # contain
     format=rgba,setpts=PTS-STARTPTS+<start>/TB[ovk];
[prev][ovk]overlay=x:y:enable='between(t,start,end)':eof_action=pass[vovk]
```

`cover` uses `...:increase,crop=W:H` instead. Image items append an alpha
`fade` (unchanged from the old attention path); video items never fade. The
chain ends with `trim=duration=<total>,setpts=PTS-STARTPTS[vout]` so looped
stills can never extend the edit. Highest z is overlaid last = in front.

## Limits

- Max **4** tracks, max **50** free clips per variant (save-time 422).
- Free overlays cannot overlap on the same track.
- Video overlays never carry a transition (that is a V1-base affordance).
- Overlay audio is dropped (video extraction is always `-an`); only the V1 base
  audio + voiceover + music reach the mix.
- Preview parity: identical split and filtergraph at 540x960; boxes are
  fractional so px scale with the target.

## Tests

`tests/test_video_overlay_ffmpeg.py`. Unit tests always run (z ordering, setpts
+ enable strings, box px at 1080x1920 and 540x960, fit contain/cover, the
magnetic/free split, and every 422 path). Real-ffmpeg smoke (skipped without
ffmpeg): duration invariant (drift `0.0s`) with an in-window pixel-mean diff of
`~51` and an out-of-window diff of `~0.006`; xfade-on-V1 coexists with a video
overlay without error.

## Operational note

The backend must be **restarted** to pick up the new validation, the assembly
split, and `apply_overlay_timeline` (dev backend is not auto-reloading).

## Frontend (timeline editor)

The multi-track timeline (`timeline-editor.tsx`) now edits overlay clips end to
end. Model: `CompositionClip` gains optional `track` + `overlay_box`
(`composition-timeline.ts`), and `reflowComposition`/`fitCompositionToDuration`
(`composition-reflow.ts`) reflow **only** magnetic clips (track absent/1),
passing overlays through with their absolute `timeline_start`.

The editor splits `video_timeline` into two derivations: a magnetic sequence
(`composition`, what every existing V1 handler indexes) and `overlayClips`
(track >= 2, never reflowed). The persist path re-joins them; `fit` self-separates
so overlays always survive a save/undo round-trip.

### Interactions

- **Render** — overlay video clips render on the V2..Vn lanes (`overlay-lane.tsx`,
  `overlay-clip-{id}`) as sky/cyan blocks with the segment thumbnail, alongside
  the image cues on the same lane. V1 stays lime.
- **Drag** — free pointer-drag (not V1's HTML5 drag): move horizontally + change
  track by dragging vertically onto another image lane; edge handles trim in/out.
  Snaps to subtitle boundaries + V1 cuts (Alt disables); clamps into the gap
  around siblings so same-track overlays never overlap; min duration 0.05s.
- **Inspector** — selecting an overlay opens `overlay-clip-inspector`: track
  selector (V2..V4), placement presets (full-frame / four 40% corners /
  center 50%) + x/y/width/height numeric fields, contain/cover toggle, the shared
  transform panel, and remove.

### Conversions (Premiere-style, both via the persist path — save/undo free)

- **V1 → V2+**: drag a V1 clip block (HTML5 drag) onto a V2+ lane. It keeps its
  current `timeline_start` as absolute, gains `track` + a full-frame contain
  `overlay_box`, is forced `kind:"body"` with `transitionIn` stripped; V1 reflows
  closed. The image lane's `onDrop` reads `compositionDragId`.
- **V2+ → V1**: drag an overlay onto the V1 lane. Detected via
  `elementFromPoint` on the `data-magnetic-lane` marker; the existing insertion
  indicator (`composition-drop-indicator`) previews the boundary, and the drop
  strips `track`/`overlay_box` and splices the clip into the magnetic sequence.

Unification choice: V1 blocks keep native HTML5 drag; overlay blocks use pointer
drag. Each drag system owns its own cross-lane target (V1's HTML5 `onDrop` on the
image lanes; the overlay pointer handler detects the V1 lane by attribute). No
shared drag layer was needed.

### Preview approach

**Fallback shipped**, not live video. The program monitor is a delicate V1-only
double-buffer engine; syncing extra seeked `<video>` elements into it risked
destabilizing playback. Instead `renderOverlayClipBoxes` draws a positioned box
per overlay — a poster thumbnail when the playhead is inside the clip's window,
a dashed outline when the clip is merely selected — placed by `overlay_box` and
z-ordered by track. Full-fidelity motion comes from the server-rendered preview.

### Constraints the UI pre-enforces (to avoid 422s)

Overlay tracks 2..4 only; ≤50 free clips (convert is blocked past the cap); no
same-track time overlap (drag clamps); box fields kept in `[0,1]` with
width/height ≥ 0.01; overlays always `kind:"body"` with no transition.

### Tests

`frontend/tests/timeline-video-overlay.spec.ts` (route-mock): overlay renders on
V2 and not in V1; V1→V2 PUT carries `track` + `overlay_box` while V1 reflows;
V2→V1 PUT drops `track`/`overlay_box` and splices into the sequence; same-track
overlap is clamped.
