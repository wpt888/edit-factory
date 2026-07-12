# Session navigation cache

## Purpose

Desktop users frequently move between Pipeline, Segments, Library, Products, and
the other sidebar sections. Next.js keeps the application shell mounted during
this navigation, but it unmounts the individual page component. Page-local
state therefore cannot retain already fetched API data by itself.

## Implementation

- `frontend/src/lib/api.ts` keeps successful, non-volatile `GET` responses in a
  renderer-memory cache.
- Cache entries are scoped by the active profile ID and exist only for the life
  of the desktop renderer. Nothing is written to localStorage or disk.
- Navigating back to a section reuses its already loaded API data immediately,
  avoiding a repeated loading state and request.
- Status, progress, health, logs, and event endpoints are intentionally not
  cached so background work and polling remain live.
- Every API write (`POST`, `PUT`, `PATCH`, `DELETE`, upload, including direct
  `apiFetch` writes) clears the shared cache. The next read then reflects the
  server-side change.

## Source videos

Pipeline also keeps its source-video list in a profile-scoped cache because the
Pipeline page unmounts when opening Segments. The list is invalidated when a
source video is added, deleted, or renamed. The Edit links use `next/link`, so
opening a source video does not trigger a full document navigation.

The selected source video in Segments is also held in renderer memory per
profile. Returning through the sidebar to `/segments` restores that selection;
an explicit `?video=<id>` link takes precedence over the remembered value.

## Verification

- `npm run typecheck`
- `npm run lint` (repository warnings remain; no lint errors)
