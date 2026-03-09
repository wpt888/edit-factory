---
phase: 75-batch-endpoint-fix
plan: 01
status: completed
duration: 1min
tasks_completed: 2
files_changed: 1
commit: 5b8e272
---

# Summary: Fix batch endpoint URL

## What was done
- Changed BatchUploadQueue endpoint from `/generate-raw` (non-existent) to `/generate`
- Updated comment to match corrected endpoint name
- Verified zero occurrences of `generate-raw` in entire frontend/src/

## Files Modified
- `frontend/src/components/batch-upload-queue.tsx` — fixed endpoint URL on line 234

## Verification
- `grep -r "generate-raw" frontend/src/` → 0 results (PASS)
- `npm run build` → success (PASS)
- Backend route `POST /projects/{project_id}/generate` exists at library_routes.py:761 (PASS)

## Gaps Closed
- INT-03: BatchUploadQueue calls correct endpoint
- FLOW-02: Batch flow completes without 404 errors
