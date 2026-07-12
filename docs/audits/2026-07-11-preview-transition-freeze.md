# Audit: Variant Preview Player — Segment-Boundary Freeze/Stutter

**Date:** 2026-07-11
**Scope:** `frontend/src/components/timeline-editor.tsx` inline continuous preview player (Step 3 "Preview & match"). This is the player with the Play/Pause controls, scrub bar, and `N/M` slide counter — **not** `variant-preview-player.tsx`, which is a different dialog that plays a single server-FFmpeg-rendered MP4 with no client-side segment stitching at all (see "Two players" note below).
**Status:** Diagnosis only. No source files modified as part of this audit.

---

## Two players — don't conflate them

The repo has two components that are both colloquially "the preview player." Only one matches the bug report.

| | `variant-preview-player.tsx` | `timeline-editor.tsx` (inline preview) |
|---|---|---|
| Trigger | "Eye" icon / full preview dialog | "Play Preview" inside Step 3 timeline |
| What plays | ONE server-rendered MP4 (`/pipeline/render-preview/...`, FFmpeg concatenated the whole variant ahead of time) | Client-side stitching: N raw source-video segments driven by a shared TTS-audio clock, no server pre-render |
| `<video>` count | 1 | 2 (ping-pong double-buffer) |
| Per-segment seeking in the browser | None — it's already one continuous file once rendered | Yes — this is the component that seeks into different source videos per segment |
| Slide counter `N/M` | No | Yes (`{previewActiveIndex + 1}/{matches.length}`, line 1445) |

The bug report describes a slide counter like "16/25" and freezes "every time it crosses from one segment/slide to the next" — that is unambiguously **`timeline-editor.tsx`**'s inline preview, not the FFmpeg-rendered dialog. This audit focuses entirely on that component. `variant-preview-player.tsx` is included only for contrast in the Architecture Map.

---

## Architecture map

### Files and line numbers (current HEAD, uncommitted state as of 2026-07-11)

- `frontend/src/components/timeline-editor.tsx` — the entire inline preview engine, lines 153–835 (state/refs/callbacks) + JSX at 1282–1450 (compact) and 1452–1560+ (expanded dialog).
- `frontend/src/app/pipeline/components/step3-preview.tsx` — hosts `<TimelineEditor>`, passes `matches`, `pipelineId`, `variantIndex`, `profileId`; no playback logic of its own.
- `app/api/segments_routes.py:1092-1141` — `GET /segments/source-videos/{video_id}/preview-stream`, the backend endpoint the `<video>` elements point at.
- `app/api/segments_routes.py:224-318` — preview-proxy generation (`_generate_preview_proxy`, `_generate_preview_proxy_background`).

### Data flow

```
matches: MatchPreview[]  (from Step 3 state — SRT phrase ↔ segment_id ↔ source_video_id
                           ↔ segment_start_time/segment_end_time ↔ merge_group)
        │
        ▼
previewAudioRef  (<audio> element, src = TTS mp3 for the variant, line 1274-1279)
        │  audio.currentTime is the SINGLE CLOCK driving the whole preview
        ▼
rAF loop (startPreviewRafLoop, line 431-482)
        │  reads audio.currentTime every animation frame (NOT `timeupdate`, which
        │  is documented in-code as only firing ~4Hz)
        │  → findActiveMatch(time) → index into `matches[]`
        ▼
commitTransition(nextIdx)  (line 392-427)   ◄── boundary-detection + swap logic
        │  flips previewActiveIndexRef, moves subtitle/counter forward,
        │  and does the visible <video> swap (details below)
        ▼
Two <video> elements ("slots"), refs in previewSlotRefs.current[0|1]
        JSX: compact view line 1295-1315, expanded-dialog view line 1466-1486
        Both slots always `display:block`; the inactive one is opacity:0, z-index:0.
        src for a slot = `${API_URL}/segments/source-videos/{sourceVideoId}/preview-stream?...`
        (app/api/segments_routes.py:1092)
```

### Is it single-`<video>`-seek, `src`-swap, or double-buffer?

**Double-buffer (ping-pong), by design, already implemented.** Two persistent `<video>` elements ("slots") exist for the lifetime of the preview (`previewSlotRefs.current: [HTMLVideoElement|null, HTMLVideoElement|null]`, declared line 169). At any time one slot is "active" (visible, playing) and the other is "idle" (paused, being pre-staged for the *next* segment that will actually cut to a different video, per `findNextTransitionIndex`, line 243-257). On a boundary crossing the code does **not** seek the visible element — it flips CSS `opacity`/`z-index` on already-decoded elements (`applySlotVisibility`, line 381-386) and calls `.play()` on the now-visible one.

### Are segment sources separate clip files or in/out points of one source file?

**In/out points of source video files, not pre-cut clips.** `match.source_video_id` + `match.segment_start_time` / `match.segment_end_time` index into a small number of *original* long source videos (or their proxies). Multiple `matches[]` entries commonly share the same `source_video_id` at different offsets, and the player seeks each slot's `<video>.currentTime` to `segment_start_time` (`seekSlotTo`, line 303-327). This is exactly the seek-based architecture the double-buffer was built to route around — see Root Cause below for the residual case where seeking still happens on the seam.

### Exact citations

- **Playback/timing loop:** `startPreviewRafLoop`, `frontend/src/components/timeline-editor.tsx:431-482`. Uses `requestAnimationFrame`, reads `previewAudioRef.current.currentTime`, explicitly chosen over `timeupdate` per the comment at line 429-430 ("replaces timeupdate (which only fires ~4Hz) to eliminate ~250ms segment switch lag").
- **Boundary detection:** `findActiveMatch` (line 267-271) computes which `matches[]` index owns the current audio time; compared against `previewActiveIndexRef.current` inside the rAF loop body (line 444-465). Same-`merge_group` transitions are filtered out (line 450-455) so only real video cuts trigger `commitTransition`.
- **Source-switching / swap code:**
  - Pre-staging (off-screen, before the boundary): `prepareSlot`, line 332-345, called from the rAF loop at line 470-476 once per settled index — loads the idle slot's `src` (`loadSlotSource`, line 288-299) and pre-seeks it (`seekSlotTo`, line 303-327) *while still on the previous segment*, so the seek's async cost is hidden ahead of time.
  - Seam commit: `commitTransition`, line 392-427. Happy path (idle slot `ready`): `applySlotVisibility` (imperative opacity/z-index flip, line 381-386) + `.play()` on the new active element, `.pause()` on the old one — no seek at the seam itself.
  - **Fallback path when staging missed the deadline:** `commitTransition` line 423-425 — `seatActiveSlot(nextIdx, true)`, which *does* perform a live, synchronous-feeling seek-then-play on the active slot (line 350-375). This is the still-present regression path (see Root Cause).
- **Segment end-of-window enforcement:** separate rAF loop, `frontend/src/components/timeline-editor.tsx:535-587`, replaces `timeupdate` for the same reason (comment line 530-531). On overshoot it now loops back to the segment's in-point instead of pausing (line 560-570, added 2026-07-11 in commit `9c9c360`).

### `VariantPreviewPlayer` (contrast only)

`frontend/src/components/variant-preview-player.tsx:389-401` is a single `<video>` with a single `src` pointed at one server-rendered file (`previewVideoUrl`, line 325-328); there is no client-side segment switching, so it cannot exhibit a per-boundary freeze — any stutter there would be an FFmpeg-side transition/encoding artifact baked into the file, not a player bug. Confirmed out of scope for this report.

---

## Root cause analysis

There isn't one single mechanism — there are two layered ones, and the second is the one still live in the reported bug.

### 1. (Historical, now fixed) Live seek-on-boundary in a single pooled `<video>` per source

Before commit `31de997` (2026-07-06), the player used `previewVideoRefs: Record<sourceVideoId, HTMLVideoElement>` — one `<video>` mounted per distinct source video, all kept in the DOM, visibility toggled per active source. On every boundary crossing to a *different* segment, `syncPreviewVideo` set `activeVideo.currentTime = match.segment_start_time` **on the already-visible element** and waited for the `seeked` event before calling `.play()` (old code, `syncPreviewVideo`, roughly lines 255-323 of the pre-`31de997` version — see git reference below). The in-code comment at that call site is explicit about the mechanism: *"Wait for seek to complete before playing — prevents showing frames from the old position during the async seek (50-150ms window)."* That 50-150ms window, multiplied by 1080p source video with a normal (sparse, several-second) GOP, is exactly the textbook "seek to non-keyframe forces decode-forward" stall — the visible element goes blank/frozen while the decoder catches up from the last keyframe before the target time. This is confirmed replaced, not merely papered over: the whole `previewVideoRefs` Record and `syncPreviewVideo` function are gone from the current file.

### 2. (Current, still live) Fallback re-seek when idle-slot pre-staging misses the deadline

The current double-buffer design correctly avoids seeking the *visible* element on the common path. But `commitTransition` (`timeline-editor.tsx:392-427`) has an explicit degrade branch:

```
if (st.preparedForIndex === nextIdx && st.ready) {
  // Seamless: idle slot already decoded the first frame at the right offset.
  ...
} else {
  // Staging missed the deadline — degrade to seeking the active slot in place.
  seatActiveSlot(nextIdx, true);
}
```

`seatActiveSlot` (line 350-375) is functionally identical to the old `syncPreviewVideo`: it loads/points the *active, visible* slot at the new source (`loadSlotSource`, which calls `el.load()` — a full reload, not just a seek, whenever the source video id differs from what's currently loaded) and seeks it, waiting on the `seeked` event before playing. This is a real, on-screen stall exactly like the historical bug, just gated behind a timing race instead of happening every time.

**Why staging can miss the deadline** — the pre-staging trigger is coarse:

- `prepareSlot` for the *next* transition is only kicked off once per "settled" index (line 470-476: `if (preparedNextForIndexRef.current !== settledIdx)`), i.e., once the rAF loop has already landed on the current segment. It does not know how long that segment is; it assumes ample lead time ("Segments are ~2-3s, so there's ample time to load + seek before the boundary", comment line 467-468). For any segment shorter than that assumption — a quick jump-cut, a merge-group tail, or several back-to-back short SRT phrases — the idle slot may still be mid-`seekSlotTo` (waiting on `loadedmetadata` → `seeked`) when the boundary rAF tick arrives, so `st.ready` is `false` and the code falls into the live-seek fallback.
- `loadSlotSource` (line 288-299) does a full `el.pause(); el.src = ...; el.load()` when the idle slot's currently-loaded source differs from the one being staged — i.e., every time consecutive short segments alternate between two source videos, the idle slot pays a full HTTP fetch + decoder reinit, not just a seek, before it can even seek to the target offset. On a slow disk/proxy-not-ready path this alone can exceed the 2-3s budget.
- The 1080p-vs-proxy angle compounds this: `preview-stream` (`app/api/segments_routes.py:1092-1141`) serves the *preview proxy* (`-g 15 -keyint_min 15` — keyframe every 0.5s at 30fps, cheap to seek) only if `preview_proxy_status == "ready"`. Proxy generation is **lazy and asynchronous** — the first time any given source video is opened in a pipeline, `should_start_lazy_proxy` (line 1121-1125) kicks off a background FFmpeg job and the endpoint falls back to streaming the **original, un-proxied 1080p file** for that request (line 1141, `_video_file_response(original_path)`). The original file's GOP structure is whatever the camera/export produced it with — commonly 1-2s or longer keyframe intervals — so a seek against it is far more expensive to decode-settle than a seek against the proxy. Every segment boundary hit during this window (before the background proxy finishes) is more likely to blow the pre-staging time budget and fall into the live-seek path from #2.

### Secondary, minor contributors (present but not the primary driver)

- `applySlotVisibility`'s comment (line 378-380) notes Chromium throttles/tears down `display:none` videos — the code correctly avoids that by keeping both slots `display:block` always and using `opacity`/`z-index` instead. This is already handled, not a live bug.
- Expanding/collapsing the preview (`isPreviewExpanded` toggle) unmounts and remounts both `<video>` elements into a different DOM subtree (compact view JSX at line 1295-1315 vs. expanded-dialog JSX at line 1466-1486, both writing into the same `previewSlotRefs.current` array). The effect at line 823-835 re-seats the active slot with a single seek after remount — a one-time, user-initiated stall, not a per-boundary one, but worth knowing if the user tests inside the expanded dialog specifically.
- `requestAnimationFrame` itself is not the bottleneck: at 60fps the loop is fine-grained enough (`~16ms` resolution) that it isn't "too coarse." The stall, when it happens, is inside the awaited `seeked` event dispatch of the fallback seek, not in the polling cadence.

**Bottom line:** the freeze the user still sees is very likely the `seatActiveSlot` fallback in `commitTransition` firing more often than intended — either because segments are shorter/more numerous than the "~2-3s" assumption baked into the pre-staging trigger, or because the source video being cut to is still being served un-proxied (large keyframe interval) while its background proxy job is in flight.

---

## Prior attempts (git history)

| Commit | Date | What it did | Outcome |
|---|---|---|---|
| `5132c9f` "fix(pipeline): fix 5 Step 3 bugs — dual audio, subtitle settings in timeline preview, rAF sync" | 2026-02-25 | Earliest form of the inline preview visible in history: one `<video>` per unique `source_video_id` (`previewVideoRefs: Record<string, HTMLVideoElement>`), all mounted, only the active one shown; direct `currentTime` seek + `seeked`-event wait on every boundary (comment: *"prevents showing frames from the old position during the async seek (50-150ms window)"*); rAF loop already used in place of `timeupdate` at this point for the same "~250ms lag" reason. | Superseded, not reverted — this is the architecture that produced the seek stall. Code confirmed fully removed by `31de997`. |
| `52556a7` "fix: pipeline audit fixes + accumulated v11 improvements", `7156159` "fix: defensive hardening for pipeline crashes and preview stability", `2e5b453`/`3423a93`/`8b5fa05`/`570bb74`/`c0f9e01`/`9d6237b` (various "N bugs" cleanup passes) | Feb–Jul 2026 | Touched `timeline-editor.tsx` repeatedly for memory leaks, stale closures, mount-guard races — general hardening of the *same* single-video-pool architecture, not a redesign of the seek mechanism. | Present, but none of these change the seek-on-boundary approach itself — the freeze mechanism from `5132c9f` era survived all of them. |
| `31de997` "rebrand: Edit Factory → Blipost" (2026-07-06) — **misleading title; this commit's diff to `timeline-editor.tsx` is the double-buffer rewrite**, unrelated to the stated rebrand scope in the commit message | 2026-07-06 | Replaced `previewVideoRefs` Record with the two-slot ping-pong buffer (`previewSlotRefs`, `slotStateRef`, `prepareSlot`, `seatActiveSlot`, `applySlotVisibility`, `commitTransition`) described in this audit's Architecture Map. In-code comments explicitly name the prior bug: *"no async seek at the seam (that seek was the stutter cause)"* (line 168) and note the `display:none` Chromium throttling pitfall (line 378-380). | **Still present and active** — this is the current architecture. Fixed the *common-path* stutter. Did not close the fallback-seek gap (`seatActiveSlot` inside `commitTransition`'s `else` branch) for segments too short to pre-stage in time. |
| `9c9c360` "feat(pipeline): adjust suite — smooth preview, trim, audio/eq controls, AI match" (2026-07-11, same day as this audit) | 2026-07-11 | Added loop-at-seam behavior for segments shorter than their phrase slot: instead of `vid.pause()` on overshoot, wraps `currentTime` back to `segmentStartTime` (line 560-570) "mirrors the render engine's `use_loop`", explicitly because "the freeze read as stutter at every seam." Also normalizes interstitial/PiP clip params server-side so the FFmpeg `-c copy` concat (final render, not this player) doesn't bake in stutter. | Present, addresses a *different* stutter (looping short segments within the enforcement loop), not the pre-staging-deadline-miss case above. |

**Net assessment:** two real architectural generations exist in git history (single-pool-seek → ping-pong double-buffer), and the double-buffer swap genuinely eliminated the seek stall on the common path. The bug is very likely still reproducible today specifically because of the *fallback* seek path that the double-buffer retained as a safety net — that fallback reintroduces the exact same `seeked`-event-wait stall the rewrite was meant to eliminate, just gated behind a race instead of happening unconditionally. No commit has yet addressed: (a) widening the pre-staging lead time / triggering it earlier than "once per settled index," or (b) forcing the background preview-proxy to be ready (or blocking on it) before a source video is ever used as a preview target.

---

## Recommended fix

**Primary direction: keep the double-buffer architecture (it is architecturally correct and already 90% there) — close the two gaps that still let it fall back to a live seek.** Do not replace it with a different pattern (e.g., canvas compositing, single-source time-mapping); the codebase already invested in, and mostly succeeded with, pre-staged dual `<video>` elements. A rewrite would be throwing away working infrastructure to re-solve an already-solved sub-problem.

### Step-by-step plan

1. **Trigger pre-staging earlier, not "once per settled index."**
   File: `frontend/src/components/timeline-editor.tsx`, inside the rAF loop (`startPreviewRafLoop`, line 431-482).
   Currently staging fires once when the rAF loop first observes the new "settled" index (line 470-476) — i.e., staging for segment N+1 doesn't start until segment N has *already* become active. For short segments this leaves less than a second of lead time. Change the trigger to fire based on **time remaining in the current segment**, computed from `previewSegmentEndTimeRef.current` (already tracked) vs. the live video's `currentTime`, e.g. start staging as soon as the active segment has ≥1.5s left (or immediately if the segment's total duration is under, say, 2s). This requires moving the `preparedNextForIndexRef` gate from "index-based, once" to "time-based, with a re-arm when the target index changes," but reuses the existing `prepareSlot`/`findNextTransitionIndex` functions unchanged.

2. **Make `loadSlotSource` cheaper on the hot path for alternating short segments.**
   File: `timeline-editor.tsx:288-299`. When two consecutive transition targets alternate between the same two source videos (common for cutaway/reaction patterns), the idle slot currently pays a full `el.src = ...; el.load()` every time even though it held that exact source moments ago. Consider keeping a small LRU of "recently loaded source → last known decode state" per slot, or — simpler — track the *previous* source id per slot (not just current) so a same-source-different-offset re-stage skips `load()` and goes straight to `seekSlotTo`, which is already what happens when `st.sourceVideoId === sourceVideoId` (line 292) — verify this fast path is actually being hit in practice for alternating patterns; add a dev-only console timer around `prepareSlot` to confirm staging duration in real sessions before optimizing further.

3. **Don't let un-proxied 1080p source serve as a preview target during the freeze-prone window.**
   File: `app/api/segments_routes.py:1092-1141` (`preview_stream_source_video`). Right now the first request for a not-yet-proxied video starts the background job and immediately serves the original file — correct for "don't block the user," wrong for "this is the file every subsequent seek during this session will stall on." Two complementary options, pick the cheaper one first:
   - **3a (cheap, do first):** Frontend — when `prepareSlot`/`seatActiveSlot` is about to target a `source_video_id` that the Step 3 page already knows lacks a ready proxy (surface `preview_proxy_status` from the source-videos list endpoint, already returned per `SourceVideoResponse` at `segments_routes.py:321-342`), show the existing `isPreviewBuffering` spinner proactively and widen the pre-staging lead time further for that segment (effectively treat "no proxy yet" as "assume worst-case load time").
   - **3b (more thorough):** Backend — trigger proxy generation eagerly when a pipeline enters Step 3 (i.e., as soon as `matches[]` references a `source_video_id`), not lazily on first preview-stream request, so by the time the user presses Play the proxy is very likely already `ready`. This is a small addition to whatever handler populates Step 3 matches — kick a `background_tasks.add_task(_generate_preview_proxy_background, ...)` per unique `source_video_id` in the matches, mirroring the existing lazy-trigger logic at `segments_routes.py:1126-1139`.

4. **Instrument the fallback path so regressions are visible, not silent.**
   File: `timeline-editor.tsx:423-426`. Add a `console.warn` (or a lightweight counter surfaced in dev tools) whenever `commitTransition` takes the `else` branch (`seatActiveSlot` fallback), including which segment index and its duration. This turns "freeze happens sometimes, hard to reproduce" into a directly observable signal during manual QA and lets step 5 be verified objectively instead of by eyeballing only.

5. **Re-verify the merge-group / `use_loop` seam fix from `9c9c360` doesn't mask the same symptom.**
   The loop-back added today (line 560-570) rewinds `currentTime` on overshoot — that itself is a `currentTime` assignment on the *active, playing* element mid-flight. Confirm (with the instrumentation from step 4) that this loop-back doesn't also visibly hitch on 1080p un-proxied sources; if it does, the same "prefer proxy, widen grace window" reasoning from step 3 applies there too.

None of the above requires introducing canvas compositing, `fastSeek()`, or a rewritten single-source time-mapped player — the existing ping-pong buffer is the right shape; it just needs its safety-net path (which regresses to the original bug) exercised far less often.

---

## Acceptance criteria

All of these must be verified by a human watching the Step 3 inline preview player (not just by reading code):

1. **Continuous 20+ segment playback, proxy warm (all source videos already proxied from a prior session):** Press Play Preview on a variant with ≥20 matched segments spanning at least 3 different source videos, with short (1-2s) segments included. Watch the full duration without pausing. There must be **zero visible black-frame flashes, freeze-holds, or stutter-hitches at any segment boundary** — the picture should cut cleanly exactly on the beat of the subtitle/counter advancing.
2. **Cold-start case (source video previewed for the first time this session, proxy not yet generated):** Delete/rotate a source video's `preview_proxy_status` back to unset (or use a genuinely new upload), immediately open Step 3 and press Play Preview before the proxy has had time to finish. Confirm either (a) a visible buffering spinner appears instead of a frozen frame, or (b) the fallback-seek instrumentation (step 4 above) does not fire — i.e., the wider grace window successfully avoided the fallback. Either is acceptable; a silent freeze with no spinner and no log signal is not.
3. **Short segment stress test:** Construct (or find) a variant where 4+ consecutive `matches[]` entries have sub-1.5s durations and alternate between two different source videos. Play through this stretch specifically. No stall should be observable, and dev-console instrumentation (step 4) should show zero or near-zero fallback-path hits across the stretch.
4. **Expand/collapse transition:** Toggle the preview between compact and expanded (`Maximize2` button, line ~1440) while playing. A brief pause during the toggle itself is acceptable (documented, user-initiated remount), but playback must resume cleanly afterward with no residual per-boundary stutter for the rest of the session.
5. **Consistency with the render-preview dialog:** Play the same variant through `VariantPreviewPlayer` (the FFmpeg-rendered dialog) and confirm it has no stutter of its own — this isolates that any remaining issue is specific to the client-side stitcher, not a shared regression from the render engine's `use_loop`/interstitial normalization changes in `9c9c360`.
6. **No regression in scrub/jump controls:** Prev/Next segment buttons and manual scrub-bar drags (`jumpToIndex`, `handlePreviewSeek`) are explicitly allowed a single visible seek (documented as acceptable in-code, line 618-620) — confirm these still work and aren't mistaken for the automatic-boundary bug during testing.
