---
phase: 21-batch-generation
verified: 2026-02-21T00:00:00Z
status: human_needed
score: 10/10 must-haves verified
re_verification: false
human_verification:
  - test: "Multi-select checkboxes visible on product cards"
    expected: "Each card in /products shows a checkbox in the top-left corner (absolute top-2 left-2 z-10) that is always visible (not hover-only)"
    why_human: "Cannot verify visual positioning, z-index rendering, or mobile accessibility without browser"
  - test: "Sticky action bar appears and batch dispatch works end-to-end"
    expected: "Selecting 2+ products shows a fixed bottom bar with correct count and 'Generate N Videos' button; clicking it POSTs, receives batch_id, and redirects to /batch-generate?batch_id=..."
    why_human: "Requires a running dev server with products loaded in a feed; interaction flow cannot be verified by static analysis"
  - test: "Batch-generate page shows per-product cards and polls correctly"
    expected: "Navigating to /batch-generate?batch_id=<real-id> renders a card grid; each card independently transitions through queued -> processing -> completed/failed with its own progress bar"
    why_human: "Requires active batch job to observe real-time state transitions and independent card rendering"
  - test: "Navigate-away-and-return preserves batch progress"
    expected: "Leaving /batch-generate and returning to the same URL resumes polling and shows current state (not reset to 0)"
    why_human: "Must be tested interactively — depends on Supabase persistence and URL param re-read on mount"
  - test: "Retry Failed button dispatches new batch with only failed product IDs"
    expected: "When failedCount > 0 after batch completes, 'Retry N Failed' button appears; clicking it dispatches new POST /products/batch-generate with only failed product_ids and redirects to new batch page"
    why_human: "Requires a batch with at least one failed product to test; cannot simulate failure programmatically"
---

# Phase 21: Batch Generation Verification Report

**Phase Goal:** Users can select multiple products, launch batch generation, and monitor per-product progress — with one product failure not affecting the rest
**Verified:** 2026-02-21
**Status:** human_needed (all automated checks passed — 5 items require human browser verification)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /products/batch-generate accepts a list of product_ids and returns a batch_id immediately | VERIFIED | `batch_generate_products` endpoint at line 175 of product_generate_routes.py; returns `{"batch_id": batch_id, "total": len(product_jobs)}` before background task completes |
| 2 | Each product in the batch is processed sequentially with its own try/except — a failure in product N does not prevent product N+1 from processing | VERIFIED | `_batch_generate_task` lines 323-386; `except Exception as exc` at line 375 with comment "NEVER re-raise; continue to next product" — loop continues after catch, calls `_finalize_batch` at end |
| 3 | GET /products/batch/{batch_id}/status returns per-product status including progress, state, and error message for each product in the batch | VERIFIED | `get_batch_status` endpoint lines 250-303; merges child job states from `job_storage.get_job(pj["job_id"])` into `product_statuses` list with fields: product_id, job_id, title, status, progress, error, result |
| 4 | Batch state persists in Supabase jobs table so navigating away and returning preserves progress | VERIFIED | `job_storage.create_job()` called at line 223 with `job_type: "batch_product_video"` — JobStorage writes to Supabase; batch_id is read from URL params in page.tsx line 103, `startPolling(batchId)` called on mount |
| 5 | User can toggle checkboxes on product cards to select multiple products | VERIFIED | `selectedProductIds: Set<string>` state at line 103 of products/page.tsx; `toggleProductSelection` at line 263; `Checkbox` component rendered with `checked={selectedProductIds.has(product.id)}` at line 502 |
| 6 | A sticky action bar appears at the bottom when products are selected showing count and a Generate Videos button | VERIFIED | Conditional render `{selectedProductIds.size > 0 && ...}` at line 612; fixed bottom-0 z-50 bar with count display and "Generate N Videos" button at lines 612-633 |
| 7 | Clicking Generate Videos dispatches POST /products/batch-generate and redirects to /batch-generate?batch_id=... | VERIFIED | `handleBatchGenerate` at line 284; calls `apiPost("/products/batch-generate", {...})` at line 287; `router.push("/batch-generate?batch_id=...")` at line 296 on success |
| 8 | The batch-generate page shows a per-product progress card for each product with independent status | VERIFIED | `batch-generate/page.tsx` renders `<ProductJobCard>` for each `productJobs` item at line 282; each card has its own status badge, progress bar, and error text independently derived from polling response |
| 9 | User can navigate away from batch-generate page and return to see current progress | VERIFIED | `batchId = searchParams.get("batch_id")` at line 103; `useEffect(() => { if (batchId) startPolling(batchId); }, [batchId, startPolling])` at line 121 — no sessionStorage, pure URL + Supabase |
| 10 | A Retry Failed button appears when some products have failed status | VERIFIED | `someFailedAndDone && (...)` at line 247; button collects `productJobs.filter(j => j.status === "failed").map(j => j.product_id)` at line 133 and dispatches new batch |

**Score: 10/10 truths verified by static analysis**

---

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `app/api/product_generate_routes.py` | VERIFIED | 822 lines; contains `BatchGenerateRequest`, `batch_generate_products`, `get_batch_status`, `_batch_generate_task`, `_update_batch_product_status`, `_finalize_batch` |
| `frontend/src/app/products/page.tsx` | VERIFIED | Contains `selectedProductIds`, `toggleProductSelection`, `selectAllOnPage`, `clearSelection`, `handleBatchGenerate`, `batchLoading`, Checkbox import, sticky action bar |
| `frontend/src/hooks/use-batch-polling.ts` | VERIFIED | 155 lines; exports `useBatchPolling`, `BatchStatus`, `ProductJobStatus` interfaces; polls at 2s interval; ref-based cleanup |
| `frontend/src/app/batch-generate/page.tsx` | VERIFIED | 306 lines; Suspense boundary, `useSearchParams`, `useBatchPolling` hook, per-product card grid, retry button, completion states |

**Wiring levels verified:**
- Level 1 (Exists): All 4 artifacts confirmed on disk
- Level 2 (Substantive): No placeholders, no stub returns, all functions have real implementations
- Level 3 (Wired): All imports resolved, all hooks consumed, router registered in main.py

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `product_generate_routes.py::batch_generate_products` | `product_generate_routes.py::_batch_generate_task` | `background_tasks.add_task(_batch_generate_task, ...)` line 239 | WIRED | Sequential loop calls `_generate_product_video_task` per product |
| `product_generate_routes.py::get_batch_status` | `job_storage.py::get_job` | `job_storage.get_job(batch_id)` line 272; `job_storage.get_job(pj["job_id"])` line 278 | WIRED | Reads both batch record and child job records |
| `frontend/src/app/products/page.tsx` | `/api/v1/products/batch-generate` | `apiPost("/products/batch-generate", {...})` line 287 | WIRED | Response parsed for batch_id, redirect to /batch-generate |
| `frontend/src/app/batch-generate/page.tsx` | `frontend/src/hooks/use-batch-polling.ts` | `import { useBatchPolling }` line 10; hook called in `BatchGenerateContent` line 108 | WIRED | startPolling called on mount via useEffect |
| `frontend/src/hooks/use-batch-polling.ts` | `/api/v1/products/batch/{batchId}/status` | `fetch(\`${apiBaseUrl}/products/batch/${batchId}/status\`)` line 83 | WIRED | Polls at 2s; stops when `status === "completed"` |
| `app/main.py` | `product_generate_routes.py` | `include_router(product_generate_router, prefix="/api/v1")` line 78 | WIRED | Router registered, endpoints reachable at /api/v1/products/* |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BATCH-02 | 21-01, 21-02 | User can select multiple products and generate videos in batch | SATISFIED | Multi-select UI in products/page.tsx + POST /products/batch-generate endpoint dispatch |
| BATCH-03 | 21-01 | Batch generation has per-product error isolation (one failure doesn't kill the batch) | SATISFIED | `except Exception` at line 375 of product_generate_routes.py never re-raises; loop continues to next product |
| BATCH-04 | 21-02 | Batch UI shows per-product progress (not single progress bar) | SATISFIED | `ProductJobCard` rendered per product in batch-generate/page.tsx; each card has independent status badge and Progress component |

**No orphaned requirements found.** REQUIREMENTS.md maps BATCH-02, BATCH-03, BATCH-04 to Phase 21 — all three are covered by plans 21-01 and 21-02.

---

## Anti-Patterns Found

No anti-patterns detected. Scanned `product_generate_routes.py`, `use-batch-polling.ts`, `batch-generate/page.tsx`, and `products/page.tsx` for:
- TODO/FIXME/PLACEHOLDER comments: none found
- Stub returns (return null, return {}, return []): none found
- Empty handlers or placeholder implementations: none found

---

## Notable Implementation Detail: Status Field Discrepancy

`_finalize_batch` writes `"completed_with_errors"` to the batch record's `status` field when some products fail (line 438). However, `GET /batch/{batch_id}/status` **recomputes** `overall_status` dynamically from child job terminal states (line 294) — it always returns `"processing"` or `"completed"` (never `"completed_with_errors"`). The `BatchStatus` TypeScript type in `use-batch-polling.ts` correctly declares `status: "processing" | "completed"`. This is consistent and the polling hook correctly stops when the endpoint returns `"completed"`. No gap — the stored `"completed_with_errors"` status is internal only.

---

## Human Verification Required

### 1. Multi-select checkboxes visible on product cards

**Test:** Navigate to http://localhost:3000/products, load a feed with products
**Expected:** Each product card shows a checkbox in the absolute top-left corner (z-10) — always visible, not just on hover
**Why human:** Visual positioning, z-index rendering, and mobile accessibility cannot be verified by static analysis

### 2. Sticky action bar appears and batch dispatch works end-to-end

**Test:** Select 2+ product checkboxes on the products page
**Expected:** A fixed bottom bar appears showing "N selected" with Select all on page, Clear, and "Generate N Videos" buttons; clicking Generate N Videos POSTs to /api/v1/products/batch-generate and redirects to /batch-generate?batch_id=...
**Why human:** Requires running dev server with actual products in a feed; full interaction flow cannot be statically verified

### 3. Batch-generate page shows per-product cards and polls correctly

**Test:** Navigate to /batch-generate?batch_id=<real-batch-id> while batch is in progress
**Expected:** Per-product card grid renders with independent status badges (queued/processing/completed/failed), progress bars, and error text — each card updates independently on 2s poll intervals
**Why human:** Requires active batch job with real data; per-card state transitions are runtime behavior

### 4. Navigate-away-and-return preserves batch progress

**Test:** Start a batch, navigate to /products, then return to the same /batch-generate?batch_id=... URL
**Expected:** Page resumes polling and shows current state — not reset to 0%; no sessionStorage needed
**Why human:** Must test interactively; depends on Supabase persistence and URL-param-driven mount behavior

### 5. Retry Failed button dispatches new batch with only failed product IDs

**Test:** Wait for a batch to complete with at least one failure; observe "Retry N Failed" button
**Expected:** Button appears only when `isDone && failedCount > 0`; clicking it dispatches new POST with only the failed product_ids and navigates to a new batch URL
**Why human:** Requires a real batch failure to trigger; failure simulation cannot be done from browser without backend manipulation

---

## Commits Verified

All commits claimed in SUMMARY.md files exist in git history:
- `887db6b` — feat(21-01): add batch product video generation endpoints
- `d1cdee6` — feat(21-02): add multi-select + sticky action bar to products page, create useBatchPolling hook
- `40388de` — feat(21-02): create batch-generate progress page with per-product status cards

---

_Verified: 2026-02-21_
_Verifier: Claude (gsd-verifier)_
