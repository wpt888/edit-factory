---
phase: 59
plan: 59-02
subsystem: auth-cache, tts-cache
tags: [performance, caching, TTL, LRU, metrics]
dependency_graph:
  requires: []
  provides: [profile-context-cache, tts-cache-stats-endpoint]
  affects: [app/api/auth.py, app/services/tts_cache.py, app/api/routes.py]
tech_stack:
  added: []
  patterns: [in-memory-TTL-cache, threading-lock, LRU-atime-eviction]
key_files:
  created: []
  modified:
    - app/api/auth.py
    - app/services/tts_cache.py
    - app/api/routes.py
decisions:
  - "Profile cache key is (user_id, profile_id_or_'default') with monotonic timestamp for TTL"
  - "Fallback placeholder UUID (00000000) is NOT cached — only real DB profiles are stored"
  - "Bounded profile cache: clear all entries when >1000 (simple eviction for long-running processes)"
  - "TTS LRU eviction uses st_atime (access time); os.utime() touches atime on cache hit"
  - "GET /tts/cache/stats placed before /tts/{job_id} routes to prevent 'cache' being parsed as job_id"
metrics:
  duration_minutes: 15
  completed_date: "2026-03-02"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
  files_created: 0
---

# Phase 59 Plan 02: Profile Cache TTL & TTS Cache Metrics Summary

**One-liner:** In-memory 60s TTL profile cache in auth.py + TTS hit/miss counters with LRU eviction and GET /tts/cache/stats endpoint.

## What Was Built

### Task 1: Profile Context Caching with 60-Second TTL (commit: 896c6a9)

Added module-level `_profile_cache` dict to `app/api/auth.py` with threading lock and 60-second TTL. The cache stores `(user_id, profile_id_or_"default") -> (ProfileContext, monotonic_timestamp)` entries.

Key design decisions:
- `_cache_get_profile()` checks TTL on read and deletes expired entries inline
- `_cache_set_profile()` clears the entire cache if it grows past 1000 entries (simple bounded eviction for long-running processes)
- All three paths in `get_profile_context()` check cache first: dev mode (explicit profile), dev mode (default), production (default), production (explicit profile)
- Error states are never cached — only successful `ProfileContext` objects
- The fallback placeholder UUID (`00000000-0000-0000-0000-000000000000`) is never cached

### Task 2: TTS Cache Metrics and LRU Eviction (commit: 6277b4f)

Modified `app/services/tts_cache.py` to:
- Add module-level `_hit_count` and `_miss_count` counters protected by `_stats_lock`
- Increment `_miss_count` when `cache_lookup` returns None (file not found)
- Increment `_hit_count` and call `os.utime(mp3_path, None)` on cache hit (updates atime for LRU)
- Changed `_evict_if_needed()` to sort by `st_atime` instead of `st_mtime` (least recently accessed evicted first)
- Added `cache_stats()` function returning `{hit_count, miss_count, current_size, max_size}`

Added `GET /tts/cache/stats` endpoint to `app/api/routes.py`, placed BEFORE `/tts/generate` to prevent FastAPI from matching "cache" as a `{job_id}` path parameter.

## Deviations from Plan

None — plan executed exactly as written.

## Regression Checks

- Profile context still works in dev mode (auth_disabled/desktop_mode) — bypass path unchanged, only cache layer added on top
- Profile context still works when Supabase is down (503 path unchanged)
- `cache_lookup` and `cache_store` interfaces unchanged — metrics are purely additive
- `MAX_CACHE_ENTRIES=5000` constant used as `max_size` in stats response
- `/tts/cache/stats` route placed before `/tts/{job_id}` to avoid route ordering conflict

## Self-Check: PASSED

- FOUND: app/api/auth.py
- FOUND: app/services/tts_cache.py
- FOUND: app/api/routes.py
- FOUND: commit 896c6a9 (feat(59-02): profile context caching)
- FOUND: commit 6277b4f (feat(59-02): TTS cache metrics)
