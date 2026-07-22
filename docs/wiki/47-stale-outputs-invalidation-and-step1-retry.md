# EF-3: Stale render invalidation + Step 1 failure handling

Audit findings 4, 5, and 9 (`goals/audit-2026-07-21-findings.md`): a completed
render stayed `completed` — and publishable — after the script, composition,
attention timeline, voice-over, or subtitles that produced it changed. Step 1
generic provider failures crashed on an undefined `deduplicate` variable and
left the async job stuck in `processing` forever. Pipeline/assembly retention
(`expires_at`) never moved, so an actively-edited pipeline could still expire
mid-session.

## Invalidation

`app/api/pipeline_routes.py` gained `_invalidate_render_jobs` /
`_invalidate_library_clips`: when a completed render job's fingerprint-covered
input changes, the job flips from `completed` to `stale` (`current_step`
becomes "Needs re-render"), and the linked library clip's `final_status`
follows it to `stale` so the existing publish gate catches it.

Wired into every route that can change a variant's rendered output:

- `update_pipeline_template_settings`, `update_source_selection`
- `update_attention_timeline`, `apply_attention_template`, `update_attention_selection`
- `update_meta_multiplication`
- `update_subtitle_rotation`, `update_subtitle_overrides`
- `update_pipeline_scripts`, `regenerate_script`
- `adopt_library_tts`, `_generate_variant_tts_work` (voice-over regeneration)
- `preview_variant`, `save_matches`, `save_composition` (composition/transitions/music)

Each site only invalidates when the relevant field actually changed (diffed
against the prior value), reusing the existing preview-fingerprint keying
(`preview_key` / `variant_index`) instead of a new tracking mechanism.

## Publish gate

`buffer_routes.py`, `postiz_routes.py`, and `blipost_platform_routes.py` now
check `final_status == "completed"` before serving a clip for publish —
`409 Clip needs re-render before publishing` otherwise. This is the same gate
a `deleted`/`processing` clip already hit; `stale` just joins that set.

## Step 1 failure handling

`_run_pipeline_generation_job`'s generic-exception branch referenced an
undefined `deduplicate`, so any non-auth provider failure (rate limit,
timeout, outage) raised `NameError` after the refund already ran, leaving the
async job in `processing` with no user-visible error. Replaced with a plain
`else`: refund still happens, job is marked `failed` with
"Pipeline generation service unavailable. Please try again later."

## Retention

`_db_save_pipeline`, `_db_update_render_jobs`, and `_db_update_async_jobs`
now refresh `expires_at` to now+30 days on every write (matching the History
30-day TTL from migration 016). `assembly_routes.py` does the same on a 7-day
window for assembly jobs. `get_pipeline_status`'s TTL check now reads the
persisted `expires_at` instead of a fixed `created_at + 30d`, so an edited
pipeline no longer expires out from under an active session.

## UI

Step 4 renders `stale` as a distinct amber "Needs re-render" badge with an
inline alert; the download/publish block stays gated on
`status === "completed"`, so a stale render can't be served from the UI
either. Render-completion polling treats `stale` as terminal alongside
completed/failed/cancelled. Pipeline History sidebar shows "Expires in N
days" once a pipeline is within 3 days of its `expires_at`.

## Verification

- `tests/test_pipeline_invalidation.py` (4 new tests, sqlite backend):
  script edit → stale render + 409 on publish; generic Step 1 failure →
  refund + `failed` job; pipeline edit extends 30-day `expires_at`; assembly
  job update extends 7-day `expires_at`. All pass.
- `ruff check` clean on every touched file (one pre-existing, unrelated E402
  in `pipeline_routes.py` from an import that was already out of order).
- Full `tsc --noEmit` clean; `/pipeline` verified rendering after the change
  via Playwright screenshot (no seeded stale variant in local dev data, so
  the badge itself wasn't visually exercised — code path is covered by the
  pytest suite instead).
