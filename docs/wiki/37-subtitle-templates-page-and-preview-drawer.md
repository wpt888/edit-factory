# Subtitle Templates page + Step 3 preview drawer

Date: 2026-07-20 · Branch: `main` (uncommitted)

## Purpose

Two related UX changes shipped together: a dedicated management page for
reusable subtitle templates (parity with the existing Attention Templates
page), and a rework of Step 3's Live Preview from an always-visible panel
into an on-demand drawer, freeing permanent screen space for the settings
column.

## Step 3 — Live Preview drawer

The "Live Preview" panel was removed from the Subtitle Style settings column
(`frontend/src/app/pipeline/components/step3-preview.tsx`) and is now a fixed
drawer on the right edge of the screen: `fixed`, `top-16` to `bottom-0`,
`w-[min(24rem,90vw)]`, `z-40`, sliding in/out with a 300ms `translate-x`
transition over the variant canvas.

It is toggled from a "Hide preview / Show preview" button in the Subtitle
Style card header (`data-testid="subtitle-style-preview-toggle"`), plus a
Close button inside the drawer itself. Open/closed state persists across
reloads in `localStorage` under `step3-style-preview-open`.

The settings column — A/B tabs, template rotation, presets, font/color/karaoke
controls — stays permanently visible; only the preview now hides. Tests in
`frontend/tests/features/tts/subtitle-per-variant.spec.ts` were updated:
drawer visibility/toggle assertions and viewport checks were rescoped to
`#subtitle-style-preview` since the drawer renders outside the style card.

## Subtitle Templates management page

New page `frontend/src/app/subtitle-templates/page.tsx`, mirroring the
Attention Templates page's shape:

- left column: template list with new / select / duplicate / delete
  (confirm-gated);
- right column: live preview (`SubtitleEditor` in `renderMode="preview-only"`)
  stacked over a compact settings-only editor;
- editable name and `wordsPerSubtitle`;
- Shared / Meta A / Meta B tabs — A/B tabs only materialize `settingsA` /
  `settingsB` overrides once a field is actually edited on that tab.

No new backend surface: it persists through the existing
`GET/POST/PUT/DELETE /profiles/{id}/subtitle-presets` endpoints, reusing the
`editai_profiles.user_subtitle_presets` JSON column — no new table, no
migration.

Sidebar entry "Subtitle Templates" (Captions icon) added in
`frontend/src/components/navbar.tsx`, directly under Attention Templates.
Step 3 links out to it via an "Open subtitle templates" button next to the
existing "Open template space" (attention) button.

## Per-variant template selection in Step 3

Previously, template rotation (see page 36) only assigned presets by
`variantIndex % presetIds.length`. Today's work adds an explicit per-variant
override on top of rotation:

- `resolveSubtitlePresetForCard()`, new in
  `frontend/src/app/pipeline/subtitle-template-rotation.ts`, resolves with
  precedence: explicit per-variant pick > rotation round-robin > none. Manual
  picks work even when rotation is disabled. `wordsPerSubtitleForVariant` was
  extended to honor the same selection.
- `page.tsx` holds `variantTemplateSelections`, keyed by `PreviewKey`
  (`"0"`, `"0_A"`, `"0_B"`), and threads it through
  `getPreviewSubtitleSettingsFor`, `getPreviewSubtitleTemplateSettingsFor`,
  `getAssignedSubtitlePreset`, render-payload flattening
  (`subtitle_settings_by_key`, `words_per_subtitle_by_key`), and pipeline
  template export/import.
- UI: a compact `Select` on each variant card header offers
  `"Auto (rotation)"` (sentinel `__auto__`) plus every named preset, shown
  whenever at least one preset exists; the same selector is mirrored in the
  maximize editor's Subtitles tab. Picking a template drops that card's local
  style override, so "Reset to template" now follows the newly picked
  template rather than the rotation default.

### Backend

`app/api/pipeline_routes.py`: `SubtitleRotationRequest.variantTemplates` is a
new field, stored at `settings["subtitles"]["variantTemplates"]`. `GET`
returns it; `PUT` validates preset IDs against the caller's owned presets and
silently drops unknown ones (same permissive-drop pattern as
`rotation.presetIds`).

**The backend must be restarted** to pick up the new request/response field.

## Verification

- Playwright: `subtitle-per-variant.spec.ts` — new describe block covers
  selector visibility, picking a template updates the effective name, and the
  selection survives reload; full file plus `tests/subtitle-templates.spec.ts`
  ran 7/7 green.
- Pytest: `tests/test_subtitle_rotation_api.py` extended for
  `variantTemplates` round-trip and unknown-ID drop — 3/3 and 4/4 green.
- Playwright ran against `http://localhost:3011` (port 3000 is now taken by
  the unrelated social-scheduler project) with
  `NEXT_PUBLIC_AUTH_DISABLED=true`.

## Gotchas

- Port 3000 now serves the other project (`social-scheduler`/blipost.com);
  edit_factory's frontend needs a different port for local Playwright runs.
- TTS regeneration still resolves words-per-subtitle at the base-variant key
  (`String(baseIndex)`). If Meta A and Meta B pick different templates with
  different word counts, they share the same TTS audio per base variant —
  accepted for now, since render styling (including cue regrouping, page 36)
  is still applied per card.
