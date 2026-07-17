# Pipeline toolbar overlap + heading-consistency fix pack (S1)

## Scope

Seven P0 visual bugs from the 2026-07-17 cross-app design audit, all inside
the studio pipeline toolbar/workspace chrome and the app's H1/CardTitle
typography. Source: `social-scheduler/goals/design-s1-pipeline-fixes.md`.

Main implementation files:

- `frontend/src/app/pipeline/components/pipeline-stepper.tsx`
- `frontend/src/app/pipeline/components/step1-script.tsx`, `step2-tts.tsx`,
  `step3-preview.tsx`, `step4-render.tsx`
- `frontend/src/app/pipeline/components/source-videos-card.tsx`,
  `pipeline-history-sidebar.tsx`
- `frontend/src/app/pipeline/pipeline-utils.tsx`
- `frontend/src/components/page-header.tsx` (new)
- `frontend/src/components/ui/card.tsx`
- 14 page files under `frontend/src/app/*/page.tsx`

## 1. Stepper/actions overlap

`PipelineStepper` centered the step track with `absolute left-1/2
-translate-x-1/2` plus a ladder of fixed per-breakpoint widths (28rem up to
42rem). Around 1100-1300px viewport width the track's fixed width collided
with the right-aligned toolbar actions (`z-10`), overlapping step 4's label.
Rebuilt the toolbar as a plain three-part flex row — context (`shrink-0`) |
step track (`flex-1`, `min-w-0`, internally `justify-center` with a
`max-w-2xl` cap) | actions (`shrink-0`) — so the track never needs to guess
the available width; the `z-10`/`absolute` hacks are gone.

## 2. Duplicate "Back to Scripts"

Step 3's mobile-cascade header (visible below the `min-[1280px]` workspace
breakpoint) repeated the toolbar's ghost "Back to Scripts" button as an
outline button next to the title — both visible at once under ~1280px,
including the audited ~1200px width. Removed the duplicate; the toolbar
button (present for step 3 regardless of width) is now the only one. Left a
comment pointing at the toolbar as the single owner of that action.

## 3. Workspace-mode Card background seam

Workspace mode (`pipelineLayout !== "guided"`, ≥1280px) strips a `Card`'s
border/radius/shadow so it sits flush against the page, but left the Card on
its `bg-card` default. `bg-card` is lighter than the toolbar/page's
`bg-background`, so every workspace Card showed as a visible seam directly
under the toolbar.

The per-site gap/padding/border overrides differ across the 7 call sites,
but the missing background fix was duplicated identically in all of them.
Added `WORKSPACE_CARD_BG = "min-[1280px]:bg-background"` to
`pipeline-utils.tsx` and appended it at each site instead of inlining a
fresh `bg-background` everywhere:

- `step1-script.tsx` (Video Idea card)
- `step2-tts.tsx` (TTS Configuration card)
- `step3-preview.tsx` × 3 (Assembly Settings, Subtitle Style, variant preview
  cards)
- `source-videos-card.tsx`
- `pipeline-history-sidebar.tsx`

## 4. Unified sub-header language

Step 2's sticky sub-header (title + count, `h-14`) used `bg-card` while its
parent section used `bg-background` — the same seam as #3, just missed by
the class name not literally being `bg-card` on a `Card` component. Aligned
it to `bg-background`. Step 3's equivalent sub-header was `h-10`; bumped to
`h-14` to match Step 2 and the main pipeline toolbar.

## 5. Heading counters split into a meta line

"Review Scripts (N)" and "Preview & Select Variants (N previews shown)"
interpolated the live count directly into the `<h2>` text. Split each into a
plain heading (`font-heading text-2xl font-semibold` for the Preview
heading) plus a `text-sm text-muted-foreground` meta paragraph underneath,
matching the pattern step 2's own sticky sub-header already used.

## 6. `font-heading` on page H1s

14 of the app's ~21 top-level pages rendered their `<h1>` without
`font-heading` (`automations`, `clipping`, `media-library`, `setup`, `login`,
and the auth-callback screen already had it): `batch`, `batch-generate`,
`calendar`, `create-image`, `create-video`, `librarie`, `product-library`,
`products`, `product-video`, `schedule`, `settings`, `tts-library`, `usage`,
`wiki`.

Added `components/page-header.tsx` — `PageHeader({ icon?, title, description?,
actions?, className? })` rendering `font-heading text-3xl font-bold
tracking-tight` — and migrated all 14 onto it. Page-specific extras that
don't fit the icon/title/description/actions shape (an eyebrow line above the
title on `create-video`, a back-button link on `usage`/`product-video`,
inline badges next to the title on `tts-library`/`wiki`) were kept as
siblings around `<PageHeader>` rather than forcing new component props for
one-off layouts. `global-error.tsx`'s H1 was left untouched — it's an error
boundary fallback, not a navigable page.

## 7. `CardTitle` default font

Added `font-heading` to `CardTitle`'s default className in
`components/ui/card.tsx` — one line fixes all ~40 call sites instead of
patching each one individually.

## Out of scope

Step 4 (Render) deliberately keeps its plain stacked-card layout — no
workspace split or `bg-background` Card treatment like steps 1-3, since
render progress is a simple list, not an editing surface. Left a comment in
`step4-render.tsx` so this doesn't read as a missed fix later.

## Commits

- `eef2604` fix(pipeline): rebuild toolbar as flex to stop stepper/actions overlap
- `187bfee` fix(pipeline): remove duplicate Back to Scripts button in step 3
- `9cd4019` fix(pipeline): give workspace-mode Cards bg-background, not bg-card
- `c6d9705` fix(pipeline): unify sub-header toolbar language across steps
- `0fa806d` fix(pipeline): move step heading counters to a separate meta line
- `f9feedb` feat(pipeline): add shared PageHeader component
- `ec370e5` fix(pipeline): apply font-heading to the 14 page H1s missing it
- `993eb38` fix(ui): default CardTitle to font-heading
- `f4e804c` docs(pipeline): note step4-render's non-workspace layout is deliberate

## Verification

`npx tsc --noEmit` and `npx eslint .` both report zero errors (only the
codebase's pre-existing `<img>`/`exhaustive-deps`/unused-var warnings, all in
untouched files). The Playwright e2e suite (139 specs, needs a running
backend and a fixed dev port) was not run — out of scope for a headless
frontend-only pass.

Visually verified by running `next dev` on port 3200 (3000 was in use by
another local project) with `NEXT_PUBLIC_AUTH_DISABLED=true` and taking
headless Chrome screenshots (`--headless=new --window-size=1200,900
--virtual-time-budget=8000`) of `/pipeline?step=1|2|3` at 1200px width — the
exact viewport band where the stepper used to overlap the toolbar actions.
Confirmed: no stepper/action overlap at any step, a single "Back to Scripts"
button on step 3, no background seam under the toolbar on any step, and the
step 2/3 headings show their counts as a separate meta line.
