# Step 4 UX (navigation, Retry, Stop confirm) + accessibility (EF-4)

## Problem

Audit `goals/audit-2026-07-21-findings.md` sections 6-7 flagged four issues:

1. `pipeline-stepper.tsx` hid the step indicator below `min-[1950px]`,
   which meant it was invisible at a plain 1920x1080 (Full HD) display —
   the single most common desktop resolution.
2. `step4-render.tsx` had no way back to Step 3 once the user reached the
   render screen, and a `failed`/`cancelled` variant had no retry — the
   only recovery path was "Start New Pipeline" (re-running the whole
   pipeline from scratch).
3. Stop Render (global and per-variant) fired immediately on click, with
   no confirmation, unlike "Start New Pipeline" which already used a
   confirm dialog.
4. `pipeline-history-sidebar.tsx` and `source-videos-card.tsx` had
   mouse-only interactive elements: `span role="button"` without Space
   support, icon-only buttons without labels, and (on `source-videos-card`)
   an "Edit segments" link nested inside a selectable card that changed the
   card's selection when clicked.

## Fix

- **Stepper** (`pipeline-stepper.tsx:233`): breakpoint lowered from
  `min-[1950px]` to `min-[1800px]` and the stepper compacted (narrower
  max-width, `size-7` step circles instead of `size-8`, tighter gaps) so
  it renders inside a 1920px viewport instead of just above it.
- **Back + Retry** (`step4-render.tsx`): added a "Back to Preview" button
  (`setStep(3)`) next to Stop Render, and a Retry button on `failed`/
  `cancelled` variant cards. Retry reuses the existing single-variant
  remake flow (`handleRemakeVariant` → `POST /pipeline/remake/{id}/{variant}`)
  — the same call already wired to the "Remake with different segments"
  icon button on completed variants — rather than introducing a second
  render path.
- **Stop confirmation** (`step4-render.tsx`): both the global "Stop
  Render" button and the per-variant "Stop" button now open the same
  `confirmDialog` pattern already used for "Start New Pipeline" instead
  of calling `handleCancelRender` / the per-variant cancel directly.
- **History sidebar a11y** (`pipeline-history-sidebar.tsx`): the delete
  and expand controls are real `<button type="button">` elements with
  `aria-label`, `focus-visible` rings, and native Enter/Space activation
  (no manual `onKeyDown` needed). The whole clickable row is a `<button>`
  with `aria-expanded`/`aria-controls` pointing at the expanded script
  list's `id`.
- **Source videos a11y** (`source-videos-card.tsx`): selectable cards get
  `role="checkbox"`, `aria-checked`, `aria-label`, `tabIndex={0}`, and an
  `onKeyDown` handler for Enter/Space (kept as a styled `div` rather than
  a `<button>` since it wraps a native `Checkbox` and other controls —
  `role="checkbox"` matches its actual semantics). List/grid toggle
  buttons and the search-clear button gained `aria-label`; all three
  "Edit segments" links now call `event.stopPropagation()` so clicking
  them no longer also toggles the card's selection underneath.

## Verification

- `npm run lint` — no new errors/warnings in the four touched files (the
  run reports ~1700 pre-existing errors across the repo, none in
  `pipeline-stepper.tsx`, `step4-render.tsx`,
  `pipeline-history-sidebar.tsx`, or `source-videos-card.tsx`).
- `npm run design:check` — passes.
- `npx tsc --noEmit` — no errors in the four touched files.
- Playwright screenshot at 1920x1080 confirms the stepper is visible on
  Step 3/4 of `/pipeline`: `frontend/screenshots/step4-ux-a11y-1920.png`.
