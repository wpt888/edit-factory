# Blipost frontend design system

This file is the canonical visual contract for `frontend/`. It applies to every
new screen and every UI change. Agent prompts and page-local conventions do not
override it unless the user explicitly changes the product direction.

## 1. Surface system

Dark mode uses exactly two solid application surfaces:

- `surface-canvas` / `background`: `#181818` — app shell, editor canvas,
  workspace panes, page background.
- `surface-panel` / `card`: `#202020` — document cards, controls, menus,
  popovers, and intentionally raised regions.

Use `surface-overlay` or alpha borders for hover, pressed, selection, and
separation. Do not invent a third opaque gray. Pure black is reserved for
actual video/image stages and media overlays, never for application panels.
Literal surface hex values belong only in `globals.css`; components consume
semantic Tailwind tokens such as `bg-background`, `bg-card`,
`bg-surface-canvas`, and `bg-surface-panel`.

Lime is a brand/state accent. Use it for the single primary CTA, current
step/tab, focus, and positive state. It must not become a general panel color.

## 2. Two composition modes

Choose one mode before implementing a screen.

### Document pages

Examples: Settings, Library, Usage, AI generators.

- Start with `PageShell`; generator routes start with `GeneratorShell`.
- Use normal `Card` components on `surface-panel`.
- Use the standard six-unit vertical rhythm (`space-y-6`).
- Use `PageHeader`; do not hand-roll an H1/action header.

### Workspaces

Examples: Pipeline steps 1–3, Timeline, Attention Templates, Subtitle
Templates, Segments.

- Use `EditorHeader` for the top chrome.
- Panes use `surface-canvas` and one-pixel dividers.
- Use `<Card variant="workspace">` for sections that must be cards on narrow
  layouts and flush inspector sections from 1280 px upward.
- Every pane begins with the shared `WorkspacePanelHeader`. Its compact geometry
  is invariant: `h-9` (36 px), `px-2`, one-pixel bottom divider, vertically
  centered `text-xs font-semibold` title, and the same leading grip. Headers
  remain permanently visible; do not hide them behind hover. Adjacent pane
  headers must share the exact top edge, bottom edge, and title baseline;
  page-local `h-10`/`h-12`/`h-14` headers are forbidden.
- The grip is always functional: every named workspace pane can be dragged by
  its header and exchanged with its sibling panes. Reordering persists for the
  workspace; a visible named header must never advertise a disabled drag.
- Every workspace pane has the same lower endcap: `h-3` (12 px), a one-pixel
  `border-border` top divider, and `surface-panel`. Complete pane shells carry
  `data-workspace-pane`; the shared rule reserves 12 px and pins the endcap to
  the pane's bottom edge so it remains visible while content scrolls. Never
  infer it from the presence of a header because workspace panes may contain
  nested headers and cards. Headerless exceptional panes may render
  `WorkspacePanelEndcap` explicitly.
- Do not neutralize a default Card with page-local combinations of
  `rounded-none`, `border-0`, and `bg-background`.
- Dense editor controls may use smaller heights, but the choice belongs to a
  shared component or explicit component variant.

Never mix document Card composition and workspace composition in the same pane.

## 3. Component grammar

- Page container: `PageShell` (`default`, `narrow`, or `wide`).
- Generator container: `GeneratorShell`.
- Document header: `PageHeader`.
- Full-bleed editor header: `EditorHeader`; tool-heavy workspaces may use its
  compact 44 px variant.
- Workspace pane/tab header: `WorkspacePanelHeader`.
- Content surface: `Card`; use its `workspace` variant inside workspaces.
- Buttons, inputs, selects, textareas, switches, tabs, dialogs, badges, and
  accordions come from `components/ui/`.

Page files own content and layout decisions, not primitive styling. If the
same class recipe appears twice, promote it into a component or variant.

## 4. Shape, spacing, and type

- Controls use the shared primitive radius; normal cards use `rounded-lg`;
  pills alone use full radius.
- Dark application surfaces do not use box shadows. Use a border or overlay.
- Spacing comes from 4, 8, 12, 16, 24, 32, 48, or 64 px.
- Page titles come from `PageHeader`; workspace titles come from
  `EditorHeader`; section titles come from `CardTitle` or the owning primitive.
- Prefer three text levels: foreground, muted foreground, and tertiary muted
  foreground. Do not create hierarchy by making every label bold.

## 5. Interaction and accessibility

- Every interactive target needs a visible hover and `focus-visible` state.
- Hover changes color/surface only; avoid scale, translation, and glow.
- Do not use raw buttons or form controls when a shared primitive exists,
  except inside purpose-built media/canvas interactions.
- Preserve keyboard navigation, labels, roles, and selected/current states.

## 6. Inspector forms (dense editor panels)

Dense editor inspectors — the Step 3 Subtitle Style and Render Settings panels,
the Attention/Subtitle template editors, and any future workspace side panel —
share one grammar. The primitives live in `components/ui/inspector.tsx`
(`InspectorField`, `InspectorSectionHeader`, `InspectorSection`,
`InspectorSwitchRow`); reuse them instead of re-deriving the recipe. A field
label is not a section header, inspectors have no inner boxed panels, and dense
editors use exactly one select height.

1. **Field labels**: `text-xs font-medium text-muted-foreground`. Never
   bold-white; that weight belongs to section headers only.
2. **Controls**: height `h-8`, `text-xs`.
   - Selects: shadcn `SelectTrigger size="sm"` + `text-xs`. Transparent/bordered
     default look — no `bg-muted/50` fills, no `h-7`, no `h-9` in inspectors.
   - Inputs: `h-8 px-2 text-xs`.
   - Action-row buttons: `variant="outline" size="sm" className="h-8 text-xs"`.
3. **Collapsible sections**: flush composition. Trigger `h-8`, `px-1.5`, title
   `text-sm font-medium text-foreground` left, collapsed summary
   `text-xs font-normal text-muted-foreground truncate` right, chevron
   `size-4 text-muted-foreground` rotating. Separate sections with 1-px dividers
   (`border-t` / `divide-y divide-border/70`), never with
   `rounded-md border bg-surface-panel` boxes.
4. **Numeric readouts** (slider values, bitrate, GOP, %):
   `font-mono text-xs tabular-nums text-muted-foreground`.
5. **Slider rows**: inline grid
   `grid min-h-6 grid-cols-[7rem_1fr_auto] items-center gap-2` — label | slider |
   readout.
6. **Switch rows**: flush `flex items-center justify-between` — label (+ optional
   `text-[11px] text-muted-foreground` helper) left, Switch right. No box.
7. **Helper/secondary text**: `text-[11px] text-muted-foreground` (no
   `text-[10px]` in these panels).
8. **Surfaces**: panels stay `Card variant="workspace"` (flush `bg-surface-canvas`
   at ≥1280 px). Inside inspectors, no `bg-surface-panel` and no `bg-muted/30`
   boxes. Lime stays on the primary CTA / switch-checked / slider thumb / focus.

Native form controls are forbidden in application UI — a raw `<select>` renders
an OS-native popup with broken dark-mode contrast. Use the shadcn `Select` (and
other `components/ui/` primitives); the only exceptions are purpose-built
media/canvas overlay controls. `design:check` enforces the native-control ban
globally and rules 2, 3, and 8 across the inspector files.

## 7. Required verification

For every frontend UI change run:

1. `npm run design:check`
2. `npm run lint`
3. `npm run typecheck`
4. the focused Playwright contract and a rendered screenshot at the affected
   desktop size

Design screenshots that protect a contract use Playwright snapshot assertions,
not capture-only screenshots.
