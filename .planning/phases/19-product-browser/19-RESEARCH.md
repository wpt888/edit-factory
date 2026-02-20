# Phase 19: Product Browser - Research

**Researched:** 2026-02-21
**Domain:** FastAPI query params + Supabase filtering, Next.js paginated card grid with search/filter controls
**Confidence:** HIGH

## Summary

Phase 19 is primarily a wiring and UI phase, not an infrastructure phase. The backend database schema and image download pipeline are fully built (Phase 17). The existing `GET /feeds/{feed_id}/products` endpoint already handles pagination but has NO search, on-sale, category, or brand filter params — those are the backend gap for plan 19-01. The frontend gap is a new `/products` page with feed selector, filter bar, and a paginated product card grid.

The backend work is a targeted extension of `feed_routes.py`: add four optional query params (`search`, `on_sale`, `category`, `brand`) to the existing `list_products` endpoint, and add a `GET /feeds/{feed_id}/products/filters` endpoint to return distinct brand and category values for dropdown population. The supabase-py client already supports `.ilike()` for case-insensitive text search and `.eq()` for boolean/exact filtering — no new libraries needed.

The frontend is a new `frontend/src/app/products/page.tsx` following the established project pattern: `"use client"`, `useEffect` fetch on mount, `apiGet`/`apiPost` from `@/lib/api`, Shadcn/UI components (Card, Input, Select, Switch/Toggle, Badge), and Sonner toasts. Product images must be served via the `image_link` URL (original CDN URL from feed) as `<img>` tags with a fallback to a placeholder, because local cached images live in `output/product_images/` on the backend filesystem with no static HTTP mount. The Next.js `<Image>` component requires allowlisted domains — only `gomagcdn.ro` is currently allowlisted, so using a plain `<img>` tag with `onError` fallback is the safe cross-feed choice for the card grid.

**Primary recommendation:** Extend `feed_routes.py` with inline filter params (no new service file needed — the endpoint is simple enough). Build the frontend page as a single-file client component with local state for filters and pagination, following the `tts-library/page.tsx` and `usage/page.tsx` patterns already in the project.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FEED-02 | User can browse synced products in a visual card grid with pagination | New `/products` frontend page — card grid, paginated 50/page, fed by extended `list_products` endpoint |
| FEED-03 | User can search products by title (full-text search) | Add `search` query param to `list_products` — use Supabase `.ilike("title", f"%{search}%")` (case-insensitive substring); GIN index on title exists but ilike on indexed text column is sufficient for <10k rows per feed |
| FEED-04 | User can filter products by on-sale status (sale_price < price) | Add `on_sale` bool query param — use `.eq("is_on_sale", True)` (is_on_sale is a stored boolean column, already set during upsert in Phase 17) |
| FEED-05 | User can filter products by product category (from product_type field) | Add `category` query param — use `.eq("product_type", category)`; add `GET /feeds/{feed_id}/products/filters` to return distinct product_types for dropdown |
| FEED-06 | User can filter products by brand | Add `brand` query param — use `.eq("brand", brand)`; same filters endpoint returns distinct brands |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `supabase-py` | 2.x (installed) | Filtered DB queries | Already in project; `.ilike()`, `.eq()`, `.range()` are the right primitives |
| Shadcn/UI | installed | Card grid, Input, Select, Switch, Badge | All components already in `frontend/src/components/ui/` |
| `lucide-react` | ^0.556.0 (installed) | Icons (Search, Filter, Tag, etc.) | Already in project |
| `sonner` | ^2.0.7 (installed) | Toast notifications | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `apiGet` from `@/lib/api` | project | API calls with X-Profile-Id header | Used for all product and feed fetch calls |
| `useProfile` from `@/contexts/profile-context` | project | Current profile context | Needed to know when profile is loaded before fetching |
| `useEffect` + `useState` | React 19 | Client-side data fetching and state | Established pattern; no external state library |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `.ilike()` for search | Supabase `textSearch()` with GIN index | textSearch uses `to_tsquery` which requires exact word matches; ilike gives simpler substring UX. GIN index already exists but is for future use. ilike is correct for this UX. |
| `<img>` tag with onError | Next.js `<Image>` | Next.js Image requires allowlisted hostnames per domain. Feeds from different CDNs would silently fail. Plain `<img>` + onError fallback is safer and simpler. |
| Server-side filtering | Client-side filtering | Products can be up to 10k per feed — 50/page means client never sees full dataset; server-side filtering is required |
| New `product_routes.py` | Extend `feed_routes.py` | Plan 19-01 description says `product_routes.py` — create new file to keep concerns separated and avoid growing feed_routes further |

**Installation:**
```bash
# No new packages needed — all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
app/api/
├── feed_routes.py          # Existing feed CRUD + sync (keep as-is)
└── product_routes.py       # NEW: products listing with filters (19-01)

frontend/src/app/
└── products/
    └── page.tsx            # NEW: Product browser page (19-02)
```

### Pattern 1: Extended Query Params in FastAPI
**What:** Add optional query params to an existing-style endpoint without changing the route path
**When to use:** Adding filter params to a list endpoint — same URL, richer filtering
**Example:**
```python
# Source: established FastAPI pattern (supabase-py .ilike / .eq)
@router.get("/{feed_id}/products")
async def list_products(
    feed_id: str,
    page: int = 1,
    page_size: int = 50,
    search: Optional[str] = None,
    on_sale: Optional[bool] = None,
    category: Optional[str] = None,
    brand: Optional[str] = None,
    profile: ProfileContext = Depends(get_profile_context),
):
    query = supabase.table("products").select("*").eq("feed_id", feed_id)

    if search:
        query = query.ilike("title", f"%{search}%")
    if on_sale is True:
        query = query.eq("is_on_sale", True)
    if category:
        query = query.eq("product_type", category)
    if brand:
        query = query.eq("brand", brand)

    result = query.order("created_at").range(offset, offset + page_size - 1).execute()
```

### Pattern 2: Distinct Values Endpoint for Dropdown Population
**What:** A dedicated endpoint that returns unique brand and category values for a feed
**When to use:** Populating filter dropdowns from real data (avoids hardcoding)
**Example:**
```python
# New endpoint in product_routes.py
@router.get("/{feed_id}/products/filters")
async def get_product_filters(
    feed_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Return distinct brands and categories for a feed's products."""
    # supabase-py does not support raw DISTINCT — use two separate selects
    brands_result = supabase.table("products").select("brand").eq("feed_id", feed_id).execute()
    types_result = supabase.table("products").select("product_type").eq("feed_id", feed_id).execute()

    brands = sorted(set(r["brand"] for r in brands_result.data if r.get("brand")))
    categories = sorted(set(r["product_type"] for r in types_result.data if r.get("product_type")))

    return {"brands": brands, "categories": categories}
```

NOTE: `supabase-py` v2 does not expose a native DISTINCT query method. Fetching all brand/type values and deduplicating in Python is correct for <10k products. This is a known limitation.

### Pattern 3: Feed Config Panel + Filter Bar + Card Grid (Frontend)
**What:** Three-section layout: feed selector at top, filter row below, scrollable card grid
**When to use:** Browsing a filtered list from a feed-scoped dataset
**Example structure:**
```tsx
// Source: tts-library/page.tsx and usage/page.tsx patterns
"use client";

export default function ProductsPage() {
  // Feed state
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);

  // Filter state
  const [search, setSearch] = useState("");
  const [onSale, setOnSale] = useState(false);
  const [category, setCategory] = useState("all");
  const [brand, setBrand] = useState("all");

  // Product state
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total_pages: 1, total: 0 });
  const [loading, setLoading] = useState(false);

  // Debounce search to avoid hammering API on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Fetch on filter/page change
  useEffect(() => {
    if (!selectedFeedId) return;
    fetchProducts();
  }, [selectedFeedId, debouncedSearch, onSale, category, brand, pagination.page]);
```

### Pattern 4: Search Debounce
**What:** Delay API call until user stops typing (300-500ms)
**When to use:** Any text input that triggers server-side search
**Example:**
```tsx
// Simple useEffect debounce — no external library needed
useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedSearch(search);
  }, 400);
  return () => clearTimeout(timer);
}, [search]);
```

### Pattern 5: Image with Fallback
**What:** `<img>` tag with onError handler to show placeholder
**When to use:** Product images from external CDNs not in Next.js allowlist
**Example:**
```tsx
<img
  src={product.image_link || "/placeholder-product.png"}
  alt={product.title}
  className="w-full h-48 object-cover rounded-t-lg"
  onError={(e) => {
    (e.target as HTMLImageElement).src = "/placeholder-product.png";
  }}
/>
```

NOTE: A static placeholder PNG must be placed in `frontend/public/placeholder-product.png`.

### Pattern 6: New Router File + mount in main.py
**What:** Separate `product_routes.py` for product-specific endpoints, mounted in main.py
**When to use:** Keeping route files focused; feed_routes.py already handles feed CRUD + sync
**Example:**
```python
# product_routes.py
router = APIRouter(prefix="/feeds", tags=["Products"])

# main.py addition
from app.api.product_routes import router as product_router
app.include_router(product_router, prefix="/api/v1", tags=["Products"])
```

NOTE: Using prefix `/feeds` in product_routes.py means the full path is `/api/v1/feeds/{feed_id}/products` — same URL as the current endpoint in feed_routes.py. The existing `list_products` in feed_routes.py must be REMOVED when product_routes.py takes over, to avoid route conflicts.

**Decision required:** Either (a) move the existing `list_products` from feed_routes.py to product_routes.py + add the new filter endpoint there, or (b) add filter params directly to feed_routes.py and skip a new file. Option (a) matches the plan description ("product_routes.py"). Option (b) is simpler. The plan explicitly says product_routes.py — go with (a).

### Anti-Patterns to Avoid
- **Fetching all products client-side:** 10k products would bloat the client. Always paginate server-side.
- **Using `ilike` with leading wildcard on large datasets without indexes:** Performance is fine for <10k rows per feed but would need the GIN index (already created) for 100k+. Not a concern in Phase 19.
- **Next.js `<Image>` for unknown CDN domains:** Will throw errors for unlisted hostnames. Use `<img>` with onError.
- **Re-fetching filter options on every product fetch:** Fetch brands/categories once when feed is selected, cache in state.
- **Conflicting routes:** If product_routes.py and feed_routes.py both define `GET /feeds/{feed_id}/products`, FastAPI will use whichever is registered first. Remove from feed_routes.py when adding to product_routes.py.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Search debounce | Custom debounce hook | Simple `useEffect` + `setTimeout` | Sufficient for this use case; no dependency needed |
| Distinct values | Raw SQL DISTINCT query | Fetch all + deduplicate in Python | supabase-py v2 lacks native DISTINCT; Python dedup is correct for <10k |
| Pagination UI | Custom pagination component | Simple prev/next buttons with page counter | Library card grids are heavy; simple controls are faster to build and match project style |
| Image fallback | Proxy server for images | `<img onError>` | Simple and effective; avoids backend complexity |

**Key insight:** Phase 19 is primarily a wiring phase — the hard parts (DB schema, indexes, image download, compositor) are done. Most code is connecting existing pieces.

## Common Pitfalls

### Pitfall 1: Route Conflict Between feed_routes.py and product_routes.py
**What goes wrong:** FastAPI silently uses the first-registered route when two routers share the same path. The product browser would be served by the old unfiltered endpoint.
**Why it happens:** Both files use prefix `/feeds` and define `GET /{feed_id}/products`.
**How to avoid:** Remove `list_products` from `feed_routes.py` when creating `product_routes.py`. Alternatively, keep everything in `feed_routes.py` (simpler, fewer files).
**Warning signs:** Filter params have no effect despite being sent in the request.

### Pitfall 2: Pagination Total Count Stale After Filtering
**What goes wrong:** `total` in pagination uses `feed.product_count` (stored on product_feeds row). This is the unfiltered count. When filters are active, the displayed total is wrong.
**Why it happens:** The current `list_products` uses stored `product_count` for the total instead of querying filtered count.
**How to avoid:** For filtered queries, do a separate count query with the same filters, or set `total` to the number of results returned + a hint like "showing filtered results". Supabase count via `.select("count", count="exact")` is the cleanest approach.
**Warning signs:** "Showing page 1 of 200" when filtered to 3 products.

### Pitfall 3: Filter Dropdowns Show Stale or Empty Options
**What goes wrong:** Brand/category dropdowns are empty because the filters endpoint is fetching before the feed sync completes, or because product_type/brand columns contain NULL.
**Why it happens:** `product_type` and `brand` fields are optional in Google Shopping feeds — some products may have NULL.
**How to avoid:** Filter NULLs in the filters endpoint: `if r.get("brand")`. Show "All" as the default dropdown option (value `"all"` maps to no filter param sent).
**Warning signs:** Dropdown shows empty list or includes blank entries.

### Pitfall 4: Image Load Failures Break the Card Grid
**What goes wrong:** Products without `local_image_path` or with broken `image_link` show broken image icons.
**Why it happens:** Image download is non-fatal in Phase 17 — some products may have NULL `local_image_path`. `image_link` (original CDN URL) is always populated from the feed.
**How to avoid:** Use `image_link` as the primary image source (CDN URL, always available). Add `onError` fallback to a local placeholder in `public/`. The backend `local_image_path` is for FFmpeg compositing, not for browser display.
**Warning signs:** Grey broken image icons in the card grid.

### Pitfall 5: Search Fires on Every Keystroke
**What goes wrong:** User types "Pantofi sport" and triggers 12 API calls, causing visible flicker.
**Why it happens:** No debounce on the search input.
**How to avoid:** 400ms debounce with `useEffect` + `clearTimeout` cleanup (see Pattern 4 above).
**Warning signs:** Network tab shows rapid-fire requests while typing.

### Pitfall 6: Profile Not Loaded When Products Fetch
**What goes wrong:** First render fires API call before `X-Profile-Id` header is available, causing 401 or wrong-profile data.
**Why it happens:** `useProfile()` initializes asynchronously; the first `useEffect` may run before `currentProfile` is set.
**How to avoid:** Gate the fetch behind `currentProfile` being set: `if (!currentProfile) return;` at the top of the fetch effect. Pattern established in `settings/page.tsx`.
**Warning signs:** First load always shows empty product list even when products exist.

## Code Examples

Verified patterns from project codebase:

### Supabase ilike Filter (supabase-py v2)
```python
# Source: supabase-py documentation pattern, verified against existing .eq() usage in project
query = supabase.table("products").select("*").eq("feed_id", feed_id)
if search:
    query = query.ilike("title", f"%{search}%")
result = query.execute()
```

### Supabase Count with Filters
```python
# Source: supabase-py v2 count parameter
count_result = supabase.table("products") \
    .select("id", count="exact") \
    .eq("feed_id", feed_id) \
    .execute()
total = count_result.count  # integer
```

### Feed Selector + Products Fetch (Frontend Pattern)
```tsx
// Source: settings/page.tsx and usage/page.tsx patterns
const { currentProfile, isLoading: profileLoading } = useProfile();

useEffect(() => {
  if (!currentProfile) return;
  fetchFeeds();
}, [currentProfile]);

const fetchProducts = useCallback(async () => {
  if (!selectedFeedId) return;
  setLoading(true);
  const params = new URLSearchParams({
    page: String(page),
    page_size: "50",
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(onSale && { on_sale: "true" }),
    ...(category !== "all" && { category }),
    ...(brand !== "all" && { brand }),
  });
  const res = await apiGet(`/feeds/${selectedFeedId}/products?${params}`);
  if (res.ok) {
    const data = await res.json();
    setProducts(data.products);
    setPagination(data.pagination);
  }
  setLoading(false);
}, [selectedFeedId, debouncedSearch, onSale, category, brand, page]);
```

### Product Card (Frontend)
```tsx
// Source: library/page.tsx card pattern
<Card key={product.id} className="overflow-hidden">
  <img
    src={product.image_link || "/placeholder-product.png"}
    alt={product.title}
    className="w-full h-48 object-cover"
    onError={(e) => {
      (e.target as HTMLImageElement).src = "/placeholder-product.png";
    }}
  />
  <CardContent className="p-4">
    <h3 className="font-semibold text-sm truncate">{product.title}</h3>
    <p className="text-xs text-muted-foreground">{product.brand}</p>
    <div className="flex items-center gap-2 mt-2">
      {product.is_on_sale && (
        <Badge variant="destructive" className="text-xs">SALE</Badge>
      )}
      {product.is_on_sale ? (
        <>
          <span className="text-sm font-bold text-green-400">{product.raw_sale_price_str}</span>
          <span className="text-xs text-muted-foreground line-through">{product.raw_price_str}</span>
        </>
      ) : (
        <span className="text-sm font-bold">{product.raw_price_str}</span>
      )}
    </div>
  </CardContent>
</Card>
```

### Navbar Link Addition
```tsx
// Source: frontend/src/components/navbar.tsx
// Add "Products" to navLinks array:
{ label: "Products", href: "/products" },
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side filtering of full dataset | Server-side paginated + filtered queries | Always correct for 10k rows | No memory pressure on client |
| Next.js `pages/` router | App Router with `"use client"` + `useEffect` | Next.js 13+ | New pages go in `src/app/` directory |

**Deprecated/outdated:**
- React Query / SWR: Not used in this project. The codebase uses plain `useState` + `useEffect` + `useCallback` — follow this pattern.

## Open Questions

1. **Where does the existing `list_products` endpoint live after 19-01?**
   - What we know: It currently lives in `feed_routes.py`. Plan 19-01 says to create `product_routes.py`.
   - What's unclear: Should the old endpoint be removed from feed_routes.py and recreated in product_routes.py, or should filter params just be added to the existing endpoint in-place?
   - Recommendation: Move + extend into product_routes.py (cleaner separation). Remove from feed_routes.py. The URL stays identical so no frontend changes needed.

2. **Placeholder image for products without image_link**
   - What we know: `image_link` is always populated from the feed XML, so NULL is unlikely but possible.
   - What's unclear: No `placeholder-product.png` exists in `frontend/public/` yet.
   - Recommendation: Plan 19-02 should create a minimal SVG/PNG placeholder at `frontend/public/placeholder-product.png` as part of the task.

3. **Filter count accuracy with active filters**
   - What we know: Current `list_products` uses `feed.product_count` (unfiltered total) for pagination.
   - Recommendation: For filtered requests, use Supabase `count="exact"` on the filtered query to get accurate total. When no filters are active, use the stored `product_count` (cheaper).

4. **Feed config panel scope**
   - What we know: The plan description says "feed config panel" in the frontend. This likely means: a section showing the current feed's sync status + a "Re-sync" button + the feed selector dropdown.
   - Recommendation: Keep it minimal — feed selector dropdown + sync status badge + re-sync button. Full feed CRUD belongs in a settings page if needed later.

## Sources

### Primary (HIGH confidence)
- Project codebase: `app/api/feed_routes.py` — confirmed existing endpoint structure, Supabase query patterns, profile context
- Project codebase: `supabase/migrations/013_create_product_tables.sql` — confirmed schema, columns, indexes
- Project codebase: `frontend/src/app/tts-library/page.tsx`, `settings/page.tsx`, `usage/page.tsx` — confirmed frontend patterns
- Project codebase: `frontend/src/lib/api.ts` — confirmed API client with X-Profile-Id injection
- Project codebase: `frontend/next.config.ts` — confirmed only `gomagcdn.ro` is allowlisted for Next.js Image
- Project codebase: `frontend/src/components/navbar.tsx` — confirmed nav link pattern

### Secondary (MEDIUM confidence)
- supabase-py v2 documentation pattern: `.ilike()` method for case-insensitive search — consistent with established `.eq()` usage in project
- supabase-py v2: `count="exact"` parameter in `.select()` — standard supabase-py feature

### Tertiary (LOW confidence)
- None — all findings verified against project codebase or established supabase-py patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and in use
- Architecture: HIGH — patterns directly derived from existing project code
- Pitfalls: HIGH — derived from known Phase 17 design decisions and supabase-py behavior

**Research date:** 2026-02-21
**Valid until:** 2026-03-21 (stable stack)
