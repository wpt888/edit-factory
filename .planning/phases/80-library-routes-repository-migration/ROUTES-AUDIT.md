# Phase 80 — Library Routes Migration Audit

**Source:** `app/api/library_routes.py` (27 `repo.get_client()` call sites)
**Pattern taxonomy:** `.planning/v13-desktop-production/ARCHITECTURE.md` §1 (A=chained, B=count, C=complex OR/maybe_single/join, D=RPC/raw SQL)

## Site-by-site table

| # | Line | Route / Helper | Tables touched | Operations | Pattern | Target method | Method exists? | Owner plan |
|---|------|----------------|----------------|------------|---------|---------------|----------------|------------|
| 1 | 442  | GET /clips/{id}/srt | editai_clips, editai_clip_content | select | A | repo.get_clip + repo.get_clip_content | Y | 80-01 |
| 2 | 471  | GET /clips/{id}/audio | editai_clips, editai_clip_content | select | A | repo.get_clip + repo.get_clip_content | Y | 80-01 |
| 3 | 509  | GET /clips/{id}/download | editai_clips | select | A | repo.get_clip | Y | 80-01 |
| 4 | 1056 | _generate_raw_clips_task (variant_index max) | editai_clips | select (max) | A | repo.list_clips(filters=eq{is_deleted:False, profile_id}) + max() in Python | Y | 80-01 |
| 5 | 1174 | /projects/{id}/generate-from-segments | editai_project_segments + nested editai_segments + editai_source_videos | select with nested join | C | new repo.list_project_segments_with_source(project_id) OR refactor to 3 calls | N | 80-02 |
| 6 | 1427 | _generate_from_segments_task | editai_clips, editai_projects, editai_project_segments (nested) | select max + update + nested join | C | combined with site #5 + repo.update_project | mixed | 80-02 |
| 7 | 1889 | GET /tags | editai_clips | select tags | A | repo.list_clips_by_profile(filters=eq{is_deleted:False}, select=`tags`) | Y | 80-01 |
| 8 | 2002 | GET /all-clips | editai_clips (count) + editai_clips (nested join with editai_projects) + editai_clip_content (in_) | count + select + nested join + cursor/offset | C | new repo.count_clips + new repo.list_clips_with_project_info OR refactor | partial | 80-02 |
| 9 | 2129 | POST /sync-orphans | (delegates to _sync_orphan_clips helper) | helper rewrite | C | refactor helpers to use repo | N | 80-02 |
| 10 | 2308 | POST /clips/{id}/remove-audio | editai_clips (select + update), editai_clip_content (update) | select + 2 updates | A | repo.get_clip + repo.update_clip + repo.update_clip_content | Y | 80-01 |
| 11 | 2402 | DELETE /clips/{id} | editai_clips, editai_clip_content | select + 2 deletes | A | repo.get_clip + repo.delete_clip_content_by_clip_ids + repo.delete_clip | Y | 80-01 |
| 12 | 2436 | POST /clips/bulk-delete | editai_clips (in_ select) + cascade delete | in_ select + 2 in_ deletes | C | new method OR loop + repo.delete_clips_by_ids + repo.delete_clip_content_by_clip_ids | mostly Y | 80-01 (loop approach) |
| 13 | 2497 | GET /trash | editai_clips (deleted) + editai_projects (in_) | select + in_ select for project names | A/C | repo.list_clips_by_profile(eq={is_deleted:True}) + per-clip repo.get_project | Y | 80-01 |
| 14 | 2534 | DELETE /trash/empty | editai_clips + cascade delete | select + 2 in_ deletes | C | repo.list_clips_by_profile + repo.delete_clip_content_by_clip_ids + repo.delete_clips_by_ids | Y | 80-01 |
| 15 | 2562 | POST /clips/{id}/restore | editai_clips | select + update | A | repo.get_clip + repo.update_clip | Y | 80-01 |
| 16 | 2611 | DELETE /clips/{id}/permanent | editai_clips, editai_clip_content | select + 2 deletes | A | repo.get_clip + repo.delete_clip_content_by_clip_ids + repo.delete_clip | Y | 80-01 |
| 17 | 2642 | PUT /clips/{id}/content | editai_clips (ownership) + editai_clip_content (upsert) | select + upsert | A | repo.get_clip + repo.create_clip_content OR repo.update_clip_content | Y | 80-01 |
| 18 | 2687 | POST /clips/{id}/content/copy-from/{src} | 2x editai_clips + editai_clip_content | 3 selects + upsert | A | repo.get_clip x2 + repo.get_clip_content + repo.create_clip_content/update | Y | 80-01 |
| 19 | 2738 | GET /export-presets | editai_export_presets with or_ filter | select with `.or_("profile_id.eq.{X},profile_id.is.null")` | A | **repo.list_export_presets(profile_id)** — existing ABC method; SQLite impl at sqlite_repo.py:844 ALREADY emits `("profile_id" = ? OR "profile_id" IS NULL)` so the route gets identical semantics for free | Y | 80-01 |
| 20 | 2795 | POST /maintenance/cleanup-exports | editai_exports | delete with lt + eq | B | new repo.delete_exports_older_than(profile_id, cutoff_iso) | N | 80-01 |
| 21 | 2841 | POST /clips/{id}/render | editai_clips + editai_clip_content + editai_export_presets | 3 selects | A | repo.get_clip + repo.get_clip_content + new repo.get_export_preset_by_name | partial | 80-01 |
| 22 | 2936 | POST /clips/{id}/regenerate-voiceover | editai_clips + editai_clip_content | 2 selects | A | repo.get_clip + repo.get_clip_content | Y | 80-01 |
| 23 | 3009 | _regenerate_voiceover_task | editai_clips (update) + editai_clip_content (upsert) | update + upsert | A | repo.update_clip + repo.create_clip_content/update | Y | 80-01 |
| 24 | 3360 | _render_final_clip_task initial fetch | (no actual query — only assigns supabase) | DEAD after migration | A | DELETE block; switch downstream to repo directly | Y | 80-02 |
| 25 | 3367 | _render_final_clip_task retry inside loop | DEAD CODE — retries fetching client | — | DELETE block | — | 80-02 |
| 26 | 3376 | _render_final_clip_task last-ditch | editai_clips update on critical failure | DEAD wrapper; the inner table().update() must become repo.update_clip | A | repo.update_clip(clip_id, {"final_status": "failed"}) | Y | 80-02 |
| 27 | 3891 | _start_render_for_clip helper | editai_clips + editai_clip_content + editai_export_presets | 3 selects | A | repo.get_clip + repo.get_clip_content + new repo.get_export_preset_by_name | partial | 80-02 |

## Out of scope for grep gate

Also flagged but NOT a `get_client()` site — note (do NOT migrate in this phase): lines 952-955 `from app.db import get_supabase` direct fallback in `_generate_raw_clips_task`. Same anti-pattern, but doesn't fail the grep gate per success criterion 1.

## Helpers with supabase parameter

These helpers TAKE a supabase client as parameter. Plan 80-02 must refactor their signatures to take `repo` or operate via `get_repository()` internally:

- `_sync_orphan_clips(profile_id, supabase)` line 1938
- `_get_or_create_sync_project(supabase, profile_id)` line 1912
- `_increment_segment_usage(supabase_client, segment_ids)` line 3965
- `_render_final_clip_task` (extensive supabase usage in body — see next section)

## In-body supabase.table() calls inside _render_final_clip_task

These are NOT `get_client()` lines but reference the `supabase` variable that becomes undefined after the dead retry block is removed. Each MUST be migrated in Plan 80-02 Task 3:

- Line 3395: `supabase.table("editai_clips").update(...)` → `repo.update_clip(clip_id, {...})` — set status processing (lock-held branch)
- Line 3407: `supabase.table("editai_clips").update(...)` → `repo.update_clip(clip_id, {...})` — set status processing (lock-contended branch)
- Line 3416: `supabase.table("editai_clips").update(...)` → `repo.update_clip(clip_id, {...})` — set status processing (no-project-id branch)
- Line 3567: `supabase.table("editai_clip_content").upsert(...)` with `on_conflict="clip_id"` → `repo.update_clip_content(clip_id, {"tts_timestamps": ..., "tts_model": ..., "updated_at": ...})` (update_clip_content handles upsert semantics in both backends)
- Line 3607: `supabase.table("editai_clip_content").upsert(...)` with `on_conflict="clip_id"` → `repo.update_clip_content(clip_id, {"tts_audio_path": ..., "updated_at": ...})`
- Line 3652: `_extend_video_with_segments(..., supabase=supabase, ...)` — this helper takes `supabase` as a parameter. Either remove the parameter (helper calls `get_repository()` internally) OR pass `repo` instead. Plan 80-02 decides.
- Line 3772: `supabase.table("editai_clips").update(...)` → `repo.update_clip(clip_id, {"final_video_path": ..., "final_status": "completed", "updated_at": ...})`
- Line 3780: `supabase.table("editai_exports").insert(...)` → `repo.create_export({"clip_id": ..., "preset_name": ..., "output_path": ..., "file_size": ..., "status": "completed"})`
- Line 3798: `supabase.table("editai_clips").update(...)` (in the except block) → `repo.update_clip(clip_id, {"final_status": "failed", "updated_at": ...})`

After Plan 80-02 Task 3, the `supabase` variable name MUST NOT appear in `_render_final_clip_task` body except possibly as a stale parameter name in helper docstrings.

## Summary

| Pattern | Count | Owner |
|---------|-------|-------|
| A (simple chained) | 17 | 80-01 |
| B (count/aggregate) | 1 | 80-01 |
| C (complex OR/join/maybe_single) | 6 | 80-02 |
| D (RPC/raw SQL) | 0 in get_client() sites; 1 separate (_increment_segment_usage, line 3975 — RPC) | 80-02 |
| DEAD CODE (no real query) | 3 (3360/3367/3376) | 80-02 |

Plan 80-01 owns sites 1-4, 7, 10-23 = **19 sites** total (including site #19 export-presets). Plan 80-02 owns sites 5, 6, 8, 9, 24-27 = **8 sites** total, PLUS the 8 in-body `supabase.table()` lines enumerated above.

## New ABC methods required (additions in this plan)

| Method | Signature | Rationale | Implemented in |
|--------|-----------|-----------|----------------|
| `count_clips` | `count_clips(self, profile_id: str, filters: Optional[QueryFilters] = None) -> int` | line 2002 `select("id", count="exact")` for /all-clips total | both backends |
| `get_export_preset_by_name` | `get_export_preset_by_name(self, name: str) -> Optional[Dict[str, Any]]` | lines 2873, 3907 preset lookup by name | both backends |
| `delete_exports_older_than` | `delete_exports_older_than(self, profile_id: str, cutoff_iso: str) -> int` | line 2797 `delete().lt("created_at", cutoff).eq("profile_id", ...)` | both backends |
| `get_project_by_name` | `get_project_by_name(self, profile_id: str, name: str) -> Optional[Dict[str, Any]]` | line 1914 orphan-sync "Imported from disk" lookup | both backends |
| `increment_segment_usage` | `increment_segment_usage(self, segment_ids: List[str]) -> None` | line 3975 RPC `increment_segment_usage_batch` + fallback. Used downstream of Plan 80-02. | both backends |

## New ABC methods deferred to Plan 80-02 (executor will add or refactor)

- `list_project_segments_with_source(project_id)` — OR refactor route to do `list_project_segments` + per-segment `get_segment` + `get_source_video`. Plan 80-02 decides during execution.
- `list_clips_with_project_info(profile_id, ...)` — OR refactor /all-clips to do `list_clips_by_profile` + collect project_ids + bulk `get_project`.
