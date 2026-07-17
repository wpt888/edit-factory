# Pipeline media preview host parity

Date: 2026-07-17

## Symptom

Pipeline Step 3 showed broken thumbnails even though the generated JPEG files
existed under `%APPDATA%\EditFactory\segments`. The failing markup mixed the
browser frontend host with the desktop API host, for example:

```text
page: http://localhost:3947/pipeline
image: http://127.0.0.1:8000/api/v1/segments/files/C%3A%5C..._thumb.jpg
```

The same host mismatch also affected source-video thumbnails, the timeline
preview stream, the server-rendered variant preview, and completed render
media.

## Root cause

The shared API client already resolved the loopback API from the browser's
current hostname. Authenticated fetches opened on `localhost` therefore used
`localhost:8000` and refreshed the HttpOnly source-media session for that host.

The native `<img>` and `<video>` URLs in the Pipeline components still used the
static desktop `API_URL`, which is pinned to `127.0.0.1:8000`. `localhost` and
`127.0.0.1` have separate cookie jars, so those native media requests did not
carry the media-session cookie and the segment file route returned HTTP 401.

There was a second Windows-specific URL issue: thumbnail paths were reduced
with `split("/")`, which does not split backslashes. Full local paths were
therefore encoded into the public URL instead of using only the filename.

## Fix

- Added `useApiUrl`, backed by `useSyncExternalStore`, so client media URLs
  switch to the current loopback hostname after hydration without introducing
  a server/client hydration mismatch.
- Added `mediaFilename` and `segmentFileUrl` helpers. They accept both `/` and
  `\` separators and expose only the media filename to `/segments/files/`.
- Migrated the Pipeline media consumers to the runtime API URL:
  - Step 3 variant thumbnail;
  - thumbnail/frame picker;
  - timeline segment thumbnails and preview stream;
  - source-video cards;
  - high-fidelity variant preview progress/video;
  - completed render poster, video, and download URL.

The concrete failing thumbnail now resolves to this URL shape:

```text
http://localhost:8000/api/v1/segments/files/2ef2f027-fe3c-4604-9e46-ff8fafa41178_thumb.jpg
```

## Files

- `frontend/src/hooks/use-api-url.ts`
- `frontend/src/lib/media-url.ts`
- `frontend/src/app/pipeline/components/step3-preview.tsx`
- `frontend/src/app/pipeline/components/source-videos-card.tsx`
- `frontend/src/app/pipeline/components/step4-render.tsx`
- `frontend/src/components/thumbnail-picker.tsx`
- `frontend/src/components/timeline-editor.tsx`
- `frontend/src/components/variant-preview-player.tsx`

## Verification

- `npm run typecheck`: passed.
- Focused ESLint on all touched frontend files: 0 errors; existing warnings
  remain for native media elements and unrelated ref cleanup code.
- `python -m pytest -q tests/test_source_media_session.py`: 4 passed.
- Direct Windows-path helper check: passed and produced the basename-only URL.
- CodeGraph was synchronized after the source changes.
- The source JPEG was confirmed present and non-empty.

The production build did not reach compilation because the running Electron
application had `frontend/.next/standalone/server.js` open and Windows returned
`EBUSY` while Next.js prepared the output directory. No application process was
terminated. Close EditFactory, rebuild the standalone frontend, relaunch it,
and perform the final visual/network verification on Pipeline Step 3.
