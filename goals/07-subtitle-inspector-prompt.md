# Goal: Subtitle inspector — Premiere-style collapsible sections

Working directory: `C:\OBSID SRL\n8n\edit_factory` (Blipost desktop). Run this /goal from the edit_factory window, AFTER goal 06 (subtitle-template-rotation) has landed, on top of its branch or its merge result.

READ FIRST — binding: the "CRITICAL — mixed line endings" recipe in @goals/attention-images-details.md applies to EVERY commit (rebuild per-line EOL from HEAD; stage by explicit path; `git diff --cached --stat` must show only real lines). Never stage files you did not change for this goal.

## Product intent
The subtitle settings panel in Pipeline Step 3 (`SubtitleEditor` in settings-only/compact mode) is an all-in-one wall of controls. Restructure it like Adobe Premiere's Effect Controls panel: grouped, collapsible sections with a compact header row per section, current key values visible in/near the header, sections collapsed by default except the most-used one. Reference layout: Premiere's Video/Motion/Opacity panel (twirl-down arrows, label left / value right, tight rows).

## Scope — layout refactor ONLY
- File: `frontend/src/components/subtitle-editor.tsx` (and small touches in `step3-preview.tsx` if wiring requires). ZERO logic changes: same controls, same `SubtitleSettings` fields, same onSettingsChange behavior, same defaults. No new settings in this goal.
- Use the shadcn `Accordion` (already in the project — verify under `frontend/src/components/ui/`; if absent, add via shadcn generator, not a new npm dep) with `type="multiple"` so several sections can be open.
- Suggested grouping (adjust to the actual controls you find): **Text** (font, size, bold, spacing, words-per-subtitle if present after goal 06) / **Color & Stroke** (text color, outline color/width) / **Background & Shadow** (box, shadow, glow, opacity) / **Karaoke** (enable, style, highlight colors) / **Position** (positionY, horizontal alignment). Section headers show a short summary of current values (e.g. "Montserrat · 48") in muted text.
- Preserve every existing `data-testid` and the preset apply/delete flow. Compact density: rows like Premiere (label left, control right), not stacked full-width blocks.
- Optional UX inspiration: `CAPTIONS_AENEAS/caption_ui.py` settings organization — inspiration only.

## Acceptance
1. `npx tsc --noEmit` + `npm run build` (frontend/) green; existing Playwright specs touching subtitle settings still pass (`npx playwright test -g "subtitle"` at minimum; fix selectors only if the refactor legitimately moved them, and say so).
2. Playwright screenshots (MANDATORY per CLAUDE.md): Step 3 inspector with sections collapsed, and with two sections expanded. Frontend :3000/:3005, backend 8001 AUTH_DISABLED.
3. Wiki: entry in `docs/wiki/01-log.md` (small feature — log entry is enough, no new page unless you diverge meaningfully).

## Hard constraints
- **NEVER `git push`.** New branch `feat/subtitle-inspector` off the post-06 state. No new npm dependencies.
- No behavior drift: a settings object saved before the refactor must round-trip identically after it.

## Standing clauses
**A.** One logical change = one commit, conventional message, EOL recipe. Never push.
**B.** Docs at FULL completion only; commit.
**C.** Return = data: section grouping chosen, commits (hash+subject), test tails, screenshot paths.
**D.** Drive the running app for acceptance 2; report what you saw.
