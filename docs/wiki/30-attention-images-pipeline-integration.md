# Attention Images: Pipeline Step 1 integration + per-variant stagger

## Background

"Attention Images" are overlay images that appear in bursts over the video
to boost retention. Before this session the feature already existed as
isolated pieces, none of them wired into the main Video Pipeline flow:

- Render engine: behind/front subtitle two-pass compositing, fade in/out
  (`app/services/video_effects/overlay_renderer.py::apply_attention_timeline`).
- Template CRUD: `/api/v1/attention-templates` (3 `SYSTEM_TEMPLATES` +
  personal templates).
- A separate template-editor page
  (`frontend/src/app/attention-templates/page.tsx`), reachable from the nav
  under Video Pipeline.
- A multi-layer timeline editor inside Step 3 for hand-placing cues.
- `POST /{pipeline_id}/attention-timeline/{preview_key}/apply-template`,
  which builds cues from a template via `distribute_attention_cues` and
  writes them into a preview's attention timeline.

Delivered on `feat/attention-images`: `ff3b8b4`, `74c5c9c`, `fbb4d4c`,
`87602e4`. None of that wired a way to configure Attention Images once, at
Step 1, and have it auto-apply to every generated variant.

## Delivered today (2026-07-19)

Problem: users had to open each variant's Step 3 timeline and apply a
template manually — there was no single "turn this on for the whole
pipeline" control, and every variant got identical cue timing, so images
popped at the same second in every variant.

1. **Step 1 picker** — `frontend/src/components/attention-template-picker.tsx`,
   mounted in `step1-script.tsx` under Video Idea. Lets the user choose a
   template, choose source images (Gallery/Upload via
   `AttentionAssetPickerDialog`), and set two new controls:
   - **Stagger / variant (s)** (`staggerSeconds`, default 1, range 0–30):
     variant *N* gets all its cues shifted by `N × staggerSeconds` seconds,
     so images don't land at the same timestamp across variants — variant 0
     keeps the base timing, variant 1 is +1s, variant 2 is +2s, etc.
   - **Variants (0 = all)** (`maxVariants`, range 0–100): only the first *N*
     variants get attention images applied; `0` means all variants.

2. **Selection persistence** — `PUT /api/v1/pipeline/{id}/attention-selection`
   (`pipeline_routes.py`) stores
   `{templateId, assetUrls, staggerSeconds, maxVariants}` under the
   reserved `_selection` key inside `editai_pipelines.attention_timeline`.
   Preview keys are `\d+(_[A-J])?`, so `_selection` can't collide with a
   real preview's cues. `GET /pipeline/scripts/{id}` returns it as
   `attention_selection`, so the choice survives history restore and
   import.

3. **Auto-apply on preview** — an effect in
   `frontend/src/app/pipeline/page.tsx` watches for a variant that now has
   a preview (`audio_duration` + `matches`) whose attention timeline is
   still empty, and calls apply-template with the preview's
   `durationMs`/`subtitleBoundariesMs` plus
   `startOffsetMs = variantIndex × staggerSeconds × 1000`. Variants at or
   past `maxVariants` are skipped. Timelines that are already non-empty
   (i.e. hand-edited in Step 3) are never overwritten by the auto-apply
   effect.

4. **Backend stagger support** — `ApplyAttentionTemplateRequest` gained
   `startOffsetMs` (0–60000, default 0). After
   `distribute_attention_cues` builds the base cues, each cue's timing is
   shifted by the offset; any cue that would then start at or past
   `durationMs` is dropped (not clamped back into range).

5. **Tests**:
   - `tests/test_attention_timeline.py::test_apply_template_start_offset_staggers_and_drops_overflow`
     — 3/3 passed in the file.
   - `frontend/tests/attention-step1-picker.spec.ts` — 2/2 passed: the
     picker (with stagger controls) is visible in Step 1; the auto-apply
     effect sends `startOffsetMs: 0` for variant 0 and `1000` for
     variant 1.
   - Screenshot: `frontend/screenshots/attention-step1-picker.png`.

## Operational gotchas

- The desktop app's frontend serves from port 3947 via a **standalone
  Next.js build** (`frontend/.next/standalone/server.js`), not the dev
  server — source edits are invisible until `npm run build`. The build
  fails with `EBUSY` if the standalone server process is still running (it
  holds a lock on `.next/standalone`): stop the node process first, build,
  then restart with `PORT=3947`.
- The backend (uvicorn on :8000) runs **without** `--reload` — restart it
  manually after route changes (required here for the new
  `startOffsetMs` and `attention-selection` fields to take effect).
- The Step 1 + stagger integration is **uncommitted** in the working tree:
  `page.tsx` and `pipeline_routes.py` interleave attention hunks with
  other parallel sessions' uncommitted work (segment_proximity scoring,
  karaoke `subtitle_styler.py`). Committing requires hunk-level staging
  plus the mixed-EOL rebuild recipe documented in
  `goals/attention-images-details.md` (compare
  `git diff --stat` vs `--ignore-cr-at-eol` per file; rebuild only the
  files that churn wildly, preserving HEAD's per-line EOL and staging with
  `core.autocrlf=false`).

## Related

- `goals/attention-images-details.md` — binding implementation spec for
  the whole Attention Images effort (engine, apply-template route, editor
  UI, template-editor screen) and the mixed-EOL commit recipe.
- `goals/attention-images-prompt.md` — original task prompt.
