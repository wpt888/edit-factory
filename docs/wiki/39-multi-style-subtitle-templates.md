# Multi-style subtitle templates

Date: 2026-07-21

## Problem corrected

The first Subtitle Templates page used `template` and `style` as synonyms.
Each saved row contained one look, so the management page could not express the
actual product concept: one reusable template containing several caption looks
that rotate across output variants.

The corrected hierarchy is:

```text
Subtitle template
  -> Style 1 (visual settings, A/B overrides, words per subtitle)
  -> Style 2 (visual settings, A/B overrides, words per subtitle)
  -> ...
```

Style order is meaningful. Selecting the template in Pipeline Step 3 copies
its child style IDs into the existing rotation order. With three styles the
variant assignment is `1,2,3,1,2,3,...`.

## Persistence and compatibility

The existing profile JSON column remains the storage boundary. A new record is
stored as a container:

```json
{
  "id": "template-id",
  "name": "Launch captions",
  "created_at": "...",
  "styles": [
    {
      "id": "style-id",
      "name": "Punchy karaoke",
      "settings": {"fontFamily": "Anton", "karaoke": true},
      "wordsPerSubtitle": 2
    }
  ]
}
```

No database migration is needed. Old rows that contain `settings` directly are
normalized at read time into a template with one `Default style`. Editing that
template writes the new container shape while retaining the old ID.

Two API views deliberately serve different consumers:

- `/profiles/{id}/subtitle-templates` returns the hierarchical management
  model;
- `/profiles/{id}/subtitle-presets` returns a flat list of child styles with
  `templateId` and `templateName` metadata.

The flat view preserves existing preview, render, per-variant selection, and
pipeline-template rotation behavior. Style IDs remain the values persisted in
`rotation.presetIds`; final rendering does not need a new resolution path.

## User interface

The Templates pane is a keyboard-focusable collapsible tree. A template row
shows its child count and provides a direct plus action. Expanding it reveals
every style, its word count, and a second `Add style` action. The settings pane
separates template name from style name; all other controls edit the selected
style only.

In Step 3, `Use a subtitle template` replaces the rotation list with all child
styles in their saved order. Individual rows can still be reordered, replaced,
or removed to create a pipeline-specific custom rotation.

## Verification

- Backend tests cover two-style creation, hierarchical reads, flat reads,
  stable IDs during updates, legacy normalization, and rotation validation for
  child style IDs.
- Playwright covers expansion, adding a third style, ordered persistence,
  confirm-gated deletion, panel movement/resizing, and Step 3 collection
  selection.
- The visual contract is protected by
  `subtitle-template-with-three-styles-chromium-win32.png`.
