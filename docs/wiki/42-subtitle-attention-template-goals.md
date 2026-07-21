# Subtitle & attention template goals — Step 3 application surface

Date: 2026-07-21 · Branch: `main` (unpushed)

## Purpose

Closes the gap reported against the template system: templates could be
*created* (Subtitle Templates page, Attention Templates space) but not
*applied or previewed* from the pipeline. Four goals, all on `main`:

1. **Live preview per variant** — the Step 3 subtitle live preview only
   rendered the Default/A/B style and ignored rotation entirely.
2. **Subtitle-free variants** — no way to express "variant 4 has no
   captions at all" in a rotation.
3. **Attention templates from Step 3** — applicable only via the Step 1
   picker (auto-apply, empty timelines only); Step 3 had just a link out.
4. **Discoverability** — the whole apply flow hid behind the rotation
   toggle (default OFF) and a link-out button.

## Commits

| Commit | Goal | Content |
|--------|------|---------|
| `a977a08` | 1 | `SubtitleStylePreviewPanel` gains a **Preview target** select: Base styles (Default / A · Instagram / B · Facebook), every active-rotation slot, every variant card. Non-style targets resolve through `getPreviewSubtitleSettingsFor`, i.e. the same template → Meta A/B → card-delta layering used by cards and render. Preview-only; never writes settings. |
| `d95b8c8` | 2 | `NO_SUBTITLES_PRESET_ID` (`"__none__"`) sentinel accepted in rotation slots and per-variant picks. Resolves to `SubtitleSettings.enabled=false` at the render boundary; backend validates and renders those variants without burn-in. |
| `37002c1` | 1+2 | Test alignment: per-variant spec was still asserting the retired "Live Preview — A/B" panel text; rotation spec extended for the fourth None slot and preview-target coverage. |
| `0d85eda` | 3 | Step 3 "Attention images" card becomes an inline apply surface: template picker + content-image slots, scope select (all variants / one), Apply with `mode:"replace"` against the existing `apply-template` endpoint. Overwriting a non-empty timeline is confirm-gated; variants without previews are skipped and reported. Payload builder extracted to `pipeline/attention-template-apply.ts`, shared with the Step 1 auto-apply effect; manual applies bypass its once-only `attentionAutoApplied` guard. |
| `fc4a53c` | 4 | Inspector "Subtitle templates" section shows state at a glance: collection name (or "Custom rotation") + assigned style count when rotation is ON; "No template applied" + an **Enable rotation** shortcut (enables and focuses the rotation panel in place) when OFF with saved presets; "No saved templates yet" + link-out otherwise. The rotation panel header keeps a "N styles ready · off" summary visible while collapsed. Collection matching extracted to `pipeline/subtitle-template-collections.ts`, shared with the rotation panel. |

Goals 1+2 were authored in a prior unfinished session; this session
verified them, finished their in-flight test edits, and delivered 3+4
(Goal 3 implemented via a Codex background task, Goal 4 started by Codex
and finished/verified here after its task hung).

## Verification

- Backend: 39/39 pytest across `test_subtitle_rotation*`,
  `test_pipeline_subtitle_overrides`, `test_pipeline_templates`.
- Frontend: `npm run typecheck` and `npm run design:check` green after
  every goal.
- Playwright (against the running dev server on :3000): 12/12 across
  `subtitle-template-rotation.spec.ts` (incl. None-slot + discovery-state
  + Enable-rotation-shortcut assertions), `subtitle-per-variant.spec.ts`,
  and the new `attention-step3-apply.spec.ts`.
- Screenshots (local only — `frontend/screenshots/` is gitignored):
  `attention-apply-step3.png`, `subtitle-template-discovery-on.png`,
  `subtitle-template-discovery-off.png`.

## Gotchas

- **Backend restart required** (rotation/`variantTemplates` fields);
  desktop needs a standalone rebuild to see any of it.
- The codex-rescue subagent is a one-shot forwarder: it returns a task id
  and will not monitor. Poll with
  `node .../codex-companion.mjs status <task-id>`; the Goal 4 task hung
  for 1h+ **after** completing its edits — inspect the working tree
  before assuming a hung task produced nothing.
- `frontend/screenshots/` is gitignored, so visual-verification artifacts
  never land in commits.
