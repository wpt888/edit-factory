# Phase 90: Landing page + pricing — Context

**Gathered:** 2026-05-23
**Status:** Ready for planning
**Source:** Autonomous-loop pre-locked decisions (substitute for /gsd-discuss-phase, which is forbidden in autonomous mode).

The orchestrator distilled this CONTEXT.md from:
- `.planning/ROADMAP.md` § Phase 90 (top-level, mirrored from v13-ROADMAP.md)
- `.planning/milestones/v13-ROADMAP.md` § Phase 90
- `.planning/milestones/v13-REQUIREMENTS.md` § MARK-02
- `.planning/v13-desktop-production/SCOPE.md` § C2 (Track C — Landing page + pricing)
- `.planning/STATE.md` § Decisions (pricing tiers locked at L83-84)
- `marketing/package.json` + `marketing/app/page.tsx` (existing Phase 89 scaffolding)
- `frontend/src/components/ui/` (Shadcn primitives source)

<domain>
## Phase Boundary

Phase 90 replaces the Phase 89 placeholder `marketing/app/page.tsx` ("Coming soon" Card) with a full production-grade landing page across 6 standard marketing-site sections. The page renders the locked v13 pricing model (Starter / Pro / Cloud Sync) and meets Lighthouse Performance ≥ 90 + Accessibility ≥ 95.

**In scope:**
- Production replacement of `marketing/app/page.tsx` with full landing page composed of section components
- Six landing-page sections: Hero, Features grid, Pricing table, Screenshots placeholder, Comparison table vs SaaS competitors, FAQ
- Footer with legal placeholder links (Privacy, Terms, Cookies, copyright) — links resolve to `/legal/*` placeholder pages (404-OK for v13; Phase 92+ wires real content)
- Server-rendered by default; `'use client'` allowed ONLY in the FAQ accordion (needs interactivity)
- Additional Shadcn primitives copied byte-for-byte from `frontend/src/components/ui/` as needed: `accordion`, `badge`, `separator`. Do NOT add any not-yet-used primitives.
- Lighthouse CI assertion via Playwright + `lighthouse` npm package in a new spec `marketing/tests/landing.spec.ts` (Lighthouse run against `http://localhost:3001/`, assert Performance ≥ 90 + Accessibility ≥ 95)
- MANDATORY full-page Playwright screenshot per `CLAUDE.md` rule, written to `marketing/screenshots/phase-90-landing.png`

**Out of scope (deferred to later phases):**
- `/signup` page — Phase 90 Hero CTA wires to `/signup` href but the route does NOT exist yet; clicking returns Next.js 404. Real signup lands in Phase 91 (Lemon Squeezy checkout) or Phase 93+ (OAuth marketing app).
- Lemon Squeezy checkout button wiring (Phase 91)
- Real screenshots of the desktop app (placeholder boxes / SVG illustration only in Phase 90; real screenshots replace placeholders when the desktop alpha is ready)
- Legal page content for `/legal/privacy`, `/legal/terms`, `/legal/cookies` (placeholder pages may be created as bare stubs to silence 404s, but real legal copy is post-launch)
- SEO metadata beyond `metadata` export in `layout.tsx` and `page.tsx` (Open Graph image, Twitter card, structured data — deferred to Phase 92+)
- Internationalization (i18n) — English only in v13
- Dark-mode toggle (the OKLCH design tokens support both themes via CSS variables, but a toggle UI element is post-launch)
- Cookie banner / GDPR consent (post-launch)
- Analytics (Vercel Analytics, Plausible, etc. — post-launch)

</domain>

<decisions>
## Implementation Decisions (locked by autonomous orchestrator, Iteration 89-pattern)

### Plan structure
- **D-01 Single plan, single wave.** Phase 90 is one cohesive UI build. ROADMAP estimates "1–2 plans"; orchestrator picks 1 to minimize wave overhead and because the 6 sections are tightly coupled by shared design tokens, shared primitive imports, and a single page composition site (`marketing/app/page.tsx`). If the planner determines >50% context budget would be exceeded, return `## PHASE SPLIT RECOMMENDED` and orchestrator will split into 90a (sections 1-3) + 90b (sections 4-6 + Lighthouse).

### Page composition
- **D-02 Section order locked**: (1) Hero → (2) Features → (3) Pricing → (4) Screenshots → (5) Comparison → (6) FAQ → (7) Footer. This order is conversion-optimized (problem framing → value → price → social proof / proof-by-image → differentiation → objection handling → close).
- **D-03 Each section is its own component** under `marketing/components/sections/`:
  - `hero.tsx` — server component
  - `features.tsx` — server component
  - `pricing.tsx` — server component
  - `screenshots.tsx` — server component
  - `comparison.tsx` — server component
  - `faq.tsx` — client component (only one with `'use client'` for accordion state)
  - `footer.tsx` — server component
- **D-04 page.tsx composes the sections** by importing each and rendering in D-02 order. `page.tsx` itself remains server-rendered (no `'use client'`).

### Copy and content (locked verbatim)
- **D-05 Hero copy**:
  - Headline (h1): `Automated video production for indie creators.`
  - Subhead (p): `Edit Factory turns any input — feed, script, idea — into social-media-ready videos. Runs entirely on your desktop. One-time license, no subscription.`
  - Primary CTA (Button, default variant): `Get Started` → `<a href="/signup">`
  - Secondary CTA (Button, ghost or outline variant): `See pricing` → `<a href="#pricing">` (anchor to pricing section)
- **D-06 Features grid — exactly 6 features, 3×2 layout on desktop**:
  1. **AI script generation** — "Gemini-powered script variants tuned for reels, TikTok, YouTube Shorts."
  2. **Voice cloning & TTS** — "Bring your own ElevenLabs key. Optional offline voice cloning via downloadable ML bundle."
  3. **Multi-platform export** — "Render once, export to vertical 9:16, square 1:1, horizontal 16:9."
  4. **Batch production** — "Generate dozens of variants from a single source — perfect for content sprints."
  5. **Local-first** — "Your media, your machine. Cloud Sync optional."
  6. **One-time license** — "Pay once, own it. No monthly fees, no vendor lock-in."
  Each feature uses a Lucide icon + `<Card>` wrapper from copied Shadcn primitives. Suggested icons (planner may pick equivalent): `Sparkles, Mic, Aperture, Layers, HardDrive, BadgeCheck`.
- **D-07 Pricing table — three tiers, locked from STATE.md L84**:
  - **Starter $79 one-time** — features: AI scripts, Edge-TTS, basic export, 1 device
  - **Pro $149 one-time** (badge: "Most popular") — features: everything in Starter + ElevenLabs BYOAK + voice cloning unlock + multi-platform export + batch (1-5 device activations)
  - **Cloud Sync $39/yr add-on** — features: optional add-on to Starter or Pro; syncs projects across devices, off-machine backup
  All prices in USD. Each tier has a CTA Button:
    - Starter: `Buy Starter` → `<a href="/signup?plan=starter">`
    - Pro: `Buy Pro` → `<a href="/signup?plan=pro">`
    - Cloud Sync: `Add Cloud Sync` → `<a href="/signup?plan=cloud-sync">`
  These hrefs are placeholders — Phase 91 replaces them with real Lemon Squeezy checkout URLs.
- **D-08 Screenshots section** — 3 placeholder boxes in a grid (or single hero screenshot above-fold + 2 supporting below). Boxes use an SVG-illustration placeholder OR a stylized `bg-muted` Card showing "Screenshot coming soon" text. No real desktop screenshots ship in Phase 90 because the desktop UI is still in active development through Phase 95.
- **D-09 Comparison table — landing-page table vs SaaS competitors**, 4 rows × 4 columns:
  - Columns: `Feature` | `Edit Factory` | `Captions.ai (or similar)` | `Submagic (or similar)`
  - Rows (locked):
    1. Price model: `One-time $79–$149` vs `$29/mo+` vs `$16/mo+`
    2. Runs offline: `✓ (local-first)` vs `✗ (cloud only)` vs `✗ (cloud only)`
    3. Bring your own API key: `✓ (Gemini, ElevenLabs)` vs `✗` vs `✗`
    4. Source data ownership: `✓ (your machine)` vs `✗ (their cloud)` vs `✗ (their cloud)`
  Render as accessible `<table>` (not div grid) for screen readers; use Shadcn-style `<table>` markup with `Tailwind` styling.
- **D-10 FAQ — exactly 6 entries** (Accordion with single-collapse behavior), locked questions:
  1. **What's the difference between BYOAK and a subscription?**
  2. **What's the ~1.5 GB optional ML bundle for?**
  3. **What's Cloud Sync and do I need it?**
  4. **Why does Windows show a SmartScreen warning when I install?**
  5. **What's your refund policy?**
  6. **Can I use Edit Factory on more than one device?**
  Answers are locked in the plan (planner copies them from this CONTEXT.md verbatim into the `faq.tsx` component). See **D-10-Answers** below in `<specifics>` for the exact answer copy.
- **D-11 Footer** — three-column layout:
  - Column 1: `Edit Factory` brand + 1-line tagline + copyright `© 2026 Edit Factory. All rights reserved.`
  - Column 2: `Product` nav links — `Features` (anchor `#features`), `Pricing` (anchor `#pricing`), `FAQ` (anchor `#faq`)
  - Column 3: `Legal` links — `Privacy` (`/legal/privacy`), `Terms` (`/legal/terms`), `Cookies` (`/legal/cookies`). All three are bare placeholder routes that return 404 in v13 (Phase 92+ wires them).

### Technical constraints
- **D-12 Shadcn primitives to copy from `frontend/src/components/ui/`** (byte-for-byte, same pattern as Phase 89 D-04):
  - `accordion.tsx` (NEW in Phase 90 — required for FAQ section)
  - `badge.tsx` (NEW — required for "Most popular" pricing badge)
  - `separator.tsx` (NEW — pricing card dividers + footer divider)
  Already present from Phase 89: `button.tsx`, `card.tsx`. No others needed.
  Acceptance: `diff --strip-trailing-cr frontend/src/components/ui/{accordion,badge,separator}.tsx marketing/components/ui/{accordion,badge,separator}.tsx` returns empty (byte-identical, modulo Windows CRLF).
- **D-13 No new npm dependencies in `marketing/package.json` except**:
  - `@radix-ui/react-accordion` (transitively required by `accordion.tsx`)
  - `lighthouse` (devDependency, required for Lighthouse CI assertion in Playwright spec)
  - `chrome-launcher` (devDependency, peer of `lighthouse`)
  - Any peer that `@radix-ui/react-accordion` pulls in (orchestrator does not pre-lock these).
  No styling, animation, icon, or layout library added (Lucide already present from Phase 89 transitively via Shadcn).
- **D-14 No `'use client'` directives anywhere except `marketing/components/sections/faq.tsx`**. Grep gate: `grep -rln "'use client'" marketing/app/ marketing/components/sections/` returns exactly 1 line (`faq.tsx`). All other section components are server-rendered for Lighthouse Performance ≥ 90.
- **D-15 OKLCH design tokens preserved from Phase 89**. `marketing/app/globals.css` is NOT modified by Phase 90 unless absolutely required for a new utility class. If modified, additions must use the existing OKLCH token namespace (`--background`, `--foreground`, `--primary`, `--muted`, `--card`, etc.) — no raw hex or rgb() colors.

### Testing and verification
- **D-16 New Playwright spec `marketing/tests/landing.spec.ts`**:
  - Replaces / supplements `scaffold-smoke.spec.ts` (the scaffold smoke test stays; landing.spec.ts is additive).
  - Test 1 (`landing page renders all sections`): navigates to `/`, asserts presence of section heading text from each of D-02's 6 sections (e.g., `Hero headline text`, `Why Edit Factory` for Features, `Simple pricing` for Pricing, etc. — planner picks exact heading text per section).
  - Test 2 (`Lighthouse Performance ≥ 90 and Accessibility ≥ 95`): runs Lighthouse against the dev server, parses scores from the report, asserts both thresholds. Uses `lighthouse` + `chrome-launcher` npm packages.
  - Test 3 (`MANDATORY Playwright screenshot`): writes full-page screenshot to `marketing/screenshots/phase-90-landing.png`, asserts file exists with size > 100000 bytes (post-content landing pages are substantially larger than the Phase 89 24KB scaffold).
- **D-17 Acceptance gate for plan**: `npm --prefix marketing run typecheck` passes AND `npm --prefix marketing run lint` passes (zero new errors beyond Phase 89's 5 intentional Supabase cookie-stub warnings) AND `npx playwright test --grep "landing"` passes locally.
- **D-18 Zero modifications outside `marketing/`**. Same boundary constraint as Phase 89. Acceptance: `git diff --stat main..HEAD -- ':(exclude)marketing'` returns no changes.

</decisions>

<specifics>
## Specific Ideas

### D-10-Answers — FAQ answer copy (locked verbatim for planner to paste into faq.tsx)

1. **What's the difference between BYOAK and a subscription?**

   BYOAK = "Bring Your Own API Key." You pay Edit Factory once for the software and use your own Gemini / ElevenLabs / fal.ai keys at provider pricing. There's no monthly markup. You can switch providers anytime. Subscription tools bundle the same APIs with their own margin and lock you into their pricing tiers — we don't.

2. **What's the ~1.5 GB optional ML bundle for?**

   The bundle adds offline voice cloning (Coqui XTTS), source-voice removal (Silero VAD), and high-quality local transcription (Whisper). You don't need it for the core workflow — Gemini scripts + ElevenLabs TTS + Edge TTS work without it. Download it from Settings → ML Features when you want offline voice features.

3. **What's Cloud Sync and do I need it?**

   Cloud Sync ($39/yr add-on) keeps your projects, scripts, and renders synced across multiple Edit Factory installs and gives you an off-machine backup. Skip it if you work from one device and back up your own drive — the desktop app is fully functional without it.

4. **Why does Windows show a SmartScreen warning when I install?**

   We ship Edit Factory unsigned in v13 to keep the price down. Windows SmartScreen warns about any unsigned installer until enough users run it. Click "More info" → "Run anyway" to install. We sign installers in v14.

5. **What's your refund policy?**

   30-day no-questions refund. Email us and we'll refund through Lemon Squeezy — you keep the install on your machine until the refund clears.

6. **Can I use Edit Factory on more than one device?**

   Starter: 1 device. Pro: up to 5 devices (deactivate old ones from your `/account/license` page). Cloud Sync makes multi-device painless because projects stay in sync; without Cloud Sync you can still move files manually.

### Reference implementations (planner should read for analog patterns)

- `frontend/src/components/ui/button.tsx` — Shadcn button variants (the marketing `button.tsx` is byte-identical from Phase 89)
- `frontend/src/components/ui/card.tsx` — same byte-identical Card from Phase 89
- `frontend/src/components/ui/accordion.tsx` — NEW byte-for-byte copy target for `marketing/components/ui/accordion.tsx`
- `frontend/src/components/ui/badge.tsx` — NEW byte-for-byte copy target for `marketing/components/ui/badge.tsx`
- `frontend/src/components/ui/separator.tsx` — NEW byte-for-byte copy target for `marketing/components/ui/separator.tsx`
- `marketing/app/globals.css` — existing OKLCH design tokens (do not modify in Phase 90)
- `marketing/app/page.tsx` — current placeholder (Phase 90 replaces this)
- `marketing/playwright.config.ts` — existing Playwright config (Phase 90 reuses; `landing.spec.ts` is just a new spec file)

### Lighthouse harness reference

Standard pattern for Playwright + Lighthouse:
```ts
import { test, expect } from '@playwright/test';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

test('Lighthouse Performance >= 90 and Accessibility >= 95', async () => {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
  const result = await lighthouse('http://localhost:3001', {
    port: chrome.port,
    output: 'json',
    onlyCategories: ['performance', 'accessibility'],
  });
  await chrome.kill();
  const perf = result.lhr.categories.performance.score * 100;
  const a11y = result.lhr.categories.accessibility.score * 100;
  expect(perf).toBeGreaterThanOrEqual(90);
  expect(a11y).toBeGreaterThanOrEqual(95);
});
```
Planner may refine this pattern but must preserve the threshold assertions verbatim.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope sources
- `.planning/ROADMAP.md` § Phase 90 — top-level mirrored detail section
- `.planning/milestones/v13-ROADMAP.md` § Phase 90 — full milestone-level detail
- `.planning/milestones/v13-REQUIREMENTS.md` § MARK-02 — single requirement this phase closes
- `.planning/v13-desktop-production/SCOPE.md` § C2 — adds "comparison table vs SaaS competitors" beyond MARK-02's literal text (orchestrator pulled this into D-09)
- `.planning/STATE.md` § Decisions L83-84 — locked pricing tiers (Starter $79 / Pro $149 / Cloud Sync $39/yr)

### Existing Phase 89 scaffolding (DO NOT break)
- `marketing/package.json` — locked deps + scripts (Phase 90 adds 3 deps only)
- `marketing/app/layout.tsx` — root layout (Phase 90 may extend `metadata` export but otherwise leaves untouched)
- `marketing/app/globals.css` — OKLCH design tokens (Phase 90 does not modify)
- `marketing/app/page.tsx` — current placeholder (Phase 90 REPLACES with full landing page)
- `marketing/components/ui/{button,card}.tsx` — existing Shadcn primitives (Phase 90 reuses, does NOT modify)
- `marketing/lib/utils.ts` — `cn` helper (Phase 90 reuses)
- `marketing/lib/supabase.ts` — server + browser client factories (Phase 90 does NOT touch — landing page is unauthenticated)
- `marketing/playwright.config.ts` — Phase 89 Playwright config with `PLAYWRIGHT_PORT`/`PLAYWRIGHT_BASE_URL` env-var override (Phase 90 reuses)
- `marketing/tests/scaffold-smoke.spec.ts` — Phase 89 scaffold smoke test (Phase 90 KEEPS this; adds `landing.spec.ts` alongside)
- `marketing/.gitignore` — Phase 89 added `*.tsbuildinfo` + `test-results/` + `playwright-report/` (Phase 90 may need to add `screenshots/` if not already covered by root `.gitignore`)

### Shadcn primitive source files (byte-for-byte copy targets)
- `frontend/src/components/ui/accordion.tsx`
- `frontend/src/components/ui/badge.tsx`
- `frontend/src/components/ui/separator.tsx`

### CLAUDE.md MANDATORY rule
- `CLAUDE.md` § "MANDATORY: Visual Testing with Playwright" — `marketing/screenshots/phase-90-landing.png` must be produced + asserted size > 100000 bytes in landing.spec.ts

</canonical_refs>

<deferred>
## Deferred Ideas

- **Real desktop screenshots** — replace placeholder boxes after Phase 95 (when desktop UI is feature-complete with subscription tier gating)
- **Lemon Squeezy checkout buttons** — Phase 91 replaces the `/signup?plan=*` placeholder hrefs with real checkout URLs
- **`/signup` page itself** — Phase 91 or 93+
- **Legal page content** — `/legal/privacy`, `/legal/terms`, `/legal/cookies` are placeholder routes in Phase 90; content authoring deferred to launch checklist
- **Dark-mode toggle UI** — OKLCH tokens already support dark mode via CSS variables, but a user-facing toggle is post-launch
- **SEO Open Graph + Twitter card metadata** — Phase 92+ once we have a real OG image and tagline copy approved
- **Analytics + cookie banner** — post-launch (privacy review pending)
- **Internationalization (i18n)** — English only in v13
- **Real customer testimonials / social proof badges** — none exist yet (pre-launch); the "Why Edit Factory" feature grid serves that role until we have customers

</deferred>

---

*Phase: 90-landing-page-pricing*
*Context gathered: 2026-05-23 via autonomous-loop orchestrator (pre-locked decisions D-01..D-18 substitute for /gsd-discuss-phase which is forbidden in autonomous mode)*
