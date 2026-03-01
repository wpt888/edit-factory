---
status: resolved
trigger: "Comprehensive bug hunt across the entire pipeline feature of Edit Factory."
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:00:00Z
---

## Current Focus

hypothesis: Comprehensive audit complete — all bugs catalogued
test: Full static analysis of all pipeline files
expecting: Report of all bugs with severity and fix directions
next_action: Return structured report

## Symptoms

expected: Pipeline feature works end-to-end without issues
actual: Unknown — proactive audit
errors: None specifically reported
reproduction: N/A — proactive review
started: Pipeline built in v4 (phases 12-16), enhanced in v8 (phases 38-42)

## Evidence

- timestamp: 2026-02-25
  checked: app/api/pipeline_routes.py (1645 lines)
  found: Multiple bugs including closure capture issue, re-render guard preventing re-render, SRT cache key mismatch
  implication: Some renders may silently skip, SRT may be wrong

- timestamp: 2026-02-25
  checked: app/services/assembly_service.py (1059 lines)
  found: Silent segment filtering bug, SRT cache key inconsistency between preview_matches and assemble_and_render
  implication: Segments with missing file_path silently dropped; cached SRT could be wrong voice

- timestamp: 2026-02-25
  checked: app/services/script_generator.py
  found: Claude model ID hardcoded and potentially stale; short idea (<=50 chars) logs with "..." incorrectly
  implication: Minor — logging issue, model correctness TBD

- timestamp: 2026-02-25
  checked: app/services/segment_transforms.py
  found: Opacity filter uses format=rgba which may break on some video inputs causing FFmpeg pipeline errors
  implication: Medium — visual transform with opacity enabled can crash segment extraction

- timestamp: 2026-02-25
  checked: frontend/src/app/pipeline/page.tsx (2000+ lines)
  found: Stale closure in handleSourceToggle, audioRef cleanup misses blob URL case, missing error display resets
  implication: Medium — source video save may use stale pipelineId

- timestamp: 2026-02-25
  checked: frontend/src/components/timeline-editor.tsx
  found: Video preview effect does not clean up when selectedBlockIndex changes to a different match with same source_video_id; segment end enforcement references previewSegmentEndTimeRef but doesn't update when match changes
  implication: Medium — video preview may not seek correctly

---

## ROOT CAUSE FOUND — ALL BUGS CATALOGUED

# Pipeline Bug Audit Report

**Date:** 2026-02-25
**Files Audited:**
- `app/api/pipeline_routes.py`
- `app/api/assembly_routes.py`
- `app/services/assembly_service.py`
- `app/services/script_generator.py`
- `app/services/segment_transforms.py`
- `app/services/tts_subtitle_generator.py`
- `frontend/src/app/pipeline/page.tsx`
- `frontend/src/components/timeline-editor.tsx`

---

## BUG #1 — CRITICAL: Re-render of existing variants is silently skipped

**File:** `app/api/pipeline_routes.py`
**Line:** 1148
**Severity:** CRITICAL

**Description:**
The render loop only initializes a render job if the variant index is NOT already in `pipeline["render_jobs"]`:

```python
for variant_index in request.variant_indices:
    if variant_index not in pipeline["render_jobs"]:   # <-- GUARD
        pipeline["render_jobs"][variant_index] = { ... }
        async def do_render(vid=variant_index): ...
        background_tasks.add_task(do_render)
```

If a user renders variant 0, then re-renders it (e.g., after editing the script or changing settings), the guard `if variant_index not in pipeline["render_jobs"]` is True — the variant already has a render job from the first run — so **no new render job is created and no background task is added**. The API returns 200 OK and the frontend enters Step 4 polling, but the variant never actually re-renders. The old (stale) result is shown.

**Impact:** Users cannot re-render a variant after editing. The system silently returns the old result with no error.

**Suggested Fix:**
Remove the guard entirely, or only skip if the current status is "processing". Always create a new render job when the variant is in `request.variant_indices`:

```python
for variant_index in request.variant_indices:
    # Only skip if currently processing (avoid duplicate concurrent renders)
    existing_job = pipeline["render_jobs"].get(variant_index)
    if existing_job and existing_job.get("status") == "processing":
        continue  # Already rendering
    pipeline["render_jobs"][variant_index] = {
        "status": "processing",
        ...
    }
    # ... create background task
```

---

## BUG #2 — HIGH: SRT cache key inconsistency between preview_matches and assemble_and_render

**File:** `app/services/assembly_service.py`
**Lines:** 716 vs 916
**Severity:** HIGH

**Description:**
The SRT cache key is built differently in two methods:

In `assemble_and_render` (line 716):
```python
_srt_cache_key = {"text": script_text, "voice_id": voice_id or "", "model_id": elevenlabs_model, "provider": "elevenlabs_ts"}
```

In `preview_matches` (line 916):
```python
_srt_cache_key = {"text": script_text, "voice_id": "", "model_id": elevenlabs_model, "provider": "elevenlabs_ts"}
```

The `preview_matches` method always uses `voice_id: ""` regardless of what voice was requested. This means:
1. If a user previews with voice A, the SRT is cached with key `voice_id: ""`
2. If the same user then renders with voice B (different voice), the cache key uses `voice_id or ""` = voice B's ID — a different key — so it regenerates TTS unnecessarily.
3. Conversely, if they render with voice A, the key is `voice_id: "voice-a-id"` which doesn't match the preview cache (`voice_id: ""`), causing another unnecessary TTS generation.

The SRT content does not depend on the voice ID (it comes from the text's character timestamps), so the voice_id should either always be included or always excluded consistently. The current inconsistency causes cache misses, wastes ElevenLabs API credits, and adds latency on every render.

**Impact:** Extra TTS API calls on every render (wasted money + latency), even when audio was already generated in preview.

**Suggested Fix:**
Standardize the cache key. Since SRT is purely text-driven (not voice-dependent), use `voice_id: ""` in both:
```python
_srt_cache_key = {"text": script_text, "voice_id": "", "model_id": elevenlabs_model, "provider": "elevenlabs_ts"}
```

---

## BUG #3 — HIGH: Segments with missing source_video_path are silently dropped, no error if ALL are missing

**File:** `app/services/assembly_service.py`
**Lines:** 776-790 and 952-968
**Severity:** HIGH

**Description:**
Both `assemble_and_render` and `preview_matches` filter out segments where `editai_source_videos.file_path` is null:

```python
for seg in segments_result.data:
    source_video_path = seg.get("editai_source_videos", {}).get("file_path")
    if source_video_path:   # <-- silently skips if None
        segments_data.append(...)
```

If ALL segments have a null `editai_source_videos` relationship (e.g., the join fails, the column is empty, or the relationship doesn't resolve), `segments_data` will be empty. But the code only raises an error if `segments_result.data` is empty, not if `segments_data` is empty:

```python
if not segments_result.data:
    raise RuntimeError("No segments found in library. Please create segments first.")

# segments_data may still be empty here
```

This leads to a downstream crash at `build_timeline` or `assemble_video` with an unhelpful error rather than the clear "No segments found" message.

**Impact:** If the `editai_source_videos` join fails for any reason, the error message is cryptic rather than helpful.

**Suggested Fix:**
Add a check after building `segments_data`:
```python
if not segments_data:
    raise RuntimeError(
        "No segments with valid video paths found. "
        "Check that source videos exist and segments reference them correctly."
    )
```

---

## BUG #4 — HIGH: match_overrides key type mismatch (JSON int keys become strings)

**File:** `app/api/pipeline_routes.py`
**Lines:** 225, 1177
**Severity:** HIGH

**Description:**
The `PipelineRenderRequest` model declares `match_overrides` as `Optional[Dict[int, List[dict]]]`:

```python
match_overrides: Optional[Dict[int, List[dict]]] = None
```

When the frontend sends this JSON:
```json
{"match_overrides": {"0": [...], "1": [...]}}
```

JSON only supports string keys. Pydantic *should* coerce string keys to int for `Dict[int, ...]`, but this depends on Pydantic version and configuration. If key coercion does NOT happen, the lookup on line 1177:

```python
if request.match_overrides and vid in request.match_overrides:
```

will fail because `vid` is an `int` but the dict keys are strings `"0"`, `"1"`, etc., causing all match_overrides to be silently ignored. The render then falls back to automatic segment matching, discarding all user timeline edits.

**Impact:** All timeline editor customizations (segment swaps, duration adjustments, drag-and-drop reorders) are silently discarded during render. Users see different results than what the timeline editor showed.

**Suggested Fix:**
Defensively coerce keys when accessing, or convert the dict on receipt:
```python
# In the render endpoint, after fetching match_overrides:
if request.match_overrides:
    # Normalize keys to int
    normalized_overrides = {int(k): v for k, v in request.match_overrides.items()}
    if vid in normalized_overrides:
        variant_match_overrides = normalized_overrides[vid]
```

Or use `Optional[Dict[str, List[dict]]]` and convert to int when accessing.

---

## BUG #5 — HIGH: tts_previews not initialized on pipelines loaded from DB (old records)

**File:** `app/api/pipeline_routes.py`
**Lines:** 786-788, 858-860
**Severity:** HIGH

**Description:**
When pipelines are loaded from the database via `_db_load_pipeline`, the `tts_previews` field is always present (line 150). However, OLD pipeline records in the DB that were saved before the `tts_previews` column was added may have `NULL` for that column.

The DB load code handles this:
```python
tts_previews = {}
for k, v in (row.get("tts_previews") or {}).items():
```

But the `generate_variant_tts` and `adopt_library_tts` endpoints check:
```python
if "tts_previews" not in pipeline:
    pipeline["tts_previews"] = {}
```

This is correct for in-memory pipelines that were created before the field was added. However, the `render_variants` background task accesses:
```python
existing_tts = pipeline.get("tts_previews", {}).get(vid)
```

This uses `.get()` with default, which is safe. But the `update_pipeline_scripts` function at line 507 does:
```python
tts_previews = pipeline.get("tts_previews", {})
for i, new_script in enumerate(request.scripts):
    if i < len(old_scripts) and _stable_hash(...):
        tts_previews.pop(str(i), None)
        tts_previews.pop(i, None)
```

If `tts_previews` is `{}` (from `.get()` default), modifying it does NOT modify `pipeline["tts_previews"]` because it's a new empty dict — the pop() calls are no-ops on a fresh dict reference. The actual `pipeline["tts_previews"]` is unchanged.

**Impact:** TTS cache invalidation on script edit fails for pipelines that had no tts_previews initialized. Stale TTS audio may be reused even after the script changes.

**Suggested Fix:**
In `update_pipeline_scripts`, mutate the actual dict:
```python
if "tts_previews" not in pipeline:
    pipeline["tts_previews"] = {}
tts_previews = pipeline["tts_previews"]  # Direct reference, not copy from .get()
```

---

## BUG #6 — MEDIUM: SRT cache key in preview_matches ignores voice_id but voice affects TTS timing

**File:** `app/services/assembly_service.py`
**Line:** 916
**Severity:** MEDIUM

**Description:**
Related to Bug #2. In `preview_matches`, the SRT cache key uses `voice_id: ""` regardless of the actual voice. However, different ElevenLabs voices produce audio at different speeds, which affects the character-level timestamps. A script spoken by a fast voice has different per-character timestamps than the same script by a slow voice.

If a user previews with voice A (which populates the SRT cache with voice A's timing), then changes to voice B and previews again, the SRT cache hit returns voice A's SRT content — which has wrong timestamps relative to voice B's audio. The subtitles will be desynchronized.

**Impact:** After changing voice in Step 2, re-running preview may show desynchronized subtitles (subtitles appear at wrong times relative to spoken words).

**Suggested Fix:**
Include `voice_id` in the SRT cache key consistently in both methods:
```python
_srt_cache_key = {
    "text": script_text,
    "voice_id": voice_id or "",
    "model_id": elevenlabs_model,
    "provider": "elevenlabs_ts"
}
```

And align `preview_matches` to pass `voice_id` (it currently ignores it for cache purposes).

---

## BUG #7 — MEDIUM: Opacity transform filter incompatible with standard video format pipeline

**File:** `app/services/segment_transforms.py`
**Lines:** 109-111
**Severity:** MEDIUM

**Description:**
The opacity transform uses:
```python
filters.append(f"format=rgba,colorchannelmixer=aa={a:.2f}")
```

However, subsequent filters in the chain (scale, crop) and the final encode step use `yuv420p` pixel format (line 587 in assembly_service.py: `-pix_fmt yuv420p`). The `format=rgba` filter switches to RGBA (32-bit with alpha), then `colorchannelmixer` adjusts the alpha channel, but then the encoding to `yuv420p` drops the alpha channel entirely (since YUV420P has no alpha).

This means:
1. The opacity transform adds complexity but produces no visible effect (alpha is discarded during encode)
2. If the safety-net `scale=...` filter at the end of `to_ffmpeg_filters` runs after `format=rgba`, it may produce "Filtering error: Impossible to convert between the formats" in some FFmpeg versions since scale doesn't preserve RGBA correctly without explicit format specification

**Impact:** Opacity transforms are effectively non-functional (alpha discarded) and may cause FFmpeg errors on some builds.

**Suggested Fix:**
Use `colorchannelmixer` with RGB channels to simulate opacity by blending to black, which works in YUV space:
```python
# Blend toward black to simulate opacity (works in yuv420p)
filters.append(f"colorchannelmixer=rr={a:.2f}:gg={a:.2f}:bb={a:.2f}")
```
Or add `format=yuv420p` after the opacity filter to re-convert before scale.

---

## BUG #8 — MEDIUM: handleSourceToggle closure captures stale pipelineId

**File:** `frontend/src/app/pipeline/page.tsx`
**Lines:** 387-406
**Severity:** MEDIUM

**Description:**
```typescript
const handleSourceToggle = (videoId: string) => {
  setSelectedSourceIds(prev => {
    const next = new Set(prev);
    ...
    sourceSelectionTimer.current = setTimeout(() => {
      if (pipelineId) {   // <-- captured from outer closure
        apiPut(`/pipeline/${pipelineId}/source-selection`, {...}).catch(() => {});
      }
    }, 500);
    return next;
  });
};
```

The `pipelineId` value is captured from the outer closure scope at the time the component renders, not at the time the setTimeout fires. If:
1. The user opens the pipeline page (pipelineId = null)
2. They toggle a source video (setTimeout created with pipelineId = null)
3. The pipeline generates (pipelineId is now set)
4. The 500ms timeout fires with the OLD null pipelineId

The save never happens. Conversely, if pipelineId changes between user action and timeout fire, the save goes to the wrong pipeline.

**Impact:** Source video selection may not be persisted to the backend correctly when the pipeline ID changes shortly before/after the toggle.

**Suggested Fix:**
Use a ref to track pipelineId, or pass pipelineId explicitly:
```typescript
const pipelineIdRef = useRef(pipelineId);
useEffect(() => { pipelineIdRef.current = pipelineId; }, [pipelineId]);

// In the timeout:
if (pipelineIdRef.current) {
  apiPut(`/pipeline/${pipelineIdRef.current}/source-selection`, {...}).catch(() => {});
}
```

---

## BUG #9 — MEDIUM: `update_pipeline_scripts` does not update `tts_previews` in DB

**File:** `app/api/pipeline_routes.py`
**Lines:** 519-527
**Severity:** MEDIUM

**Description:**
When scripts change and TTS cache entries are invalidated (popped from `tts_previews`), the DB update only saves `scripts` and `variant_count`:

```python
supabase.table("editai_pipelines").update({
    "scripts": request.scripts,
    "variant_count": len(request.scripts),
}).eq("id", pipeline_id).execute()
```

The `tts_previews` column is NOT updated. So if the backend restarts and the pipeline is reloaded from DB, the old (now-stale) TTS entries are restored — the in-memory cache invalidation is lost.

**Impact:** After server restart, editing a script and then rendering may reuse stale TTS audio that no longer matches the script content.

**Suggested Fix:**
Include `tts_previews` in the DB update after invalidation:
```python
supabase.table("editai_pipelines").update({
    "scripts": request.scripts,
    "variant_count": len(request.scripts),
    "tts_previews": {str(k): v for k, v in pipeline["tts_previews"].items()},
}).eq("id", pipeline_id).execute()
```

---

## BUG #10 — MEDIUM: Timeline editor inline preview uses wrong audio endpoint

**File:** `frontend/src/components/timeline-editor.tsx`
**Line:** 589
**Severity:** MEDIUM

**Description:**
The inline preview player in the timeline editor uses:
```typescript
src={`${API_URL}/pipeline/audio/${pipelineId}/${variantIndex}`}
```

This endpoint (`/pipeline/audio/{pipeline_id}/{variant_index}`) returns audio from `previews[variant_index].preview_data.audio_path` — which is the Step 3 preview audio (from `preview_variant` endpoint). However, in Step 2 (Review Scripts), there may not be a Step 3 preview yet.

The timeline editor is shown at Step 3 (Preview Matches), so Step 3 audio should be available. But if the user navigates back to Step 2 and the timeline editor somehow renders with `isPreviewActive`, it would get a 404 for the audio.

More importantly: if the user has adopted library TTS (which stores audio in `tts_previews` not `previews`), the `/pipeline/audio/` endpoint returns 404 (it only reads from `previews`). The `/pipeline/tts-audio/` endpoint reads from `tts_previews`. The timeline editor always uses `/pipeline/audio/`, so library-adopted TTS audio does NOT work in the timeline editor inline preview.

**Impact:** Users who adopted library TTS in Step 2 cannot use the timeline editor's inline preview in Step 3 — they get a 404 audio error.

**Suggested Fix:**
The backend `/pipeline/audio/` endpoint should fall back to `tts_previews` if `previews` doesn't have audio for the variant:

```python
# In get_pipeline_audio:
# Try previews first
preview = pipeline.get("previews", {}).get(variant_index)
if preview:
    preview_data = preview.get("preview_data", {})
    audio_path_str = preview_data.get("audio_path")
    if audio_path_str and Path(audio_path_str).exists():
        return FileResponse(...)

# Fall back to tts_previews
tts_preview = pipeline.get("tts_previews", {}).get(variant_index)
if tts_preview:
    audio_path_str = tts_preview.get("audio_path")
    ...
```

---

## BUG #11 — MEDIUM: Script model for Claude is hardcoded and potentially wrong

**File:** `app/services/script_generator.py`
**Line:** 200
**Severity:** MEDIUM

**Description:**
The Claude model is hardcoded:
```python
model="claude-sonnet-4-20250514",
```

This is a specific dated model that may be deprecated or unavailable depending on the Anthropic account. Unlike Gemini (which uses `settings.gemini_model` allowing env config), the Claude model has no configuration path — it cannot be changed without code modification.

Additionally, `claude-sonnet-4-20250514` is a model ID format that may not exist as of the current date (2026-02-25). The actual current Claude Sonnet model is likely `claude-sonnet-4-6` or `claude-3-5-sonnet-20241022`.

**Impact:** Script generation with Claude provider may fail with a model-not-found error if the hardcoded model ID is invalid or deprecated.

**Suggested Fix:**
Add a `claude_model` config field to settings (similar to `gemini_model`), defaulting to the latest stable ID. Load it in `get_script_generator()`.

---

## BUG #12 — MEDIUM: Preview error state not cleared on step navigation

**File:** `frontend/src/app/pipeline/page.tsx`
**Lines:** 667-742
**Severity:** MEDIUM

**Description:**
The `previewError` state is set on render failure but is never cleared when the user navigates to a different step. The render error (displayed in Step 4) may still be visible if the user goes back to Step 3 and forward again. More critically, the state variable `previewError` is used for BOTH preview errors (Step 3) AND render errors (Step 4) with no distinction.

If Step 3 preview fails and sets `previewError`, then the user fixes the issue and navigates to Step 4, the error alert from Step 3 may still display in Step 4's render section.

**Impact:** Stale error messages from previous operations may confuse the user about the current state.

**Suggested Fix:**
Clear `previewError` at the start of `handlePreviewAll` (already done) and also at the start of `handleRender`. Alternatively, use separate error state variables: `previewStepError` and `renderStepError`.

---

## BUG #13 — MEDIUM: audioRef blob URL not revoked on unmount in history audio player

**File:** `frontend/src/app/pipeline/page.tsx`
**Lines:** 1107-1125
**Severity:** MEDIUM

**Description:**
The cleanup in the unmount effect:
```typescript
if (audioRef.current) {
    const src = audioRef.current.src;
    audioRef.current.pause();
    audioRef.current = null;
    if (src.startsWith("blob:")) URL.revokeObjectURL(src);
}
```

This looks correct for `audioRef`. However, in `handlePlayAudio` (line 1094), the audio is constructed from a fetched blob:
```typescript
const url = URL.createObjectURL(blob);
const audio = new Audio(url);
audio.onended = () => { setPlayingAudio(null); URL.revokeObjectURL(url); };
audio.onerror = () => { setPlayingAudio(null); URL.revokeObjectURL(url); };
```

The `Audio(url)` object has `src` set to the blob URL. The cleanup code reads `audioRef.current.src` which correctly gets the blob URL. BUT: if the component unmounts while audio is loading (blob fetched but audio not yet started playing), `audioRef.current` is null at that point because it's set inside the `.then()` after the blob loads — and `audioRef.current = audio` only happens after `audio.play()` is called. If unmount happens between `setPlayingAudio(audioKey)` and the play starting, the blob URL is never revoced.

**Impact:** Memory leak — blob URLs are not revoked if the component unmounts during audio loading. Minor in practice (single audio playback), but should be fixed.

**Suggested Fix:**
Store the URL in a ref and revoke in the unmount handler, or use `AbortController` to cancel the fetch on unmount.

---

## BUG #14 — LOW: Timeline editor video preview does not detect same-source segment change

**File:** `frontend/src/components/timeline-editor.tsx`
**Lines:** 466-507
**Severity:** LOW

**Description:**
The video preview effect only changes the video `src` when `sourceVideoId !== lastSourceVideoId.current`:
```typescript
if (sourceVideoId && sourceVideoId !== lastSourceVideoId.current && profileId) {
    lastSourceVideoId.current = sourceVideoId;
    video.src = `.../${sourceVideoId}/stream...`;
    video.load();
}
```

If the user swaps between two segments from the SAME source video but at different timestamps (e.g., segment A: 10-15s and segment B: 25-30s from the same video), the `sourceVideoId` doesn't change, so `video.src` and `video.load()` are not called. The video stays at its previous position.

The code then relies on:
```typescript
if (video.readyState >= 2) {
    video.currentTime = startTime;
    video.play().catch(() => {});
}
```

This SHOULD correctly seek to `startTime`. But if the video was paused at `endTime` from the previous segment, the `readyState` is >= 2, so `currentTime` is set and play is called. This part actually works.

However, the `handleTimeUpdate` listener from the previous effect is not cleaned up when `selectedBlockIndex` changes to a NEW match — the cleanup runs at the start of the next effect, but there's a race where the old `endTime` check may fire on the new position.

Actually, the `return () => { video.removeEventListener(...) }` cleanup IS correct. This bug is LOW severity.

**Impact:** Theoretically a brief flash where the wrong endTime is used, but practically the cleanup happens synchronously before the new effect runs.

---

## BUG #15 — LOW: Incorrect log message for short ideas in script_generator

**File:** `app/services/script_generator.py`
**Line:** 88-89
**Severity:** LOW

**Description:**
```python
logger.info(
    f"Generating {variant_count} scripts with {provider} "
    f"(idea: {idea[:50]}..., {len(keywords)} keywords available)"
)
```

The log message always appends `...` after the truncated idea, even if the idea is shorter than 50 characters. For example, with idea "shorts video" (12 chars), the log shows: `idea: shorts video..., 5 keywords available` — the `...` is misleading since nothing was truncated.

**Impact:** Cosmetic — misleading log output.

**Suggested Fix:**
```python
idea_display = idea[:50] + ("..." if len(idea) > 50 else "")
```

---

## BUG #16 — LOW: Pipeline eviction uses alphabetical sort on UUID strings (not creation time)

**File:** `app/api/pipeline_routes.py`
**Lines:** 46-52
**Severity:** LOW

**Description:**
```python
def _evict_old_pipelines():
    if len(_pipelines) > _MAX_PIPELINE_ENTRIES:
        to_remove = sorted(_pipelines.keys())[:len(_pipelines) - _MAX_PIPELINE_ENTRIES]
```

`_pipelines` keys are UUIDs (random strings). Sorting them alphabetically does NOT evict the oldest pipelines first — it evicts by UUID alphabetical order, which is essentially random. This means recently-created pipelines may be evicted while old ones are kept.

**Impact:** Under high load (>1000 pipelines in memory), the wrong pipelines are evicted. Effectively this is a random cache eviction policy, not LRU/FIFO. Practically rare since 1000 pipelines is a lot.

**Suggested Fix:**
Track insertion order or sort by `created_at`:
```python
to_remove = sorted(
    _pipelines.keys(),
    key=lambda k: _pipelines[k].get("created_at", "")
)[:len(_pipelines) - _MAX_PIPELINE_ENTRIES]
```

---

## BUG #17 — LOW: assembly_routes.py `assemble_and_render` doesn't pass `voice_id`

**File:** `app/api/assembly_routes.py`
**Lines:** 343-361
**Severity:** LOW

**Description:**
The `do_assembly` background task in `assembly_routes.py` calls `assemble_and_render` without passing `voice_id` or `voice_settings`:

```python
final_video_path = await assembly_service.assemble_and_render(
    script_text=request.script_text,
    profile_id=profile.profile_id,
    preset_data=preset_data,
    subtitle_settings=subtitle_settings,
    elevenlabs_model=request.elevenlabs_model,
    # voice_id NOT passed
    # voice_settings NOT passed
    ...
)
```

The `AssemblyRenderRequest` model also has no `voice_id` or `voice_settings` fields. This means the standalone assembly route (not the pipeline route) always uses the account's default voice, with no way for the caller to specify a voice.

**Impact:** Users of the `/assembly/render` endpoint cannot specify a voice. This is a limited route (mainly used for standalone assembly, not the multi-variant pipeline), so impact is minimal. But it's a feature gap.

**Suggested Fix:**
Add `voice_id` and `voice_settings` fields to `AssemblyRenderRequest` and pass them through.

---

## Summary Table

| # | Severity | File | Line(s) | Description |
|---|----------|------|---------|-------------|
| 1 | CRITICAL | pipeline_routes.py | 1148 | Re-render silently skipped (guard prevents re-render of existing jobs) |
| 2 | HIGH | assembly_service.py | 716 vs 916 | SRT cache key inconsistency causes cache misses on every render |
| 3 | HIGH | assembly_service.py | 779, 955 | Segments with null source_video_path silently dropped, no error if all are null |
| 4 | HIGH | pipeline_routes.py | 225, 1177 | match_overrides key type mismatch (JSON string keys vs int lookup) |
| 5 | HIGH | pipeline_routes.py | 507-511 | TTS cache invalidation mutates copy, not original dict (old pipelines) |
| 6 | MEDIUM | assembly_service.py | 916 | SRT cache ignores voice_id, causes subtitle desync after voice change |
| 7 | MEDIUM | segment_transforms.py | 109-115 | Opacity filter uses RGBA format incompatible with yuv420p encode |
| 8 | MEDIUM | pipeline/page.tsx | 397-402 | handleSourceToggle closure captures stale pipelineId |
| 9 | MEDIUM | pipeline_routes.py | 519-527 | TTS cache invalidation not persisted to DB (lost on restart) |
| 10 | MEDIUM | timeline-editor.tsx | 589 | Inline preview uses wrong audio endpoint (ignores tts_previews) |
| 11 | MEDIUM | script_generator.py | 200 | Claude model hardcoded, may be deprecated |
| 12 | MEDIUM | pipeline/page.tsx | ~667 | previewError not cleared on step navigation |
| 13 | MEDIUM | pipeline/page.tsx | 1107 | Blob URL memory leak on unmount during audio loading |
| 14 | LOW | timeline-editor.tsx | 466 | Same-source video segment change may have brief timing issue |
| 15 | LOW | script_generator.py | 88 | Short ideas get misleading "..." in logs |
| 16 | LOW | pipeline_routes.py | 49 | Pipeline eviction sorts by UUID not creation time |
| 17 | LOW | assembly_routes.py | 343 | Standalone assembly route missing voice_id/voice_settings |

---

## Priority Fix Order

1. **BUG #1** (CRITICAL) — Fix re-render guard immediately. Users cannot iterate on renders.
2. **BUG #4** (HIGH) — Fix match_overrides key type. Timeline editor changes are silently discarded.
3. **BUG #5** (HIGH) — Fix TTS cache invalidation dict mutation.
4. **BUG #2 + #6** (HIGH+MEDIUM) — Standardize SRT cache key in both methods.
5. **BUG #3** (HIGH) — Add error on empty segments_data after filtering.
6. **BUG #9** (MEDIUM) — Persist TTS cache invalidation to DB.
7. **BUG #10** (MEDIUM) — Fix timeline editor audio endpoint to include tts_previews fallback.
8. **BUG #7** (MEDIUM) — Fix opacity transform compatibility.
9. **BUG #8** (MEDIUM) — Fix stale closure in handleSourceToggle.
10. Remaining LOW severity bugs — fix opportunistically.
