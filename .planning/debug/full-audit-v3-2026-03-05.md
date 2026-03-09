# Full Codebase Audit v3 — Post-Fix Verification Results

**Date:** 2026-03-05
**Audited by:** 6 parallel agents covering all 7 tiers (~160 files)
**Context:** Post v1+v2 fix waves (~269 bugs fixed). Fresh audit for missed bugs, regressions, and incorrectly-applied patterns.

---

## Consolidated Bug Table

### Tier 1 — Core Infrastructure (15 bugs)

| # | Severity | File | Line(s) | Description | Category |
|---|----------|------|---------|-------------|----------|
| 1 | HIGH | `app/main.py` | 139–140 | `_cleanup_expired_trash` is async but calls synchronous blocking I/O (`Path.unlink()`) and Supabase SDK directly on the event loop, blocking it during startup | Concurrency |
| 2 | HIGH | `app/main.py` | 242–244 | Global exception handler exposes raw `ValueError` message text verbatim in HTTP 400 responses — may contain internal paths or sensitive info | Security |
| 3 | HIGH | `app/api/auth.py` | 200–222 | `threading.Lock` (`_profile_cache_lock`) acquired inside async function `get_profile_context`, blocking the event loop. Under concurrent requests with cache eviction (>1000 entries), can stall all handlers | Concurrency |
| 4 | MEDIUM | `app/api/auth.py` | 268–269 | Dev/desktop fallback picks any default profile from entire `profiles` table with no user-scoping — in multi-tenant DB, crosses tenant boundaries | Security |
| 5 | MEDIUM | `app/main.py` | 150–174 | `_cleanup_expired_pipelines` calls synchronous Supabase SDK inside async function without `asyncio.to_thread` | Concurrency |
| 6 | MEDIUM | `app/api/auth.py` | 117–123 | Desktop mode + `AUTH_DISABLED=true` double-bypasses auth silently with only a single warning log | Security |
| 7 | MEDIUM | `app/db.py` | 49–59 | `close_supabase` and `get_supabase` use separate lock paths — potential use-after-close on in-flight requests during shutdown | Concurrency |
| 8 | MEDIUM | `app/api/auth.py` | 86–88 | JWT failure logs raw `PyJWTError` message which can contain attacker-controlled content — log injection risk | Security |
| 9 | MEDIUM | `app/cleanup.py` | 139 | Dry-run accesses `storage._supabase` (private attr) — fragile, silently reports 0 deletions if refactored | Data Integrity |
| 10 | MEDIUM | `app/cleanup.py` | 155 | `storage._update_lock` and `storage._memory_store` accessed as private attrs from external module | Data Integrity |
| 11 | LOW | `app/version.py` | 19–21 | `subprocess.run(["git", "describe"])` at import time — `timeout=5` is misleading since `FileNotFoundError` fires before timeout | Crash Safety |
| 12 | LOW | `app/utils.py` | 19–20 | `sanitize_filename` doesn't limit total length when extension exceeds 100 chars | Logic Bug |
| 13 | LOW | `app/rate_limit.py` | 21 | `get_remote_address` reads `request.client.host` — behind reverse proxy, all users share one rate limit bucket | Security |
| 14 | LOW | `app/logging_config.py` | 23 | `root.handlers.clear()` at import can discard uvicorn's handler if import order changes | Logic Bug |
| 15 | LOW | `app/api/auth.py` | 306–309 | Returns HTTP 503 for missing default profile — should be 422; 503 triggers proxy health-check failures | Error Handling |

### Tier 2 — API Routes (25 bugs)

| # | Severity | File | Line(s) | Description | Category |
|---|----------|------|---------|-------------|----------|
| 16 | MEDIUM | `library_routes.py` | 347–358 | `serve_file` caches remote files using only basename — two different remote paths with same filename collide in `.storage_cache/` | Security / Resource |
| 17 | MEDIUM | `library_routes.py` | 1419–1421 | `safe_ffmpeg_run` `RuntimeError` not caught by inner try/except (only catches `CalledProcessError`), variant left in intermediate state | Error Handling |
| 18 | MEDIUM | `library_routes.py` | 1922–1926 | `remove_clip_audio` leaks raw `result.stderr` (FFmpeg paths) in HTTP 500 response | Security |
| 19 | MEDIUM | `library_routes.py` | 2039 | `bulk_delete` returns `str(e)` in HTTP response — leaks internal exception details | Security |
| 20 | MEDIUM | `pipeline_routes.py` | 1075–1079 | Supabase exception caught and re-raised as HTTP 404 without logging — DB failure indistinguishable from missing asset | Error Handling |
| 21 | MEDIUM | `segments_routes.py` | 649–719 | `_extract_waveform` uses raw `subprocess.Popen`, bypassing `safe_ffmpeg_run` and concurrency semaphore — unbounded FFmpeg processes | Concurrency |
| 22 | MEDIUM | `segments_routes.py` | 240–274 | `_assign_product_group` is async but calls blocking Supabase directly on event loop | Concurrency |
| 23 | MEDIUM | `segments_routes.py` | 277–304 | `_reassign_all_segments` blocks event loop with sequential Supabase calls per segment in for-loop | Concurrency |
| 24 | MEDIUM | `segments_routes.py` | 1033–1050 | `list_product_groups_bulk` does N+1 queries (1 COUNT per group, up to 51 sequential round-trips) | Logic / Performance |
| 25 | MEDIUM | `product_generate_routes.py` | 793–805 | `_render_with_preset` called inside `acquire_render_slot()` but also acquires its own slot internally — double semaphore consumption, halves throughput | Concurrency |
| 26 | MEDIUM | `image_generate_routes.py` | 596–597 | `send_to_postiz` leaks Postiz exception details (URLs, tokens) in HTTP 502 response | Security |
| 27 | LOW | `pipeline_routes.py` | 1800–1803 | Dead code: both branches of if/else execute identical `set(used_set)` | Logic Bug |
| 28 | LOW | `segments_routes.py` | 514–528 | `get_source_video` queries by UUID without `.limit(1)` — deviates from established migration pattern | Data Integrity |
| 29 | LOW | `routes.py` | 440–441 | Partial file not cleaned up on write failure (unlike `library_routes.py` which has explicit cleanup) | Resource Management |
| 30 | LOW | `routes.py` | 1116 | Job result stores `str(e)` from internal exception — accessible via job status API | Security |
| 31 | LOW | `tts_routes.py` | 165–167 | Exposes raw ElevenLabs SDK error (may include API key fragments) in HTTP 500 | Security |
| 32 | LOW | `tts_routes.py` | 254 | Raw exception stored in job progress field, returned via job status API | Security |
| 33 | LOW | `image_generate_routes.py` | 29–30 | Dead code: `GENERATED_IMAGES_DIR` and `LOGOS_DIR` module-level constants never used | Logic Bug |
| 34 | LOW | `image_generate_routes.py` | 388–389 | `upload_logo` skips content validation (only checks content-type header) — `validators.py` MIME check exists but unused | Security |
| 35 | LOW | `catalog_routes.py` | 160–163 | Uses `.maybe_single()` instead of `.limit(1)` migration pattern | Data Integrity |
| 36 | LOW | `product_generate_routes.py` | 136–147 | Uses `.maybe_single()` AND no profile scoping on catalog product query — any user can generate video for any product | Security / Data Integrity |
| 37 | LOW | `assembly_routes.py` | 414–429 | Raw `str(e)` persists in DB `error` column — accessible to anyone querying DB | Security |
| 38 | LOW | `feed_routes.py` | 120–126 | `sync_error` stores raw `str(exc)` in DB column — httpx errors may include URLs with embedded credentials | Security |
| 39 | LOW | `desktop_routes.py` | 241 | `save_desktop_settings` lacks try/except on file write (inconsistent with `mark_first_run_complete`) | Error Handling |
| 40 | LOW | `profile_routes.py` | 405–413 | Two-step default profile swap has brief window where no profile is default | Data Integrity |

### Tier 3 — Backend Services (13 bugs)

| # | Severity | File | Line(s) | Description | Category |
|---|----------|------|---------|-------------|----------|
| 41 | HIGH | `ffmpeg_semaphore.py` | 59, 70, 222 | `threading.Lock()` acquired in async context to guard lazy `asyncio.Semaphore` creation — blocks event loop | Concurrency |
| 42 | HIGH | `elevenlabs_tts.py` | 423 | `process_video_with_tts` calls blocking `add_audio_to_video` (FFmpeg subprocess) directly without `asyncio.to_thread` — stalls event loop | Concurrency |
| 43 | HIGH | `edge_tts_service.py` | 74, 96–98 | `threading.Lock` guards `asyncio.Lock` creation — same event-loop-blocking pattern | Concurrency |
| 44 | MEDIUM | `job_storage.py` | 354–363 | `cleanup_stale_jobs` snapshot contains references to shared dicts, mutates them without lock after release | Thread Safety |
| 45 | MEDIUM | `elevenlabs_account_manager.py` | 265–279 | `_get_env_subscription_cached` reads/writes cache without any lock — concurrent callers make redundant API calls | Concurrency |
| 46 | MEDIUM | `license_service.py` | 65, 108 | Unguarded dict access `body["instance"]["id"]` and `body["license_key"]["status"]` — `KeyError` on malformed API response | Error Handling |
| 47 | MEDIUM | `silence_remover.py` | 436–491 | `remove_silence_ffmpeg` called outside try/except — `RuntimeError` from FFmpeg timeout propagates unhandled | Crash Safety |
| 48 | MEDIUM | `logo_overlay_service.py` | 32–33 | `Image.open()` without try/except — PIL exceptions on corrupt files produce raw 500 | Error Handling |
| 49 | MEDIUM | `tts/coqui.py` | 32–56 | `threading.Lock` guards `asyncio.Lock` creation — same pattern as #41, #43 | Concurrency |
| 50 | MEDIUM | `tts/kokoro.py` | 160–172 | `kokoro.generate()` API is unverified stub — will crash with `AttributeError` if Kokoro TTS selected | Logic Bug |
| 51 | LOW | `image_fetcher.py` | 30–35 | `_get_download_semaphore()` is dead code — never called | Logic Bug |
| 52 | LOW | `image_fetcher.py` | 154, 180 | `_convert_webp_to_jpg` and `_make_placeholder` use bare `subprocess.run` instead of `safe_ffmpeg_run` — child process not killed on timeout | Resource Management |
| 53 | LOW | `postiz_service.py` | 409–447 | `get_postiz_publisher` queries DB outside lock — concurrent callers create duplicate instances | Concurrency |

### Tier 4+5 — Frontend Core + Hooks (20 bugs)

| # | Severity | File | Line(s) | Description | Category |
|---|----------|------|---------|-------------|----------|
| 54 | HIGH | `hooks/use-job-polling.ts` | 157–205 | `pollFallback` sets state after `await apiFetch` without checking `isCancelledRef` post-await — state updates on unmounted component | React Hooks / Memory Leak |
| 55 | MEDIUM | `lib/api.ts` | 53–54 | `AbortError` from caller-provided signal escapes unwrapped (not as `ApiError`) — callers catching `ApiError` miss it | Async/Promise Safety |
| 56 | MEDIUM | `lib/api.ts` | 111–137 | `apiGetWithRetry` retry delay not cancellable — component can unmount during 1s delay, state still set | Async/Promise Safety |
| 57 | MEDIUM | `contexts/profile-context.tsx` | 114–117 | `isMountedRef` cleanup in separate `useEffect` from the effect that uses it — ordering not guaranteed | React Hook Violations |
| 58 | MEDIUM | `contexts/profile-context.tsx` | 164–165 | Unawaited `refreshProfiles()` has no mount guard — sets state on unmounted component | React Hooks / Memory Leak |
| 59 | MEDIUM | `components/auth-provider.tsx` | 50–64 | `refreshSession` uses `getSession()` (cache-only) instead of `refreshSession()` (network) — returns potentially expired token | Async/Promise Safety |
| 60 | MEDIUM | `hooks/use-job-polling.ts` | 278–290 | SSE `onerror` handler does not stop `elapsedIntervalRef` when falling back to polling — two timers run concurrently | Memory Leak |
| 61 | MEDIUM | `hooks/use-job-polling.ts` | 193–200 | `handleApiError` toast fires on every poll retry including transient errors — toast spam | UX Bugs |
| 62 | MEDIUM | `hooks/use-polling.ts` | 92–120 | `poll` sets state after `await apiGet` without post-await mount check — state on unmounted component | React Hooks / Memory Leak |
| 63 | MEDIUM | `hooks/use-batch-polling.ts` | 91–97 | Dead `response.ok` check — `apiFetch` already throws on non-2xx, so the manual check never executes | Async/Promise Safety |
| 64 | LOW | `lib/supabase/client.ts` | 4–7 | Non-null assertion `!` on env vars — missing var gives opaque SDK error instead of helpful message | Type Safety |
| 65 | LOW | `lib/supabase/server.ts` | 8–9 | Same non-null assertion pattern as #64 | Type Safety |
| 66 | LOW | `lib/supabase/middleware.ts` | 13–14 | Same non-null assertion pattern + mismatched env vars could cause silent auth failures | Type Safety |
| 67 | LOW | `contexts/profile-context.tsx` | 71–108 | Deleted profile remains as `currentProfile` — no correction logic when profile disappears server-side | State Management |
| 68 | LOW | `components/auth-provider.tsx` | 108–125 | `router.refresh()` on every `TOKEN_REFRESHED` event (~55min) causes unnecessary full-page SSR re-fetches | UX Bugs |
| 69 | LOW | `hooks/use-job-polling.ts` | 211–213 | SSE URL built without trailing-slash guard that `apiFetch` applies — double-slash in URL | Type Safety |
| 70 | LOW | `hooks/use-polling.ts` | 127–139 | If `interval` prop changes after mount, running poll continues with stale interval | React Hook Violations |
| 71 | LOW | `hooks/use-local-storage-config.ts` | 29–42 | `defaultValue` as object literal in dep array causes effect to re-run every render | React Hook Violations |
| 72 | LOW | `hooks/use-subtitle-settings.ts` | 36–38 | `handleApiError` shows "Settings error" for localStorage quota exception — misleading | UX Bugs |
| 73 | LOW | `hooks/use-subtitle-settings.ts` | 16–17 | `storageKey` change from undefined to real key doesn't reload from new storage key | State Management |

### Tier 6 — Frontend Pages (39 bugs)

| # | Severity | File | Line(s) | Description | Category |
|---|----------|------|---------|-------------|----------|
| 74 | **CRITICAL** | `app/auth/callback/route.ts` | 7–18 | `next` query param used in redirect without validation — open redirect vulnerability (`?next=//evil.com` → `origin//evil.com`) | Security |
| 75 | HIGH | `app/librarie/page.tsx` | ~356–362 | `fetchAllClips`, `fetchPostizStatus`, `fetchAvailableTags` race on profile switch — no AbortController, stale data from old profile | Async/Race Condition |
| 76 | HIGH | `app/librarie/page.tsx` | ~356–362 | Fetch functions recreated every render, omitted from deps via eslint-disable — stale closures | React Hook Violation |
| 77 | HIGH | `app/pipeline/page.tsx` | ~1596–1613 | `voiceSettingsHydrated` ref guard logic is fragile — ref change doesn't re-trigger effect | React Hook Violation |
| 78 | HIGH | `app/segments/page.tsx` | ~758–761 | `fetchAssociations` triggered on every `allSegments` change — refetches ALL associations with no deduplication | Async/Race Condition |
| 79 | HIGH | `app/tts-library/page.tsx` | ~178–184 | Polling stops silently when `fetchAssets` throws — no retry, no user feedback | Async/Promise Safety |
| 80 | HIGH | `app/settings/page.tsx` | ~334, 360 | `!response.ok` check after `apiPatch` is dead code — `apiPatch` already throws, masking specific error details | UX Bugs |
| 81 | MEDIUM | `app/librarie/page.tsx` | ~393 | `handleTagFilter` bypasses profile guard — issues unauthenticated fetch if profile not loaded | Async/Promise Safety |
| 82 | MEDIUM | `app/librarie/page.tsx` | ~483–496 | State setters after `await apiPost` without `isMountedRef` guard | Async/Promise Safety |
| 83 | MEDIUM | `app/librarie/page.tsx` | ~509–521 | Same pattern: state setters after `await apiDelete` without mount guard | Async/Promise Safety |
| 84 | MEDIUM | `app/librarie/page.tsx` | ~558–573 | Bulk delete uses stale `selectedClipIds` closure — user selection changes while dialog open cause wrong items filtered | State Management |
| 85 | MEDIUM | `app/librarie/page.tsx` | ~607–637 | Bulk upload uses stale `clips` closure — deleted clips could be sent to Postiz | State Management |
| 86 | MEDIUM | `app/pipeline/page.tsx` | ~1236–1244 | History auto-load resets state on every `currentProfile?.id` change including initial undefined | React Hook Violation |
| 87 | MEDIUM | `app/pipeline/page.tsx` | ~1660–1688 | Debounced voice settings save captures stale slider values in closure — rapid slider moves send wrong values | State Management |
| 88 | MEDIUM | `app/pipeline/page.tsx` | ~1740 | `handleGenerateTts` has no abort mechanism — rapid clicks cause concurrent API calls, last-resolve-wins | Async/Race Condition |
| 89 | MEDIUM | `app/pipeline/page.tsx` | ~919–990 | `handlePreviewAll` abort guard leaves `previewingIndex` set visually after mid-loop abort | Async/Promise Safety |
| 90 | MEDIUM | `app/create-image/page.tsx` | ~257–280 | Polling interval catch block is empty — fetch errors silently continue polling indefinitely | Async/Promise Safety |
| 91 | MEDIUM | `app/create-image/page.tsx` | ~248 | Generate button not disabled during polling — allows concurrent polls | UX Bugs |
| 92 | MEDIUM | `app/create-image/page.tsx` | ~156–169 | `fetchProducts` callback captures stale `productSearch` — eslint-disable hides dep | State Management |
| 93 | MEDIUM | `app/tts-library/page.tsx` | ~353–361 | `clipboard.writeText` without focus check — silent failure with no user feedback | UX Bugs |
| 94 | MEDIUM | `app/settings/page.tsx` | ~392–410 | Multiple `!response.ok` checks are dead code after api wrapper that already throws | Type Safety |
| 95 | MEDIUM | `app/settings/page.tsx` | ~666 | Settings fetches have no AbortController — rapid profile switch mixes data from different profiles | Async/Race Condition |
| 96 | MEDIUM | `app/product-video/page.tsx` | ~130–162 | `parseInt(duration)` without NaN guard — could pass `NaN` to API | Type Safety |
| 97 | MEDIUM | `app/usage/page.tsx` | ~108–113 | SSR/client hydration mismatch — server renders `50`, client reads localStorage value | React Hook Violation |
| 98 | MEDIUM | `app/setup/page.tsx` | ~66–88 | Non-`ApiError` exceptions (network `TypeError`) silently show license wizard instead of error | UX Bugs |
| 99 | MEDIUM | `app/segments/page.tsx` | ~492–514 | Upload poll interval not cleared on re-upload — two intervals poll concurrently | Memory Leak |
| 100 | LOW | `app/librarie/page.tsx` | ~580–597 | `downloadFile` revokes blob URL immediately after `a.click()` — may revoke before download starts | Async/Promise Safety |
| 101 | LOW | `app/pipeline/page.tsx` | ~1500–1551 | `handlePlayAudio` catch handler sets state without checking abort signal | Async/Promise Safety |
| 102 | LOW | `app/segments/page.tsx` | ~380–403 | Keyboard shortcut effect re-attaches listener on every segment state change | React Hook Violation |
| 103 | LOW | `app/tts-library/page.tsx` | ~207–214 | Rapid `togglePlay` double-click can fire onerror for wrong audio ref | State Management |
| 104 | LOW | `app/products/page.tsx` | ~325–337 | `handleSync` double-click creates second timeout without clearing first | Memory Leak |
| 105 | LOW | `app/products/page.tsx` | ~331 | Sync timeout callback reads stale `selectedFeedId` from closure | State Management |
| 106 | LOW | `app/batch-generate/page.tsx` | ~62–66 | `parseInt("0")` triggers `|| 10` fallback — shows 10% for 0% progress | UX Bugs |
| 107 | LOW | `app/usage/page.tsx` | ~154–163 | `fetchAllEntries` has no AbortController or mount guard — state on unmounted | Async/Promise Safety |
| 108 | LOW | `app/setup/page.tsx` | ~91–112 | `apiGet` response not checked for `.ok` before destructuring — wrong shape on error | Type Safety |
| 109 | LOW | `app/login/page.tsx` | ~28–57 | No `isMountedRef` guard — state set on unmounted component after auth redirect | Async/Promise Safety |
| 110 | LOW | `app/signup/page.tsx` | ~30–74 | Same pattern as #109 — no mount guard after `signUp` | Async/Promise Safety |
| 111 | LOW | `app/global-error.tsx` | ~11–13 | Minor: `useEffect` logs error with no cleanup | React Hook Violation |
| 112 | LOW | `app/auth/callback/route.ts` | ~11–18 | Auth exchange failures not logged — completely invisible in server logs | Error Handling |

### Tier 7 — Frontend Components (32 bugs)

| # | Severity | File | Line(s) | Description | Category |
|---|----------|------|---------|-------------|----------|
| 113 | HIGH | `timeline-editor.tsx` | 508–513 | `audio.onerror` handler leaks — never cleaned on unmount when `isPreviewActive === false` | Memory Leak |
| 114 | MEDIUM | `PublishDialog.tsx` | 214–240 | `setInterval` with async callback — overlapping polls if fetch > 1500ms | Async/Promise Safety |
| 115 | MEDIUM | `video-segment-player.tsx` | 1018–1030 | Seek buttons use stale `currentTime` closure instead of `videoRef.current.currentTime` | React Hook Violation |
| 116 | MEDIUM | `video-segment-player.tsx` | 602 | Waveform fetch cleanup aggressively wipes data — flash-to-empty during video switch | UX Bugs |
| 117 | MEDIUM | `timeline-editor.tsx` | 486–531 | `activatePreview` rAF loop has no abort guard — runs indefinitely if component unmounts mid-activation | Memory Leak |
| 118 | MEDIUM | `timeline-editor.tsx` | 524 | `onCanPlay` listener never removed if audio src returns 404 | Memory Leak |
| 119 | MEDIUM | `variant-preview-player.tsx` | 59–166 | Effect dep array `[open]` with eslint-disable — `matches` changes not reflected in preview (uses stale values) | React Hook Violation |
| 120 | MEDIUM | `batch-settings-dialog.tsx` | 100 | `parseInt(duration)` without radix or NaN guard — `NaN` silently sent to API | Type Safety |
| 121 | MEDIUM | `audio-waveform.tsx` | 170–179 | `setProgress(p => p)` no-op to trigger re-render — may be optimized away by future React | State Management |
| 122 | MEDIUM | `voice-cloning-upload.tsx` | 34–57 | `URL.createObjectURL` never revoked if audio element doesn't fire loadedmetadata/error events | Memory Leak |
| 123 | MEDIUM | `voice-cloning-upload.tsx` | 60–119 | `handleUpload` has no `isMounted` guard or AbortController — state on unmounted component | Async/Promise Safety |
| 124 | MEDIUM | `product-picker-dialog.tsx` | 183–218 | `fetchAbortRef` never aborted in cleanup — unmount during fetch calls state on unmounted component | Async/Promise Safety |
| 125 | MEDIUM | `tts/provider-selector.tsx` | 60–116 | Card `onClick` + RadioGroup `onValueChange` both fire `onChange` — double-call per click | UX Bugs |
| 126 | MEDIUM | `video-processing/subtitle-editor.tsx` | 96–111 | `videoInfo` default is object literal — unstable reference invalidates `useMemo` every render | React Hook Violation |
| 127 | MEDIUM | `logo-drag-overlay.tsx` | 118–125 | Empty dep array with eslint-disable — `toReal`, `position`, `scale`, `onPositionChange` all stale closures | React Hook Violation |
| 128 | MEDIUM | `image-picker-dialog.tsx` | 92 | `currentSelectedUrls` array prop in dep array — new reference every parent render re-fetches images | React Hook Violation |
| 129 | LOW | `PublishDialog.tsx` | 288 | `useMemo` with eslint-disable-next-line — comment claim about avoiding recalculation is incorrect | React Hook Violation |
| 130 | LOW | `PublishDialog.tsx` | 302–303 | `getCharWarnings()` and `getMinCharLimit()` re-derived every render without memoization | State Management |
| 131 | LOW | `video-segment-player.tsx` | 839 | Array index as React key for time scale markers | State Management |
| 132 | LOW | `timeline-editor.tsx` | 743 | `Math.random()` for slide ID — no collision protection | Type Safety |
| 133 | LOW | `audio-waveform.tsx` | 106–120 | `isPlaying=false` transition doesn't do final progress update — waveform freezes at last sampled position | UX Bugs |
| 134 | LOW | `variant-preview-player.tsx` | 45 | `pollRef` named as interval but is `setTimeout` — misleading naming | Type Safety |
| 135 | LOW | `create-profile-dialog.tsx` | 64–83 | No `isMountedRef` guard after `await apiPost` — state on unmounted component | React Hook Violation |
| 136 | LOW | `create-feed-dialog.tsx` | 59 | No cancellation for in-flight POST on dialog close — toast/callback fires after close | Async/Promise Safety |
| 137 | LOW | `logo-drag-overlay.tsx` | 37 | Position sync effect overwrites live drag position if parent re-renders mid-drag | UX Bugs |
| 138 | LOW | `clip-hover-preview.tsx` | 41–49 | `videoRef.current` play() called in effect but video might not be mounted yet | Async/Promise Safety |
| 139 | LOW | `voice-cloning-upload.tsx` | 80–88 | Profile ID read from `localStorage` instead of `useProfile()` context — inconsistent pattern | Type Safety |
| 140 | LOW | `video-processing/subtitle-editor.tsx` | 306–351 | Each subtitle line renders its own Dialog instance — 100s of Dialogs for large SRTs | State Management |
| 141 | LOW | `video-processing/variant-triage.tsx` | 121–123 | `variant_index` as React key — duplicate indices from API bug would silently merge cards | State Management |
| 142 | LOW | `editor-layout.tsx` | 40 | Duplicate active-element check — second check is redundant | Logic Bug |
| 143 | LOW | `navbar.tsx` | 79–81 | `isGroupActive` exact match only — deep-linked sub-paths don't highlight parent nav | UX Bugs |
| 144 | LOW | `video-processing/tts-panel.tsx` | 67 | Audio duration estimate (150 chars/sec) is very rough — no user caveat shown | UX Bugs |

---

## Summary

### Total Bugs by Severity

| Severity | Count |
|----------|-------|
| CRITICAL | 1 |
| HIGH | 12 |
| MEDIUM | 51 |
| LOW | 80 |
| **TOTAL** | **144** |

### Regressions (bugs introduced by v1/v2 fix waves)

- **Bug #17**: `safe_ffmpeg_run` adoption incomplete — `RuntimeError` not caught by inner handler in `_generate_from_segments_task`
- **Bug #63**: `response.ok` check in `use-batch-polling.ts` is dead code after `apiFetch` already throws — logic error in the fix
- **Bug #57**: `isMountedRef` cleanup in separate `useEffect` — pattern applied incorrectly in profile-context
- **Bug #54**: `pollFallback` in `use-job-polling.ts` — `isCancelledRef` checked before await but not after (incomplete fix)
- **Bug #62**: Same pattern in `use-polling.ts` — pre-await check only

**Total regressions: ~5**

### Incorrectly-Applied Fix Patterns

1. **`isMountedRef` / `isCancelledRef`** — checked pre-await but not post-await in 3 hooks (#54, #62, #57)
2. **`safe_ffmpeg_run` adoption** — `RuntimeError` not handled in library_routes inner try/except (#17)
3. **`response.ok` dead code** — added in batch-polling but `apiFetch` already throws (#63)

**Total incorrectly-applied patterns: 3 distinct patterns**

### Top 5 Most Problematic Files

| # | File | Bug Count | Highest Severity |
|---|------|-----------|-----------------|
| 1 | `app/api/auth.py` | 6 | HIGH |
| 2 | `frontend/src/app/librarie/page.tsx` | 9 | HIGH |
| 3 | `frontend/src/app/pipeline/page.tsx` | 7 | HIGH |
| 4 | `frontend/src/hooks/use-job-polling.ts` | 5 | HIGH |
| 5 | `app/api/segments_routes.py` | 5 | MEDIUM |

### Recommended Fix Priority Order

1. **CRITICAL #74** — Open redirect in `auth/callback/route.ts` — validate `next` param against allowlist
2. **HIGH #41-43** — threading.Lock in async context (ffmpeg_semaphore, edge_tts, auth) — switch to asyncio.Lock
3. **HIGH #42** — `elevenlabs_tts.py` blocking event loop with FFmpeg — wrap in `asyncio.to_thread`
4. **HIGH #2** — Raw ValueError in global exception handler — sanitize before HTTP response
5. **HIGH #54, #62** — Post-await mount guards missing in polling hooks — add checks after every await
6. **HIGH #75-76** — Library page race conditions on profile switch — add AbortController
7. **MEDIUM security cluster** (#18, #19, #26, #31, #32) — raw exceptions leaked in HTTP responses
8. **MEDIUM concurrency cluster** (#21-23, #25) — blocking Supabase calls in async + double semaphore
9. **MEDIUM stale closure cluster** (#84, #85, #87, #127) — use refs or functional updaters

### Production Readiness Assessment

**Not yet production-ready.** The codebase has improved significantly with 269 bugs fixed in v1+v2, but this audit found:

- **1 CRITICAL** security vulnerability (open redirect) that must be fixed before any public deployment
- **12 HIGH** severity bugs, mostly concurrency (threading.Lock blocking async event loop) and data races
- **51 MEDIUM** bugs including security leaks, stale closures, and missing mount guards
- Several fix patterns from v1/v2 were applied incorrectly, indicating the fixes need their own verification pass

**Recommended next steps:**
1. Fix the CRITICAL open redirect immediately
2. Batch-fix all HIGH bugs (12 items, mostly pattern-based)
3. Address MEDIUM security leaks (sanitize all `str(e)` in HTTP responses)
4. Fix MEDIUM concurrency bugs (async-blocking calls)
5. Address MEDIUM React hook violations in a single pass
