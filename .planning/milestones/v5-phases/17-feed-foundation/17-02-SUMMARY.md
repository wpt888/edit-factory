---
phase: 17-feed-foundation
plan: "02"
subsystem: product-image-pipeline
tags: [image-download, ffmpeg, romanian-diacritics, async, placeholder, textfile-pattern]
dependency_graph:
  requires: []
  provides: [image_fetcher, textfile_helper]
  affects: [phase-18-video-compositor]
tech_stack:
  added: [httpx-async]
  patterns: [asyncio-semaphore-concurrency, ffmpeg-textfile-utf8, disk-cache-skip]
key_files:
  created:
    - app/services/image_fetcher.py
    - app/services/textfile_helper.py
  modified: []
decisions:
  - "textfile= pattern (not text=) is the canonical approach for all product text in FFmpeg — prevents diacritic corruption"
  - "Semaphore(5) concurrency cap balances throughput vs CDN politeness for parallel downloads"
  - "Gray placeholder via FFmpeg lavfi instead of Python Pillow — keeps dependencies minimal"
metrics:
  duration: "2 minutes"
  completed: "2026-02-20"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 17 Plan 02: Image Downloader + FFmpeg textfile= Helper Summary

**One-liner:** Parallel httpx image downloader with Semaphore(5) + FFmpeg lavfi placeholder, plus UTF-8 textfile= helper verified with Romanian diacritics (ă î ș ț â Ș Ț).

## What Was Built

Two independent utilities required by all downstream video composition phases (Phase 18+):

### 1. `app/services/image_fetcher.py`
Async parallel image downloader with:
- `download_product_images(products, cache_dir, feed_id)` — async entry point
- `asyncio.Semaphore(5)` concurrency cap (CONCURRENT_DOWNLOADS constant)
- `httpx.Timeout(10.0, connect=3.0)` — aggressive timeouts to skip slow CDNs
- Disk cache: if `{cache_dir}/{feed_id}/{external_id}.jpg` exists, skips re-download
- WebP handling: saves `.webp`, runs `ffmpeg -y -i input.webp output.jpg`, deletes `.webp`
- Placeholder fallback: `_make_placeholder()` creates 400x400 gray JPEG via FFmpeg lavfi on any failure
- `update_local_image_paths(supabase, image_map, feed_id)` — writes local paths back to `products` table

### 2. `app/services/textfile_helper.py`
FFmpeg `textfile=` pattern helper with:
- `build_drawtext_filter(text, ...)` — writes text to UTF-8 temp file, returns `(filter_string, tmp_path)`
- `build_multi_drawtext(texts)` — multiple overlays joined with `,` for single `-vf` argument
- `cleanup_textfiles(*paths)` — removes temp files, swallows FileNotFoundError
- Caller manages temp file lifecycle (documented in docstrings)

## Verifications Passed

1. `from app.services.image_fetcher import download_product_images` — OK
2. `from app.services.textfile_helper import build_drawtext_filter` — OK
3. Placeholder JPEG created at `/tmp/test_placeholder.jpg`, confirmed on disk — OK
4. FFmpeg + textfile= with `"Preț special: Șoșete bărbați — 149,99 RON"` produces valid MP4 (exit code 0) — OK
5. Cache structure `output/product_images/{feed_id}/{external_id}.jpg` confirmed in code — OK
6. `build_multi_drawtext` with 2 overlays produces comma-joined filter string + 2 temp paths — OK

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 45f237f | feat(17-02): parallel image downloader with placeholder fallback |
| Task 2 | 65ff443 | feat(17-02): FFmpeg textfile= helper for Romanian diacritics |

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. **textfile= as the canonical pattern:** Phase 18 must never use `text=` for product content. The `textfile=` pattern via `build_drawtext_filter` is the only supported approach for text overlays in the product pipeline.

2. **Semaphore(5) fixed concurrency:** Chosen as a balance between throughput and CDN politeness. Can be tuned via the `CONCURRENT_DOWNLOADS` constant if needed.

3. **FFmpeg lavfi for placeholders (not Pillow):** Keeps the image pipeline dependency-free beyond httpx. FFmpeg is already required for video processing, so no new dependency is introduced.

## Self-Check: PASSED

- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/image_fetcher.py` — exists
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/textfile_helper.py` — exists
- Commit 45f237f — verified (feat(17-02): parallel image downloader)
- Commit 65ff443 — verified (feat(17-02): FFmpeg textfile= helper)
