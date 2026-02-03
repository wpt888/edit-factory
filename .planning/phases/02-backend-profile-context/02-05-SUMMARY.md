---
phase: 02-backend-profile-context
plan: 05
subsystem: api
tags: [ffmpeg, video-processing, temp-files, profile-isolation]

# Dependency graph
requires:
  - phase: 02-01
    provides: ProfileContext and get_profile_context for profile validation
provides:
  - Profile-scoped FFmpeg temp directories in library_routes.py and routes.py
  - Isolated temp file storage preventing cross-profile file collisions
  - Profile-aware cleanup function for temp directory maintenance
affects: [02-03-library-profile-injection, 02-04-routes-profile-injection]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Profile-scoped temp directories: temp/{profile_id}/ pattern"
    - "Optional profile_id parameter with 'default' fallback for backward compatibility"
    - "Cleanup functions accept profile_id to scope deletion operations"

key-files:
  created: []
  modified:
    - app/api/library_routes.py
    - app/api/routes.py

key-decisions:
  - "Default profile_id='default' for all functions - enables backward compatibility while preparing for profile context injection"
  - "cleanup_orphaned_temp_files scopes cleanup by profile_id when provided, cleans all profiles when None"
  - "Legacy flat temp/ files cleaned alongside profile subdirectories for gradual migration"

patterns-established:
  - "Background task pattern: add profile_id as Optional parameter, default to 'default'"
  - "Temp directory pattern: settings.base_dir / 'temp' / profile_id"
  - "Create temp directory immediately after path construction: temp_dir.mkdir(parents=True, exist_ok=True)"

# Metrics
duration: 7min
completed: 2026-02-03
---

# Phase 2 Plan 5: FFmpeg Temp Directory Profile Scoping Summary

**Profile-scoped FFmpeg temp directories prevent cross-profile file collisions during concurrent video processing**

## Performance

- **Duration:** 7 minutes
- **Started:** 2026-02-03T11:18:28Z
- **Completed:** 2026-02-03T11:25:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- All VideoProcessorService instantiations use profile-scoped temp directories
- TTS audio files isolated by profile to prevent overwrite conflicts
- Concat lists and segment extractions scoped to profile subdirectories
- Cleanup operations can target specific profile or all profiles
- Backward compatible with default profile_id for existing callers

## Task Commits

Each task was committed atomically:

1. **Task 1: Update library_routes.py temp directories to be profile-scoped** - `d1abeab` (feat)
2. **Task 2: Update routes.py temp directories to be profile-scoped** - `b48413c` (feat)

## Files Created/Modified
- `app/api/library_routes.py` - Added profile_id to 4 background tasks (_generate_raw_clips_task, _render_final_clip_task, _generate_from_segments_task, _extend_video_with_segments), updated all temp paths to include profile_id subdirectory, enhanced cleanup_orphaned_temp_files to support per-profile cleanup
- `app/api/routes.py` - Added profile_id parameter to get_processor() and process_tts_job(), scoped temp directories by profile for FFmpeg operations and TTS audio generation

## Decisions Made

**Default profile_id value:**
- All profile_id parameters default to "default" string
- Enables backward compatibility with existing callers that don't pass profile_id
- Future route handlers (plans 02-03/02-04) will override with actual profile_id

**Cleanup function behavior:**
- profile_id=None: Clean all profile subdirectories (admin cleanup)
- profile_id="default": Clean only default profile's temp directory
- profile_id="{uuid}": Clean specific profile's temp directory
- Also cleans legacy flat files in temp/ root for gradual migration

**Temp directory structure:**
- Before: `temp/tts_{job_id}.mp3` (collision risk)
- After: `temp/{profile_id}/tts_{job_id}.mp3` (isolated)
- Pattern applies to: TTS audio, concat lists, segment files, extended video temp files

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**File modification during editing:**
- routes.py was being modified by external process (likely from plan 02-04 execution)
- Resolution: Reset file to clean committed state before editing
- No impact on plan completion - modifications were related work (profile context injection)

## User Setup Required

None - no external service configuration required. This is internal file structure change.

## Next Phase Readiness

**Ready for plans 02-03 and 02-04 (Route profile context injection):**
- Background tasks prepared to receive profile_id parameter
- Temp directory infrastructure ready for actual profile IDs
- Default fallback ensures system continues working during migration

**Benefits of profile scoping:**
- Profile A processing video doesn't interfere with Profile B's files
- Concurrent video generation for multiple profiles safe from race conditions
- Profile-specific cleanup allows storage management per tenant
- Clear file organization for debugging (temp/profile-uuid-1/, temp/profile-uuid-2/)

**Testing note:**
- Until plans 02-03/02-04 complete, all operations use temp/default/ subdirectory
- After profile context injection, routes will pass actual profile IDs (e.g., temp/550e8400-e29b-41d4-a716-446655440000/)

---
*Phase: 02-backend-profile-context*
*Completed: 2026-02-03*
