---
phase: 66-local-file-storage-offline-mode
plan: 01
subsystem: file-storage
tags: [media-manager, project-scoped, local-storage, file-cleanup]

requires:
  - phase: 65-sqlite-local-database
    provides: "Repository abstraction and factory pattern"
provides:
  - "MediaManager service with project-scoped path resolution"
  - "media_dir config setting for local media root"
  - "Project deletion cleans up all associated media files"
  - "Upload, render, thumbnail, TTS flows use project-scoped directories"
affects: [66-local-file-storage-offline-mode, desktop-mode, file-serving]

tech-stack:
  added: []
  patterns: ["project-scoped media directories under media/{project_id}/", "singleton MediaManager factory"]

key-files:
  created:
    - app/services/media_manager.py
  modified:
    - app/config.py
    - app/api/library_routes.py

key-decisions:
  - "MediaManager works alongside existing input_dir/output_dir for backward compat"
  - "Each path method auto-creates parent directories so callers never worry about missing dirs"
  - "delete_project_media uses shutil.rmtree with onerror handler to log but not crash"
  - "Filename sanitization strips path separators, replaces spaces, limits to 100 chars"

patterns-established:
  - "Project-scoped media: all new media files stored under media/{project_id}/{type}/"
  - "MediaManager singleton via get_media_manager() factory"
  - "Backward compat: _generate_thumbnail falls back to legacy path when project_id is None"

requirements-completed: [DATA-04]

duration: 5min
completed: 2026-03-09
---

# Phase 66 Plan 01: Local Media Directory Structure Summary

**MediaManager service with project-scoped file paths for uploads, renders, thumbnails, and TTS under media/{project_id}/ tree**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-09T03:53:53Z
- **Completed:** 2026-03-09T03:58:44Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created MediaManager service with 7 path methods (project_dir, upload_path, render_path, thumbnail_path, tts_path, temp_path, delete_project_media)
- Added media_dir to Settings with ensure_dirs support
- Wired all file flows (upload, render, thumbnail, TTS, delete) to use project-scoped paths
- serve_file endpoint now allows serving from media_dir
- Backward compatibility preserved: old files at input/output/ paths still servable

## Task Commits

Each task was committed atomically:

1. **Task 1: Create MediaManager service with project-scoped paths** - `cdbaa1b` (feat)
2. **Task 2: Wire MediaManager into upload, thumbnail, render, and delete flows** - `8df7ffd` (feat, included in prior commit)

## Files Created/Modified
- `app/services/media_manager.py` - MediaManager class with project-scoped path resolution and cleanup
- `app/config.py` - Added media_dir field to Settings, updated ensure_dirs
- `app/api/library_routes.py` - Updated upload, render, thumbnail, TTS, delete flows to use MediaManager; added media_dir to serve_file allowed_dirs

## Decisions Made
- MediaManager works alongside existing input_dir/output_dir for backward compatibility
- Each path method creates parent directories automatically (mkdir parents=True, exist_ok=True)
- delete_project_media uses shutil.rmtree with onerror handler for resilience
- Filename sanitization strips path separators, limits to 100 chars, replaces spaces with underscores
- _generate_thumbnail accepts optional project_id -- falls back to legacy path when None

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Task 2 wiring was already present in library_routes.py from a prior concurrent commit (8df7ffd), so no additional commit was needed for Task 2.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- MediaManager is ready for use by future plans in Phase 66
- Old files at legacy paths remain accessible
- Project deletion now cleans up structured media directory

---
*Phase: 66-local-file-storage-offline-mode*
*Completed: 2026-03-09*
