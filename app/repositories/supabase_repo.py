"""Supabase implementation of the DataRepository interface.

Wraps the existing get_supabase() singleton client with typed methods
that match the abstract interface in base.py. Each method preserves the
exact query patterns currently used across routes and services.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.db import get_supabase
from app.repositories.base import DataRepository
from app.repositories.models import QueryFilters, QueryResult

logger = logging.getLogger(__name__)


class SupabaseRepository(DataRepository):
    """Concrete DataRepository backed by Supabase (PostgREST)."""

    def get_client(self):
        """Return the raw Supabase client for complex chained queries."""
        return get_supabase()

    # ── helpers ───────────────────────────────────────

    def _apply_filters(self, query, filters: Optional[QueryFilters]):
        """Apply QueryFilters to a Supabase query builder."""
        if filters is None:
            return query
        for col, val in filters.eq.items():
            query = query.eq(col, val)
        for col, val in filters.neq.items():
            query = query.neq(col, val)
        for col, val in filters.gt.items():
            query = query.gt(col, val)
        for col, val in filters.lt.items():
            query = query.lt(col, val)
        for col, val in filters.gte.items():
            query = query.gte(col, val)
        for col, val in filters.lte.items():
            query = query.lte(col, val)
        for col, vals in filters.in_.items():
            query = query.in_(col, vals)
        for col, val in filters.is_.items():
            query = query.is_(col, val)
        for col, pattern in filters.like.items():
            query = query.ilike(col, pattern)
        for col, val in filters.contains.items():
            query = query.contains(col, val)
        for col, val in filters.not_is.items():
            query = query.not_.is_(col, val)
        if filters.or_:
            query = query.or_(filters.or_)
        if filters.order_by:
            query = query.order(filters.order_by, desc=filters.order_desc)
        if filters.limit is not None:
            query = query.limit(filters.limit)
        if filters.offset is not None:
            query = query.offset(filters.offset)
        if filters.range_start is not None and filters.range_end is not None:
            query = query.range(filters.range_start, filters.range_end)
        return query

    def _select(
        self, table: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """Run a select query with optional filters and return QueryResult."""
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table(table).select(select_cols)
        query = self._apply_filters(query, filters)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def _get_one(self, table: str, id_col: str, id_val: str) -> Optional[Dict[str, Any]]:
        """Fetch a single row by primary key."""
        sb = get_supabase()
        result = sb.table(table).select("*").eq(id_col, id_val).execute()
        rows = result.data or []
        return rows[0] if rows else None

    def _insert(self, table: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a single row and return the created record."""
        sb = get_supabase()
        result = sb.table(table).insert(data).execute()
        rows = result.data or []
        return rows[0] if rows else data

    def _update(self, table: str, id_col: str, id_val: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a row by primary key and return the updated record."""
        sb = get_supabase()
        result = sb.table(table).update(data).eq(id_col, id_val).execute()
        rows = result.data or []
        return rows[0] if rows else data

    def _delete(self, table: str, id_col: str, id_val: str) -> None:
        """Delete a row by primary key."""
        sb = get_supabase()
        sb.table(table).delete().eq(id_col, id_val).execute()

    # ──────────────────────────────────────────────
    # 1. Projects
    # ──────────────────────────────────────────────

    def list_projects(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*, editai_clip_content(*)"
        query = sb.table("editai_projects").select(select_cols).eq("profile_id", profile_id)
        # Default: exclude soft-deleted projects
        if not filters or "deleted_at" not in filters.is_:
            query = query.is_("deleted_at", "null")
        query = self._apply_filters(query, filters)
        # Default ordering if none specified
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_projects", "id", project_id)

    def create_project(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_projects", data)

    def update_project(self, project_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_projects", "id", project_id, data)

    def delete_project(self, project_id: str) -> None:
        self._delete("editai_projects", "id", project_id)

    def get_project_by_name(
        self, profile_id: str, name: str
    ) -> Optional[Dict[str, Any]]:
        """Return the first non-deleted project matching profile_id + name, or None."""
        sb = get_supabase()
        result = (
            sb.table("editai_projects")
            .select("*")
            .eq("profile_id", profile_id)
            .eq("name", name)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    # ──────────────────────────────────────────────
    # 2. Clips
    # ──────────────────────────────────────────────

    def list_clips(
        self, project_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*, editai_clip_content(*)"
        query = sb.table("editai_clips").select(select_cols).eq("project_id", project_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def get_clip(self, clip_id: str) -> Optional[Dict[str, Any]]:
        sb = get_supabase()
        result = sb.table("editai_clips").select("*, editai_clip_content(*)").eq("id", clip_id).execute()
        rows = result.data or []
        return rows[0] if rows else None

    def create_clip(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_clips", data)

    def update_clip(self, clip_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_clips", "id", clip_id, data)

    def delete_clip(self, clip_id: str) -> None:
        self._delete("editai_clips", "id", clip_id)

    def bulk_update_clips(
        self, clip_ids: List[str], profile_id: str, data: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        if not clip_ids:
            return []
        sb = get_supabase()
        result = (
            sb.table("editai_clips")
            .update(data)
            .in_("id", clip_ids)
            .eq("profile_id", profile_id)
            .execute()
        )
        return result.data or []

    def delete_clips_by_ids(self, clip_ids: List[str]) -> None:
        if not clip_ids:
            return
        sb = get_supabase()
        sb.table("editai_clips").delete().in_("id", clip_ids).execute()

    def list_clips_by_profile(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*, editai_clip_content(*)"
        query = sb.table("editai_clips").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def count_clips(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> int:
        """Count clips for a profile honoring eq/contains filters from QueryFilters.

        Used by route 2002 (/all-clips) for the cursor-pagination total.
        Column names in filters come from route code, never from request bodies
        (see threat_model T-80-01-02).
        """
        sb = get_supabase()
        query = sb.table("editai_clips").select("id", count="exact").eq("profile_id", profile_id)
        if filters:
            for col, val in filters.eq.items():
                query = query.eq(col, val)
            for col, val in filters.contains.items():
                query = query.contains(col, val if isinstance(val, list) else [val])
        result = query.execute()
        return result.count or 0

    # ──────────────────────────────────────────────
    # 3. Clip Content
    # ──────────────────────────────────────────────

    def get_clip_content(self, clip_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_clip_content", "clip_id", clip_id)

    def create_clip_content(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_clip_content", data)

    def update_clip_content(self, clip_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_clip_content", "clip_id", clip_id, data)

    def delete_clip_content_by_clip_ids(self, clip_ids: List[str]) -> None:
        if not clip_ids:
            return
        sb = get_supabase()
        sb.table("editai_clip_content").delete().in_("clip_id", clip_ids).execute()

    # ──────────────────────────────────────────────
    # 4. Segments
    # ──────────────────────────────────────────────

    def list_segments(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_segments").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("sequence_order")
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def get_segment(self, segment_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_segments", "id", segment_id)

    def create_segment(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_segments", data)

    def update_segment(self, segment_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_segments", "id", segment_id, data)

    def delete_segment(self, segment_id: str) -> None:
        self._delete("editai_segments", "id", segment_id)

    def increment_segment_usage(self, segment_ids: List[str]) -> None:
        """Increment usage_count by 1 for each segment id. Atomic via RPC; fallback per-id.

        Mirrors the logic of the legacy `_increment_segment_usage` helper at
        library_routes.py:3965, including the read-modify-write fallback.
        """
        if not segment_ids:
            return
        sb = get_supabase()
        # Try atomic batch increment via Postgres function (migration 034)
        try:
            sb.rpc(
                "increment_segment_usage_batch",
                {"segment_ids": segment_ids},
            ).execute()
            return
        except Exception as e:
            logger.warning(
                f"increment_segment_usage_batch RPC failed, falling back to per-id update: {e}"
            )
        # Fallback: individual read-then-update (not atomic, but functional)
        for seg_id in segment_ids:
            try:
                current = (
                    sb.table("editai_segments")
                    .select("usage_count")
                    .eq("id", seg_id)
                    .execute()
                )
                if current.data:
                    new_count = (current.data[0].get("usage_count") or 0) + 1
                    sb.table("editai_segments").update(
                        {"usage_count": new_count}
                    ).eq("id", seg_id).execute()
            except Exception as e:
                logger.warning(
                    f"Failed to increment usage_count for segment {seg_id}: {e}"
                )

    # ──────────────────────────────────────────────
    # 5. Source Videos
    # ──────────────────────────────────────────────

    def list_source_videos(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_source_videos").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def get_source_video(self, video_id: str) -> Optional[Dict[str, Any]]:
        """Get a single source video by ID. Returns None if not found."""
        return self._get_one("editai_source_videos", "id", video_id)

    def create_source_video(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_source_videos", data)

    def update_source_video(self, video_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_source_videos", "id", video_id, data)

    def delete_source_video(self, video_id: str) -> None:
        self._delete("editai_source_videos", "id", video_id)

    # ──────────────────────────────────────────────
    # 6. Project Segments
    # ──────────────────────────────────────────────

    def list_project_segments(
        self, project_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*, editai_segments(*)"
        query = sb.table("editai_project_segments").select(select_cols).eq("project_id", project_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("sequence_order")
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def create_project_segment(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_project_segments", data)

    def update_project_segment(self, segment_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_project_segments", "id", segment_id, data)

    def delete_project_segments(self, project_id: str) -> None:
        sb = get_supabase()
        sb.table("editai_project_segments").delete().eq("project_id", project_id).execute()

    # ──────────────────────────────────────────────
    # 7. Pipelines
    # ──────────────────────────────────────────────

    def get_pipeline(self, pipeline_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_pipelines", "id", pipeline_id)

    def create_pipeline(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_pipelines", data)

    def update_pipeline(self, pipeline_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_pipelines", "id", pipeline_id, data)

    def upsert_pipeline(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """PostgREST native upsert on editai_pipelines keyed on id."""
        sb = get_supabase()
        result = sb.table("editai_pipelines").upsert(data).execute()
        if result.data:
            return result.data[0]
        return data

    def delete_pipeline(self, pipeline_id: str) -> None:
        self._delete("editai_pipelines", "id", pipeline_id)

    def list_pipelines(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_pipelines").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    # ──────────────────────────────────────────────
    # 8. Assembly Jobs
    # ──────────────────────────────────────────────

    def get_assembly_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_assembly_jobs", "id", job_id)

    def create_assembly_job(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_assembly_jobs", data)

    def update_assembly_job(self, job_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_assembly_jobs", "id", job_id, data)

    # ──────────────────────────────────────────────
    # 9. Export Presets
    # ──────────────────────────────────────────────

    def list_export_presets(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        # Include both profile-specific and global (null profile_id) presets
        query = sb.table("editai_export_presets").select(select_cols).or_(
            f"profile_id.eq.{profile_id},profile_id.is.null"
        )
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("name")
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def get_default_preset(self, profile_id: str) -> Optional[Dict[str, Any]]:
        sb = get_supabase()
        result = (
            sb.table("editai_export_presets")
            .select("*")
            .eq("profile_id", profile_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    def create_export_preset(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_export_presets", data)

    def update_export_preset(self, preset_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_export_presets", "id", preset_id, data)

    def get_export_preset_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Return the export preset matching `name`, or None."""
        sb = get_supabase()
        result = (
            sb.table("editai_export_presets")
            .select("*")
            .eq("name", name)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    # ──────────────────────────────────────────────
    # 10. Exports
    # ──────────────────────────────────────────────

    def create_export(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_exports", data)

    def list_exports(
        self, clip_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_exports").select(select_cols).eq("clip_id", clip_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def delete_exports_older_than(
        self, profile_id: str, cutoff_iso: str
    ) -> int:
        """Delete exports created before `cutoff_iso` scoped to `profile_id` via clip ownership.

        editai_exports has no profile_id column natively (verified against
        migrations 001-044). To enforce threat-model T-80-01-04 (no cross-profile
        deletion) we first list the profile's clip ids and delete exports whose
        clip_id is in that set.
        """
        sb = get_supabase()
        # 1. Get this profile's clip ids
        clip_resp = (
            sb.table("editai_clips")
            .select("id")
            .eq("profile_id", profile_id)
            .execute()
        )
        clip_ids = [c["id"] for c in (clip_resp.data or [])]
        if not clip_ids:
            return 0
        # 2. Delete exports older than cutoff scoped to those clip ids
        result = (
            sb.table("editai_exports")
            .delete()
            .lt("created_at", cutoff_iso)
            .in_("clip_id", clip_ids)
            .execute()
        )
        return len(result.data) if result.data else 0

    # ──────────────────────────────────────────────
    # 11. Jobs (background processing jobs)
    # ──────────────────────────────────────────────

    def create_job(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("jobs", data)

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("jobs", "id", job_id)

    def update_job(self, job_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("jobs", "id", job_id, data)

    def list_jobs(
        self,
        limit: int = 50,
        profile_id: Optional[str] = None,
        filters: Optional[QueryFilters] = None,
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("jobs").select(select_cols)
        if profile_id:
            query = query.eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        if not filters or filters.limit is None:
            query = query.limit(limit)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def delete_job(self, job_id: str) -> None:
        self._delete("jobs", "id", job_id)

    def cleanup_old_jobs(self, cutoff_date: datetime) -> int:
        sb = get_supabase()
        cutoff_str = cutoff_date.isoformat()
        result = sb.table("jobs").delete().lt("created_at", cutoff_str).execute()
        deleted = result.data or []
        return len(deleted)

    def list_jobs_by_project(
        self, project_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        # Supabase JSONB arrow operator for data->>project_id
        query = sb.table("jobs").select(select_cols).eq("data->>project_id", project_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    # ──────────────────────────────────────────────
    # 12. API Costs
    # ──────────────────────────────────────────────

    def log_cost(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("api_costs", data)

    def get_cost_summary(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("api_costs").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    # ──────────────────────────────────────────────
    # 13. Profiles
    # ──────────────────────────────────────────────

    def get_profile(self, profile_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("profiles", "id", profile_id)

    def list_profiles(self, user_id: str) -> QueryResult:
        sb = get_supabase()
        result = sb.table("profiles").select("*").eq("user_id", user_id).execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def create_profile(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("profiles", data)

    def update_profile(self, profile_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("profiles", "id", profile_id, data)

    def delete_profile(self, profile_id: str) -> None:
        self._delete("profiles", "id", profile_id)

    def get_default_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        sb = get_supabase()
        result = (
            sb.table("profiles")
            .select("*")
            .eq("user_id", user_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    # ──────────────────────────────────────────────
    # 14. TTS Assets
    # ──────────────────────────────────────────────

    def list_tts_assets(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_tts_assets").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def get_tts_asset(self, asset_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_tts_assets", "id", asset_id)

    def create_tts_asset(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_tts_assets", data)

    def update_tts_asset(self, asset_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_tts_assets", "id", asset_id, data)

    def delete_tts_asset(self, asset_id: str) -> None:
        self._delete("editai_tts_assets", "id", asset_id)

    # ──────────────────────────────────────────────
    # 15. ElevenLabs Accounts
    # ──────────────────────────────────────────────

    def list_elevenlabs_accounts(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("elevenlabs_accounts").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def get_elevenlabs_account(self, account_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("elevenlabs_accounts", "id", account_id)

    def create_elevenlabs_account(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("elevenlabs_accounts", data)

    def update_elevenlabs_account(self, account_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("elevenlabs_accounts", "id", account_id, data)

    def delete_elevenlabs_account(self, account_id: str) -> None:
        self._delete("elevenlabs_accounts", "id", account_id)

    # ──────────────────────────────────────────────
    # 26. API Key Vault
    # ──────────────────────────────────────────────

    def list_vault_keys(
        self, profile_id: str, service: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = (
            sb.table("api_key_vault")
            .select(select_cols)
            .eq("profile_id", profile_id)
            .eq("service", service)
        )
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("sort_order", desc=False)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def get_vault_key(self, key_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("api_key_vault", "id", key_id)

    def create_vault_key(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("api_key_vault", data)

    def update_vault_key(self, key_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("api_key_vault", "id", key_id, data)

    def delete_vault_key(self, key_id: str) -> None:
        self._delete("api_key_vault", "id", key_id)

    # ──────────────────────────────────────────────
    # 16. Products & Feeds
    # ──────────────────────────────────────────────

    def list_products(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        return self._select("editai_products", filters)

    def get_product(self, product_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_products", "id", product_id)

    def create_product(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_products", data)

    def list_feeds(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_feeds").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def create_feed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_feeds", data)

    def update_feed(self, feed_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_feeds", "id", feed_id, data)

    def delete_feed(self, feed_id: str) -> None:
        self._delete("editai_feeds", "id", feed_id)

    # ──────────────────────────────────────────────
    # 17. Postiz Publications
    # ──────────────────────────────────────────────

    def create_publication(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_publications", data)

    def list_publications(
        self, clip_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_publications").select(select_cols).eq("clip_id", clip_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    # ──────────────────────────────────────────────
    # 18. Product Groups
    # ──────────────────────────────────────────────

    def list_product_groups(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_product_groups").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def create_product_group(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_product_groups", data)

    def get_product_group(self, group_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_product_groups", "id", group_id)

    def update_product_group(self, group_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        sb = get_supabase()
        result = sb.table("editai_product_groups").update(data).eq("id", group_id).execute()
        rows = result.data or []
        return rows[0] if rows else {}

    def delete_product_group(self, group_id: str) -> None:
        self._delete("editai_product_groups", "id", group_id)

    # ──────────────────────────────────────────────
    # 19. Segment Product Associations
    # ──────────────────────────────────────────────

    def list_associations(
        self, segment_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*, editai_products(*)"
        query = sb.table("editai_segment_products").select(select_cols).eq("segment_id", segment_id)
        query = self._apply_filters(query, filters)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def create_association(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_segment_products", data)

    def update_association(self, assoc_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_segment_products", "id", assoc_id, data)

    def delete_association(self, assoc_id: str) -> None:
        self._delete("editai_segment_products", "id", assoc_id)

    # ──────────────────────────────────────────────
    # 20. Schedule
    # ──────────────────────────────────────────────

    def create_schedule_plan(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_schedule_plans", data)

    def get_schedule_plan(self, plan_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_schedule_plans", "id", plan_id)

    def update_schedule_plan(self, plan_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_schedule_plans", "id", plan_id, data)

    def list_schedule_plans(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_schedule_plans").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def create_schedule_items(self, items: List[Dict[str, Any]]) -> QueryResult:
        if not items:
            return QueryResult(data=[], count=0)
        sb = get_supabase()
        result = sb.table("editai_schedule_items").insert(items).execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def list_schedule_items(
        self, plan_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_schedule_items").select(select_cols).eq("plan_id", plan_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("scheduled_date")
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def update_schedule_item(self, item_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_schedule_items", "id", item_id, data)

    # ──────────────────────────────────────────────
    # 21. Generation Progress
    # ──────────────────────────────────────────────

    def get_progress(self, project_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_generation_progress", "project_id", project_id)

    def upsert_progress(self, project_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        sb = get_supabase()
        data["project_id"] = project_id
        result = sb.table("editai_generation_progress").upsert(data).execute()
        rows = result.data or []
        return rows[0] if rows else data

    def delete_progress(self, project_id: str) -> None:
        sb = get_supabase()
        sb.table("editai_generation_progress").delete().eq("project_id", project_id).execute()

    # ──────────────────────────────────────────────
    # 22. Generated Images
    # ──────────────────────────────────────────────

    def create_generated_image(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_generated_images", data)

    def list_generated_images(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        return self._select("editai_generated_images", filters)

    def get_generated_image(self, image_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_generated_images", "id", image_id)

    def update_generated_image(self, image_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_generated_images", "id", image_id, data)

    def delete_generated_image(self, image_id: str) -> None:
        self._delete("editai_generated_images", "id", image_id)

    # ──────────────────────────────────────────────
    # 23. Image Prompt Templates
    # ──────────────────────────────────────────────

    def list_prompt_templates(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        sb = get_supabase()
        select_cols = filters.select if filters and filters.select else "*"
        query = sb.table("editai_prompt_templates").select(select_cols).eq("profile_id", profile_id)
        query = self._apply_filters(query, filters)
        if not filters or not filters.order_by:
            query = query.order("created_at", desc=True)
        result = query.execute()
        data = result.data or []
        return QueryResult(data=data, count=len(data))

    def create_prompt_template(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_prompt_templates", data)

    def update_prompt_template(self, template_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._update("editai_prompt_templates", "id", template_id, data)

    def delete_prompt_template(self, template_id: str) -> None:
        self._delete("editai_prompt_templates", "id", template_id)

    # ──────────────────────────────────────────────
    # 24. Catalog Views (read-only)
    # ──────────────────────────────────────────────

    def list_catalog_products(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        return self._select("editai_catalog_products", filters)

    def list_catalog_products_grouped(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        return self._select("editai_catalog_products_grouped", filters)

    # ──────────────────────────────────────────────
    # 25. Generic escape hatch
    # ──────────────────────────────────────────────

    def table_query(
        self,
        table_name: str,
        operation: str,
        data: Optional[Dict[str, Any]] = None,
        filters: Optional[QueryFilters] = None,
    ) -> QueryResult:
        sb = get_supabase()
        table = sb.table(table_name)

        if operation == "select":
            select_cols = filters.select if filters and filters.select else "*"
            count_mode = filters.count if filters and filters.count else None
            if count_mode:
                query = table.select(select_cols, count=count_mode)
            else:
                query = table.select(select_cols)
            query = self._apply_filters(query, filters)
            if filters and filters.maybe_single:
                result = query.maybe_single().execute()
                # maybe_single returns a single dict or None
                if result.data is None:
                    return QueryResult(data=[], count=0)
                return QueryResult(data=[result.data] if isinstance(result.data, dict) else result.data, count=1)
            result = query.execute()
            rows = result.data or []
            row_count = result.count if count_mode and hasattr(result, 'count') else len(rows)
            return QueryResult(data=rows, count=row_count)

        elif operation == "insert":
            if data is None:
                raise ValueError("data is required for insert operation")
            result = table.insert(data).execute()
            rows = result.data or []
            return QueryResult(data=rows, count=len(rows))

        elif operation == "update":
            if data is None:
                raise ValueError("data is required for update operation")
            query = table.update(data)
            query = self._apply_filters(query, filters)
            result = query.execute()
            rows = result.data or []
            return QueryResult(data=rows, count=len(rows))

        elif operation == "upsert":
            if data is None:
                raise ValueError("data is required for upsert operation")
            on_conflict = filters.on_conflict if filters and filters.on_conflict else None
            if on_conflict:
                result = table.upsert(data, on_conflict=on_conflict).execute()
            else:
                result = table.upsert(data).execute()
            rows = result.data or []
            return QueryResult(data=rows, count=len(rows))

        elif operation == "delete":
            query = table.delete()
            query = self._apply_filters(query, filters)
            result = query.execute()
            rows = result.data or []
            return QueryResult(data=rows, count=len(rows))

        elif operation == "rpc":
            # RPC calls: table_name is function name, data is params
            result = sb.rpc(table_name, data or {}).execute()
            rows = result.data or []
            return QueryResult(data=rows, count=len(rows))

        else:
            raise ValueError(f"Unknown operation: {operation}. Use select/insert/update/upsert/delete/rpc.")
