# Desktop Application Health Audit — 2026-07-11

## Scope

Evidence-based audit of the Electron lifecycle, FastAPI backend, Next.js frontend, script → TTS → preview → render pipeline, configuration fallbacks, error handling, and build/test scripts.

## Confirmed fixes

- API test clients now use in-memory job storage and an explicit development profile instead of reading or writing the developer's `data.db`.
- ESLint ignores the separate `.next-dev` output, and all Next.js 16 lint errors were resolved without changing the 95 historical warnings.
- The Settings bridge points to the exact web heading, “Connect a desktop for free rendering,” and its token, reveal, pairing, and runner controls have programmatic names.
- Desktop unpair calls `DELETE /api/render/v1/pair` with its runner bearer token before deleting local credentials. Network, server, and malformed-response failures return a clear error and keep the local token for retry; a confirmed revoke or already-revoked token clears it.
- Voice-mute requests enforce the ML installation gate before opening the repository, avoiding unnecessary SQLite access and lock failures.
- Stale backend expectations were aligned with intentional repository, writable desktop-path, GPU-first encoding, SRT formatting, and video-scoring contracts.

The existing runner robustness work was also verified: status exposes `lastError`, revoked pairing stops retrying, transient failures back off exponentially, orphaned renders are reported retriable, and unverified Kokoro TTS fails fast.

## Verification

- Backend: 484 passed, 2 skipped, 18 expected failures; four remaining failures are documented below.
- Runner/unpair regression tests: 13 passed. ML gating: 7 passed. API job lifecycle: 20 passed.
- Frontend: `npm run lint` passed with warnings only; `npm run typecheck` passed.
- A clean physical-copy production build compiled all 25 routes and copied `.next/static` plus `public` into the standalone bundle.
- Chromium loaded the production Settings page with two stylesheets and zero failed `/_next` assets. Settings bridge copy and accessible roles were exercised in the running development UI.
- Electron process topology was observed with FastAPI on port 8000 and standalone Next.js on port 3947; `/api/v1/health/live` returned `status=ok`.

Screenshots:

- `frontend/screenshots/audit-settings-cross-app-copy.png`
- `frontend/screenshots/audit-settings-accessible-switch.png`
- `frontend/screenshots/audit-isolated-production-settings.png`

## Remaining blockers

- Three obsolete TTS tests in `tests/test_api_routes.py` omit the now-required `provider` and `voice_id` fields and expect the old `pending` state. That file had pre-existing user edits, so the audit did not overwrite it.
- `build_output_basename()` limits script labels to six words while its readable-name contract/test expects seven. `app/services/assembly_service.py` was already staged with unrelated work; the safe follow-up is to change only `max_words=6` to `max_words=7` after that work is committed.
- A live user-owned Electron process locked `.next/standalone` during an in-place build attempt. A verified replacement bundle is preserved under `%TEMP%`; after quitting Electron, replace `frontend/.next` with the preserved build and restart from `electron` using `npm run dev`.
