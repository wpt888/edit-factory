# Uncommitted Changes Audit

**Date**: 2026-02-26
**Branch**: `main` (up to date with `origin/main`)
**Staged changes**: None
**Modified files**: 10
**Untracked files**: ~30+

---

## 1. Modified Files (Unstaged)

### 1.1 `app/api/pipeline_routes.py`

**What changed**:
- Imports `strip_product_group_tags` from assembly_service
- Adds `words_per_subtitle: int = 2` field to `PipelineRenderRequest` and `PipelineTtsRequest` models
- TTS cache invalidation now strips `[ProductGroup]` tags before hashing, so tag-only edits don't invalidate TTS audio
- `generate_variant_tts` strips tags before sending text to TTS (tags must not be spoken)
- `preview_variant` passes `words_per_subtitle` as `max_words_per_phrase` to assembly service
- `render_variants` uses cleaned text for hash comparison and passes `words_per_subtitle` through to render

**Status**: COMPLETE. All code paths that touch script text (TTS generation, preview, render, cache invalidation) consistently strip product group tags. The `words_per_subtitle` parameter is threaded through all three flows (individual TTS, preview, render).

**Potential issues**: None. The default of 2 matches the new default in `tts_subtitle_generator.py`.

**Recommendation**: COMMIT

---

### 1.2 `app/api/postiz_routes.py`

**What changed**:
- New `PostizIntegrationSummary` model (name, type, picture)
- `PostizStatusResponse` gains `integrations: List[PostizIntegrationSummary]` field
- `get_postiz_status` endpoint now populates the integrations list (filtered to non-disabled)

**Status**: COMPLETE. Clean addition to expose integration details to the frontend for the connection indicator badge.

**Potential issues**: None.

**Recommendation**: COMMIT

---

### 1.3 `app/api/segments_routes.py`

**What changed**:
- New endpoint `GET /product-groups-bulk` that fetches product groups for multiple source video IDs in one query (comma-separated IDs via query param)
- Returns `List[ProductGroupResponse]` with segment counts per group

**Status**: COMPLETE. Avoids N+1 queries from the pipeline page. Uses `.in_()` for multi-video fetch.

**Potential issues**: The inner loop still does N queries (one per group) to count segments. For large numbers of groups this could be slow, but acceptable for typical usage.

**Recommendation**: COMMIT

---

### 1.4 `app/services/assembly_service.py`

**What changed**:
- New top-level function `strip_product_group_tags(text)` -- removes `[Tag]` patterns
- New function `build_word_to_group_map(text)` -- maps each word to its product group based on tag positions
- New function `assign_groups_to_srt(script_text, srt_entries)` -- assigns product group to each SRT entry by matching words back to the tagged script
- `generate_srt_from_timestamps` gains `max_words_per_phrase` parameter
- `match_srt_to_segments` gains `srt_product_groups` parameter -- when a group is forced, only segments from that group are considered
- Unmatched segment fallback logic respects forced groups from tags
- Full pipeline (`assemble_video`) and preview pipeline (`preview_assembly`) both strip tags before TTS and assign groups to SRT entries
- `max_words_per_phrase` threaded through both pipelines

**Status**: COMPLETE. This is the core Product Groups feature implementation. The word-to-group mapping algorithm handles sequential matching with lookahead, majority voting for multi-word SRT entries, and fallback to broader scan. All three public methods (`assemble_video`, `preview_assembly`, `match_srt_to_segments`) are updated.

**Potential issues**:
- `assign_groups_to_srt` uses sequential word matching which could drift if SRT words don't match cleaned words exactly (e.g., hyphenation, contractions). The broader scan fallback mitigates this.
- Type ignore comment on line with `max(non_none, key=non_none.get)` is acceptable.

**Recommendation**: COMMIT

---

### 1.5 `app/services/postiz_service.py`

**What changed**:
- Removes fallback to global env vars (`POSTIZ_API_URL`, `POSTIZ_API_KEY`) in both `get_postiz_publisher()` and `is_postiz_configured()`
- Error message changed to Romanian: "Configurează Postiz în Settings."
- `is_postiz_configured()` now returns `False` if no profile-level config found (no env var fallback)

**Status**: COMPLETE. Intentional change to enforce per-profile Postiz configuration rather than relying on global env vars.

**Potential issues**:
- Breaking change for users who relied on env vars for Postiz. However, this aligns with the multi-profile architecture where each profile has its own settings.
- Romanian error message is consistent with the app's UI language.

**Recommendation**: COMMIT

---

### 1.6 `app/services/tts_subtitle_generator.py`

**What changed**:
- Default `max_chars_per_phrase` changed from 40 to 20
- Default `max_words_per_phrase` changed from 7 to 2

**Status**: COMPLETE. Aligns with the new "words per subtitle" slider default of 2 (TikTok-style short subtitles).

**Potential issues**: This changes the default for ALL callers, not just the pipeline. Any code path that calls `generate_srt_from_timestamps` without explicit params will now get 2-word subtitles. This is likely intentional but worth noting.

**Recommendation**: COMMIT

---

### 1.7 `frontend/src/app/librarie/page.tsx`

**What changed**:
- Imports `AlertCircle` and `Link` icons
- New `postizStatus` state tracking connection status with integrations list
- `fetchPostizStatus()` called on mount alongside `fetchAllClips()`
- New Postiz connection indicator badge (green "connected" or red "neconfigurat") above filters
- Bulk upload and per-clip Postiz buttons disabled when `!postizStatus?.connected`
- Buttons show tooltip with Postiz URL or "neconfigurat" message

**Status**: COMPLETE. Clean UX improvement -- users see Postiz connection state and buttons are disabled when not configured.

**Potential issues**: None.

**Recommendation**: COMMIT

---

### 1.8 `frontend/src/app/pipeline/page.tsx`

**What changed**:
- New `wordsPerSubtitle` state (default 2), persisted to localStorage
- New `productGroups` state fetched via bulk endpoint when source videos change
- `countWords()` now strips `[ProductGroup]` tags before counting
- `insertGroupTag()` inserts `[GroupLabel]\n` at cursor position in script textarea
- `detectGroupTags()` extracts unique tag names from script text
- `words_per_subtitle` param sent in TTS generation, preview, and render requests
- Voice settings panel gains "Cuvinte per subtitrare" slider (1-4, step 1)
- Script textareas gain `id` attributes for cursor positioning
- Each script card shows "Insert Group Tag" dropdown and detected tag badges (with color dots)

**Status**: COMPLETE. Full Product Groups UI in the pipeline page: tag insertion dropdown, tag visualization with colors, word count excluding tags, subtitle grouping slider.

**Potential issues**:
- The `Select` component's `onValueChange` fires `insertGroupTag` but the Select doesn't reset its displayed value after insertion. The `placeholder` will re-appear since no controlled value is set, which is acceptable behavior.

**Recommendation**: COMMIT

---

### 1.9 `frontend/src/app/segments/page.tsx`

**What changed**:
- New `handleGroupCreateFromTimeline(start, end)` function that pre-fills start/end times and opens the group dialog
- Passes `onGroupCreate` callback to `VideoSegmentPlayer` component
- Group label input gains `autoFocus` and Enter key handler for quick creation

**Status**: COMPLETE. Enables creating product groups directly from the video timeline via the G key shortcut.

**Potential issues**: None.

**Recommendation**: COMMIT

---

### 1.10 `frontend/src/components/video-segment-player.tsx`

**What changed**:
- Imports `Layers` icon
- New `onGroupCreate` prop (optional callback)
- New `groupMarkStart` / `isGroupMarking` state for group range marking
- `cancelMark` also cancels group marking
- New `toggleGroupMark()` function (mirrors `toggleMark` but for groups)
- `G` key bound to `toggleGroupMark`
- Purple dashed range indicator on timeline during group marking
- Purple start point marker on timeline
- "Group (G)" button in controls bar (only shown when `onGroupCreate` is provided)
- Keyboard shortcuts help updated with "G Mark Group"

**Status**: COMPLETE. Clean implementation parallel to the existing segment marking (C key). Purple visual distinction from the yellow/green segment markers.

**Potential issues**: None.

**Recommendation**: COMMIT

---

## 2. Untracked Files

### 2.1 Cleanup Candidates (DELETE)

| File | Reason |
|------|--------|
| `.backend.pid` | Runtime PID file, should not be committed. Add to `.gitignore`. |
| `.venv-wsl/` | Virtual environment directory. Already have `.venv/` in gitignore but this variant is not covered. Add `.venv-wsl/` to `.gitignore`. |
| `app/api/library_routes.py.backup` | Old backup file. No longer needed. |
| `update_library_routes.py` | One-time migration script for adding profile context. Already applied. |
| `supabase/.temp/` | Supabase CLI temp directory. Add to `.gitignore`. |
| `pipeline-fix-bottom-buttons.png` | Debug screenshot in repo root. |
| `pipeline-fix-preview-button.png` | Debug screenshot in repo root. |
| `pipeline-history-green-badges.png` | Debug screenshot in repo root. |
| `pipeline-source-videos-2.png` | Debug screenshot in repo root. |
| `pipeline-step1.png` | Debug screenshot in repo root. |
| `pipeline-step2-tts-loaded.png` | Debug screenshot in repo root. |
| `segments-fix-verified.png` | Debug screenshot in repo root. |
| `segments-list-select.png` | Debug screenshot in repo root. |
| `segments-page-empty.png` | Debug screenshot in repo root. |
| `segments-timeline-click.png` | Debug screenshot in repo root. |
| `segments-with-data.png` | Debug screenshot in repo root. |
| `tts-library-batched.png` | Debug screenshot in repo root. |
| `tts-library-collapsed.png` | Debug screenshot in repo root. |
| `tts-library-empty.png` | Debug screenshot in repo root. |
| `tts-library-expanded.png` | Debug screenshot in repo root. |
| `tts-library-updated.png` | Debug screenshot in repo root. |
| `tts-library-v2.png` | Debug screenshot in repo root. |

**Total: 17 PNG screenshots + 4 misc files to delete.**

### 2.2 Untracked Test Files (DECIDE: commit or delete)

| File | Notes |
|------|-------|
| `frontend/tests/screenshot-inline-preview.spec.ts` | One-off Playwright screenshot test |
| `frontend/tests/screenshot-pipeline-debug.spec.ts` | One-off Playwright screenshot test |
| `frontend/tests/screenshot-pipeline-overlap.spec.ts` | One-off Playwright screenshot test |
| `frontend/tests/screenshot-settings.spec.ts` | One-off Playwright screenshot test |
| `frontend/tests/screenshot-source-picker.spec.ts` | One-off Playwright screenshot test |
| `frontend/tests/screenshot-tts-preview.spec.ts` | One-off Playwright screenshot test |
| `frontend/tests/screenshot-voice-settings.spec.ts` | One-off Playwright screenshot test |

These are verification screenshot tests created during development. Some similar tests are already tracked (e.g., `screenshot-workflow.spec.ts`). Decision: either commit all screenshot tests or delete the untracked ones for consistency. Leaning toward **delete** since they were ad-hoc verification tools, not regression tests.

### 2.3 Planning/Debug Files (KEEP but don't commit)

| File | Notes |
|------|-------|
| `.planning/debug/audit-v8-post.md` | Post-v8 audit notes |
| `.planning/debug/pipeline-bugs-audit.md` | Pipeline bug tracking |
| `.planning/debug/resolved/pipeline-step2-audit.md` | Resolved audit |

These are internal planning docs. The `.planning/` directory is already untracked. Keep locally but don't commit.

---

## 3. Gitignore Additions Needed

The following patterns should be added to `.gitignore`:

```
.backend.pid
.venv-wsl/
*.backup
supabase/.temp/
*.png
```

Note: Adding `*.png` would cover all root-level screenshots. If screenshots in subdirectories (like `frontend/screenshots/`) should be tracked, use a more specific pattern like `/*.png` instead.

---

## 4. Summary

### All 10 modified files are COMPLETE and ready to commit.

The changes form two coherent features:

1. **Product Groups in Pipeline** (7 files): Script tagging with `[GroupLabel]`, tag-aware TTS (tags stripped before speech), group-aware SRT-to-segment matching, timeline group creation via G key, "words per subtitle" slider
2. **Postiz UX improvements** (3 files): Connection status indicator on library page, per-profile enforcement (no env var fallback), integration details in status response

### Recommended commit strategy:

**Option A** -- Single commit:
```
feat: product groups pipeline support + Postiz connection indicator
```

**Option B** -- Two commits:
```
feat(pipeline): product group tags in scripts with group-aware segment matching
feat(library): Postiz connection status indicator and per-profile enforcement
```

### Cleanup actions:
1. Delete 17 PNG screenshots from repo root
2. Delete `app/api/library_routes.py.backup`
3. Delete `update_library_routes.py`
4. Delete 7 untracked screenshot test files (or commit if desired)
5. Update `.gitignore` with `.backend.pid`, `.venv-wsl/`, `supabase/.temp/`, `*.backup`
