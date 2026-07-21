# Inspector grammar for dense editor panels

Editor side panels used to drift apart visually: the Step 3 left "Subtitle
Style" inspector and the right "Render Settings" panel each invented their own
label weights, select heights, and section chrome (some flush, some boxed in
`rounded-md border bg-surface-panel`, some `bg-muted/30` cards). The attention
and clipping editors additionally used raw native `<select>` elements, which
render an OS-native popup with broken dark-mode contrast (white panel, system
blue highlight, washed-out option text).

This work unified every dense editor panel onto one canonical grammar, codified
it in the design contract, and made it enforceable.

## Shared primitives

`frontend/src/components/ui/inspector.tsx` is the single source:

- `InspectorField({ label, htmlFor, helper?, children })` — stacked
  label + control (`space-y-1.5`); label is `text-xs font-medium text-muted-foreground`.
- `InspectorSectionHeader({ title, summary? })` — title
  `font-medium text-foreground` + right-aligned muted truncated summary; sits
  inside an Accordion/Collapsible trigger that supplies its own chevron.
- `InspectorSection({ title, summary?, open?, onOpenChange? })` — flush
  Collapsible: `h-8`/`px-1.5` trigger, content under a `border-t`. Group sibling
  sections in a `divide-y divide-border/70` container for inter-section rules —
  never box them.
- `InspectorSwitchRow({ label, helper?, checked, onCheckedChange })` — flush
  `flex items-center justify-between` row, no box.

## The grammar (DESIGN_SYSTEM.md §6)

1. Field labels: `text-xs font-medium text-muted-foreground` (never bold-white).
2. Controls `h-8`/`text-xs`; selects use shadcn `SelectTrigger size="sm"` (one
   height only — no `h-7`, no `h-9`, no `bg-muted/50` fills).
3. Flush collapsible sections separated by 1-px dividers, not boxed panels.
4. Numeric readouts: `font-mono text-xs tabular-nums text-muted-foreground`.
5. Slider rows: `grid min-h-6 grid-cols-[7rem_1fr_auto] items-center gap-2`.
6. Switch rows: flush `justify-between`, optional `text-[11px]` helper.
7. Helper text: `text-[11px] text-muted-foreground` (no `text-[10px]`).
8. Panels stay `Card variant="workspace"`; no inner `bg-surface-panel`/`bg-muted`
   boxes. Lime only on CTA / switch-checked / slider thumb / focus.

Native form controls are forbidden in application UI — use shadcn `Select` and
the other `components/ui/` primitives. The only exceptions are purpose-built
media/canvas overlay controls (the timeline editor and the video player's speed
control).

## Applied to

- `render-settings-panel.tsx` — boxes removed; GPU/color-correction rows →
  `InspectorSwitchRow`; Video/Audio/Advanced → `InspectorSection`; bitrate/GOP/
  color sliders → inline slider rows; selects → `size="sm"`.
- `video-processing/subtitle-editor.tsx` — shared `InspectorSectionHeader`,
  muted field labels, `size="sm"` selects (dropped `bg-muted/50`), `h-8` color
  trigger, `font-mono` slider readouts.
- `step3-preview.tsx` — muted labels, `size="sm"` selects, Preview Timing title
  to `text-sm`, per-variant template selects to `size="sm"` (kept primary tint).
- `subtitle-template-rotation-panel.tsx` — selects to the `size="sm"` API.
- Native `<select>` → shadcn `Select`: `attention-templates/page.tsx` (4),
  `attention-template-picker.tsx` (2), `clipping/page.tsx` (4).

The popover primitives (`ui/select.tsx`, `ui/dropdown-menu.tsx`) already resolve
to the target look via tokens — dark panel (`--popover` = `#202020`), 1-px
`white/10%` border, hover `--accent` = 5% white, no system-blue selected state —
so they were left unchanged.

## Enforcement

`npm run design:check` (`scripts/check-design-system.mjs`) now fails on:

- any native `<select>` in `src/**` outside the media/canvas allowlist;
- `h-7`, `<SelectTrigger>` with `h-9`, or `rounded-md border bg-surface-panel`
  inside the four inspector files;
- `bg-muted/30` or `bg-muted/50` inside the render/step3/rotation panels.

## Verification

`design:check` and `tsc --noEmit` pass. Playwright: the design-system contract
and attention picker specs pass; new mocked specs screenshot Step 3 (both
inspectors on one flush canvas) and the attention editor's open shadcn dropdown
(dark popover). Screenshots in `frontend/screenshots/step3-inspector-grammar.png`
and `attention-editor-dropdown.png`.
