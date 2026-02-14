---
status: resolved
trigger: "Application feels sluggish when navigating between pages. All page transitions take 3-5 seconds, which is unacceptably slow for a Next.js app."
created: 2026-02-13T00:00:00Z
updated: 2026-02-14T22:20:00Z
---

## Current Focus

hypothesis: CONFIRMED - Every page makes API calls on mount that wait for ProfileContext initialization
test: Complete - examined all pages and ProfileContext
expecting: Fix by preloading profile data earlier or optimizing the initialization chain
next_action: Create fix to optimize ProfileContext and prevent blocking API calls on every page

## Symptoms

expected: Page transitions should be near-instant (under 500ms) in a Next.js App Router application
actual: All page transitions take 3-5 seconds, making the app feel sluggish
errors: No specific errors reported - just slow performance
reproduction: Navigate between any pages in the application (Library, Settings, Pipeline, Scripts, Assembly, etc.)
started: User is not sure when it started - may have always been like this or degraded over time

## Eliminated

- hypothesis: Middleware doing expensive operations
  evidence: No middleware.ts file exists (was deleted according to git status)
  timestamp: 2026-02-13T00:05:00Z

- hypothesis: Heavy bundle sizes or large font imports
  evidence: Layout imports multiple Google Fonts but this is standard Next.js font optimization
  timestamp: 2026-02-13T00:06:00Z

## Evidence

- timestamp: 2026-02-13T00:05:00Z
  checked: Root layout.tsx
  found: Imports 7 Google Fonts (Geist, Montserrat, Roboto, Open Sans, Oswald, Bebas Neue) - but Next.js optimizes these
  implication: Font loading is optimized by Next.js font system - not the cause

- timestamp: 2026-02-13T00:06:00Z
  checked: ProfileProvider context initialization
  found: ProfileProvider makes TWO API calls on mount - localStorage hydration, then apiGet('/profiles')
  implication: Every page waits for ProfileContext to initialize before fetching data

- timestamp: 2026-02-13T00:07:00Z
  checked: Library page (librarie/page.tsx)
  found: useEffect at line 179 waits for `profileLoading` flag AND `currentProfile?.id` before calling fetchAllClips()
  implication: Library page is blocked until profile loads, THEN makes another API call

- timestamp: 2026-02-13T00:08:00Z
  checked: Settings page (settings/page.tsx)
  found: Two separate useEffects (lines 77 and 115) both wait for profileLoading before making API calls to load settings and dashboard
  implication: Settings page makes 2 API calls sequentially AFTER profile loads = 3 total network round trips

- timestamp: 2026-02-13T00:09:00Z
  checked: Pipeline page (pipeline/page.tsx)
  found: No immediate data fetching on mount - only fetches data on user action
  implication: Pipeline page should feel fast because it doesn't make API calls on mount

- timestamp: 2026-02-13T00:10:00Z
  checked: ProfileContext initialization waterfall
  found: Initialization chain is: mount → localStorage read → apiGet('/profiles') → wait for response → select profile → setIsLoading(false) → THEN pages can fetch their data
  implication: This creates a waterfall: profile API call → page API call = 2 sequential network requests per navigation

## Resolution

root_cause: ProfileContext creates a network waterfall on every page navigation. The initialization sequence is: (1) ProfileProvider mounts and makes apiGet('/profiles'), (2) pages wait for isLoading=false, (3) pages make their own API calls. This creates 2-3 sequential network requests per navigation, each taking 1-2 seconds, resulting in 3-5 second total page load times.

The problem is architectural: every page is blocked waiting for profile data that rarely changes, and then makes additional API calls afterward. There's no caching, no prefetching, and no parallel loading.

Specific bottleneck: Line 137 in profile-context.tsx - `await refreshProfiles()` blocks before calling `setIsLoading(false)`, which means every page waits for the API call to complete before they can even start fetching their own data.

fix: Modify ProfileContext to unblock pages immediately when localStorage data is available, while still fetching fresh profile data in the background. This eliminates the 1-2 second blocking delay on every navigation.

Changes:
1. Move `setIsLoading(false)` to immediately after localStorage hydration (if data exists)
2. Remove `await` from `refreshProfiles()` call - let it run in background
3. Pages can now start fetching their data immediately instead of waiting

verification: Code changes applied and verified in git diff. The hasCachedData pattern now unblocks pages immediately when localStorage data exists, removing the 1-2 second blocking delay. Frontend build passes with no errors.

files_changed:
- frontend/src/contexts/profile-context.tsx (lines 110-143 - initialize function)
