# Frontend Audit Report

**Date:** 2026-02-26
**Scope:** Full frontend codebase (`frontend/src/`)
**TypeScript errors:** 1 (test file only)
**Lint:** next lint broken (invalid project directory error — see issue #1)

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High     | 7 |
| Medium   | 10 |
| Low      | 7 |

---

## Critical

### 1. `next lint` is broken — cannot run linter at all

- **File:** `frontend/` (project config)
- **Description:** Running `npx next lint` produces `Invalid project directory provided, no such directory: .../frontend/lint`. This means lint never runs — neither locally nor in CI. The linter is completely non-functional.
- **Suggested fix:** Check `next.config.mjs` and `.eslintrc.json` for misconfigured `eslint.dirs` or a stale ESLint config. Likely a `dirs: ['lint']` misconfiguration in the Next.js config or missing `.eslintrc.json`. Run `npx next lint --help` to verify correct invocation for the installed version.

---

## High

### 2. `pipeline/page.tsx` is 2,974 lines — extreme file size

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/pipeline/page.tsx`
- **Severity:** High
- **Description:** A single component with ~80 `useState` hooks, ~25 `useEffect` hooks, and dozens of handler functions. This is a maintenance and performance hazard. React re-renders the entire tree on every state change.
- **Suggested fix:** Extract logical sections into sub-components or custom hooks: `usePipelineHistory`, `usePipelineSourceVideos`, `usePipelineTts`, `usePipelinePreview`, `usePipelineRender`. Each step (1-4) should be its own component.

### 3. Missing `fetchHistory` in useEffect dependency array (stale closure)

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/pipeline/page.tsx`, line 935
- **Severity:** High
- **Description:** `useEffect` calls `fetchHistory()` with dependency `[currentProfile?.id]`, but `fetchHistory` is a plain function (not wrapped in `useCallback`), so it captures stale closures. If `fetchHistory` ever reads state beyond profile ID, it will use stale values.
- **Suggested fix:** Either wrap `fetchHistory` in `useCallback` and include it in the dependency array, or inline the fetch logic.

### 4. Missing `fetchAllClips` and `fetchPostizStatus` in useEffect dependency array

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/librarie/page.tsx`, line 203-208
- **Severity:** High
- **Description:** `useEffect` calls `fetchAllClips()` and `fetchPostizStatus()` with `[profileLoading, profileId]` as deps, but neither function is in the array. The React exhaustive-deps rule would flag this (if lint worked). The functions capture stale closure state.
- **Suggested fix:** Wrap both functions in `useCallback` with appropriate dependencies and include them in the effect's dependency array.

### 5. `video-segment-player.tsx` uses raw `fetch()` instead of `apiFetch`

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/components/video-segment-player.tsx`, lines 593, 623
- **Severity:** High
- **Description:** Two fetch calls (waveform data and voice detection) use the raw `fetch()` API with a locally-defined `API_URL` constant, bypassing the centralized `apiFetch` client. This means:
  - No automatic `X-Profile-Id` header injection (manually added for voice detection but missing for waveform)
  - No timeout handling
  - No `ApiError` conversion
  - Silently swallowed errors (`.catch(() => {})`)
- **Suggested fix:** Replace raw `fetch()` calls with `apiGet()` from `@/lib/api`. Remove the local `API_URL` constant on line 75.

### 6. Duplicate `API_URL` definition in `video-segment-player.tsx`

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/components/video-segment-player.tsx`, line 75
- **Severity:** High
- **Description:** Defines its own `const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1"` instead of importing from `@/lib/api`. If the centralized definition ever changes, this component would be out of sync.
- **Suggested fix:** Import `API_URL` from `@/lib/api` (already exported there).

### 7. Duplicate `API_URL` in `variant-triage.tsx`

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/components/video-processing/variant-triage.tsx`, line 51
- **Severity:** High
- **Description:** Same issue as #6 — local `API_URL` fallback instead of importing from the shared API module.
- **Suggested fix:** Import from `@/lib/api`.

### 8. Silent error swallowing in multiple components

- **Files:**
  - `video-segment-player.tsx` lines 596, 634: `.catch(() => {})`
  - `pipeline/page.tsx` lines 445, 463, 620: `.catch(() => {})`
- **Severity:** High
- **Description:** Multiple `fetch` calls silently discard errors with empty catch handlers. If the API is down or returns errors, the user sees no feedback — the UI just appears non-functional.
- **Suggested fix:** At minimum, add `handleApiError(err, "context")` calls. For non-critical operations, a silent catch is acceptable but should have a comment explaining why.

---

## Medium

### 9. `proxy.ts` is dead code

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/proxy.ts`
- **Severity:** Medium
- **Description:** This file defines a `proxy()` function and `config` matcher but is never imported by `middleware.ts` or any other file. It's leftover debugging code (comment says "test if proxy is the issue").
- **Suggested fix:** Delete this file.

### 10. Unused `defaultTransforms` prop in `SegmentTransformPanel`

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/components/segment-transform-panel.tsx`, line 34-35
- **Severity:** Medium
- **Description:** The `defaultTransforms` prop is destructured but immediately suppressed with `eslint-disable @typescript-eslint/no-unused-vars`. This is accepted-but-unused API surface.
- **Suggested fix:** Either implement the feature that uses `defaultTransforms` or remove it from the interface and destructuring.

### 11. `tts-library/page.tsx` polls on `assets` array identity

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/tts-library/page.tsx`, line 178-183
- **Severity:** Medium
- **Description:** The polling useEffect depends on `[assets, fetchAssets]`. Since `assets` is an array (new reference each fetch), this effect will teardown and recreate the interval on every successful fetch, even if no assets are generating. This creates unnecessary timer churn.
- **Suggested fix:** Derive `hasGenerating` as a stable boolean via `useMemo` and use that in the dependency array instead of the full `assets` array.

### 12. `useEffect` with `[selectedSourceIds]` triggers on every render

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/pipeline/page.tsx`, line 450
- **Severity:** Medium
- **Description:** `selectedSourceIds` is a `Set`, and Sets have referential identity issues in React — `new Set(prev)` always creates a new object. Every call to `handleSourceToggle` creates a new Set reference, which triggers this effect even if the actual IDs haven't changed.
- **Suggested fix:** Serialize the Set to a sorted string for the dependency array comparison, or use a `useMemo` wrapper.

### 13. Multiple `eslint-disable react-hooks/exhaustive-deps` suppressions

- **Files:** `pipeline/page.tsx` (3x), `video-segment-player.tsx` (2x), `timeline-editor.tsx` (2x), `variant-preview-player.tsx` (1x), `profile-context.tsx` (1x), `use-polling.ts` (1x), `settings/page.tsx` (1x)
- **Severity:** Medium
- **Description:** 11 total suppressions of the exhaustive-deps rule. While some are justified (documented with comments), several lack explanation. Each is a potential source of stale closure bugs.
- **Suggested fix:** Audit each suppression individually. For those without comments, either add justification or fix the dependency array.

### 14. Hardcoded `localhost:8000` fallback URL in 3 locations

- **Files:**
  - `frontend/src/lib/api.ts:9`
  - `frontend/src/components/video-segment-player.tsx:75`
  - `frontend/src/components/video-processing/variant-triage.tsx:51`
- **Severity:** Medium
- **Description:** The `http://localhost:8000/api/v1` fallback is hardcoded in 3 places. If the backend port ever changes, all three must be updated. The canonical definition should be in one place only.
- **Suggested fix:** Only `api.ts` should define the fallback. Other files should import `API_URL` from there.

### 15. No React Error Boundary wrapping page components

- **File:** All page components under `frontend/src/app/`
- **Severity:** Medium
- **Description:** Only `global-error.tsx` exists as a top-level boundary. Individual page components (pipeline, segments, library, products) have no error boundaries. An unhandled render error in a child component crashes the entire page.
- **Suggested fix:** Add `error.tsx` files in key route directories (`app/pipeline/error.tsx`, `app/librarie/error.tsx`, etc.) to provide granular recovery.

### 16. `console.warn` statements in production code

- **Files:**
  - `settings/page.tsx:179` — `console.warn("Failed to load templates:", err)`
  - `pipeline/page.tsx:1056` — `console.warn("TTS library duplicate check failed:", err)`
  - `product-video/page.tsx:85` — `console.warn("Failed to load profile template defaults:", err)`
- **Severity:** Medium
- **Description:** These warnings leak to the browser console in production. While not as noisy as `console.log`, they should be handled properly.
- **Suggested fix:** Replace with `handleApiError()` calls or remove if the error is truly expected/ignorable.

### 17. No loading/error states for several `useEffect` data fetches

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/pipeline/page.tsx`, lines 449-463 (product groups), 992-1008 (subtitle settings)
- **Severity:** Medium
- **Description:** Some `useEffect` blocks that fetch data don't set loading or error state. The user has no indication that data is being fetched or that a fetch failed.
- **Suggested fix:** Add loading states for user-visible data fetches.

### 18. `products/page.tsx` has 9 `useEffect` hooks with complex interplay

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/products/page.tsx`
- **Severity:** Medium
- **Description:** 9 `useEffect` hooks that reset/update filters, pagination, and fetch state. The interaction between them is non-obvious and could produce cascading re-renders (e.g., tab change resets search, which triggers debounce, which triggers fetch, which updates page).
- **Suggested fix:** Consider consolidating into a `useReducer` or extracting a `useProductFilters` custom hook.

---

## Low

### 19. TypeScript error in test file

- **File:** `frontend/tests/debug-all-logs.spec.ts`, line 38
- **Severity:** Low
- **Description:** `error TS2578: Unused '@ts-expect-error' directive.` — a `@ts-expect-error` comment suppresses a type error that no longer exists.
- **Suggested fix:** Remove the `@ts-expect-error` directive.

### 20. No accessibility attributes on interactive elements

- **Files:** Most page components under `frontend/src/app/`
- **Severity:** Low
- **Description:** Only `statsai/page.tsx` and `pipeline/page.tsx` (2 instances) use `aria-label` or `role` attributes across the entire app. Interactive elements like filter dropdowns, video players, and timeline editors lack screen-reader support.
- **Suggested fix:** Add `aria-label` to all `<Button>` components that only contain icons (no text), and `role`/`aria-*` attributes to custom interactive widgets.

### 21. No `<img>` tags used — but `eslint-disable @next/next/no-img-element` is prevalent

- **Files:** 7 instances across `pipeline/page.tsx`, `products/page.tsx`, `product-picker-dialog.tsx`, `variant-triage.tsx`, `image-picker-dialog.tsx`, `librarie/page.tsx`, `product-video/page.tsx`
- **Severity:** Low
- **Description:** Native `<img>` elements are used instead of Next.js `<Image>` component. Each usage has an eslint-disable comment. This bypasses Next.js image optimization (lazy loading, WebP conversion, responsive sizing).
- **Suggested fix:** Gradually migrate to `next/image` where the image sources are known/stable. For dynamic API-served images where dimensions are unknown, `<img>` may be acceptable but should use `loading="lazy"`.

### 22. Mixed language in error messages (Romanian + English)

- **Files:** Various — `handleApiError(err, "Eroare la incarcarea clipurilor")` vs `handleApiError(err, "Failed to load voices")`
- **Severity:** Low
- **Description:** Error messages are inconsistently in Romanian and English across the codebase. Users will see mixed-language toasts.
- **Suggested fix:** Standardize on one language. If the app is for Romanian users, use Romanian consistently. If international, use English. Consider an i18n library for future localization.

### 23. `Suspense` imported but usage unclear in pipeline page

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/pipeline/page.tsx`, line 3
- **Severity:** Low
- **Description:** `Suspense` is imported from React on line 3. A quick scan didn't find it used in the JSX return (the component is already `"use client"`). May be unused.
- **Suggested fix:** Verify usage. If unused, remove the import.

### 24. `scriptSaveTimer` and `subtitleSaveTimer` not cleaned up on profile change

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/pipeline/page.tsx`
- **Severity:** Low
- **Description:** These debounce timers are only cleaned up on component unmount (line 1221). If the user switches profiles mid-edit, pending saves from the old profile could fire against the new profile context.
- **Suggested fix:** Clear timers when `currentProfile` changes.

### 25. Inconsistent `Set` serialization for React state

- **File:** `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/pipeline/page.tsx`
- **Severity:** Low
- **Description:** Multiple state values use `Set<string>` (`selectedSourceIds`, `selectedVariants`, `selectedCatalogIds`, `historySelectedScripts`). React doesn't deeply compare Sets, so setState with a new Set always triggers a re-render even if contents are identical.
- **Suggested fix:** Consider using arrays with `useMemo`-based deduplication, or convert to a stable sorted string for comparisons.

---

## Uncommitted Frontend Changes

The following frontend files have unstaged modifications:

| File | Lines |
|------|-------|
| `frontend/src/app/librarie/page.tsx` | 943 |
| `frontend/src/app/pipeline/page.tsx` | 2,974 |
| `frontend/src/app/segments/page.tsx` | 1,594 |
| `frontend/src/components/video-segment-player.tsx` | 1,139 |

These are the 4 largest/most complex frontend files. All have uncommitted changes.

---

## Positive Observations

- **No `console.log` statements** in production code (only `console.warn` and `console.error` in catch blocks)
- **No `dangerouslySetInnerHTML`** usage anywhere
- **No `any` types** in application code (TypeScript strict usage is good)
- **No hardcoded API keys or secrets** in frontend code
- **Proper cleanup** on unmount for audio elements, abort controllers, and blob URLs in pipeline page
- **Centralized error handling** via `handleApiError` from `@/lib/api-error.ts` used consistently
- **Proper abort controller pattern** for in-flight TTS preview requests
- **Good use of refs** for timers and audio elements to avoid stale closure issues

---

## Recommended Priority Actions

1. **Fix `next lint`** — Critical. No linting means no safety net.
2. **Deduplicate `API_URL`** — Quick win. Remove local definitions, import from `api.ts`.
3. **Replace raw `fetch()` in video-segment-player** — High impact. Standardize on `apiFetch`.
4. **Add error boundaries** — Medium effort. Add `error.tsx` to key routes.
5. **Split `pipeline/page.tsx`** — Large effort. Extract hooks and sub-components to improve maintainability.
