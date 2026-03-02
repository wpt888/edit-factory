---
phase: 59
plan: "59-03"
title: "SSE Job Progress (Replace Polling)"
subsystem: "performance"
tags: ["sse", "streaming", "real-time", "job-progress", "eventSource"]
dependency_graph:
  requires: ["59-01", "59-02"]
  provides: ["sse-job-streaming", "real-time-progress"]
  affects: ["job-progress", "render-dialog", "product-video-page"]
tech_stack:
  added: ["StreamingResponse (fastapi)", "EventSource (browser API)"]
  patterns:
    - "Server-Sent Events (SSE) via AsyncGenerator + StreamingResponse"
    - "EventSource with onerror auto-reconnect"
    - "SSE fallback to polling when EventSource unavailable (SSR)"
key_files:
  created: []
  modified:
    - "app/api/routes.py"
    - "frontend/src/hooks/use-job-polling.ts"
    - "frontend/src/hooks/use-batch-polling.ts"
    - "frontend/src/hooks/use-polling.ts"
decisions:
  - "SSE endpoint has no auth — job IDs are UUIDs (unguessable), endpoint is read-only; EventSource cannot send custom headers"
  - "Backend polls JobStorage every 1 second and only emits SSE events when status or progress changes"
  - "Heartbeat event every 15 seconds keeps connection alive through proxies and firewalls"
  - "useJobPolling hook keeps identical external interface — all consumers work without code changes"
  - "Batch polling hook left as polling with TODO comment — batch SSE endpoint deferred"
metrics:
  duration_minutes: 15
  tasks_completed: 3
  tasks_total: 3
  files_modified: 4
  completed_date: "2026-03-02"
---

# Phase 59 Plan 03: SSE Job Progress (Replace Polling) Summary

## One-liner

SSE streaming endpoint at `/jobs/{job_id}/stream` plus EventSource-based `useJobPolling` hook replacing 2-second HTTP polling with a single persistent connection.

## What Was Built

### Backend SSE endpoint (`app/api/routes.py`)

Added `GET /jobs/{job_id}/stream` that:
- Returns `StreamingResponse` with `media_type="text/event-stream"`
- Runs an async generator loop, polling `JobStorage` every 1 second internally
- Emits `progress` events only when status or progress changes (reduces noise)
- Emits `completed` event (with result payload) and closes stream when job finishes
- Emits `failed` event (with error) and closes stream on failure
- Sends `heartbeat` every 15 seconds to prevent proxy/firewall timeouts
- No auth dependency — EventSource browsers cannot send custom headers; job IDs are unguessable UUIDs
- Sets `X-Accel-Buffering: no` header to disable nginx buffering

### Frontend hook rewrite (`frontend/src/hooks/use-job-polling.ts`)

Rewrote internal implementation from `setTimeout` polling to `EventSource`:
- Preserves identical exported interface: `startPolling`, `stopPolling`, `isPolling`, `currentJob`, `progress`, `statusText`, `elapsedTime`, `estimatedRemaining`
- Connects to `/api/v1/jobs/{jobId}/stream` via `EventSource`
- Handles `progress`, `completed`, `failed` events from SSE stream
- `cleanup()` calls `eventSource.close()` to properly terminate the connection
- Elapsed time counter and ETA calculation (`calculateETA`) unchanged
- SSE fallback: if `typeof EventSource === "undefined"` (SSR context), falls back to original `setTimeout` polling via dynamic import of `apiFetch`
- Exported `extractProgress` function (previously internal) for external use

### Polling hook comments

- `use-batch-polling.ts`: Added TODO comment for future batch SSE endpoint
- `use-polling.ts`: Added NOTE directing job-status callers to `useJobPolling`

## Deviations from Plan

None - plan executed exactly as written.

Minor auto-fix: TypeScript type alignment in SSE event handler — used `undefined` instead of `null` for optional `Job` fields and removed non-existent `created_at`/`updated_at` fields from the synthesized Job object. Pre-existing TypeScript error in `librarie/page.tsx` (cursor pagination from 59-01) left unchanged — out of scope.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | c0a468b | feat(59-03): add SSE streaming endpoint for job progress |
| 2 | b3f53ca | feat(59-03): rewrite useJobPolling to use EventSource (SSE) |
| 3 | 9b5ed10 | chore(59-03): add SSE migration comments to batch and generic polling hooks |

## Verification Notes

- All existing consumers of `useJobPolling` (library page render dialog, product-video page, progress-tracker component) work without code changes — interface preserved
- The regular `GET /jobs/{job_id}` endpoint remains unchanged for programmatic/authenticated access
- Backend `StreamingResponse` approach is compatible with FastAPI's `BackgroundTasks` — the SSE stream observes job state written by background tasks in `JobStorage`

## Self-Check: PASSED

Files modified:
- FOUND: app/api/routes.py
- FOUND: frontend/src/hooks/use-job-polling.ts
- FOUND: frontend/src/hooks/use-batch-polling.ts
- FOUND: frontend/src/hooks/use-polling.ts

Commits:
- FOUND: c0a468b
- FOUND: b3f53ca
- FOUND: 9b5ed10
