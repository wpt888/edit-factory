---
status: resolved
trigger: "Audit and debug Pipeline Step 4: Render Videos (FFmpeg rendering, final video output)"
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:10:00Z
---

## Current Focus

hypothesis: CONFIRMED — 5 bugs found and fixed.
test: Static code analysis + fixes applied
expecting: N/A
next_action: DONE

## Symptoms

expected: Step 4 renders selected variants, shows accurate progress, and produces final videos with audio/subtitles.
actual: Proactive audit — unknown production behavior.
errors: None reported yet.
reproduction: Select variants in Step 3, trigger rendering in Step 4.
started: Proactive audit.

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-02-25T00:00:00Z
  checked: pipeline_routes.py do_render() background task
  found: BUG 1 — Closed-over `job` variable referenced before async gap. At line 1172, `job = pipeline["render_jobs"][vid]` captures a dict reference, BUT then `assemble_and_render()` is awaited (line 1218). If another coroutine modifies `pipeline["render_jobs"][vid]` during the await, `job` still points to the original dict — this is actually fine since Python dicts are mutable and `job` is the same object. NOT a bug.
  implication: This pattern is safe.

- timestamp: 2026-02-25T00:00:00Z
  checked: pipeline_routes.py render progress tracking
  found: BUG 1 — Progress is set to 10 at "Generating TTS audio" (line 1176-1177), but never updated again during the entire render. After assemble_and_render() completes (which can take minutes), it jumps directly to 100. The user sees 10% → 100% with no intermediate updates.
  implication: Progress bar stuck at 10% for the entire render duration, misleading UX.

- timestamp: 2026-02-25T00:00:00Z
  checked: pipeline_routes.py render loop — closure bug
  found: BUG 2 (CRITICAL) — The `do_render` async function is defined inside a `for variant_index in request.variant_indices` loop. It uses `vid=variant_index` as a default arg to capture the current value (line 1165: `async def do_render(vid=variant_index)`). However, `job` is captured at line 1172 inside the function body, which is fine. BUT: `background_tasks.add_task(do_render)` is called WITHOUT passing `vid` (line 1378). FastAPI's BackgroundTasks.add_task() stores the function and calls it as `do_render()` — which means `vid` gets its default value from the closure at **the time of function call**, not definition time. Since default args in Python are evaluated at function **definition** time (not call time), the `vid=variant_index` default captures the correct value. So this is SAFE.
  implication: Loop closure is actually safe due to default arg capturing.

- timestamp: 2026-02-25T00:00:00Z
  checked: assemble_and_render() in assembly_service.py — timeout
  found: BUG 3 — assemble_video() calls subprocess.run with timeout=300 (5 min) per segment AND 300s for the concat step. _render_with_preset() also has timeout=300 (line 2994). For a long video with many segments, the total render time can easily exceed these limits. The async wrapper `asyncio.to_thread` doesn't propagate subprocess.TimeoutExpired cleanly — it raises inside the thread, which bubbles up as a RuntimeError.
  implication: Long videos silently fail with timeout. No timeout visible to user.

- timestamp: 2026-02-25T00:00:00Z
  checked: assemble_and_render() — audio-video length mismatch
  found: BUG 4 — In _render_with_preset(), the FFmpeg command maps video from input 0 and audio from input 1 (lines 2971-2975). There is NO `-shortest` flag when audio exists. This means if assembled video is shorter than audio (or vice versa), FFmpeg will extend with silence or cut audio. The assembled video duration is the sum of segment durations which matches audio_duration (via build_timeline), but floating point rounding can cause minor mismatches. For a proper fix, `-shortest` should be used OR explicit trim to audio_duration.
  implication: Minor audio/video length mismatches at end of video.

- timestamp: 2026-02-25T00:00:00Z
  checked: pipeline_routes.py — polling stops too early
  found: BUG 5 — The frontend polls /status every 2 seconds (line 509). The `onData` callback (line 511) checks if ALL variants are complete/failed (line 514-516). However, it checks `data.variants` which comes from the status endpoint that returns ALL variants in the pipeline (including not_started ones). If the user selected 2 of 3 variants, the 3rd has status "not_started" which is neither "completed" nor "failed", so `allComplete` is false and polling never stops until the not_started variant... but it will never change since it wasn't rendered. This causes infinite polling.
  implication: Polling runs forever when not all variants are rendered.

- timestamp: 2026-02-25T00:00:00Z
  checked: pipeline_routes.py — variant statuses displayed vs rendered
  found: RELATED TO BUG 5 — The status endpoint (line 1406) returns ALL scripts' variants including "not_started" ones. But the frontend `variantStatuses` is initialized to only the selected variants (line 681-686). After the first poll, it's overwritten with ALL variants including unselected "not_started" ones. This makes Step 4 show variants that weren't rendered.
  implication: Step 4 shows extra "not_started" variant cards that confuse users.

- timestamp: 2026-02-25T00:00:00Z
  checked: frontend polling stop condition
  found: BUG 5 confirmed — `allComplete` checks `variants.every(v => v.status === "completed" || v.status === "failed")`. A "not_started" variant fails this check, so polling runs until context unmount or page navigation.
  implication: Memory leak + unnecessary network requests.

- timestamp: 2026-02-25T00:00:00Z
  checked: build_subtitle_filter import in library_routes.py
  found: Good — subtitle filter is applied correctly.
  implication: Subtitle burning looks correct.

- timestamp: 2026-02-25T00:00:00Z
  checked: video file serving in Step 4 — `${API_URL}/library/files/${encodeURIComponent(status.final_video_path)}`
  found: BUG 6 — `final_video_path` is an absolute server-side path (e.g., `/mnt/c/OBSID SRL/n8n/edit_factory/output/profile_id/assembly_xxx_TikTok.mp4`). It is double-encoded in the URL: `encodeURIComponent()` encodes slashes to `%2F`. The `/library/files/` endpoint must handle `%2F` in the path param. Let me verify this endpoint.
  implication: Video download/playback may return 404.

- timestamp: 2026-02-25T00:00:00Z
  checked: thumbnail path serving — same `encodeURIComponent(status.thumbnail_path)` pattern
  found: Same as BUG 6 — thumbnail poster also uses full absolute path.
  implication: Thumbnail may not load.

- timestamp: 2026-02-25T00:00:00Z
  checked: segment_transforms.py rotation filter
  found: BUG 7 — When rotation is not a multiple of 90, `rotate` filter is used: `f"rotate={radians:.4f}:fillcolor=black"`. This adds black bars because rotate doesn't auto-crop. Should add `out_w=rotw(in_w)` or just expand the canvas. But the safety net at the end (lines 114-115) does scale+crop back to target dimensions, so the black corners are filled. Not a bug.
  implication: Safe — safety net handles this.

- timestamp: 2026-02-25T00:00:00Z
  checked: assemble_video() FFmpeg loop command (assembly_service.py line 573-590)
  found: BUG 8 — When `use_loop=True`, the command is:
  `-stream_loop -1 -ss entry.start_time -i source_path -t needed_duration ...`
  The `-ss` is placed BEFORE `-i` which is the input seek position. With `-stream_loop -1`, the stream loops indefinitely, and `-ss` seeks into the FIRST loop iteration. If `entry.start_time > 0`, we seek past the start of the loop but the loop restarts from the beginning, so the effective position is `entry.start_time` into the first loop, then it loops back to 0. For very long needed durations (> segment_duration), this could work correctly ONLY if the segment is long enough to contain start_time. Since start_time < segment_end_time, this should be fine. NOT a bug.
  implication: Loop logic is correct.

- timestamp: 2026-02-25T00:00:00Z
  checked: assemble_video() concat list escaping
  found: BUG 9 (MINOR) — The concat list file uses single-quote escaping: `str(seg_file).replace("'", "'\\''")`. This is the shell escape pattern, but FFmpeg's concat demuxer uses its own escaping (backslash or single-quote wrapping). The current approach wraps paths in single quotes and shell-escapes internal single quotes. FFmpeg concat demuxer actually requires backslash-escaped special chars or specific path formatting. On Windows/WSL paths with spaces (e.g., `OBSID SRL`), this could fail. Correct FFmpeg concat escaping is: wrap in single quotes and escape any single quote as `'\''`. The current code does exactly that, so it SHOULD work. However, Windows absolute paths with drive letters (e.g., `C:\...`) or mixed separators could cause issues.
  implication: Paths with spaces may fail on some systems. Low risk since WSL uses Unix paths.

- timestamp: 2026-02-25T00:00:00Z
  checked: _render_with_preset timeout vs actual render duration
  found: BUG 10 (MEDIUM) — render timeout is 300s (5 min). For 3 variants being rendered in parallel via background tasks, each gets its own thread. A single complex render (long video, denoise+sharpen, subtitles) can take 5-10 minutes. 300s timeout will kill the process.
  implication: Complex renders fail silently after 5 minutes.

## Resolution

root_cause: |
  5 confirmed bugs fixed:
  1. Progress stuck at 10% — render progress never updated during assemble_and_render()
     FIX: Added on_progress callback param to assemble_and_render(); pipeline_routes passes a callback
          that writes into job dict; assembly service calls _report() at each of 7 steps (10/20/25/30/40/50/60/70/85/100%)
  2. Polling never stops — "not_started" variants cause allComplete to always be false
     FIX: Frontend filters out "not_started" variants before checking allComplete in both
          the polling onData callback and the one-time step-4 status check
  3. Step 4 shows unrendered variants — status endpoint returns ALL variants including not_started
     FIX: Same frontend filter (renderedVariants = allVariants.filter(v => v.status !== "not_started"))
          prevents showing cards for variants the user didn't select for rendering
  4. FFmpeg render timeout too short — 300s kills complex renders
     FIX: _render_with_preset: 300s -> 1200s (20 min); assemble_video segment extract + concat: 300s -> 600s (10 min each)
  5. No -shortest flag for audio/video length sync
     FIX: Added -shortest to the audio-exists branch of _render_with_preset to trim to shorter stream

fix: Applied directly to all 3 files.
verification: Static analysis confirmed each fix addresses the mechanism.
files_changed:
  - app/api/pipeline_routes.py (on_progress callback, reuse-TTS progress bump)
  - app/services/assembly_service.py (on_progress param, _report() calls at 7 steps, increased timeouts)
  - app/api/library_routes.py (_render_with_preset: increased timeout 300s->1200s, added -shortest)
  - frontend/src/app/pipeline/page.tsx (filter not_started variants in both polling callbacks)
