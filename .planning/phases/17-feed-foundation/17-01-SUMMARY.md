---
phase: 17-feed-foundation
plan: 01
subsystem: api
tags: [google-shopping, xml-feed, lxml, iterparse, supabase, product-catalog, rls]

# Dependency graph
requires:
  - phase: 17-02
    provides: image_fetcher.py (download_product_images, update_local_image_paths) called from sync background task
provides:
  - supabase/migrations/013_create_product_tables.sql — product_feeds + products tables with indexes and RLS
  - app/services/feed_parser.py — streaming XML parser, clean_product_text, parse_price, upsert_products
  - app/api/feed_routes.py — Feed CRUD (POST/GET/DELETE /feeds) + /sync + /products pagination endpoints
  - app/main.py — feed_router mounted at /api/v1
affects:
  - 18-compositor (uses product image_link + local_image_path)
  - 19-product-browser (uses products table + all 5 indexes)
  - 20-e2e-single (reads product data for video generation)
  - 21-batch (reads feed products in bulk)

# Tech tracking
tech-stack:
  added:
    - lxml>=5.0.0 (streaming XML parser — iterparse for memory-safe 10k feed parsing)
  patterns:
    - Background task: set sync_status='syncing' before task, idle/error after — follows existing render pattern
    - Memory-safe XML: lxml iterparse + elem.clear() + parent cleanup per element
    - 2-pass HTML cleaning: strip tags, unescape entities, strip tags again (handles &lt;b&gt; encoded tags)
    - Romanian price format: detect dot-thousands/comma-decimal by position of last separator

key-files:
  created:
    - supabase/migrations/013_create_product_tables.sql
    - app/services/feed_parser.py
    - app/api/feed_routes.py
  modified:
    - app/main.py (added feed_router import + include_router)
    - requirements.txt (added lxml>=5.0.0)

key-decisions:
  - "2-pass HTML stripping in clean_product_text — first strip then unescape then strip again, handles entity-encoded tags like &lt;b&gt;"
  - "lxml iterparse with event='end' and tag filter — only materializes one element at a time, never loads full XML tree"
  - "Sync background task: image download failure is non-fatal — products already upserted even if images fail"
  - "Concurrent sync prevention: 409 Conflict if sync_status='syncing' when POST /feeds/{id}/sync called"
  - "page_size clamped to max 200 in products listing endpoint — prevents runaway queries before Phase 19 adds cursor pagination"

patterns-established:
  - "Feed sync pattern: immediate status update (syncing) → background task → success/error status update"
  - "Ownership check before mutation: verify profile_id match before DELETE/sync operations"
  - "Image download imported lazily inside background task to avoid circular import risk"

requirements-completed: [FEED-01, FEED-07]

# Metrics
duration: 6min
completed: 2026-02-20
---

# Phase 17 Plan 01: Feed Foundation Summary

**Google Shopping XML feed parser with lxml iterparse (memory-safe for 10k products), Supabase product_feeds + products tables with RLS, and REST CRUD + async sync API at /api/v1/feeds**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-20T21:10:18Z
- **Completed:** 2026-02-20T21:16:20Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- product_feeds and products tables created in Supabase with 5 product indexes and RLS policies (profile ownership chain)
- Streaming XML parser using lxml iterparse handles RSS and Atom formats, strips HTML, parses Romanian price formats
- Feed CRUD API: POST/GET/DELETE /feeds, GET /feeds/{id}, POST /feeds/{id}/sync, GET /feeds/{id}/products with pagination
- Sync background task: download XML → parse → upsert 500-row batches → download product images

## Task Commits

Each task was committed atomically:

1. **Task 1: Database migration for product_feeds and products tables** - `020d950` (feat)
2. **Task 2: Feed parser service + feed API routes** - `5f0aacd` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `supabase/migrations/013_create_product_tables.sql` - product_feeds + products tables, 5 indexes, RLS, updated_at triggers
- `app/services/feed_parser.py` - parse_feed_xml (streaming iterparse), clean_product_text, parse_price, upsert_products
- `app/api/feed_routes.py` - Full feed CRUD, sync endpoint with BackgroundTasks, paginated products listing
- `app/main.py` - Added feed_router import and include_router at /api/v1
- `requirements.txt` - Added lxml>=5.0.0

## Decisions Made

- 2-pass HTML stripping: strip tags → unescape entities → strip tags again. Required because Google Shopping feeds sometimes HTML-encode their HTML tags (e.g. `&lt;b&gt;text&lt;/b&gt;`)
- Image download failure is non-fatal: products are already upserted even if image downloads fail. Image availability is a bonus for Phase 18, not a sync prerequisite
- Concurrent sync prevention: returns HTTP 409 if feed is already syncing to prevent race conditions
- page_size capped at 200 for products endpoint — a safety limit before Phase 19 adds proper cursor pagination

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added lxml to requirements.txt and installed in venv**
- **Found during:** Task 2 (feed parser implementation)
- **Issue:** lxml was required by feed_parser.py but absent from requirements.txt and venv
- **Fix:** `pip install lxml` in .venv-wsl; added `lxml>=5.0.0` to requirements.txt
- **Files modified:** requirements.txt
- **Verification:** `python3 -c "import lxml"` succeeds; feed_parser imports cleanly
- **Committed in:** 5f0aacd (Task 2 commit)

**2. [Rule 1 - Bug] Fixed clean_product_text to use 2-pass tag stripping**
- **Found during:** Task 2 verification (`clean_product_text('&lt;b&gt;Pește&lt;/b&gt; &amp; chips')`)
- **Issue:** Single-pass implementation stripped real `<tag>` characters before unescaping — but Google Shopping feeds may use entity-encoded tags that only become `<tag>` after `html.unescape()`. Plan's test required the double-encoded input to produce clean text
- **Fix:** Added second `re.sub(r'<[^>]+>', '', cleaned)` pass after `html.unescape()`
- **Files modified:** app/services/feed_parser.py
- **Verification:** All plan verification assertions pass
- **Committed in:** 5f0aacd (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both required for correctness. No scope creep.

## Issues Encountered

- MCP `exec_sql` required using the SSE-compatible `Accept: application/json, text/event-stream` header — standard JSON-only Accept header returned 406. Applied migration via direct HTTP call to `/mcp` endpoint with correct headers.

## User Setup Required

None - migration was applied directly to Supabase via MCP execute_sql.

## Next Phase Readiness

- product_feeds and products tables live in Supabase — Phase 18 compositor can read product image URLs
- Feed CRUD API operational — feed URLs can be registered immediately
- Sync endpoint ready — XML feeds can be parsed and products stored
- Phase 19 product browser has all required indexes (brand, product_type, is_on_sale, GIN title search)

---
*Phase: 17-feed-foundation*
*Completed: 2026-02-20*
