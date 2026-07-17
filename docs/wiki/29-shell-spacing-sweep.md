# Shell, spacing, and icon-sizing sweep (S2)

## Scope

Follow-up to the S1 heading-consistency pack (see
[Pipeline toolbar overlap + heading-consistency fix pack](28-pipeline-toolbar-heading-fixes.md)).
S1 shipped `PageHeader` and `CardTitle`'s default `font-heading`; this pass
unifies the page *container* (six width recipes, four padding recipes),
header-to-content spacing, `Card` elevation, and `h-N w-N` icon sizing.
Source: `social-scheduler/goals/design-s2-shell-sweep.md`.

Main implementation files:

- `frontend/src/components/page-shell.tsx` (new)
- `frontend/src/components/ui/card.tsx`
- ~20 page files under `frontend/src/app/*/page.tsx`
- ~45 component files (icon-sizing sweep)

## 1. `PageShell`

Added `components/page-shell.tsx` — one canonical container:
`mx-auto w-full px-4 sm:px-6 lg:px-8 py-8` plus a `width` prop
(`"default"` = `max-w-7xl`, `"narrow"` = `max-w-3xl`, `"wide"` =
`max-w-[1600px]`, only for pages that were already wider than `max-w-7xl`).

Applied across every top-level route:

- `container mx-auto p-6` (wiki, settings ×3, usage) → `PageShell`.
- `max-w-[1400px]` pages (calendar, librarie, batch, schedule, tts-library)
  → `PageShell width="wide"` (`max-w-[1600px]`), one documented recipe
  instead of five ad-hoc ones. `librarie` keeps its `<main>` landmark tag —
  only the className changed, not the element — since `PageShell` renders a
  `<div>`.
- `p-4 md:p-8` on `max-w-7xl` (media-library, clipping, automations) →
  the same `PageShell` default as products/product-library/batch-generate,
  which already used the canonical recipe.
- `create-video`/`create-image`: both `max-w-5xl` but one used `px-6 py-8`
  and the other `py-8 px-4`; unified to
  `px-4 sm:px-6 lg:px-8 py-8` on both (kept as a literal class list, not
  `PageShell`, since `max-w-5xl` isn't one of the three named recipes).
- `product-video` was already on the `narrow` recipe; migrated onto the
  component for consistency.

## 2. Header-to-content spacing

Removed `mb-6`/`mb-8` from page header blocks in favor of `space-y-6` (or
the pre-existing `space-y-8` on `schedule`) on the `PageShell`/`<main>`
parent — the pattern the newer pages already used. Applied to `librarie`,
`products`, `product-library`, `tts-library`, `usage`. Where a header's
`mb-*` and the parent's new `space-y-*` end up on adjacent siblings with
equal values, CSS margin collapsing makes this a no-op visually (e.g.
`mb-6` + `space-y-6`'s `mt-6` both resolve to the same 1.5rem gap); left
the handful of unrelated `mb-4`/`mb-5` spacing (tab switchers, search bars)
untouched — out of scope.

## 3. `CardTitle` `font-heading` cleanup

`components/ui/card.tsx`'s `CardTitle` already carried `font-heading` by
default from S1. Removed the now-redundant manual `font-heading` from the
four auth-flow call sites that still added it explicitly: `signup`,
`login`, `login/reset-password`.

## 4. `Card` default shadow

Removed `shadow-sm` from `Card`'s base className — no page actually wants
Card-level elevation by default in this flat/monochrome UI, and the
`min-[1280px]:shadow-none` / plain `shadow-none` overrides on 6 pipeline
workspace-mode call sites plus the login split-card existed purely to
cancel it out. Deleted those 7 now-inert overrides. Radix-driven floating
surfaces (`Dialog`, `Popover`, `DropdownMenu`, `Select`) already declare
their own explicit `shadow-lg`/`shadow-md`/`shadow-xs` independent of
`Card`, so elevation on genuinely floating UI is untouched.

## 5. Icon sizing: `h-N w-N` → `size-N`

Swept `h-N w-N` / `w-N h-N` class pairs (matching `N` only, adjacent
tokens) to Tailwind's `size-N` shorthand — a scripted, regex-verified
transform (`\bh-(\d+(\.\d+)?)\s+w-\1\b` and the reversed order), applied
only where the two values matched so intentionally non-square layout
boxes (e.g. `h-8 w-20` inputs, `h-6 w-11` switches) were left alone.
841 matching pairs found; 45 files were mechanically clean and committed
first (`c9ac453`). The remaining 13 files (`pipeline/page.tsx`,
`segments/page.tsx`, `timeline-editor.tsx`, `video-segment-player.tsx`,
and 9 others) had a second Claude session
(`session_01CoRd2iQHDvr1waj7c2WPAb`, commit `353fb37`) concurrently
editing them, so they were completed in a follow-up commit (`7283b40`)
via surgical staging: the regex was applied to the working tree (their
in-flight edits preserved, sweep layered on top) while the *staged*
content was built from each file's HEAD blob plus the same regex
(`git hash-object -w --no-filters` + `git update-index --cacheinfo`), so
the commit contains only the icon changes relative to HEAD — verified
pure (all 249 staged line pairs equal the regex transform, `--numstat`
symmetric). Gotcha for next time: without `--no-filters`, `hash-object`
applies CRLF→LF normalization and turns a 55-line change into a
whole-file diff on CRLF-committed files.

## 6. `product-video` `CardContent` padding

Three info cards used `CardContent className="p-4"` while the form card
below them used the bare default (`px-6` from `Card`'s own `py-6`,
resulting in a uniform ~24px inset since the card has no header).
Removed the `p-4` overrides so all four cards share the same default
inset.

## Out of scope / left alone

- `pipeline/page.tsx`'s dual-mode container split (`max-w-none p-0` in
  workspace mode vs `max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8` guided
  mode) — already flagged deliberate in commit `f4e804c`.
- Electron `html.desktop` radius handling, subtitle fonts, page logic —
  untouched per the goal's hard constraints.
- `components/timeline/timeline-primitives.tsx` (4 matched pairs) — the
  concurrent session's *untracked* new file; not in HEAD, so nothing to
  commit against. Sweep it when that file lands.

## Commits

- `94b757d` feat(ui): add PageShell canonical container component
- `fb03c1e` refactor(ui): apply PageShell to wiki, settings, usage,
  calendar, librarie, batch, schedule, tts-library
- `9653ac7` refactor(ui): apply PageShell to products, product-library,
  product-video, batch-generate, media-library, clipping, automations;
  unify create-video/create-image padding
- `2612c34` refactor(ui): remove default shadow-sm from Card, drop
  now-redundant shadow-none overrides
- `c9ac453` refactor(ui): sweep h-N w-N icon sizing to size-N (lucide
  icons, matched pairs only)
- `e0268f6` refactor(ui): drop redundant font-heading on CardTitle
  call-sites (signup, login)
- `7283b40` refactor(ui): complete size-N icon sweep on remaining 13 files

## Verification

`npx tsc --noEmit` and `npx eslint src` both report zero errors (only
pre-existing `<img>`/`exhaustive-deps`/unused-var warnings in files this
pass didn't touch). `next build` could not be run — a concurrently
running Electron instance (from the other session above) held a lock on
`.next/standalone`; `tsc`/`eslint` stood in as the build-correctness
check.

Visually verified against the other session's already-running `next dev`
(port 3005 — Next 16 allows only one dev server per project, so a second
instance on 3200 declined to start) via headless Playwright screenshots
at 1440px on `/pipeline`, `/settings`, `/calendar`, `/librarie`,
`/create-image`. Confirmed identical H1 size/font and identical lateral
margins across pages sharing the same `PageShell` width. `/usage`
redirected client-side to `/librarie` in this no-backend/no-profile
environment before a screenshot could be captured (pre-existing app
behavior, unrelated to this pass — `usage` uses the same `PageShell`
component so its container is structurally identical either way).

## Follow-up: X1 shell parity pack (2026-07-18)

Cross-app follow-up (`social-scheduler/goals/design-x1-parity.md`), source
of truth = web, contract recorded in `.claude/skills/blipost-parity/SKILL.md`.
Aligned `frontend/src/components/navbar.tsx`, `product-switcher.tsx`,
`ui/button.tsx` with the equivalent web files:

- Media Library icon `Cloud` → `Images`.
- Product-switcher `PRODUCTS` descriptions now match web's copy verbatim
  (`name`/`description` only — `href`/`external`/`icon` stay per-app).
- Nav hover token on inactive items: `hover:text-lime` →
  `hover:text-sidebar-accent-foreground` (lime isn't an approved hover
  accent).
- Group-label class string copied verbatim from web's `app-nav.tsx`; nav
  lists `gap-1` → `gap-0.5`; collapsed rail top padding `pt-6` → `pt-4`
  plus inter-group dividers (mirrors web's collapsed-rail divider logic,
  previously desktop's collapsed rail had none).
- Footer radius `rounded-xl` → `rounded-lg` on the switcher trigger, credit
  pill, and user card; sidebar wordmark `h-8` → `h-11` (matches web's
  `BrandLogo h-11`).
- Credit widget restyled to match web: neutral `Wallet` icon → `Zap` in
  lime + "AI Credits Remaining" label; no quota bar (desktop's
  `/platform/me` doesn't return a quota, only `balance`).
- Icon-collision fix: `AI Video` (`/create-video`) `Clapperboard` → `Film`
  (residual: `Local Exports` already used `Film` — new collision noted in
  the parity skill watchlist, not fixed this pass). `Generate`
  (`/product-video`) renamed `Context Video` to stop colliding with web
  `/create`'s "Generate".
- `ui/button.tsx`: base + `sm`/`lg` size radius `rounded-md` → `rounded-lg`.
  Height unchanged (`h-9` default) — desktop was already on the h-9
  decision that web adopted this same pass.

Web-side counterpart: `app-nav.tsx` active-route check made boundary-safe
(`pathname === href || startsWith(href + "/")`, matching desktop's
existing `isActive`); `ui/button.tsx` default size `h-8` → `h-9`.

Verification: `eslint` and `tsc --noEmit` clean on both repos for the
changed files. Screenshot `x1-parity-studio-expanded.png` (repo root)
captured against the same already-running dev server referenced above
(port 3005) — confirms the Images icon, group-label styling, renamed nav
items and tightened item spacing render live. A collapsed-rail screenshot
could not be captured this pass: every fresh `next dev` restart attempted
during this session (ports 3200–3204, `npx` and `npm run dev`, with and
without a `.next-dev` cache clear) crashed within seconds on a Turbopack
workspace-root inference error (`Next.js inferred your workspace root...`)
despite `turbopack.root` already being pinned in `next.config.ts` —
environment-level flakiness unrelated to this pass's code, not reproduced
on the one instance that stayed up long enough for the expanded
screenshot. Collapsed-rail changes (dividers, `pt-4`) were verified by
code review against web's already-screenshotted collapsed rail
(`x1-parity-web-collapsed.png` in the web repo) instead.
