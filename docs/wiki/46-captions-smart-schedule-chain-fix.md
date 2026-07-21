# Captions → Smart Schedule chain fix (EF-2)

Closes the caption-loss chain documented in
`goals/audit-2026-07-21-findings.md` §3. Goal spec:
`goals/02-captions-smart-schedule.md`.

## The bug

Three independent breaks combined into a chain that reported success while
publishing empty captions:

1. `pipeline-caption-generator.tsx` autosaved via a raw `fetch` to
   `window.location.origin` with the port swapped to `:8000` — wrong host
   whenever frontend and API run on different origins (prod), and it only
   checked `fetch`'s own rejection, never `response.ok`, so a 404/500 save
   failed silently.
2. `pipeline-schedule.tsx` sent `caption_template: ""` on confirm instead of
   the captions actually generated per clip — every scheduled post published
   with an empty caption regardless of what the generator produced.
3. `schedule_service.py`'s `_execute_v2` referenced `QueryFilters` without
   importing it (a `NameError` on every run) inside a bare
   `except: pass`, so the per-clip caption lookup always failed, silently
   fell through to the (empty) template, and the plan still reported success
   `(1, 0)`.

## The fix

### Frontend — `frontend/src/components/pipeline/pipeline-caption-generator.tsx`

Autosave now goes through `apiPost` (`frontend/src/lib/api.ts`), which
resolves the correct API base for desktop/web and throws `ApiError` on
non-2xx. The `keepalive` flag passes through via `FetchOptions extends
RequestInit`. A failed save surfaces as `toast.error("Failed to save
captions: ...")` instead of a console-only warning.

### Frontend — `frontend/src/components/pipeline/pipeline-schedule.tsx`

Two new derived maps: `captionByVariant` (first non-empty caption per
variant index) and `previewCaptionPayload` (per-clip caption for every
schedule preview entry, falling back to the variant's caption). Confirming
now sends `captions: previewCaptionPayload` instead of an empty
`caption_template`. `missingCaptionVariants` blocks confirmation — with a
visible inline warning (`role="alert"`) and a disabled Confirm button —
before any request goes out, so a missing caption is caught in the UI, not
after publish.

### Backend — `app/services/schedule_service.py` + `app/api/schedule_routes.py`

`QueryFilters` is imported once at module scope instead of inside the
function. The per-clip `editai_clip_content` lookup in `_execute_v2` no
longer swallows exceptions — a lookup failure now propagates. If no caption
is found for a clip (neither stored nor template), the executor raises
instead of publishing blank, which fails that schedule item and marks the
plan `failed`. `create_schedule_plan`'s caption-upsert (persisting
generated captions before the background executor runs) also stopped
swallowing its exception, so a caption-persistence failure is visible in the
job/plan status instead of a silent partial write. The background task
progress now reports `"failed"` instead of `"completed"` when the plan's
final status is `failed`.

## Tests

- `tests/test_schedule_service.py` — two new hermetic tests (no real
  Postiz): `test_caption_generation_to_smart_schedule_publishes_correct_variant_caption`
  drives `create_schedule_plan` → background V2 executor → a mock publisher
  and asserts each clip's post carries its own generated caption;
  `test_caption_query_failure_marks_smart_schedule_failed` forces the
  caption-store read to raise and asserts the publisher is never called and
  the plan/job status is `failed`. Full suite: **9 passed**.
- `frontend/tests/features/pipeline/captions-smart-schedule.spec.ts` — a
  Playwright e2e spec (route-mocked backend) that generates captions, hits a
  mocked 500 on autosave and asserts the visible failure toast, asserts the
  missing-caption inline warning blocks Confirm, then confirms and asserts
  the `schedule/plans` request body carries `captions: { clip-v0: ..., clip-v1: ... }`
  and no `caption_template` key. **1 passed** (also produces
  `frontend/screenshots/captions-smart-schedule.png` for the CLAUDE.md
  visual-verification rule).
- `ruff check app/services/schedule_service.py app/api/schedule_routes.py`:
  clean.

## Scope note

`app/api/schedule_routes.py` wasn't named in the original 3-file task list
but was touched for the same failure-propagation requirement (goal
acceptance criterion: "eșecul de schedule se propagă ca failure vizibil");
it's committed alongside `schedule_service.py` as one backend fix.
