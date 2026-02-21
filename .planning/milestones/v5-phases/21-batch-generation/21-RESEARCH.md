# Phase 21: Batch Generation - Research

**Researched:** 2026-02-21
**Domain:** Backend batch orchestration (FastAPI BackgroundTasks) + Frontend multi-select UI (React/Next.js)
**Confidence:** HIGH — all findings verified against existing codebase; no third-party library additions required

---

## Summary

Phase 21 adds batch product video generation. The single-product flow (Phase 20) is the building block: `POST /products/{product_id}/generate` returns a `job_id`, the 6-stage background task runs independently, and the client polls `GET /api/v1/jobs/{job_id}`. Batch generation is essentially N independent invocations of that same pipeline, each with full error isolation.

The backend design is straightforward: a new `POST /products/batch-generate` endpoint creates a **BatchJob** record that contains N per-product job IDs (`ProductJobState`), then launches N independent `BackgroundTask` calls — one per product. Each child task uses the same `_generate_product_video_task` function with its own `try/except` that catches all exceptions and marks only that product as failed. The batch never re-raises. The client polls a single `GET /products/batch/{batch_id}/status` endpoint that returns the states of all child jobs in one response.

The frontend needs two parts: (1) multi-select checkboxes on the existing products page plus a sticky action bar with a "Generate X videos" button, and (2) a `/batch-generate` results page that shows a per-product progress card grid and updates via polling. The existing `useJobPolling` hook covers single-job polling well, but batch polling requires a custom pattern — polling one endpoint that returns N job states, then deriving per-card state from each.

**Primary recommendation:** Build the batch endpoint as a sequential loop (not parallel) with `try/except` per iteration. Sequential reduces peak FFmpeg + Supabase concurrency pressure on this WSL dev machine and matches the "one failure doesn't kill the batch" requirement without needing asyncio.gather or semaphores.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BATCH-02 | User can select multiple products and generate videos in batch | Multi-select checkboxes on product cards + sticky action bar in `products/page.tsx`; batch dispatch endpoint collects product IDs and launches N background tasks |
| BATCH-03 | Batch generation has per-product error isolation (one failure doesn't kill the batch) | Sequential loop in background task with `try/except` around each product call; never re-raise; mark product state `failed` and continue |
| BATCH-04 | Batch UI shows per-product progress (not single progress bar) | Per-product progress card grid on `/batch-generate` page; each card independently reflects job state from batch status polling endpoint |
</phase_requirements>

---

## Standard Stack

### Core — no new installs needed

| Component | Location | Purpose |
|-----------|----------|---------|
| FastAPI BackgroundTasks | `app/api/product_generate_routes.py` (pattern) | One `add_task` call per product in the batch |
| JobStorage | `app/services/job_storage.py` | Persist batch job + per-product job states; existing `create_job` / `update_job` / `get_job` API |
| Supabase `jobs` table | existing schema | Store `BatchJob` and N `ProductJobState` records; JSONB `data` column holds the payload |
| `useJobPolling` hook | `frontend/src/hooks/use-job-polling.ts` | Reference pattern; batch will need a companion `useBatchPolling` hook |
| Shadcn/UI Checkbox | `frontend/src/components/ui/checkbox.tsx` | Product card multi-select |
| React `useState` + `useEffect` | all pages | Local state per card, batch page polling state |

### Supporting (already present)

| Component | Location | Purpose |
|-----------|----------|---------|
| `toast` (Sonner) | frontend | Success / error notifications |
| `Progress` component | `ui/progress.tsx` | Per-product progress bar |
| `Badge` component | `ui/badge.tsx` | Status label (queued/processing/done/failed) |
| `Card` component | `ui/card.tsx` | Per-product progress card |
| `Loader2` (lucide-react) | existing imports | Spinner icon |
| `CheckCircle2`, `AlertCircle`, `XCircle` | lucide-react | State icons |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sequential loop in batch task | `asyncio.gather` parallel | Parallel would be faster but risks FFmpeg memory contention on WSL; sequential is safer and simpler |
| Single batch-status polling endpoint | Poll N individual job endpoints | N individual polls create N×polling_interval HTTP requests; single endpoint is more efficient |
| In-memory batch state | Supabase `jobs` table | In-memory is lost on restart; Supabase provides nav-away-and-return persistence (BATCH-04) |

**Installation:** None required.

---

## Architecture Patterns

### Recommended File Structure

```
app/api/
├── product_generate_routes.py    # existing — add batch endpoint here
frontend/src/app/
├── products/
│   └── page.tsx                  # existing — add multi-select + sticky action bar
├── batch-generate/
│   └── page.tsx                  # new — per-product progress grid page
frontend/src/hooks/
├── use-job-polling.ts            # existing — reference pattern for useBatchPolling
```

No new service files needed — batch orchestration fits in `product_generate_routes.py`.

### Pattern 1: BatchJob Data Model (in-memory + Supabase via JobStorage)

```python
# Stored as job_type="batch_product_video" in jobs table
BatchJobData = {
    "job_id": str,           # batch_id (UUID)
    "job_type": "batch_product_video",
    "status": "processing",  # batch-level: processing | completed | failed
    "profile_id": str,
    "product_jobs": [        # ordered list, one per product
        {
            "product_id": str,
            "job_id": str,   # child job_id — each maps to its own jobs row
            "title": str,    # for display — avoid extra DB round-trip on poll
            "status": "queued" | "processing" | "completed" | "failed",
            "progress": str, # "0"-"100"
            "error": str | None,
        }
    ],
    "total": int,
    "completed": int,
    "failed": int,
    "created_at": str,
    "updated_at": str,
}
```

**Key design decision:** Store `product_jobs` list in the BatchJob's `data` JSONB. The batch-status polling endpoint reads child job states from `JobStorage.get_job(child_job_id)` and merges them into the response — no separate table needed.

### Pattern 2: Batch Dispatch Endpoint

```python
# Source: product_generate_routes.py — follows same pattern as existing generate endpoint
class BatchGenerateRequest(BaseModel):
    product_ids: list[str]          # 2-50 product IDs
    voiceover_mode: str = "quick"
    tts_provider: str = "edge"      # edge default per v5 roadmap decision
    voice_id: Optional[str] = None
    ai_provider: str = "gemini"
    duration_s: int = 30
    encoding_preset: str = "tiktok"
    voiceover_template: str = "{title}. {brand}. Pret: {price} lei."
    cta_text: str = "Comanda acum!"
    enable_denoise: bool = False
    enable_sharpen: bool = False
    enable_color_correction: bool = False

@router.post("/batch-generate")
async def batch_generate_products(
    request: BatchGenerateRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    batch_id = str(uuid.uuid4())
    # create N child job_ids (UUID each)
    product_jobs = [
        {"product_id": pid, "job_id": str(uuid.uuid4()), "status": "queued", ...}
        for pid in request.product_ids
    ]
    # Save batch record to JobStorage
    job_storage.create_job({
        "job_id": batch_id,
        "job_type": "batch_product_video",
        "product_jobs": product_jobs,
        ...
    }, profile_id=profile.profile_id)

    # Dispatch single background task — sequential loop internally
    background_tasks.add_task(
        _batch_generate_task,
        batch_id=batch_id,
        product_jobs=product_jobs,
        profile_id=profile.profile_id,
        request=request,
    )
    return {"batch_id": batch_id, "total": len(product_jobs)}
```

### Pattern 3: Per-Product Error Isolation (BATCH-03 critical)

```python
async def _batch_generate_task(batch_id, product_jobs, profile_id, request):
    job_storage = get_job_storage()

    for product_job in product_jobs:
        pid = product_job["product_id"]
        child_job_id = product_job["job_id"]

        # Mark this product as processing in batch record
        _update_batch_product_status(batch_id, pid, "processing", job_storage, profile_id)

        try:
            # Create child job record
            job_storage.create_job({
                "job_id": child_job_id,
                "job_type": "product_video",
                "status": "pending",
                "progress": "0",
                "product_id": pid,
                "profile_id": profile_id,
            }, profile_id=profile_id)

            # Reuse existing single-product pipeline
            await _generate_product_video_task(
                job_id=child_job_id,
                product_id=pid,
                profile_id=profile_id,
                request=request,  # shared settings for all products
            )

            # Check if child succeeded
            child = job_storage.get_job(child_job_id)
            if child and child.get("status") == "completed":
                _update_batch_product_status(batch_id, pid, "completed", job_storage, profile_id)
            else:
                err = child.get("error", "Unknown error") if child else "Job not found"
                _update_batch_product_status(batch_id, pid, "failed", job_storage, profile_id, err)

        except Exception as exc:
            # NEVER re-raise — log and continue to next product
            logger.error("[batch %s] Product %s failed: %s", batch_id, pid, exc)
            _update_batch_product_status(batch_id, pid, "failed", job_storage, profile_id, str(exc))

    # Final batch status update
    _finalize_batch(batch_id, job_storage, profile_id)
```

### Pattern 4: Batch Status Polling Endpoint

```python
@router.get("/batch/{batch_id}/status")
async def get_batch_status(
    batch_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    batch = job_storage.get_job(batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")

    # Merge fresh child job states into response
    product_statuses = []
    for pj in batch.get("product_jobs", []):
        child = job_storage.get_job(pj["job_id"]) or {}
        product_statuses.append({
            "product_id": pj["product_id"],
            "job_id": pj["job_id"],
            "title": pj.get("title", ""),
            "status": child.get("status", pj.get("status", "queued")),
            "progress": child.get("progress", "0"),
            "error": child.get("error"),
            "result": child.get("result"),
        })

    completed = sum(1 for p in product_statuses if p["status"] == "completed")
    failed = sum(1 for p in product_statuses if p["status"] == "failed")
    total = len(product_statuses)

    return {
        "batch_id": batch_id,
        "status": "completed" if (completed + failed) == total else "processing",
        "total": total,
        "completed": completed,
        "failed": failed,
        "product_jobs": product_statuses,
    }
```

### Pattern 5: Frontend Multi-Select State (products/page.tsx)

```typescript
// Add to existing products page state
const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
const [isBatchMode, setIsBatchMode] = useState(false);

const toggleProductSelection = (productId: string) => {
  setSelectedProductIds(prev => {
    const next = new Set(prev);
    if (next.has(productId)) next.delete(productId);
    else next.add(productId);
    return next;
  });
};

// Sticky action bar — shown when selectedProductIds.size > 0
// "Generate X Videos" → POST /products/batch-generate → redirect to /batch-generate?batch_id=...
```

### Pattern 6: useBatchPolling Hook

```typescript
// New hook — mirrors useJobPolling pattern but for batch endpoint
function useBatchPolling(options) {
  const { batchId, apiBaseUrl, interval = 2000, onProductUpdate, onBatchComplete } = options;
  // Polls GET /products/batch/{batchId}/status
  // Returns: { batchStatus, productStatuses, isPolling, completedCount, failedCount, totalCount }
  // Stops polling when all products are completed or failed
}
```

### Pattern 7: Per-Product Progress Card (batch-generate/page.tsx)

```typescript
// State icon determined by product status
function ProductStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="text-green-500" />;
  if (status === "failed") return <AlertCircle className="text-destructive" />;
  if (status === "processing") return <Loader2 className="animate-spin" />;
  return <Clock className="text-muted-foreground" />; // queued
}

// Each card: product title, status badge, progress bar (0-100), error message if failed
// Retry-failed button: re-triggers batch dispatch with only failed product_ids
```

### Anti-Patterns to Avoid

- **Re-raising exceptions in the batch loop:** Any unhandled exception that propagates out of the `for` loop will abort all remaining products. The `except Exception` block must never re-raise.
- **Parallel `asyncio.gather` for FFmpeg jobs:** On WSL with limited CPU, multiple concurrent FFmpeg processes cause significant slowdown. The Phase 18 decision documented a 2.3x slowdown with zoompan. Sequential is safer.
- **Storing full product data in batch JSONB:** Only store what the UI needs for display (title, status, progress). Avoid storing large fields like `description` or `local_image_path` in the batch record — they belong in the child job.
- **Polling N individual job endpoints from the frontend:** Creates N×2 HTTP requests per interval. The single batch-status endpoint merges all child states server-side.
- **Not persisting batch state to Supabase:** BATCH-04 requires navigate-away-and-return. The `jobs` table with JSONB `data` already supports this — use it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Batch job storage | Custom batch table | `jobs` table with `job_type="batch_product_video"` | Schema already exists, JobStorage CRUD handles it |
| Error isolation | Custom try/except framework | Plain `try/except Exception` per iteration | Simplest reliable solution — no library needed |
| Single-product pipeline | Re-implement 6 stages | Call `_generate_product_video_task()` directly | Already proven in Phase 20 E2E; avoids drift |
| Progress polling | Custom WebSocket or SSE | HTTP polling at 2s interval | Consistent with existing `useJobPolling` pattern; backend is stateless |
| Multi-select UI | Custom drag-select | Checkbox `useState<Set<string>>` | Matches Shadcn Checkbox component; simple, accessible |

**Key insight:** This phase is orchestration of the Phase 20 pipeline, not new pipeline logic. Every attempt to re-implement stage logic creates drift risk.

---

## Common Pitfalls

### Pitfall 1: Exception Re-Raise in Batch Loop
**What goes wrong:** One product raises an exception that bubbles past the `except` block (e.g., `except ValueError` instead of `except Exception`), and all subsequent products in the batch never run.
**Why it happens:** Developers scope exception types too narrowly. Image not found raises `FileNotFoundError`, TTS failure raises `httpx.HTTPError`, FFmpeg raises `subprocess.CalledProcessError` — all different types.
**How to avoid:** Always use `except Exception as exc` (not a specific subclass) in the batch loop.
**Warning signs:** Batch status shows N-1 products still "queued" after first product fails.

### Pitfall 2: BatchJob Progress Shows 0 Until All Done
**What goes wrong:** The batch status endpoint is only called after all products complete, so the UI shows no progress until the last product finishes.
**Why it happens:** The polling endpoint isn't called frequently enough, or the frontend stops polling too early.
**How to avoid:** Poll the batch-status endpoint at 2s intervals. The endpoint computes `completed + failed / total` as overall progress in real time.
**Warning signs:** Progress grid appears frozen for a long time, then all cards flip to done simultaneously.

### Pitfall 3: Navigate Away Loses Batch ID
**What goes wrong:** User navigates away from `/batch-generate?batch_id=...` and the `batch_id` is stored only in React state, which is lost on navigation.
**Why it happens:** Passing `batch_id` via React state instead of URL query param.
**How to avoid:** Always pass `batch_id` as a URL query param (`/batch-generate?batch_id=...`). The page reads it from `useSearchParams()` on mount and resumes polling from Supabase-persisted state.
**Warning signs:** Navigating back to the page shows no progress and starts a fresh state.

### Pitfall 4: Sticky Action Bar Z-Index and Scrolling Issues
**What goes wrong:** The sticky action bar overlaps the last row of product cards and there's no bottom padding to compensate.
**Why it happens:** `position: sticky; bottom: 0` with no `pb-24` on the grid container.
**How to avoid:** Add `pb-24` to the product grid container when `selectedProductIds.size > 0`.
**Warning signs:** Last row of cards is partially hidden behind the action bar.

### Pitfall 5: Batch Settings Applied Uniformly
**What goes wrong:** Per-product customization is attempted (different voice for each product, different duration). The `BatchGenerateRequest` is shared across all products.
**Why it happens:** "Out of scope" requirement (see REQUIREMENTS.md) sometimes surfaces as user request during implementation.
**How to avoid:** `BatchGenerateRequest` holds settings applied equally to all products in the batch. Per-video customization is explicitly out of scope per REQUIREMENTS.md.

### Pitfall 6: Supabase JSONB Size Limit for Large Batches
**What goes wrong:** A batch of 50 products with full product data stored in each `product_jobs` entry causes the JSONB payload to exceed reasonable limits.
**Why it happens:** Storing full product objects (title, description, image URLs) in batch record instead of only display metadata.
**How to avoid:** Store only `{product_id, job_id, title, status, progress, error}` in `product_jobs`. Full product data is already in the `products` table.

---

## Code Examples

Verified patterns from existing codebase:

### Existing: Single Product Generate (reference for batch)
```python
# Source: app/api/product_generate_routes.py lines 87-137
@router.post("/{product_id}/generate")
async def generate_product_video(
    product_id: str,
    request: ProductGenerateRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    job_id = str(uuid.uuid4())
    job_storage.create_job({"job_id": job_id, "job_type": "product_video", ...})
    background_tasks.add_task(_generate_product_video_task, job_id=job_id, ...)
    return {"job_id": job_id, "status": "pending"}
```

### Existing: JobStorage create + update pattern
```python
# Source: app/services/job_storage.py
job_storage = get_job_storage()
job_storage.create_job({"job_id": job_id, ...}, profile_id=profile_id)
job_storage.update_job(job_id, {"status": "completed", "progress": "100"}, profile_id=profile_id)
batch = job_storage.get_job(batch_id)  # returns data JSONB dict
```

### Existing: useJobPolling (reference for useBatchPolling)
```typescript
// Source: frontend/src/hooks/use-job-polling.ts
const { startPolling, isPolling, progress, statusText } = useJobPolling({
  apiBaseUrl: API_URL,
  interval: 2000,
  onComplete: (result) => { /* handle completion */ },
  onError: (error) => { /* handle error */ },
});
startPolling(jobId);
```

### Existing: Checkbox product card pattern (new addition to products/page.tsx)
```typescript
// Source: frontend/src/components/ui/checkbox.tsx (already present)
<Checkbox
  checked={selectedProductIds.has(product.id)}
  onCheckedChange={() => toggleProductSelection(product.id)}
  className="absolute top-2 left-2"
  onClick={(e) => e.stopPropagation()}  // prevent card click-through
/>
```

### Existing: Job status polling URL pattern
```typescript
// Source: frontend/src/hooks/use-job-polling.ts line 101
const response = await fetch(`${apiBaseUrl}/jobs/${jobId}`);
// Batch equivalent:
const response = await fetch(`${apiBaseUrl}/products/batch/${batchId}/status`);
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Per-request in-memory job dict | Supabase `jobs` table with fallback | Navigate-away-and-return works (BATCH-04) |
| Single `process_job` background task | Modular `_generate_product_video_task` | Can be called as a subroutine from batch loop |
| Single progress bar | Per-product card grid | BATCH-04 requirement |

---

## Open Questions

1. **Batch size limit**
   - What we know: No explicit limit defined in requirements. 50 products at 30s each = ~25 minutes of sequential processing.
   - What's unclear: Is there a maximum reasonable batch size? Should we cap it?
   - Recommendation: Cap at 50 products in the request validation with a clear error message. This prevents accidental "select all 10,000 products" scenarios.

2. **Retry-failed button scope**
   - What we know: Phase 21-02 plan includes a "retry-failed" button.
   - What's unclear: Does retry create a new batch job (new batch_id) or mutate the existing one?
   - Recommendation: Create a new batch job with only the failed product IDs. Simpler state machine — the old batch stays as historical record, the retry creates a fresh one. Frontend can navigate to the new batch page.

3. **Select-all checkbox behavior**
   - What we know: Products are paginated (50 per page). Current page shows up to 50 products.
   - What's unclear: Should "select all" select only the current page, or all filtered products (which may span multiple pages)?
   - Recommendation: Select current page only. Cross-page selection requires fetching all product IDs in one request — complex and potentially slow for 10k product feeds. "Current page only" is clearly communicated in the UI.

4. **Batch settings defaults**
   - What we know: TTS-03 says "Edge TTS default for batch". Voice defaults to `ro-RO-EmilNeural`.
   - What's unclear: Should the batch settings form be identical to the single-product form, or simplified?
   - Recommendation: Simplified — show only: TTS Provider, Voice, Duration, Encoding Preset, CTA Text. Hide elaborate mode (AI scripts) for batch since it's slower and costs per-product. This aligns with "quick mode default" for batch.

---

## Sources

### Primary (HIGH confidence)
- `app/api/product_generate_routes.py` — full single-product 6-stage pipeline; direct reference for batch implementation
- `app/services/job_storage.py` — JobStorage API: `create_job`, `update_job`, `get_job`, `list_jobs`; verified JSONB storage model
- `frontend/src/hooks/use-job-polling.ts` — polling pattern; reference for `useBatchPolling` hook design
- `frontend/src/app/products/page.tsx` — existing product browser; modification target for multi-select
- `frontend/src/app/product-video/page.tsx` — single-product generation UI; reference pattern for batch UI
- `supabase/migrations/013_create_product_tables.sql` — confirmed `products` and `product_feeds` table schema
- `.planning/STATE.md` — confirmed Phase 20 complete; E2E verified; decisions: zoompan viable, Edge TTS default for batch

### Secondary (MEDIUM confidence)
- REQUIREMENTS.md `BATCH-02/03/04` — requirement text confirmed; "Per-video customization in batch" explicitly out of scope
- REQUIREMENTS.md Out of Scope table — "Per-video customization in batch: Defeats batch purpose"
- `.planning/STATE.md` decision `[18-01]` — zoompan 2.3x slowdown benchmark; sequential batch confirmed safer than parallel

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against existing codebase, no new dependencies
- Architecture: HIGH — patterns directly derived from Phase 20 working implementation
- Pitfalls: HIGH — identified from existing code patterns and explicit requirements constraints

**Research date:** 2026-02-21
**Valid until:** 2026-03-07 (stable codebase; 14 days)
