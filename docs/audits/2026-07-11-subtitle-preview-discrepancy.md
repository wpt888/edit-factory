# Subtitle Preview Discrepancy Audit

Date: 2026-07-11
Scope: `C:\obSID SRL\n8n\edit_factory` (Blipost desktop — Electron + FastAPI + Next.js)
Status: Investigation only. No code changed by this audit.

## Problem

The Blipost desktop pipeline (Step 3) has three places where the same numeric
`SubtitleSettings` (font size in px, outline width in px, Y position %, font
family, text/outline color) get turned into on-screen pixels:

1. The Subtitle Style editor's **"Live Preview" / "Accurate preview"** panel
   (a small preview card, e.g. Font Size 108px, Outline 9px, Y 55%, Montserrat,
   white text, red outline).
2. The per-**Variant Timeline preview player** embedded in each Variant card
   in Step 3 (a small "compact" 9:16 box, expandable to a larger dialog).
3. The **final FFmpeg render** that burns subtitles into the exported MP4.

Users report that for the *same* settings object, path 2 (Variant Timeline
preview) renders subtitle text that looks enormous — fills the width, wraps
to two lines, outline dominates the glyph — while path 1 (Style editor's
preview) shows small, correctly-proportioned text for the same numbers. The
user's summary: "what the live preview shows has absolutely no connection to
what the variant preview shows."

## Render paths

### Path A — Subtitle Style editor "Live Preview" / "Accurate preview"

File: `frontend/src/components/video-processing/subtitle-editor.tsx`

This component has **two** rendering modes layered on top of each other:

- A real FFmpeg-rendered JPEG frame, fetched from the backend
  (`/pipeline/subtitle-frame-preview/{pipeline_id}/{variant_index}`), shown
  whenever it has loaded. This is pixel-ground-truth — see Path C.
- A local CSS overlay (`renderLocalSubtitleOverlay`) shown only as a
  transient fallback before the FFmpeg image has loaded, or while the user is
  dragging a slider (debounced 50ms before the next FFmpeg frame is fetched).

CSS overlay scaling — `frontend/src/components/video-processing/subtitle-editor.tsx:47,301-361`:

```tsx
const ASS_REFERENCE_HEIGHT = 1920;
...
const previewDimensions = useMemo(() => {
  const safeWidth = videoInfo.width || 1080;
  const safeHeight = videoInfo.height || 1920;
  const aspectRatio = safeWidth / safeHeight;
  if (videoInfo.is_vertical) {
    return { width: previewHeight * aspectRatio, height: previewHeight };
  }
  return { width: previewHeight, height: previewHeight / aspectRatio };
}, [videoInfo, previewHeight]);

const renderLocalSubtitleOverlay = (dimensions: { height: number }, className = "") => {
  const scale = dimensions.height / ASS_REFERENCE_HEIGHT;
  const fontSize = Math.max(8, settings.fontSize * scale);
  const outlineWidth = Math.max(0, settings.outlineWidth * scale);
  ...
};
```

`previewHeight` is passed in as a prop (`320` from the pipeline page's
Subtitle Style card — see `frontend/src/app/pipeline/components/subtitle-style-preview-panel.tsx:87`).
So `dimensions.height` is a **known, deterministic React prop**, not a DOM
measurement — `scale = 320 / 1920 ≈ 0.167`. At fontSize 108px this yields a
CSS `font-size` of ~18px, which is proportionally correct for a 320px-tall
9:16 box representing a 1920px-tall video.

Formula: `renderedPx = settingPx * (previewHeightProp / 1920)`, where
`previewHeightProp` is a fixed, caller-supplied constant.

### Path B — per-Variant Timeline preview player

File: `frontend/src/components/timeline-editor.tsx`

This is the component embedded in each Variant card in Step 3
(`frontend/src/app/pipeline/components/step3-preview.tsx:774`, `<TimelineEditor ... subtitleSettings={getPreviewSubtitleSettingsFor(card)} />`).
It is **not** the same component as `variant-preview-player.tsx` (that one is
a separate FFmpeg-video-in-a-dialog player, described below for completeness
— it plays a real backend-rendered MP4 and has no CSS overlay of its own, so
it is not part of the size-mismatch bug).

`TimelineEditor` renders two silent, muted `<video>` elements (segment clips,
ping-pong buffered) with a **CSS-only** subtitle overlay on top — there is no
FFmpeg-image fallback/upgrade path here, unlike Path A. The overlay is always
CSS, always.

Container sizing — `frontend/src/components/timeline-editor.tsx:44-54`:

```tsx
const compactPreviewFrameStyle: React.CSSProperties = {
  aspectRatio: "9 / 16",
  width: "min(180px, 100%)",
  maxWidth: "100%",
};

const expandedPreviewFrameStyle: React.CSSProperties = {
  aspectRatio: "9 / 16",
  width: "min(421.875px, 100%)",
  maxWidth: "100%",
};
```

Font scaling (compact view) — `frontend/src/components/timeline-editor.tsx:1332-1339`:

```tsx
{matches[previewActiveIndex]?.srt_text && (() => {
  // Use same proportional scaling as subtitle-editor.tsx
  // ASS PlayRes reference height = 1920; scale to actual preview container height
  const ASS_REF_HEIGHT = 1920;
  const containerH = previewContainerRef.current?.clientHeight ?? 320;
  const scale = containerH / ASS_REF_HEIGHT;
  const fontSize = Math.max(8, (subtitleSettings?.fontSize ?? 48) * scale);
  const outlineW = (subtitleSettings?.outlineWidth ?? 3) * scale;
  ...
```

Expanded view is the same formula with `?? 720` as the fallback
(`frontend/src/components/timeline-editor.tsx:1500-1505`).

The formula itself (`fontSize * containerH / 1920`) is *identical in intent*
to Path A's formula. The critical difference is **where the height number
comes from**:

- Path A: a constant React prop (`previewHeight={320}`), known and correct
  at every render, no DOM read required.
- Path B: `previewContainerRef.current?.clientHeight`, a live DOM
  measurement read synchronously **inside the JSX-building function during
  render** (not inside a `useLayoutEffect`/`ResizeObserver` callback). On
  first render after mount, refs are not yet attached (`previewContainerRef.current`
  is `null` until after commit), so this always falls back to the hardcoded
  default (`320` compact / `720` expanded) for at least one render pass. React
  does not automatically re-render just because a ref's `.current` becomes
  non-null — a genuine re-measurement only happens if something else
  (`previewActiveIndex` changing during playback, buffering state, etc.)
  happens to trigger a subsequent render. There is no `ResizeObserver`
  anywhere in this file, so the box is never re-measured after a container
  resize (sidebar collapse/expand, window resize, responsive grid reflow —
  the `min(180px, 100%)` clause means the *actual* pixel width, and therefore
  height via `aspect-ratio`, can legitimately change at runtime without the
  overlay ever re-scaling to match).

Also note `frontend/src/components/timeline-editor.tsx:44-54` clamps compact
width to `180px` and expanded to `421.875px` — these are hard 9:16-derived
maxima chosen independently of the actual card/dialog width elsewhere in the
page, so even when the ref read is accurate, the box the subtitle is scaled
against is not obviously tied to what a user perceives as "the preview."

Formula (compact): `renderedPx = settingPx * (previewContainerRef.current?.clientHeight ?? 320) / 1920`
— correct in principle, but the numerator is a possibly-stale/possibly-null
DOM read instead of a known constant, and there is no invalidation path when
the container's real size changes.

### Path B2 — `VariantPreviewPlayer` (separate component, FFmpeg video, no independent scaling bug)

File: `frontend/src/components/variant-preview-player.tsx`

This is a `<Dialog>` that plays a real, backend-rendered MP4
(`GET /pipeline/preview-video/{pipeline_id}/{variant_index}`), produced by
`POST /pipeline/render-preview/{pipeline_id}/{variant_index}`
(`frontend/src/components/variant-preview-player.tsx:133-189`, backend at
`app/api/pipeline_routes.py:5738`). There is no CSS subtitle overlay in this
component at all (`frontend/src/components/variant-preview-player.tsx:389-401`)
— the subtitles are already burned into the video pixels by FFmpeg before
the browser ever sees it, so this path is governed entirely by Path C's math,
not by any frontend scaling formula. It is included here for completeness
because the user's "Variant" card language could refer to either this dialog
or the inline `TimelineEditor` above; the actual CSS-vs-CSS discrepancy the
user is describing is between Path A and Path B (`timeline-editor.tsx`).

### Path C — final FFmpeg render / preview-render subtitle burn-in (ground truth)

Two backend code paths exist that can burn in ASS/SRT subtitles. Only one of
them is actually wired into the live render/preview flow used by paths A and
B2 above.

**C1 — `subtitle_styler.build_subtitle_filter` (the one actually used).**

File: `app/services/video_effects/subtitle_styler.py:338-439`

```python
filter_str = (
    f"subtitles='{srt_path_escaped}'"
    f":original_size={video_width}x{video_height}"
    f":force_style='{force_style}'"
)
```

`force_style` includes `FontSize={self.font_size}` verbatim
(`app/services/video_effects/subtitle_styler.py:90`, no scaling applied to
the number itself) plus `PlayResX`/`PlayResY` (`subtitle_styler.py:87-88`),
but the comment at `subtitle_styler.py:424-431` explains PlayResX/Y inside
`force_style` are actually inert for SRT input (they only apply to the ASS
`[Script Info]` section, which `force_style` cannot write to). The value that
actually controls libass's scaling for SRT input is the `original_size`
filter option, set explicitly to `{video_width}x{video_height}`.

This function is called from two places:

- `app/api/pipeline_routes.py:6658-6663` — the **subtitle-frame-preview**
  endpoint behind Path A's "Accurate preview" JPEG, with
  `video_width=1080, video_height=1920` **hardcoded**, even though the actual
  output JPEG frame is scaled/cropped to 540x960
  (`app/api/pipeline_routes.py:6655`: `scale=540:960:force_original_aspect_ratio=increase,crop=540:960`).
- `app/api/library_routes.py:4526-4533` — `_render_with_preset`, the function
  that both the **final render** and the **Variant preview render**
  (`assemble_and_render` → `_render_with_preset`) call to burn subtitles:

  ```python
  if srt_path and srt_path.exists() and subtitle_settings:
      subtitles_filter = build_subtitle_filter(
          srt_path=srt_path,
          subtitle_settings=subtitle_settings,
          video_width=preset.get('subtitle_ref_width', preset.get('width', 1080)),
          video_height=preset.get('subtitle_ref_height', preset.get('height', 1920))
      )
  ```

  The **preview** preset explicitly sets `subtitle_ref_width=1080,
  subtitle_ref_height=1920` while encoding video at 540x960
  (`app/services/assembly_service.py:2580-2587`) — i.e. the preview is a
  half-resolution encode, but the subtitle scaling reference is pinned to the
  full 1080x1920 canvas, so the *ratio* of glyph size to frame height is
  identical between the half-res preview and the final 1080x1920 render.
  Final-render presets (`app/api/pipeline_routes.py:904`,
  `app/api/assembly_routes.py:287,300`, `app/api/library_routes.py:3147`,
  `app/api/product_generate_routes.py:105`) declare `"width": 1080` with no
  `subtitle_ref_width` override, so the `.get(...)` fallback also resolves to
  1080 there — same ratio again.

**Conclusion: C1 is internally consistent.** Every FFmpeg-burned output the
user can see (Path A's "Accurate preview" JPEG, the Variant preview MP4 via
`variant-preview-player.tsx`, and the final export) all use
`original_size=1080x1920` regardless of actual encode resolution, so
`FontSize=108` always maps to the same fraction of frame height
(`108/1920 ≈ 5.6%`) across all three.

**C2 — `VideoEditor.add_subtitles` (dead/parallel code, NOT used by the live pipeline).**

File: `app/services/video_processor.py:1145-1287`

This is a second, independent ASS force_style builder that does **not** call
`original_size=` at all:

```python
subtitle_style = (
    f"PlayResX={video_width},"
    f"PlayResY={video_height},"
    f"FontName={font_family},"
    f"FontSize={font_size},"
    ...
)
...
cmd = [..., "-vf", f"subtitles='{srt_path_escaped}':force_style='{subtitle_style}'", ...]
```

Per the C1 comment, `PlayResX/PlayResY` inside `force_style` for SRT input
have no effect on libass's scaling (they'd only matter for native ASS input
with a `[Script Info]` section). Without `original_size`, libass falls back
to scaling against the **actual encoded frame dimensions**, so `FontSize=108`
here means something different depending on whether the encode is 540x960 or
1080x1920 — the exact bug C1's `original_size` was added to avoid. This
function is called from three sites, all inside `VideoProcessorService`
methods (`video_processor.py:1607`, `:1983`, `:2198`), which are a separate,
older processing class from `AssemblyService`/`_render_with_preset`. A repo
search found no caller reaching these sites from the live Step 1-4 pipeline
routes exercised by `assembly_service.assemble_and_render`/
`assemble_and_render_preview` — this looks like a legacy/alternate pipeline
(possibly `analyze_video`/batch flows) that is not part of the render path
the frontend previews target today. It is flagged here because if anything
in the app still calls `VideoProcessorService.process_video_full` or
similar with subtitles enabled, it would silently reintroduce the exact
frame-size-dependent scaling bug that C1 fixed. Recommend confirming it is
actually unreachable before deleting it, but it is **out of scope** for the
Path A vs Path B discrepancy this audit was asked to explain.

## Root cause

The three visually-different outputs the user compared are not actually
disagreeing on formula — Path A and Path B use the *same* scaling formula
(`fontSize * containerHeightPx / 1920`), and Path C (ground truth) uses a
mathematically equivalent ratio (`FontSize / PlayResY` via libass
`original_size`). The bug is that **Path B's `containerHeightPx` input is an
unreliable, unmeasured, or stale DOM read, while Path A's is a hardcoded,
always-correct constant**:

- Path A (`subtitle-editor.tsx:301-316`) computes `dimensions.height`
  synchronously from a `previewHeight` **prop** (`320`, passed by the caller)
  via `useMemo` — always available, always correct, no timing dependency. In
  addition, Path A almost always shows the real FFmpeg JPEG on top of (and
  hiding) the CSS overlay, so the CSS math only has to be "close enough" for
  the seldom-seen fallback frame.
- Path B (`timeline-editor.tsx:1336`) computes `containerH` from
  `previewContainerRef.current?.clientHeight`, read **inside the render body**
  of a conditionally-rendered IIFE, with no `useLayoutEffect`/
  `ResizeObserver` to guarantee it reflects the current committed layout.
  Concretely:
  - On the very first render after the preview area mounts, the ref is
    `null` (refs attach post-commit), so `clientHeight` falls back to the
    literal default (`320` compact / `720` expanded) — same order of
    magnitude as Path A's constant, so this alone would not explain
    "enormous," but:
  - There is no re-measurement wired to container resize. `compactPreviewFrameStyle`/
    `expandedPreviewFrameStyle` clamp width via `min(180px, 100%)` /
    `min(421.875px, 100%)`, meaning the *actual* rendered box can legitimately
    be smaller than 180px/421.875px on narrow layouts (mobile width, a
    collapsed vs expanded sidebar, a narrower variant grid column) — in which
    case `clientHeight` is smaller than the hardcoded fallback would have
    predicted, so `scale` computed from a stale/absent read can significantly
    **overstate** the true container height, and therefore **overstate the
    rendered font size** relative to the box the user is actually looking at.
  - Because Path B is CSS-only forever (no FFmpeg-image upgrade like Path A
    has), any measurement error is permanently visible, not just a
    fallback state during a 50ms debounce window.
  - This is a per-render, per-mount, per-window-size timing bug — it explains
    why the same numeric settings can look correct in one spot and wildly
    oversized in another, and why the user perceives "no connection" between
    the two previews: the two previews are not reading the same
    ground-truth container size, only nominally running the same formula.

Secondary contributing factor: even when Path B's `clientHeight` read is
accurate, its reference container (`min(180px,100%)`/`min(421.875px,100%)`)
is an independently-chosen hard cap that has no structural relationship to
Path A's `previewHeight={320}` prop — so even a "correct" Path B measurement
is scaling against a differently-sized box than Path A, by design, which is
fine in isolation but means the two previews were never guaranteed to look
identical in absolute pixel terms — only proportionally correct each to its
own box, when the measurement works.

## Ground truth

Path C1 (`app/services/video_effects/subtitle_styler.py` via
`app/api/library_routes.py:4526-4533` `_render_with_preset`, and via
`app/api/pipeline_routes.py:6658-6663` for the frame preview) is the ground
truth. Reasoning:

- It is the actual code that burns pixels into every artifact a user can
  see or export: the Style editor's "Accurate preview" JPEG, the Variant
  preview MP4 (`variant-preview-player.tsx`), and the final exported video —
  all three call this same function, all three pin `original_size` (or
  `video_width`/`video_height` args flowing into it) to **1080x1920**
  regardless of actual encode resolution.
- Its reference resolution is explicit and self-documenting:
  `PlayResX=1080, PlayResY=1920` matches the source video's actual delivered
  resolution (`DEFAULT_VIDEO_INFO` in `frontend/src/components/video-processing/subtitle-editor.tsx:46`
  is also `1080x1920`, and backend presets declare `"width": 1080` — see
  `app/api/pipeline_routes.py:904`).
- The frontend CSS previews (Path A, Path B) exist purely as approximations
  of this backend math for instant visual feedback before an FFmpeg round
  trip completes; they must match ITS ratio (`fontSizePx / 1920` of frame
  height), not the other way around. Path A already encodes exactly this
  ratio correctly (constant-based). Path B encodes the same ratio formula
  but sources the denominator/height from an unreliable measurement.
- Path C2 (`video_processor.py` `add_subtitles`) is not ground truth — it is
  unreachable from today's live pipeline and would (if ever re-wired in)
  reintroduce a frame-size-dependent bug that C1 was explicitly written to
  avoid, per the comment at `subtitle_styler.py:424-431`.

## Recommended fix

1. **Add one shared scaling helper** (frontend), e.g.
   `frontend/src/lib/subtitle-preview-scale.ts`:

   ```ts
   export const SUBTITLE_REFERENCE_HEIGHT = 1920; // must match backend PlayResY / original_size height (app/services/video_effects/subtitle_styler.py, app/api/pipeline_routes.py:6661-6662, app/api/library_routes.py:4531)

   export function scaleSubtitlePx(px: number, containerHeightPx: number, min = 8): number {
     return Math.max(min, px * (containerHeightPx / SUBTITLE_REFERENCE_HEIGHT));
   }
   ```

   This makes the 1920 reference a single named constant instead of three
   independent copy-pasted `1920`/`ASS_REFERENCE_HEIGHT`/`ASS_REF_HEIGHT`
   literals (`subtitle-editor.tsx:47`, `timeline-editor.tsx:1335`,
   `timeline-editor.tsx:1501`) that could silently drift out of sync with
   each other or with the backend's `PlayResY`.

2. **Fix Path B's height source**, not just its formula. Two changes to
   `frontend/src/components/timeline-editor.tsx`:
   - Replace the direct `previewContainerRef.current?.clientHeight` render-time
     read with a measured-and-stored value: add a `useState<number>` (or a
     `useRef` + forced re-render) populated by a `ResizeObserver` attached to
     `previewContainerRef` in a `useEffect`/`useLayoutEffect`, so the overlay
     re-scales whenever the box's committed size actually changes (mount,
     window resize, sidebar collapse, responsive breakpoint). This removes
     both the first-render-null problem and the stale-after-resize problem.
   - Call the new `scaleSubtitlePx()` helper with that observed height
     instead of duplicating the scale/fontSize/outline/shadow/glow math
     inline (currently duplicated near-verbatim at
     `timeline-editor.tsx:1332-1377` for compact and `:1500-1541` for
     expanded).

3. **Reuse the same helper in Path A** (`subtitle-editor.tsx:322-325`) so all
   three CSS call sites (`subtitle-editor.tsx`, and the two blocks in
   `timeline-editor.tsx`) are provably running identical math, not just
   similar math that happens to agree today.

4. **Do not touch Path C1** (`subtitle_styler.py`, `library_routes.py:4526-4533`,
   `pipeline_routes.py:6658-6663`) — it is already correct and is the target
   the frontend must match.

5. **Optional cleanup, separate from this bug**: confirm
   `VideoProcessorService.add_subtitles` (`video_processor.py:1145-1287`) and
   its three call sites (`:1607`, `:1983`, `:2198`) are truly unreachable from
   the live pipeline routes, then either delete them or route them through
   `subtitle_styler.build_subtitle_filter` so a future accidental re-wire
   can't reintroduce the un-scaled-frame-size bug.

6. **Verification steps** once the fix lands:
   - Load the Subtitle Style editor with Font Size 108px, Outline 9px, Y 55%,
     Montserrat, white/red — confirm the CSS-fallback overlay (throttle the
     FFmpeg preview request or inspect before it resolves) and the eventual
     FFmpeg JPEG show the same apparent glyph height.
   - Open the same Variant's Timeline preview (compact card view) with
     identical settings — measure the on-screen glyph cap-height in px via
     browser devtools, divide by the box's `clientHeight`, and confirm the
     ratio is within a few percent of `108/1920`.
   - Resize the browser window / collapse the sidebar while the compact
     Timeline preview is visible and confirm the subtitle re-scales (proves
     the `ResizeObserver` wiring works, not just the initial mount value).
   - Expand the Timeline preview to its dialog view and repeat the ratio
     check against `expandedPreviewFrameStyle`'s box.
   - Run an actual Variant preview render (`variant-preview-player.tsx`,
     FFmpeg MP4) and the final export, and visually compare glyph size
     against the two CSS previews above — all four should look the same
     relative to frame height.

## Acceptance criteria

- At Font Size 108px (Outline 9px, Y 55%, Montserrat, white/red), when each
  of the following is normalized to "glyph cap-height in px ÷ container
  height in px": (a) the Style editor's CSS fallback overlay, (b) the Style
  editor's FFmpeg "Accurate preview" JPEG, (c) the Timeline preview compact
  CSS overlay, (d) the Timeline preview expanded CSS overlay, (e) the
  Variant preview FFmpeg MP4, (f) the final exported MP4 — all six ratios
  must be within 5% of `108/1920 ≈ 0.05625`.
- Resizing the browser window (or toggling the sidebar) while a Timeline
  preview (compact or expanded) is visible causes the subtitle overlay to
  visibly re-scale within one animation frame of the container's size
  changing — i.e. it is not stuck at whatever size was measured on first
  mount.
- The literal number `1920` (or an equivalent reference-height constant)
  appears in exactly one frontend source location
  (`SUBTITLE_REFERENCE_HEIGHT` in the new shared helper) instead of three
  independent copies.
- `frontend/src/components/timeline-editor.tsx`'s two subtitle-overlay blocks
  (compact and expanded) and `frontend/src/components/video-processing/subtitle-editor.tsx`'s
  `renderLocalSubtitleOverlay` all call the same shared scaling function for
  fontSize/outlineWidth/shadowDepth/glowBlur — verified by grep, not just by
  eyeballing the math.
- No change to `app/services/video_effects/subtitle_styler.py`,
  `app/api/library_routes.py:4526-4533`, or
  `app/api/pipeline_routes.py:6658-6663` (ground truth stays untouched).

## Prior attempts

Evidence of at least one deliberate, documented prior attempt to solve
exactly this class of bug, found via git log and in-code comments:

- Commit `b3dcd48` — `fix: correct subtitle preview scaling and move preview
  to side-by-side...` (see `git -C "C:\obSID SRL\n8n\edit_factory" log --oneline -- frontend/src/components/video-processing/subtitle-editor.tsx`).
  This is very likely the commit that introduced the
  `ASS_REFERENCE_HEIGHT`/`scale = dimensions.height / ASS_REFERENCE_HEIGHT`
  pattern in `subtitle-editor.tsx` — i.e. Path A's correct-by-construction
  formula already reflects a prior fix. That fix was never propagated to
  `timeline-editor.tsx` (added later, in `526aa91 feat(41-01): create
  TimelineEditor component with phrase-to-segment d...`), which reimplemented
  the same formula independently (comment at `timeline-editor.tsx:1333-1334`:
  "Use same proportional scaling as subtitle-editor.tsx") but sourced its
  height from a live DOM ref instead of a constant prop, reintroducing a
  timing-dependent version of the same class of bug in a new place.
- `app/services/video_effects/subtitle_styler.py:424-431` contains an
  explicit backend-side comment explaining exactly this failure mode
  ("`FontSize=100` would render ~2x too large relative to the frame compared
  to the final render" without `original_size`) — i.e. the backend team
  already diagnosed and fixed the equivalent bug for the FFmpeg path (adding
  `original_size=`). That fix (Path C1) is correct and is not the source of
  today's discrepancy; the frontend fix documented in this audit is the
  remaining half of the same historical bug class, on the CSS side.
- No evidence of any attempt to unify Path A's and Path B's scaling constant
  into a shared module — the `1920` reference height is independently
  hardcoded three times (`subtitle-editor.tsx:47`, `timeline-editor.tsx:1335`,
  `timeline-editor.tsx:1501`), which is what recommendation #1 above
  addresses.
