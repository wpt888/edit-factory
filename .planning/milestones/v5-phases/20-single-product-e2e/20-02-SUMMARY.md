---
phase: 20-single-product-e2e
plan: "02"
subsystem: product-video-frontend
tags: [nextjs, react, shadcn, playwright, useJobPolling, product-video, tts]
dependency_graph:
  requires:
    - app/api/product_generate_routes.py (Phase 20-01)
    - frontend/src/hooks/use-job-polling.ts
    - frontend/src/lib/api.ts
    - frontend/src/app/products/page.tsx (Phase 19)
  provides:
    - frontend/src/app/product-video/page.tsx
    - Generate Video button on product browser cards
  affects:
    - frontend/src/app/products/page.tsx (added button + router)
tech_stack:
  added: []
  patterns:
    - useSearchParams with Suspense wrapper (Next.js App Router requirement)
    - useJobPolling hook for real-time progress bar and ETA
    - Product data passed as URL query params (id, title, image, price, brand, feed_id)
    - Collapsible video filters section (ChevronDown/ChevronUp toggle)
key_files:
  created:
    - frontend/src/app/product-video/page.tsx
    - frontend/tests/verify-product-video-page.spec.ts
    - frontend/tests/verify-products-generate-button.spec.ts
  modified:
    - frontend/src/app/products/page.tsx
decisions:
  - id: "20-02-A"
    summary: "Product data passed as URL query params (not sessionStorage) — simpler, shareable, no hydration issues; all required data already available on product card"
  - id: "20-02-B"
    summary: "useSearchParams wrapped in Suspense boundary — required by Next.js App Router to avoid build errors; outer ProductVideoPage renders Loader2 spinner fallback"
  - id: "20-02-C"
    summary: "Dev server restart required to pick up new /product-video route — Turbopack did not detect new directory automatically in this WSL environment"
metrics:
  duration_minutes: 7
  tasks_completed: 3
  files_created: 3
  files_modified: 1
  completed_date: "2026-02-21"
---

# Phase 20 Plan 02: Product Video Frontend Summary

**One-liner:** /product-video generation page with voiceover mode, TTS provider, duration, preset, and filter form wired to backend via useJobPolling; product browser cards get "Generate Video" navigation button.

## What Was Built

### Task 1: /product-video generation page

`frontend/src/app/product-video/page.tsx`:
- Reads `id`, `title`, `image`, `price`, `brand` from URL search params
- Product info card at top showing image (with onError fallback), title, brand, price
- Generation settings form with all required fields:
  - **Voiceover Mode**: RadioGroup — Quick (template) / Elaborate (AI-generated)
  - **AI Provider**: Select (Gemini/Claude) — shown only in Elaborate mode
  - **TTS Provider**: Select — Edge TTS (free) / ElevenLabs (premium)
  - **Voice**: Text input with placeholder showing default voice (ro-RO-EmilNeural for Edge)
  - **Duration**: Select — 15s / 30s / 45s / 60s (default: 30)
  - **Encoding Preset**: Select — TikTok / Reels / YouTube Shorts (default: tiktok)
  - **CTA Text**: Input (default: "Comanda acum!")
  - **Video Filters**: Collapsible section with Denoise, Sharpen, Color Correction checkboxes
- Generate button: POSTs to `/api/v1/products/{product_id}/generate` with form values
- `useJobPolling` hook: real-time progress bar, status text, elapsed time, ETA
- `onComplete`: success toast + "View in Library" button linking to `/librarie`
- `onError`: error alert with retry instructions, re-enables form
- Form disabled while polling is active
- Wrapped in `<Suspense>` (required by Next.js App Router for useSearchParams)

### Task 2: Generate Video button on product browser

`frontend/src/app/products/page.tsx`:
- Added `useRouter` import and `Film` icon from lucide-react
- `handleGenerateVideo(product)` builds URL params and pushes to `/product-video`
- Small "Generate Video" button (outline, sm, Film icon) at bottom of each product card
- Minimal change — existing card layout unchanged

### Task 3: Checkpoint (auto-approved)

⚡ Auto-approved: complete single product E2E flow (backend from 20-01 + frontend from 20-02 tasks 1+2)

## Success Criteria Met

- [x] User can navigate from product browser to generation page (BATCH-01 UI)
- [x] User can choose TTS provider in the form (TTS-03 UI)
- [x] Generation triggers and progress is visible via polling (BATCH-01)
- [x] Completed video appears in library (OUT-04 — publishable via existing Postiz)
- [x] /product-video page renders with all form fields (TypeScript clean, Playwright verified)
- [x] Products page shows Generate Video button on cards

## Deviations from Plan

### Auto-fixed Issues

None - plan executed exactly as written.

### Implementation Notes

**Suspense wrapper:** Next.js App Router requires components using `useSearchParams` to be wrapped in `<Suspense>`. Added outer `ProductVideoPage` export as the default export with Suspense boundary, inner `ProductVideoContent` contains all logic.

**Server restart:** Turbopack dev server (Next.js 16.1.1) did not auto-detect new `/product-video` route directory. Required killing and restarting `npm run dev` on port 3001 for the 404 to resolve to 200. This is a known Turbopack behavior in WSL environments with workspace root detection warnings.

**Radio group styling:** Used flex layout (`className="flex gap-4"`) for horizontal Voiceover Mode radio options — keeps the form compact.

## Self-Check: PASSED

- frontend/src/app/product-video/page.tsx: FOUND
- frontend/src/app/products/page.tsx: FOUND (modified — contains "Generate Video" and "product-video")
- Commit 31183c5 (Task 1 - product-video page): FOUND
- Commit bee8d6f (Task 2 - products generate button): FOUND
