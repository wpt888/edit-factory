# Phase 20: Single Product End-to-End - Research

**Researched:** 2026-02-21
**Domain:** Product video generation pipeline — TTS voiceover wiring, subtitle integration, job dispatch, library integration
**Confidence:** HIGH (all findings from direct codebase inspection; no external research required)

## Summary

Phase 20 is an integration phase, not a greenfield build. Every major component already exists: the compositor (`product_video_compositor.py`), the TTS factory (`app/services/tts/factory.py`), the subtitle generator (`tts_subtitle_generator.py`), the script generator (`script_generator.py`), the job storage system (`JobStorage`), the polling hook (`useJobPolling`), and the render pipeline (`_render_with_preset` in `library_routes.py`). The work is wiring these together with a new endpoint and a new frontend page.

The pipeline for a single product video follows this exact flow:
1. Frontend calls `POST /api/v1/products/{product_id}/generate` with generation config
2. Backend creates a job via `JobStorage`, dispatches a `BackgroundTask`, returns `job_id` immediately
3. Background task: fetch product row → download/resolve image → optionally generate TTS text (quick template or elaborate AI) → synthesize TTS audio → generate SRT from timestamps → run `compose_product_video` (existing compositor) to get a silent video with overlays → mux audio into the composed video using `_render_with_preset` logic → write clip row to `editai_clips` with `final_status=completed` → update job to `completed`
4. Frontend polls `GET /api/v1/jobs/{job_id}` using the existing `useJobPolling` hook
5. On completion, the clip appears in the existing `/librarie` library page

The key architectural decision is the **two-phase video construction**: the compositor produces a video WITH visual overlays but NO audio, and then the audio mux + subtitle burn step uses existing `_render_with_preset` infrastructure. The `product_video_compositor.py` currently outputs libx264 with `crf=20` at `veryfast`, which does not apply the encoding preset (TikTok/Reels/Shorts). The correct approach for OUT-01/OUT-02/OUT-03 is to either: (a) have the compositor produce a raw/lossless intermediate and feed it through `_render_with_preset`, or (b) merge audio and subtitles into the FFmpeg command of the compositor itself. Option (a) is cleaner and reuses existing code.

**Primary recommendation:** Build a new `product_generate_task` background function in a new `app/api/product_generate_routes.py`, wire TTS and subtitle generation directly using the existing factory and `generate_srt_from_timestamps`, pass the compositor output through `_render_with_preset` for audio mux + encoding preset + filters + subtitles, then write the result directly into `editai_clips` with `final_status=completed`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TTS-01 | Quick mode: voiceover from template text (title + price + brand) | `get_tts_service()` factory handles any provider; template string is trivially constructed from `products` row fields |
| TTS-02 | Elaborate mode: AI-generated script from product description via Gemini/Claude | `ScriptGenerator.generate_scripts()` already exists; needs a product-aware prompt variant (pass `description` as `context` param) |
| TTS-03 | User can choose TTS provider (ElevenLabs or Edge TTS); Edge TTS default for batch | `get_tts_service(provider, profile_id, voice_id)` factory supports both; provider sent as request param; default `edge` per roadmap decision |
| TTS-04 | Synced subtitles from TTS timestamps (reuse v4 pipeline) | `generate_srt_from_timestamps(timestamps)` in `tts_subtitle_generator.py` handles ElevenLabs char-level timestamps; Edge TTS does NOT return timestamps (returns empty dict from `TTSResult.timestamps`) — need word-level workaround or skip subtitles for Edge |
| BATCH-01 | User can generate a single product video and preview it | New `POST /products/{product_id}/generate` endpoint + frontend page with generate button + `useJobPolling` |
| BATCH-05 | Generated videos land in existing library (clips table) | Write `editai_projects` row (product video project type) + `editai_clips` row with `final_video_path` and `final_status=completed` at end of task |
| OUT-01 | Use existing encoding presets (TikTok/Reels/Shorts) | `get_preset(name)` from `encoding_presets.py`; pass preset dict to `_render_with_preset` |
| OUT-02 | Use existing -14 LUFS audio normalization | `measure_loudness()` + `build_loudnorm_filter()` from `audio_normalizer.py`; already called inside `_render_with_preset` when `preset.normalize_audio=True` |
| OUT-03 | Use existing video filters if enabled | `VideoFilters` / `DenoiseConfig` / `SharpenConfig` / `ColorConfig` from `video_filters.py`; request body includes filter params same as assembly render |
| OUT-04 | Product videos publishable via existing Postiz integration | No new work needed — Postiz works on any `editai_clips` row with `final_video_path`; clips land in library automatically |
</phase_requirements>

## Standard Stack

### Core (no new dependencies)

| Component | Location | Purpose | Notes |
|-----------|----------|---------|-------|
| `product_video_compositor.py` | `app/services/` | Ken Burns animation + text overlays → silent MP4 | Already complete from Phase 18 |
| `tts/factory.py` | `app/services/tts/` | `get_tts_service(provider, profile_id, voice_id)` → `TTSService` | Supports `elevenlabs` and `edge`; returns `TTSResult` with optional `timestamps` |
| `tts_subtitle_generator.py` | `app/services/` | `generate_srt_from_timestamps(dict)` → SRT string | Character-level ElevenLabs timestamps → SRT; returns empty string for None |
| `script_generator.py` | `app/services/` | `ScriptGenerator.generate_scripts(idea, context, keywords, variant_count, provider)` | Gemini or Claude; context param accepts product description |
| `job_storage.py` | `app/services/` | `get_job_storage().create_job()` / `update_job()` | Supabase primary + in-memory fallback; `GET /api/v1/jobs/{job_id}` endpoint already exists |
| `encoding_presets.py` | `app/services/` | `get_preset(name)` → `EncodingPreset` | Presets: TikTok, Reels, YouTube Shorts |
| `audio_normalizer.py` | `app/services/` | `measure_loudness()` + `build_loudnorm_filter()` | Two-pass EBU R128, -14 LUFS target |
| `useJobPolling` | `frontend/src/hooks/use-job-polling.ts` | Polls `GET /api/v1/jobs/{job_id}` every 2s | Full ETA calculation, `onComplete` / `onError` callbacks |
| `JobStorage.update_job()` | `app/services/job_storage.py` | Update job status/progress | Supabase table: `jobs` |

### Supporting

| Component | Location | Purpose | Notes |
|-----------|----------|---------|-------|
| `auth.py` | `app/api/` | `get_profile_context` → `ProfileContext` | Same pattern as all other routes |
| `_render_with_preset()` | `app/api/library_routes.py` (line 2585) | Audio mux + encoding preset + filters + subtitle burn | Currently a module-level private function; needs to be importable or duplicated |
| `subtitle_styler.py` | `app/services/` | `build_subtitle_filter()` | For SRT → ASS filter in `_render_with_preset` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing `_render_with_preset` | Duplicating FFmpeg command | Duplication risks divergence; import is better |
| `generate_scripts()` for elaborate | Custom prompt in task | Better reuse; just pass `description` as `context` and `title` as `idea` |
| Edge TTS for subtitles | Skip subtitles for Edge | Edge TTS `TTSResult.timestamps` is `None` always (no word-level API); generate SRT only when provider is ElevenLabs |

**Installation:** No new packages needed. All dependencies already in `requirements.txt`.

## Architecture Patterns

### Recommended Project Structure

```
app/api/
└── product_generate_routes.py    # NEW: POST /products/{product_id}/generate
                                   #      + background task function

app/services/
└── (no new services — all reuse existing)

frontend/src/app/
└── product-video/
    └── page.tsx                   # NEW: generate form + polling UI
```

### Pattern 1: BackgroundTask with JobStorage (established pattern)

**What:** Endpoint creates job synchronously, returns `job_id`, task runs in background and updates job status.
**When to use:** All video generation endpoints in this codebase use this pattern.
**Example (from `assembly_routes.py` and `routes.py`):**

```python
# In endpoint:
job_id = str(uuid.uuid4())
job_storage = get_job_storage()
job_storage.create_job({
    "job_id": job_id,
    "job_type": "product_video",
    "status": "pending",
    "progress": "0",
}, profile_id=profile.profile_id)

background_tasks.add_task(
    _generate_product_video_task,
    job_id=job_id,
    product_id=product_id,
    config=config,
    profile_id=profile.profile_id,
)
return {"job_id": job_id, "status": "pending"}

# In background task:
job_storage.update_job(job_id, {"status": "processing", "progress": "10"})
# ... work ...
job_storage.update_job(job_id, {"status": "completed", "progress": "100", "result": {...}})
```

### Pattern 2: Library Integration (clips table)

**What:** Product videos must appear in the existing `/librarie` page. This page reads `editai_clips` filtered by `profile_id`. A product video needs both an `editai_projects` row (as a container) and an `editai_clips` row.

**Approach:** Create a lightweight "product video project" row per product video generation. The project `name` can be the product title (truncated). Then insert the clip row pointing to the final rendered video path.

```python
# Create project row
project = supabase.table("editai_projects").insert({
    "name": f"Product: {product['title'][:50]}",
    "profile_id": profile_id,
    "status": "completed",
    "target_duration": config.duration_s,
    "context_text": product.get("description", ""),
}).execute()
project_id = project.data[0]["id"]

# Create clip row
clip = supabase.table("editai_clips").insert({
    "project_id": project_id,
    "profile_id": profile_id,
    "raw_video_path": str(composed_video_path),
    "final_video_path": str(final_video_path),
    "final_status": "completed",
    "variant_index": 0,
    "duration": audio_duration_or_video_duration,
}).execute()
clip_id = clip.data[0]["id"]
```

### Pattern 3: TTS + Subtitle Integration

**What:** Generate audio with `get_tts_service()`, extract timestamps, convert to SRT.
**Important:** Edge TTS never returns timestamps (`TTSResult.timestamps` is always `None`). Only ElevenLabs supports character-level timing.

```python
tts_service = get_tts_service(
    provider=config.tts_provider,  # "edge" or "elevenlabs"
    profile_id=profile_id,
    voice_id=config.voice_id,
)
output_path = temp_dir / f"tts_{job_id}.mp3"
tts_result = await tts_service.generate_audio(
    text=voiceover_text,
    voice_id=config.voice_id or tts_service.default_voice,
    output_path=output_path,
)

# Subtitles only when timestamps available (ElevenLabs only)
srt_content = ""
if tts_result.timestamps:
    srt_content = generate_srt_from_timestamps(tts_result.timestamps)
```

**Note:** `ElevenLabsTTSService` has a separate `generate_audio_with_timestamps()` method that must be called explicitly (not the base `generate_audio()`). Use `generate_audio_with_timestamps()` for ElevenLabs to get timestamps.

### Pattern 4: Two-Phase Video Construction

**What:** Compositor outputs a silent video with overlays (Phase 18). Audio + subtitle mux is a separate step using `_render_with_preset`.

**Problem:** `_render_with_preset` is a private function in `library_routes.py`. It needs to be accessible from the new routes file.

**Solution options (in preference order):**
1. Move `_render_with_preset` to a shared service (`app/services/render_pipeline.py`) and import from both `library_routes.py` and `product_generate_routes.py`
2. Duplicate the FFmpeg mux logic inline (avoid — divergence risk)
3. Import it directly with `from app.api.library_routes import _render_with_preset` (works but couples route files)

Option 1 is cleanest. Option 3 is fastest and acceptable for Phase 20 since `library_routes.py` already imports from services freely.

### Pattern 5: Quick vs Elaborate Mode

**Quick mode (TTS-01):** Template string constructed from product fields, no AI call.
```python
def build_quick_voiceover(product: dict, template: str = "{title}. {brand}. Pret: {price}.") -> str:
    price = product.get("raw_sale_price_str") or product.get("raw_price_str") or ""
    brand = product.get("brand") or ""
    title = product.get("title", "")
    return template.format(title=title, brand=brand, price=price).strip()
```

**Elaborate mode (TTS-02):** Use `ScriptGenerator.generate_scripts()` with `variant_count=1`:
```python
generator = ScriptGenerator(
    gemini_api_key=settings.gemini_api_key,
    anthropic_api_key=settings.anthropic_api_key,
)
scripts = generator.generate_scripts(
    idea=product["title"],
    context=product.get("description", ""),
    keywords=[],  # No segment keywords needed for product videos
    variant_count=1,
    provider=config.ai_provider,  # "gemini" or "claude"
)
voiceover_text = scripts[0]
```

### Anti-Patterns to Avoid

- **Running `compose_product_video` synchronously in a route handler:** Will block the server for 15-60 seconds. Always dispatch as `BackgroundTask`.
- **Generating subtitles for Edge TTS:** Edge TTS has no timestamp API. Check `tts_result.timestamps is not None` before calling `generate_srt_from_timestamps`. Do not fabricate timestamps.
- **Muxing audio directly in the compositor command:** Loses the `-14 LUFS` normalization, preset encoding settings, and video filter chain. Always use `_render_with_preset` as the final step.
- **Using `text=` instead of `textfile=` in FFmpeg:** The compositor already uses `textfile=` for all product text. Do not bypass this in any new compositor calls.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job status tracking | Custom dict in module scope | `get_job_storage()` | Supabase persistence survives server restart; in-memory fallback already coded |
| Frontend polling | Custom setInterval | `useJobPolling` hook | ETA calculation, error retry, cleanup on unmount all handled |
| TTS synthesis | Direct httpx/edge_tts calls | `get_tts_service()` factory | Provider abstraction, cache integration, multi-account failover for ElevenLabs |
| SRT generation | Word-splitting logic | `generate_srt_from_timestamps()` | 3-step grouping (chars→words→phrases) tested and working |
| AI script generation | Direct Gemini/Claude calls | `ScriptGenerator.generate_scripts()` | TTS sanitization, delimiter parsing, error handling already done |
| Audio normalization | Direct loudnorm filter | `measure_loudness()` + `build_loudnorm_filter()` | Two-pass EBU R128 with correct parameter extraction is non-trivial |
| Encoding presets | Hardcoded FFmpeg params | `get_preset(name)` | All social media platform specs already validated |

**Key insight:** Phase 20 is 80% wiring and 20% new code. The risk is not complexity — it's integration gaps (Edge TTS timestamps, `_render_with_preset` accessibility, product image path resolution).

## Common Pitfalls

### Pitfall 1: Edge TTS Has No Timestamp API

**What goes wrong:** `generate_srt_from_timestamps(tts_result.timestamps)` is called when provider is Edge, but `tts_result.timestamps` is `None` for Edge TTS (the `EdgeTTSService.generate_audio()` method never sets timestamps). The function returns an empty string safely, but subtitles will be missing entirely for Edge TTS.
**Why it happens:** Edge TTS (`edge-tts` library) provides word boundary events in a streaming API but `EdgeTTSService` does not capture them — it uses `communicate.save()` which only writes audio.
**How to avoid:** Guard subtitle generation: `srt_content = generate_srt_from_timestamps(tts_result.timestamps) if tts_result.timestamps else ""`. Document that subtitles require ElevenLabs. Do NOT attempt to add edge-tts word boundary event capture in Phase 20 (out of scope).
**Warning signs:** Empty SRT file, no subtitles in output video when using Edge TTS.

### Pitfall 2: `generate_audio_with_timestamps` vs `generate_audio` on ElevenLabs

**What goes wrong:** Calling the base `generate_audio()` on `ElevenLabsTTSService` does NOT return timestamps — only `generate_audio_with_timestamps()` does. The base method returns `TTSResult(timestamps=None)`.
**Why it happens:** The ElevenLabs service has two separate API calls: standard TTS endpoint and the `/with-timestamps` endpoint. The factory returns a `TTSService` with the base interface, but ElevenLabs-specific timestamp method is only on the concrete class.
**How to avoid:** Cast to `ElevenLabsTTSService` when provider is ElevenLabs and call `generate_audio_with_timestamps()` directly, or check `isinstance`. Pattern from `_render_final_clip_task` (line 1864-1887 in library_routes.py) shows the exact pattern to copy.
**Warning signs:** `tts_result.timestamps is None` even when using ElevenLabs.

### Pitfall 3: Product Image Path Resolution

**What goes wrong:** Products have `image_link` (remote URL) and `local_image_path` (downloaded path). The local path may be `None` if image download failed during sync. `compose_product_video()` requires a local file path and raises `FileNotFoundError` if the file does not exist.
**Why it happens:** Image downloads during feed sync are non-fatal — products are upserted even if images fail (Phase 17 decision). `local_image_path` can be NULL in the DB.
**How to avoid:** Check `local_image_path` first. If NULL or file does not exist, attempt to re-download from `image_link` into a temp path. If that also fails, surface a clear error in the job: `"status": "failed", "error": "Product image not available"`.
**Warning signs:** `FileNotFoundError` in background task, job transitions to `failed` immediately.

### Pitfall 4: Compositor Outputs Silent Video, Final Render Must Mux Audio

**What goes wrong:** If the job result stores `composed_video_path` (the compositor output) instead of `final_video_path` (after `_render_with_preset`), the library clip has no audio, no subtitles, and incorrect encoding.
**Why it happens:** Two steps can be confused — compositor writes a valid MP4 (it IS playable) but without audio or normalization.
**How to avoid:** The clip row in `editai_clips` must only be written AFTER `_render_with_preset` completes. Store `composed_video_path` only in the job's temporary state, never as the final clip path.

### Pitfall 5: `_render_with_preset` Import Coupling

**What goes wrong:** `_render_with_preset` is a private module-level function in `library_routes.py`. Importing it from another file works in Python (private names are a convention, not enforced) but creates tight coupling between route files.
**Why it happens:** The function was written as a helper for `_render_final_clip_task` and never extracted to a service.
**How to avoid:** For Phase 20, import it directly: `from app.api.library_routes import _render_with_preset`. Document that this should be refactored to a service in a future phase. Do NOT delay Phase 20 to do the refactor.

### Pitfall 6: `ScriptGenerator.generate_scripts()` Is Synchronous

**What goes wrong:** `ScriptGenerator.generate_scripts()` makes blocking HTTP calls to Gemini/Claude. If called from an `async` background task, this blocks the event loop.
**Why it happens:** The `ScriptGenerator` uses `genai` and `anthropic` SDK clients which are synchronous in current implementation.
**How to avoid:** Either run in a `ThreadPoolExecutor` with `await loop.run_in_executor()`, or accept the limitation since background tasks in FastAPI are already off the main request path. Given that `_render_final_clip_task` in `library_routes.py` is also `async` but calls synchronous FFmpeg subprocess, the pattern of mixing sync and async is already established — it's acceptable here.

## Code Examples

Verified patterns from codebase inspection:

### Creating a Job and Dispatching BackgroundTask
```python
# Source: app/api/routes.py + assembly_routes.py pattern
import uuid
from app.services.job_storage import get_job_storage

@router.post("/products/{product_id}/generate")
async def generate_product_video(
    product_id: str,
    request: ProductGenerateRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    job_id = str(uuid.uuid4())
    job_storage = get_job_storage()
    job_storage.create_job({
        "job_id": job_id,
        "job_type": "product_video",
        "status": "pending",
        "progress": "0",
    }, profile_id=profile.profile_id)

    background_tasks.add_task(
        _generate_product_video_task,
        job_id=job_id,
        product_id=product_id,
        request=request,
        profile_id=profile.profile_id,
    )
    return {"job_id": job_id, "status": "pending"}
```

### TTS + Timestamp + SRT Pattern (ElevenLabs)
```python
# Source: adapted from library_routes.py _render_final_clip_task lines 1864-1887
from app.services.tts.elevenlabs import ElevenLabsTTSService
from app.services.tts_subtitle_generator import generate_srt_from_timestamps

tts_service = ElevenLabsTTSService(
    output_dir=temp_dir,
    profile_id=profile_id,
)
tts_result, timestamps = await tts_service.generate_audio_with_timestamps(
    text=voiceover_text,
    voice_id=tts_service._voice_id,
    output_path=temp_dir / f"tts_{job_id}.mp3",
)
srt_content = generate_srt_from_timestamps(timestamps) if timestamps else ""
```

### TTS Pattern (Edge TTS — no timestamps)
```python
# Source: app/services/tts/edge.py
from app.services.tts.factory import get_tts_service

tts_service = get_tts_service("edge", profile_id=profile_id)
tts_result = await tts_service.generate_audio(
    text=voiceover_text,
    voice_id="ro-RO-EmilNeural",  # or from profile tts_settings
    output_path=temp_dir / f"tts_{job_id}.mp3",
)
# tts_result.timestamps is None for Edge TTS
srt_content = ""  # No subtitles for Edge TTS
```

### Frontend Polling Pattern
```typescript
// Source: frontend/src/hooks/use-job-polling.ts
const { startPolling, isPolling, progress, statusText, currentJob } = useJobPolling({
  apiBaseUrl: "http://localhost:8000/api/v1",
  onComplete: (result) => {
    toast.success("Video generated!");
    // result.clip_id available for library navigation
  },
  onError: (error) => toast.error(error),
});

// After POST /products/{id}/generate returns job_id:
startPolling(jobId);
```

### Inserting Clip into Library
```python
# Source: editai_clips table schema from Supabase inspection
# Required fields: project_id, profile_id, raw_video_path, variant_index
supabase.table("editai_clips").insert({
    "project_id": project_id,
    "profile_id": profile_id,
    "raw_video_path": str(composed_path),    # compositor output (silent)
    "final_video_path": str(final_path),     # after _render_with_preset
    "final_status": "completed",
    "variant_index": 0,
    "duration": video_duration,
    "is_selected": True,
    "is_deleted": False,
}).execute()
```

## State of the Art

| Old Approach | Current Approach | Status |
|--------------|------------------|--------|
| Hardcoded ElevenLabs TTS calls | `get_tts_service()` factory | Factory established in Phase 12 |
| Whisper ASR for subtitles | `generate_srt_from_timestamps()` from TTS timestamps | Established in Phase 13 |
| Inline FFmpeg encoding | `_render_with_preset()` with encoding presets | Established in Phase 7-9 |
| In-memory job storage | `JobStorage` with Supabase persistence + fallback | Established in Phase 12 |

**Note on `progress` field in `jobs` table:** The DB column is `double precision` (float) but `JobStorage.update_job()` stores the full `job_data` dict in the `data` JSONB column. The `progress` field in the dict is a string like `"25"` (percent) — this is what `useJobPolling` reads via `parseInt(job.progress)`. Match this convention exactly.

## Open Questions

1. **Edge TTS Voice for Romanian Products**
   - What we know: `EdgeTTSService` default voice is `"en-US-GuyNeural"`. Product titles/prices are in Romanian.
   - What's unclear: Should the voice be hardcoded to `ro-RO-EmilNeural` for product videos, or pulled from the profile's `tts_settings.edge.voice`?
   - Recommendation: Read from `profile.tts_settings["edge"]["voice"]` if available, otherwise default to `"ro-RO-EmilNeural"` for this use case. This is a configuration detail for Plan 20-03.

2. **`_render_with_preset` import approach**
   - What we know: The function exists at `library_routes.py:2585`, is private by convention, and does exactly what Phase 20 needs.
   - What's unclear: Whether the planner wants to extract it to a service in this phase or just import it directly.
   - Recommendation: Direct import for Phase 20 (`from app.api.library_routes import _render_with_preset`). File a note for future refactor.

3. **Subtitle settings for product videos**
   - What we know: `_render_with_preset` accepts `subtitle_settings` dict with font/color/position params. Product videos need subtitles only with ElevenLabs.
   - What's unclear: Should the frontend expose subtitle style settings in the generate form, or use hardcoded defaults?
   - Recommendation: Use hardcoded sensible defaults for Phase 20 (font_size=48, white text, black outline, y=85%). Configurability is TMPL scope (Phase 22).

4. **Variant name for product clips in library**
   - What we know: `editai_clips` has no `variant_name` column in the schema (only `variant_index`). The library page shows clip info from the clip row.
   - What's unclear: How to distinguish product video clips from regular video clips in the library UI.
   - Recommendation: Use a descriptive `editai_projects.name` like `"[Product] {title}"`. The library page groups by project — users will see the project name. No schema change needed.

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/product_video_compositor.py` — compositor interface, `CompositorConfig`, `compose_product_video()` signature
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/tts/factory.py` — `get_tts_service()` signature and provider list
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/tts/base.py` — `TTSResult` dataclass, `timestamps` field
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/tts/elevenlabs.py` — `generate_audio_with_timestamps()` vs `generate_audio()`
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/tts/edge.py` — no timestamps returned, `timestamps=None`
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/tts_subtitle_generator.py` — `generate_srt_from_timestamps()` interface and behavior
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/script_generator.py` — `ScriptGenerator.generate_scripts()` params
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/job_storage.py` — `create_job()`, `update_job()`, `get_job()` interface
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py` lines 1784-2115, 2585-2700 — `_render_final_clip_task` and `_render_with_preset` patterns
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/routes.py` lines 726-749 — `GET /jobs/{job_id}` polling endpoint
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/product_routes.py` — existing product listing router prefix `/feeds/{feed_id}/products`
- `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/hooks/use-job-polling.ts` — `useJobPolling` hook interface
- `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/products/page.tsx` — existing product browser frontend patterns
- Supabase MCP `list_tables` — confirmed `editai_clips`, `editai_projects`, `jobs`, `products` schema
- `/mnt/c/OBSID SRL/n8n/edit_factory/.planning/STATE.md` — confirmed decisions: Edge TTS default for batch, zoompan viable, single product E2E before batch

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all services inspected directly from source
- Architecture: HIGH — integration patterns confirmed from existing working routes
- Pitfalls: HIGH — gaps identified from concrete code inspection (ElevenLabs timestamps method, Edge TTS no timestamps, `_render_with_preset` private)
- Open questions: MEDIUM — require planner/user decisions on defaults

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (stable codebase; valid until next major refactor of TTS or rendering pipeline)
