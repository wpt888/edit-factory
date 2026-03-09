# Full Codebase Audit v3 — Post-Fix Verification

**Date:** 2026-03-05
**Context:** Two rounds of bug-fixing have been applied:
- **v1 wave:** 143 bugs fixed across 11 commits (`28638e8`..`9790d77`)
- **v2 wave:** 126 bugs fixed across 3 commits (`2777a63`..`8b5fa05`)

Total: ~269 bugs fixed across ~60 files. This is a FRESH audit to catch anything missed, regressions introduced by either fix wave, or new bugs not covered in previous passes.

**Codebase:** ~33K lines Python backend (73 files) + ~26K lines TypeScript/React frontend (93 files)

---

## Instructions

Read EVERY file listed below, line by line. For each file, check ALL categories in the checklist. Report findings in the output table format at the bottom. Do NOT report issues that are by-design patterns documented in CLAUDE.md.

**Severity scale:**
- **CRITICAL** — App crashes, data loss, security vulnerability, auth bypass
- **HIGH** — Silent data corruption, race condition with user impact, resource leak causing degradation
- **MEDIUM** — Error swallowed silently, edge case crash, incorrect behavior under load
- **LOW** — Cosmetic, logging gap, minor inefficiency, non-blocking tech debt

---

## Files to Audit

### Tier 1 — Core Infrastructure (read first, these affect everything)

```
app/main.py                          — Lifespan, startup, middleware, exception handlers
app/db.py                            — Supabase singleton, connection management
app/config.py                        — Settings, env loading, path resolution
app/api/auth.py                      — JWT validation, ProfileContext, cache
app/rate_limit.py                    — Rate limiting middleware
app/models.py                        — Shared Pydantic models
app/logging_config.py                — Logging setup
app/cleanup.py                       — Temp file cleanup
app/desktop.py                       — Desktop mode integration
app/utils.py                         — Shared utilities
app/version.py                       — Version constant
```

### Tier 2 — API Routes (highest user-facing surface)

```
app/api/library_routes.py            — Project/clip CRUD, rendering, export (~2400 lines)
app/api/pipeline_routes.py           — Pipeline create/render/status (~2100 lines)
app/api/segments_routes.py           — Manual segment selection (~1100 lines)
app/api/routes.py                    — Video processing, TTS, jobs
app/api/tts_routes.py                — TTS provider listing, generation, cloning
app/api/tts_library_routes.py        — TTS asset CRUD
app/api/postiz_routes.py             — Social media publishing
app/api/profile_routes.py            — User profile CRUD, subtitle settings
app/api/assembly_routes.py           — Video assembly from segments
app/api/product_routes.py            — Product catalog
app/api/product_generate_routes.py   — Product video generation
app/api/feed_routes.py               — RSS/product feed management
app/api/image_generate_routes.py     — AI image generation
app/api/catalog_routes.py            — Product catalog browsing
app/api/elevenlabs_accounts_routes.py — ElevenLabs multi-account
app/api/association_routes.py        — Product-clip association
app/api/desktop_routes.py            — Desktop-mode routes
app/api/validators.py                — Input validation helpers
```

### Tier 3 — Backend Services

```
app/services/video_processor.py      — VideoAnalyzer, frame analysis, scoring
app/services/gemini_analyzer.py      — Gemini Vision AI analysis
app/services/ffmpeg_semaphore.py     — FFmpeg concurrency, safe_ffmpeg_run
app/services/job_storage.py          — Dual-persistence job tracking
app/services/cost_tracker.py         — API cost logging
app/services/elevenlabs_tts.py       — ElevenLabs TTS integration
app/services/edge_tts_service.py     — Edge TTS integration
app/services/elevenlabs_account_manager.py — Multi-account key rotation
app/services/script_generator.py     — Gemini/Claude script generation
app/services/assembly_service.py     — Video assembly pipeline
app/services/tts_subtitle_generator.py — SRT generation from TTS timing
app/services/subtitle_styler.py      — Subtitle positioning & styling
app/services/srt_validator.py        — SRT format validation & ASS conversion
app/services/encoding_presets.py     — FFmpeg encoding preset definitions
app/services/audio_normalizer.py     — Audio normalization
app/services/video_filters.py        — Video filter chains
app/services/silence_remover.py      — Silent segment detection & removal
app/services/voice_detector.py       — Silero VAD voice detection
app/services/postiz_service.py       — Postiz social publishing client
app/services/telegram_service.py     — Telegram bot messaging
app/services/file_storage.py         — Local/Supabase file storage
app/services/tts_cache.py            — TTS audio caching layer
app/services/tts_library_service.py  — TTS library persistence
app/services/product_video_compositor.py — Product video FFmpeg composition
app/services/overlay_renderer.py     — Image overlay rendering
app/services/logo_overlay_service.py — Logo overlay processing
app/services/fal_image_service.py    — fal.ai image generation
app/services/image_fetcher.py        — Product image downloading
app/services/feed_parser.py          — RSS/product feed parsing
app/services/textfile_helper.py      — Text file processing
app/services/keyword_matcher.py      — Keyword/segment matching
app/services/segment_transforms.py   — Per-segment visual transforms
app/services/license_service.py      — License validation
app/services/crash_reporter.py       — Error reporting
app/services/tts/base.py             — TTS base class
app/services/tts/factory.py          — TTS provider factory
app/services/tts/elevenlabs.py       — ElevenLabs TTS provider
app/services/tts/edge.py             — Edge TTS provider
app/services/tts/coqui.py            — Coqui TTS provider
app/services/tts/kokoro.py           — Kokoro TTS provider
```

### Tier 4 — Frontend Core

```
frontend/src/lib/api.ts              — API client (fetch wrapper, error handling)
frontend/src/lib/api-error.ts        — ApiError class, handleApiError
frontend/src/lib/supabase/client.ts  — Supabase client singleton
frontend/src/lib/supabase/server.ts  — Server-side Supabase
frontend/src/lib/supabase/middleware.ts — Auth cookie middleware
frontend/src/lib/utils.ts            — Shared utilities
frontend/src/types/video-processing.ts — TypeScript types/interfaces
frontend/src/contexts/profile-context.tsx — Profile context provider
frontend/src/components/auth-provider.tsx — Auth state management
```

### Tier 5 — Frontend Hooks

```
frontend/src/hooks/use-job-polling.ts       — Job status polling + SSE
frontend/src/hooks/use-polling.ts           — Generic polling hook
frontend/src/hooks/use-batch-polling.ts     — Batch operation polling
frontend/src/hooks/use-local-storage-config.ts — localStorage config hook
frontend/src/hooks/use-subtitle-settings.ts — Subtitle settings hook
```

### Tier 6 — Frontend Pages

```
frontend/src/app/librarie/page.tsx          — Library page (~800 lines)
frontend/src/app/pipeline/page.tsx          — Pipeline page (~1800 lines)
frontend/src/app/segments/page.tsx          — Segments page (~700 lines)
frontend/src/app/create-image/page.tsx      — Image generation page
frontend/src/app/tts-library/page.tsx       — TTS library page
frontend/src/app/settings/page.tsx          — Settings page
frontend/src/app/products/page.tsx          — Products page
frontend/src/app/product-video/page.tsx     — Product video page
frontend/src/app/batch-generate/page.tsx    — Batch generation page
frontend/src/app/usage/page.tsx             — Usage/costs page
frontend/src/app/setup/page.tsx             — Setup wizard
frontend/src/app/login/page.tsx             — Login page
frontend/src/app/signup/page.tsx            — Signup page
frontend/src/app/layout.tsx                 — Root layout
frontend/src/app/page.tsx                   — Home/redirect page
frontend/src/app/global-error.tsx           — Global error boundary
frontend/src/app/auth/callback/route.ts     — OAuth callback
```

### Tier 7 — Frontend Components

```
frontend/src/components/PublishDialog.tsx             — Social publishing dialog
frontend/src/components/video-segment-player.tsx      — Video player with timeline
frontend/src/components/timeline-editor.tsx           — Timeline editing component
frontend/src/components/audio-waveform.tsx            — Audio waveform visualizer
frontend/src/components/variant-preview-player.tsx    — Variant preview player
frontend/src/components/inline-video-player.tsx       — Inline video player
frontend/src/components/batch-settings-dialog.tsx     — Batch settings dialog
frontend/src/components/create-profile-dialog.tsx     — Profile creation dialog
frontend/src/components/simple-segment-popup.tsx      — Segment editing popup
frontend/src/components/logo-drag-overlay.tsx         — Draggable logo overlay
frontend/src/components/clip-hover-preview.tsx        — Clip hover preview
frontend/src/components/clip-tag-editor.tsx           — Clip tag editor
frontend/src/components/confirm-dialog.tsx            — Confirmation dialog
frontend/src/components/create-feed-dialog.tsx        — Feed creation dialog
frontend/src/components/editor-layout.tsx             — Editor layout wrapper
frontend/src/components/empty-state.tsx               — Empty state component
frontend/src/components/image-picker-dialog.tsx       — Image picker dialog
frontend/src/components/navbar.tsx                    — Navigation bar
frontend/src/components/navbar-wrapper.tsx            — Navbar wrapper
frontend/src/components/pip-overlay-panel.tsx         — PiP overlay panel
frontend/src/components/product-picker-dialog.tsx     — Product picker dialog
frontend/src/components/profile-switcher.tsx          — Profile switcher dropdown
frontend/src/components/segment-transform-panel.tsx   — Segment transform controls
frontend/src/components/subtitle-enhancement-controls.tsx — Subtitle controls
frontend/src/components/tts/provider-selector.tsx     — TTS provider selector
frontend/src/components/tts/voice-cloning-upload.tsx  — Voice cloning upload
frontend/src/components/video-processing/index.ts     — Video processing barrel
frontend/src/components/video-processing/progress-tracker.tsx
frontend/src/components/video-processing/secondary-videos-form.tsx
frontend/src/components/video-processing/subtitle-editor.tsx
frontend/src/components/video-processing/tts-panel.tsx
frontend/src/components/video-processing/variant-triage.tsx
```

---

## Checklist per File

### Backend Python Files

1. **Crash Safety**
   - Unguarded `.get()` / `["key"]` on optional dicts
   - Unguarded `float()`, `int()`, `Path()` on user/external input
   - Missing `try/except` around external API calls (Gemini, ElevenLabs, Supabase, httpx)
   - Variables referenced before assignment in except blocks
   - `None` used where `str`/`Path`/`int` expected (no None check before method call)
   - Division by zero on computed values

2. **Concurrency & Thread Safety**
   - Shared mutable state (dicts, lists, counters) accessed without locks
   - `asyncio.Lock` / `asyncio.Semaphore` created outside running event loop
   - `threading.Lock` vs `asyncio.Lock` confusion (sync lock in async context or vice versa)
   - Race conditions: TOCTOU (check-then-act without holding lock through both)
   - `time.sleep()` blocking the async event loop thread pool
   - Double-checked locking patterns done incorrectly

3. **Resource Management**
   - File handles, cv2.VideoCapture, httpx clients not closed/released
   - `subprocess.run` without timeout or using raw subprocess instead of safe_ffmpeg_run
   - Temp files created but not cleaned up on error paths
   - Database connections or cursors held open too long

4. **Security**
   - Path traversal: user-supplied paths not validated with `is_relative_to()`
   - Raw exception messages leaked to HTTP responses
   - Missing authentication (`Depends(get_current_user)`) on endpoints that need it
   - SQL injection via string interpolation (Supabase client prevents this, but check raw queries)
   - Secrets (API keys, tokens) logged at INFO level
   - User input reflected in error messages without sanitization

5. **Data Integrity**
   - Any remaining `.single()` calls that weren't migrated to `.limit(1)`
   - Missing `if not result.data` checks after Supabase queries
   - Optimistic updates without rollback on failure
   - Integer overflow / precision loss in video timestamp calculations

6. **Error Handling**
   - Bare `except:` or `except Exception:` that swallows errors silently
   - HTTP 500 returned instead of proper 4xx status codes
   - Missing error propagation (function returns None instead of raising)
   - Inconsistent error response format (some return `{"detail": ...}`, others `{"error": ...}`)

7. **Logic Bugs**
   - Off-by-one errors in loop bounds, array indexing, pagination
   - Boolean conditions inverted or incomplete
   - Default parameter values that should be None but are mutable (lists, dicts)
   - Stale data used after await/yield (dict reference may have changed)

### Frontend TypeScript/React Files

1. **React Hook Violations**
   - `useEffect` missing dependencies that cause stale closures
   - `useEffect` cleanup not returning cleanup function (intervals, timeouts, listeners, AbortControllers)
   - `useCallback`/`useMemo` missing or with wrong deps
   - State updates after unmount (missing `isMountedRef` or cancelled flag)
   - Hooks called conditionally or inside loops

2. **Async/Promise Safety**
   - `fetch` / `apiPost` / `apiGet` without error handling (missing `.catch()` or try/catch)
   - `audio.play()` promise rejection unhandled
   - `navigator.clipboard.writeText()` not awaited or not in try/catch
   - Race conditions: multiple fetches overwriting each other's results
   - Polling intervals not cleared on component unmount or dependency change

3. **Memory Leaks**
   - `URL.createObjectURL()` without `revokeObjectURL()`
   - Event listeners added in useEffect without cleanup
   - `setInterval` / `setTimeout` without clearInterval/clearTimeout on unmount
   - `ResizeObserver` / `IntersectionObserver` not disconnected
   - WebSocket / SSE connections not closed

4. **State Management**
   - Stale closure: callback uses old state value captured at creation time
   - Optimistic UI update not reverted on API error
   - Derived state that should be computed but is stored separately and gets out of sync
   - Array index used as React key for items that can be reordered/deleted

5. **Type Safety**
   - `as any` type assertions hiding real type errors
   - Optional fields accessed without null check
   - API response assumed to have certain shape without validation
   - `parseFloat` / `parseInt` result not checked for `NaN`

6. **UX Bugs**
   - Loading states not shown during async operations
   - Error messages not displayed to user (console.error only)
   - Buttons not disabled during in-flight requests (double-click)
   - Form state not reset after dialog close/reopen

---

## Regression Check: Patterns Applied in v1+v2 Fixes — Verify Correctness

The two fix waves introduced/modified these patterns. Check that they were applied **correctly** everywhere — not just present, but logically sound:

1. **`.limit(1)` migration** — Verify every `.limit(1)` usage has a corresponding `if not result.data` check AND uses `result.data[0]` (not `result.data`). Search for any remaining `.single()` calls.

2. **`safe_ffmpeg_run` adoption** — Verify all `safe_ffmpeg_run()` callers handle `RuntimeError` (timeout) properly. Check that the return value is used correctly (`result.stdout`, `result.stderr` are text strings, `result.returncode` is int). Verify no raw `subprocess.run/Popen` with ffmpeg/ffprobe remain (except `-version`/`-encoders` capability checks).

3. **`is_relative_to()` path validation** — Verify all file-serving endpoints validate paths. Check that `.resolve()` is called on BOTH the target path and the allowed directory before comparison.

4. **Threading locks** — Verify newly-added `threading.Lock` instances are used correctly:
   - Lock acquired before AND released after (preferably via `with` statement)
   - No nested locks that could deadlock
   - Lock scope is neither too broad (blocking unrelated work) nor too narrow (missing critical sections)
   - No lock held across `await` (threading.Lock in async code)

5. **`isMounted` ref guards** — Verify all newly-added `isMountedRef` patterns:
   - The ref is set to `false` in cleanup, not in a conditional
   - ALL setState calls after await check the ref
   - The ref doesn't prevent legitimate state updates

6. **AbortController patterns** — Verify all newly-added AbortControllers:
   - Abort is called in cleanup
   - AbortError is caught/ignored properly (not shown as user-facing error)
   - Signal is passed to the actual fetch call

7. **Error handling additions** — Verify newly-added try/catch blocks:
   - Don't silently swallow errors that should propagate
   - Return appropriate HTTP status codes (not always 500)
   - Error messages are sanitized (no internal paths/keys leaked)

---

## Known By-Design Patterns (DO NOT report these)

These are documented in CLAUDE.md and are intentional:
- `Depends()` only used for authentication (services use singleton factories)
- `BackgroundTasks` for processing (not Celery/Redis)
- In-memory `_generation_progress` / `_project_locks` dicts (ephemeral by design)
- Form data string-to-bool coercion (`"true"` → `True`)
- Graceful degradation hierarchy (Gemini→motion scoring, ElevenLabs→Edge TTS, Supabase→in-memory)
- No global state library in frontend (useState + useEffect pattern)
- Lazy-initialized service singletons

---

## Output Format

For each bug found, add a row to this table:

```
| # | Severity | File | Line(s) | Description | Category |
|---|----------|------|---------|-------------|----------|
| 1 | CRITICAL | app/api/foo.py | 123 | Description of the bug | Crash Safety |
```

**Rules:**
- Number bugs sequentially starting at 1
- Include exact line numbers where the bug occurs
- Description must explain WHAT is wrong and WHY it's a bug (not just "potential issue")
- Do NOT report:
  - Style/formatting preferences
  - Missing docstrings or type hints on unchanged code
  - Theoretical bugs that require impossible preconditions
  - Issues in `frontend/src/components/ui/*.tsx` (these are Shadcn/UI library files)
  - Issues already documented as by-design in CLAUDE.md (see above)
  - Bugs that were reported in v1/v2 audits AND have already been fixed
- DO report:
  - Bugs introduced BY the v1 or v2 fix waves (regressions)
  - Bugs that existed before but were missed in both previous audits
  - Fix patterns that were applied incorrectly (e.g., lock held across await, wrong variable in data[0])
  - New crash paths created by the fix code itself

---

## Summary Section

After the full audit, provide:

1. Total bugs found, broken down by severity
2. Count of regressions (bugs introduced by the fix waves)
3. Count of incorrectly-applied fix patterns
4. Top 3 most problematic files
5. Recommended fix priority order
6. Assessment: Is the codebase production-ready after these fixes?
