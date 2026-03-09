"""SQLite implementation of the DataRepository interface.

Stores all data in a local SQLite file at {base_dir}/data.db,
eliminating the Supabase dependency for data storage in desktop mode.

Thread-safe: WAL mode for concurrent reads, threading.Lock for writes.
"""

import json
import logging
import os
import sqlite3
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.repositories.base import DataRepository
from app.repositories.models import QueryFilters, QueryResult

logger = logging.getLogger(__name__)

# Columns known to store JSON data (TEXT in SQLite, parsed on read)
_JSON_COLUMNS = frozenset({
    "tts_settings", "cloned_voices", "video_template_settings",
    "subtitle_settings", "postiz_integration_ids", "scripts",
    "previews", "render_jobs", "source_video_ids", "data",
    "metadata", "selected_image_urls", "pip_config", "slide_config",
    "tts_timestamps", "tags", "product_ids", "integration_ids",
    "collection_ids", "summary",
})


class SQLiteRepository(DataRepository):
    """Concrete DataRepository backed by a local SQLite database."""

    # Map from logical (Supabase) table names to actual SQLite table names
    _TABLE_MAP = {
        "editai_profiles": "profiles",
        "editai_feeds": "product_feeds",
        "editai_products": "products",
        "editai_publications": "editai_postiz_publications",
        "editai_elevenlabs_accounts": "elevenlabs_accounts",
        "editai_segment_products": "segment_product_associations",
        "editai_generated_images": "generated_images",
        "editai_prompt_templates": "image_prompt_templates",
        "editai_jobs": "jobs",
    }

    def __init__(self) -> None:
        from app.config import get_settings

        settings = get_settings()
        self._db_path = settings.base_dir / "data.db"
        self._write_lock = threading.Lock()

        # Ensure parent directory exists
        self._db_path.parent.mkdir(parents=True, exist_ok=True)

        # Open connection and initialize schema
        self._conn = sqlite3.connect(
            str(self._db_path), check_same_thread=False
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA foreign_keys = ON")

        self._init_schema()
        logger.info("SQLiteRepository initialized at %s", self._db_path)

    def _init_schema(self) -> None:
        """Run the schema SQL file to create all tables."""
        schema_path = Path(__file__).parent.parent.parent / "supabase" / "sqlite_schema.sql"
        if not schema_path.exists():
            raise FileNotFoundError(
                f"SQLite schema file not found: {schema_path}"
            )
        sql = schema_path.read_text(encoding="utf-8")
        with self._write_lock:
            self._conn.executescript(sql)

    # ── Table name helper ──────────────────────────────

    def _t(self, name: str) -> str:
        """Translate a logical table name to the actual SQLite table name."""
        return self._TABLE_MAP.get(name, name)

    # ── Row / JSON conversion helpers ──────────────────

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        """Convert a sqlite3.Row to a plain dict, parsing JSON columns."""
        d = dict(row)
        for key in d:
            if key in _JSON_COLUMNS and isinstance(d[key], str):
                try:
                    d[key] = json.loads(d[key])
                except (json.JSONDecodeError, TypeError):
                    pass
        return d

    @staticmethod
    def _serialize_json_fields(data: Dict[str, Any]) -> Dict[str, Any]:
        """Serialize any dict/list values in JSON columns to JSON strings."""
        out = {}
        for key, val in data.items():
            if key in _JSON_COLUMNS and isinstance(val, (dict, list)):
                out[key] = json.dumps(val)
            else:
                out[key] = val
        return out

    # ── Generic CRUD helpers ───────────────────────────

    def _now(self) -> str:
        return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    def _get_one(
        self, table: str, id_col: str, id_val: str
    ) -> Optional[Dict[str, Any]]:
        table = self._t(table)
        cur = self._conn.execute(
            f'SELECT * FROM "{table}" WHERE "{id_col}" = ?', (id_val,)
        )
        row = cur.fetchone()
        return self._row_to_dict(row) if row else None

    def _get_table_columns(self, table: str) -> set:
        """Return the set of column names for a table (cached)."""
        if not hasattr(self, "_col_cache"):
            self._col_cache: Dict[str, set] = {}
        if table not in self._col_cache:
            cur = self._conn.execute(f'PRAGMA table_info("{table}")')
            self._col_cache[table] = {row[1] for row in cur.fetchall()}
        return self._col_cache[table]

    def _insert(self, table: str, data: Dict[str, Any]) -> Dict[str, Any]:
        table = self._t(table)
        if "id" not in data:
            data["id"] = str(uuid.uuid4())
        now = self._now()
        columns = self._get_table_columns(table)
        if "created_at" not in data and "created_at" in columns:
            data["created_at"] = now
        if "updated_at" not in data and "updated_at" in columns:
            data["updated_at"] = now
        data = self._serialize_json_fields(data)
        cols = list(data.keys())
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(f'"{c}"' for c in cols)
        vals = [data[c] for c in cols]
        with self._write_lock:
            self._conn.execute(
                f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders})',
                vals,
            )
            self._conn.commit()
        # Re-read the inserted row to get defaults
        return self._get_one_raw(table, "id", data["id"])

    def _get_one_raw(
        self, table: str, id_col: str, id_val: str
    ) -> Dict[str, Any]:
        """Fetch one row from an already-translated table name."""
        cur = self._conn.execute(
            f'SELECT * FROM "{table}" WHERE "{id_col}" = ?', (id_val,)
        )
        row = cur.fetchone()
        return self._row_to_dict(row) if row else {}

    def _update(
        self, table: str, id_col: str, id_val: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        table = self._t(table)
        columns = self._get_table_columns(table)
        if "updated_at" not in data and "updated_at" in columns:
            data["updated_at"] = self._now()
        data = self._serialize_json_fields(data)
        set_clause = ", ".join(f'"{c}" = ?' for c in data.keys())
        vals = list(data.values()) + [id_val]
        with self._write_lock:
            self._conn.execute(
                f'UPDATE "{table}" SET {set_clause} WHERE "{id_col}" = ?',
                vals,
            )
            self._conn.commit()
        return self._get_one_raw(table, id_col, id_val)

    def _delete(self, table: str, id_col: str, id_val: str) -> None:
        table = self._t(table)
        with self._write_lock:
            self._conn.execute(
                f'DELETE FROM "{table}" WHERE "{id_col}" = ?', (id_val,)
            )
            self._conn.commit()

    # ── Filter / query helpers ─────────────────────────

    def _apply_filters(
        self,
        where_parts: List[str],
        params: List[Any],
        filters: Optional[QueryFilters],
    ) -> None:
        """Append WHERE clause fragments and params from QueryFilters."""
        if filters is None:
            return
        for col, val in filters.eq.items():
            where_parts.append(f'"{col}" = ?')
            params.append(val)
        for col, val in filters.neq.items():
            where_parts.append(f'"{col}" != ?')
            params.append(val)
        for col, val in filters.gt.items():
            where_parts.append(f'"{col}" > ?')
            params.append(val)
        for col, val in filters.lt.items():
            where_parts.append(f'"{col}" < ?')
            params.append(val)
        for col, val in filters.gte.items():
            where_parts.append(f'"{col}" >= ?')
            params.append(val)
        for col, val in filters.lte.items():
            where_parts.append(f'"{col}" <= ?')
            params.append(val)
        for col, vals in filters.in_.items():
            if vals:
                placeholders = ", ".join("?" for _ in vals)
                where_parts.append(f'"{col}" IN ({placeholders})')
                params.extend(vals)
        for col, val in filters.is_.items():
            if val == "null" or val is None:
                where_parts.append(f'"{col}" IS NULL')
            else:
                where_parts.append(f'"{col}" IS ?')
                params.append(val)
        for col, pattern in filters.like.items():
            where_parts.append(f'"{col}" LIKE ? COLLATE NOCASE')
            params.append(pattern)
        for col, val in filters.contains.items():
            # JSON containment: check if json array contains value
            if isinstance(val, list):
                # For each value, check json_each
                for v in val:
                    where_parts.append(
                        f'EXISTS (SELECT 1 FROM json_each("{col}") WHERE value = ?)'
                    )
                    params.append(v)
            else:
                where_parts.append(
                    f'EXISTS (SELECT 1 FROM json_each("{col}") WHERE value = ?)'
                )
                params.append(val)
        for col, val in filters.not_is.items():
            if val == "null" or val is None:
                where_parts.append(f'"{col}" IS NOT NULL')
            else:
                where_parts.append(f'"{col}" IS NOT ?')
                params.append(val)
        if filters.or_:
            or_parts = self._parse_or_filter(filters.or_, params)
            if or_parts:
                where_parts.append(f"({or_parts})")

    def _parse_or_filter(
        self, or_str: str, params: List[Any]
    ) -> str:
        """Parse PostgREST or-filter string into SQL OR expression.

        Example: "profile_id.eq.abc,profile_id.is.null"
        -> "(\"profile_id\" = ? OR \"profile_id\" IS NULL)"
        """
        parts = []
        # Split on comma, but respect nested parens (not used here)
        for clause in or_str.split(","):
            clause = clause.strip()
            if not clause:
                continue
            # Parse col.op.value
            segments = clause.split(".", 2)
            if len(segments) < 2:
                continue
            col = segments[0]
            op = segments[1]
            val = segments[2] if len(segments) > 2 else None

            if op == "eq":
                parts.append(f'"{col}" = ?')
                params.append(val)
            elif op == "neq":
                parts.append(f'"{col}" != ?')
                params.append(val)
            elif op == "gt":
                parts.append(f'"{col}" > ?')
                params.append(val)
            elif op == "lt":
                parts.append(f'"{col}" < ?')
                params.append(val)
            elif op == "gte":
                parts.append(f'"{col}" >= ?')
                params.append(val)
            elif op == "lte":
                parts.append(f'"{col}" <= ?')
                params.append(val)
            elif op == "is":
                if val == "null":
                    parts.append(f'"{col}" IS NULL')
                else:
                    parts.append(f'"{col}" IS ?')
                    params.append(val)
            elif op == "like" or op == "ilike":
                parts.append(f'"{col}" LIKE ? COLLATE NOCASE')
                params.append(val)
            elif op == "in":
                # in.(val1,val2)
                if val and val.startswith("(") and val.endswith(")"):
                    in_vals = val[1:-1].split(",")
                    placeholders = ", ".join("?" for _ in in_vals)
                    parts.append(f'"{col}" IN ({placeholders})')
                    params.extend(in_vals)

        return " OR ".join(parts)

    def _build_select(
        self, table: str, filters: Optional[QueryFilters] = None
    ) -> tuple:
        """Build a SELECT query with filters. Returns (sql, params)."""
        table = self._t(table)
        where_parts: List[str] = []
        params: List[Any] = []
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters:
            if filters.order_by:
                direction = "DESC" if filters.order_desc else "ASC"
                sql += f' ORDER BY "{filters.order_by}" {direction}'
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)
            if (
                filters.range_start is not None
                and filters.range_end is not None
                and filters.limit is None
            ):
                limit = filters.range_end - filters.range_start + 1
                sql += " LIMIT ? OFFSET ?"
                params.extend([limit, filters.range_start])

        return sql, params

    def _execute_select(
        self, table: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """Common pattern for list methods."""
        sql, params = self._build_select(table, filters)
        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]

        count = len(rows)
        if filters and filters.count == "exact":
            # Run a separate count query without limit/offset
            table_t = self._t(table)
            count_where: List[str] = []
            count_params: List[Any] = []
            self._apply_filters(count_where, count_params, filters)
            count_sql = f'SELECT COUNT(*) FROM "{table_t}"'
            if count_where:
                count_sql += " WHERE " + " AND ".join(count_where)
            count = self._conn.execute(count_sql, count_params).fetchone()[0]

        return QueryResult(data=rows, count=count)

    # ── get_client (no raw client for SQLite) ──────────

    def get_client(self):
        """Return None -- SQLite has no raw client. Use table_query instead."""
        return None

    # ──────────────────────────────────────────────
    # 1. Projects
    # ──────────────────────────────────────────────

    def list_projects(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_projects")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]

        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        # Default ordering
        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_projects", "id", project_id)

    def create_project(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_projects", data)

    def update_project(
        self, project_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_projects", "id", project_id, data)

    def delete_project(self, project_id: str) -> None:
        self._delete("editai_projects", "id", project_id)

    # ──────────────────────────────────────────────
    # 2. Clips
    # ──────────────────────────────────────────────

    def list_clips(
        self, project_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_clips")
        where_parts: List[str] = ['"project_id" = ?']
        params: List[Any] = [project_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def get_clip(self, clip_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_clips", "id", clip_id)

    def create_clip(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_clips", data)

    def update_clip(
        self, clip_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_clips", "id", clip_id, data)

    def delete_clip(self, clip_id: str) -> None:
        self._delete("editai_clips", "id", clip_id)

    def delete_clips_by_ids(self, clip_ids: List[str]) -> None:
        if not clip_ids:
            return
        table = self._t("editai_clips")
        placeholders = ", ".join("?" for _ in clip_ids)
        with self._write_lock:
            self._conn.execute(
                f'DELETE FROM "{table}" WHERE "id" IN ({placeholders})',
                clip_ids,
            )
            self._conn.commit()

    def list_clips_by_profile(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_clips")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    # ──────────────────────────────────────────────
    # 3. Clip Content
    # ──────────────────────────────────────────────

    def get_clip_content(self, clip_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_clip_content", "clip_id", clip_id)

    def create_clip_content(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_clip_content", data)

    def update_clip_content(
        self, clip_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_clip_content", "clip_id", clip_id, data)

    def delete_clip_content_by_clip_ids(self, clip_ids: List[str]) -> None:
        if not clip_ids:
            return
        table = self._t("editai_clip_content")
        placeholders = ", ".join("?" for _ in clip_ids)
        with self._write_lock:
            self._conn.execute(
                f'DELETE FROM "{table}" WHERE "clip_id" IN ({placeholders})',
                clip_ids,
            )
            self._conn.commit()

    # ──────────────────────────────────────────────
    # 4. Segments
    # ──────────────────────────────────────────────

    def list_segments(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_segments")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "sequence_order" ASC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def get_segment(self, segment_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_segments", "id", segment_id)

    def create_segment(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_segments", data)

    def update_segment(
        self, segment_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_segments", "id", segment_id, data)

    def delete_segment(self, segment_id: str) -> None:
        self._delete("editai_segments", "id", segment_id)

    # ──────────────────────────────────────────────
    # 5. Source Videos
    # ──────────────────────────────────────────────

    def list_source_videos(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_source_videos")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def create_source_video(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_source_videos", data)

    def update_source_video(
        self, video_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_source_videos", "id", video_id, data)

    def delete_source_video(self, video_id: str) -> None:
        self._delete("editai_source_videos", "id", video_id)

    # ──────────────────────────────────────────────
    # 6. Project Segments
    # ──────────────────────────────────────────────

    def list_project_segments(
        self, project_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        ps_table = self._t("editai_project_segments")
        seg_table = self._t("editai_segments")

        where_parts: List[str] = [f'ps."project_id" = ?']
        params: List[Any] = [project_id]

        # Apply filters to ps columns
        if filters:
            for col, val in filters.eq.items():
                where_parts.append(f'ps."{col}" = ?')
                params.append(val)
            for col, val in filters.neq.items():
                where_parts.append(f'ps."{col}" != ?')
                params.append(val)

        sql = f"""
            SELECT ps.*, s.id AS _seg_id, s.source_video_id, s.start_time,
                   s.end_time, s.duration AS seg_duration, s.thumbnail_path AS seg_thumbnail_path,
                   s.video_path AS seg_video_path, s.score, s.label,
                   s.is_selected AS seg_is_selected, s.profile_id AS seg_profile_id,
                   s.created_at AS seg_created_at, s.updated_at AS seg_updated_at
            FROM "{ps_table}" ps
            LEFT JOIN "{seg_table}" s ON ps.segment_id = s.id
        """
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY ps."{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY ps."sequence_order" ASC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            # Build nested editai_segments object like Supabase join
            seg_data = None
            if d.get("_seg_id"):
                seg_data = {
                    "id": d.pop("_seg_id"),
                    "source_video_id": d.pop("source_video_id", None),
                    "start_time": d.pop("start_time", None),
                    "end_time": d.pop("end_time", None),
                    "duration": d.pop("seg_duration", None),
                    "thumbnail_path": d.pop("seg_thumbnail_path", None),
                    "video_path": d.pop("seg_video_path", None),
                    "score": d.pop("score", None),
                    "label": d.pop("label", None),
                    "is_selected": d.pop("seg_is_selected", None),
                    "profile_id": d.pop("seg_profile_id", None),
                    "created_at": d.pop("seg_created_at", None),
                    "updated_at": d.pop("seg_updated_at", None),
                }
            else:
                # Remove the prefixed keys
                for k in list(d.keys()):
                    if k.startswith("_seg_") or k.startswith("seg_"):
                        d.pop(k, None)
                    if k in ("source_video_id", "start_time", "end_time",
                             "score", "label"):
                        d.pop(k, None)
            d["editai_segments"] = seg_data
            rows.append(d)

        return QueryResult(data=rows, count=len(rows))

    def create_project_segment(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._insert("editai_project_segments", data)

    def update_project_segment(
        self, segment_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_project_segments", "id", segment_id, data)

    def delete_project_segments(self, project_id: str) -> None:
        table = self._t("editai_project_segments")
        with self._write_lock:
            self._conn.execute(
                f'DELETE FROM "{table}" WHERE "project_id" = ?',
                (project_id,),
            )
            self._conn.commit()

    # ──────────────────────────────────────────────
    # 7. Pipelines
    # ──────────────────────────────────────────────

    def get_pipeline(self, pipeline_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_pipelines", "id", pipeline_id)

    def create_pipeline(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_pipelines", data)

    def update_pipeline(
        self, pipeline_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_pipelines", "id", pipeline_id, data)

    def delete_pipeline(self, pipeline_id: str) -> None:
        self._delete("editai_pipelines", "id", pipeline_id)

    def list_pipelines(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_pipelines")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    # ──────────────────────────────────────────────
    # 8. Assembly Jobs
    # ──────────────────────────────────────────────

    def get_assembly_job(
        self, job_id: str
    ) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_assembly_jobs", "id", job_id)

    def create_assembly_job(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._insert("editai_assembly_jobs", data)

    def update_assembly_job(
        self, job_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_assembly_jobs", "id", job_id, data)

    # ──────────────────────────────────────────────
    # 9. Export Presets
    # ──────────────────────────────────────────────

    def list_export_presets(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_export_presets")
        # Include both profile-specific and global (null profile_id) presets
        where_parts: List[str] = [
            '("profile_id" = ? OR "profile_id" IS NULL)'
        ]
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "name" ASC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def get_default_preset(
        self, profile_id: str
    ) -> Optional[Dict[str, Any]]:
        table = self._t("editai_export_presets")
        cur = self._conn.execute(
            f'SELECT * FROM "{table}" WHERE "profile_id" = ? AND "is_default" = 1 LIMIT 1',
            (profile_id,),
        )
        row = cur.fetchone()
        return self._row_to_dict(row) if row else None

    def create_export_preset(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._insert("editai_export_presets", data)

    def update_export_preset(
        self, preset_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_export_presets", "id", preset_id, data)

    # ──────────────────────────────────────────────
    # 10. Exports
    # ──────────────────────────────────────────────

    def create_export(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_exports", data)

    def list_exports(
        self, clip_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_exports")
        where_parts: List[str] = ['"clip_id" = ?']
        params: List[Any] = [clip_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    # ──────────────────────────────────────────────
    # 11. Jobs (background processing jobs)
    # ──────────────────────────────────────────────

    def create_job(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_jobs", data)

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_jobs", "id", job_id)

    def update_job(
        self, job_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_jobs", "id", job_id, data)

    def list_jobs(
        self,
        limit: int = 50,
        profile_id: Optional[str] = None,
        filters: Optional[QueryFilters] = None,
    ) -> QueryResult:
        table = self._t("editai_jobs")
        where_parts: List[str] = []
        params: List[Any] = []
        if profile_id:
            where_parts.append('"profile_id" = ?')
            params.append(profile_id)
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters and filters.limit is not None:
            sql += " LIMIT ?"
            params.append(filters.limit)
        else:
            sql += " LIMIT ?"
            params.append(limit)

        if filters and filters.offset is not None:
            sql += " OFFSET ?"
            params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def delete_job(self, job_id: str) -> None:
        self._delete("editai_jobs", "id", job_id)

    def cleanup_old_jobs(self, cutoff_date: datetime) -> int:
        table = self._t("editai_jobs")
        cutoff_str = cutoff_date.isoformat()
        with self._write_lock:
            cur = self._conn.execute(
                f'SELECT COUNT(*) FROM "{table}" WHERE "created_at" < ?',
                (cutoff_str,),
            )
            count = cur.fetchone()[0]
            self._conn.execute(
                f'DELETE FROM "{table}" WHERE "created_at" < ?',
                (cutoff_str,),
            )
            self._conn.commit()
        return count

    def list_jobs_by_project(
        self, project_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_jobs")
        # SQLite: use json_extract for data->project_id
        where_parts: List[str] = [
            "json_extract(\"data\", '$.project_id') = ?"
        ]
        params: List[Any] = [project_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    # ──────────────────────────────────────────────
    # 12. API Costs
    # ──────────────────────────────────────────────

    def log_cost(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("api_costs", data)

    def get_cost_summary(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("api_costs")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    # ──────────────────────────────────────────────
    # 13. Profiles
    # ──────────────────────────────────────────────

    def get_profile(self, profile_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_profiles", "id", profile_id)

    def list_profiles(self, user_id: str) -> QueryResult:
        table = self._t("editai_profiles")
        cur = self._conn.execute(
            f'SELECT * FROM "{table}" WHERE "user_id" = ?', (user_id,)
        )
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def create_profile(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_profiles", data)

    def update_profile(
        self, profile_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_profiles", "id", profile_id, data)

    def delete_profile(self, profile_id: str) -> None:
        self._delete("editai_profiles", "id", profile_id)

    def get_default_profile(
        self, user_id: str
    ) -> Optional[Dict[str, Any]]:
        table = self._t("editai_profiles")
        cur = self._conn.execute(
            f'SELECT * FROM "{table}" WHERE "user_id" = ? AND "is_default" = 1 LIMIT 1',
            (user_id,),
        )
        row = cur.fetchone()
        return self._row_to_dict(row) if row else None

    # ──────────────────────────────────────────────
    # 14. TTS Assets
    # ──────────────────────────────────────────────

    def list_tts_assets(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_tts_assets")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def get_tts_asset(self, asset_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_tts_assets", "id", asset_id)

    def create_tts_asset(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_tts_assets", data)

    def update_tts_asset(
        self, asset_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_tts_assets", "id", asset_id, data)

    def delete_tts_asset(self, asset_id: str) -> None:
        self._delete("editai_tts_assets", "id", asset_id)

    # ──────────────────────────────────────────────
    # 15. ElevenLabs Accounts
    # ──────────────────────────────────────────────

    def list_elevenlabs_accounts(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_elevenlabs_accounts")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def get_elevenlabs_account(
        self, account_id: str
    ) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_elevenlabs_accounts", "id", account_id)

    def create_elevenlabs_account(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._insert("editai_elevenlabs_accounts", data)

    def update_elevenlabs_account(
        self, account_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_elevenlabs_accounts", "id", account_id, data)

    def delete_elevenlabs_account(self, account_id: str) -> None:
        self._delete("editai_elevenlabs_accounts", "id", account_id)

    # ──────────────────────────────────────────────
    # 16. Products & Feeds
    # ──────────────────────────────────────────────

    def list_products(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        return self._execute_select("editai_products", filters)

    def get_product(self, product_id: str) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_products", "id", product_id)

    def create_product(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_products", data)

    def list_feeds(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_feeds")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def create_feed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return self._insert("editai_feeds", data)

    def update_feed(
        self, feed_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_feeds", "id", feed_id, data)

    def delete_feed(self, feed_id: str) -> None:
        self._delete("editai_feeds", "id", feed_id)

    # ──────────────────────────────────────────────
    # 17. Postiz Publications
    # ──────────────────────────────────────────────

    def create_publication(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._insert("editai_publications", data)

    def list_publications(
        self, clip_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_publications")
        where_parts: List[str] = ['"clip_id" = ?']
        params: List[Any] = [clip_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    # ──────────────────────────────────────────────
    # 18. Product Groups
    # ──────────────────────────────────────────────

    def list_product_groups(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_product_groups")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def create_product_group(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._insert("editai_product_groups", data)

    def delete_product_group(self, group_id: str) -> None:
        self._delete("editai_product_groups", "id", group_id)

    # ──────────────────────────────────────────────
    # 19. Segment Product Associations
    # ──────────────────────────────────────────────

    def list_associations(
        self, segment_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        spa_table = self._t("editai_segment_products")
        prod_table = self._t("editai_products")

        where_parts: List[str] = [f'spa."segment_id" = ?']
        params: List[Any] = [segment_id]

        sql = f"""
            SELECT spa.*, p.id AS _prod_id, p.feed_id, p.external_id,
                   p.title AS prod_title, p.brand, p.product_type,
                   p.price, p.sale_price, p.raw_price_str, p.raw_sale_price_str,
                   p.is_on_sale, p.image_link, p.local_image_path,
                   p.product_url, p.description AS prod_description,
                   p.created_at AS prod_created_at, p.updated_at AS prod_updated_at
            FROM "{spa_table}" spa
            LEFT JOIN "{prod_table}" p ON spa.catalog_product_id = p.id
        """
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        cur = self._conn.execute(sql, params)
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            prod_data = None
            if d.get("_prod_id"):
                prod_data = {
                    "id": d.pop("_prod_id"),
                    "feed_id": d.pop("feed_id", None),
                    "external_id": d.pop("external_id", None),
                    "title": d.pop("prod_title", None),
                    "brand": d.pop("brand", None),
                    "product_type": d.pop("product_type", None),
                    "price": d.pop("price", None),
                    "sale_price": d.pop("sale_price", None),
                    "raw_price_str": d.pop("raw_price_str", None),
                    "raw_sale_price_str": d.pop("raw_sale_price_str", None),
                    "is_on_sale": d.pop("is_on_sale", None),
                    "image_link": d.pop("image_link", None),
                    "local_image_path": d.pop("local_image_path", None),
                    "product_url": d.pop("product_url", None),
                    "description": d.pop("prod_description", None),
                    "created_at": d.pop("prod_created_at", None),
                    "updated_at": d.pop("prod_updated_at", None),
                }
            else:
                for k in list(d.keys()):
                    if k.startswith("_prod_") or k.startswith("prod_"):
                        d.pop(k, None)
                    if k in ("feed_id", "external_id", "brand",
                             "product_type", "price", "sale_price",
                             "raw_price_str", "raw_sale_price_str",
                             "is_on_sale", "image_link", "local_image_path",
                             "product_url"):
                        d.pop(k, None)
            # Parse JSON fields in spa row
            for key in list(d.keys()):
                if key in _JSON_COLUMNS and isinstance(d[key], str):
                    try:
                        d[key] = json.loads(d[key])
                    except (json.JSONDecodeError, TypeError):
                        pass
            d["editai_products"] = prod_data
            rows.append(d)

        return QueryResult(data=rows, count=len(rows))

    def create_association(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._insert("editai_segment_products", data)

    def update_association(
        self, assoc_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_segment_products", "id", assoc_id, data)

    def delete_association(self, assoc_id: str) -> None:
        self._delete("editai_segment_products", "id", assoc_id)

    # ──────────────────────────────────────────────
    # 20. Schedule
    # ──────────────────────────────────────────────

    def create_schedule_plan(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._insert("editai_schedule_plans", data)

    def get_schedule_plan(
        self, plan_id: str
    ) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_schedule_plans", "id", plan_id)

    def update_schedule_plan(
        self, plan_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_schedule_plans", "id", plan_id, data)

    def list_schedule_plans(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_schedule_plans")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def create_schedule_items(
        self, items: List[Dict[str, Any]]
    ) -> QueryResult:
        if not items:
            return QueryResult(data=[], count=0)
        table = self._t("editai_schedule_items")
        now = self._now()
        columns = self._get_table_columns(table)
        result_rows = []
        with self._write_lock:
            for item in items:
                if "id" not in item:
                    item["id"] = str(uuid.uuid4())
                if "created_at" not in item and "created_at" in columns:
                    item["created_at"] = now
                if "updated_at" not in item and "updated_at" in columns:
                    item["updated_at"] = now
                item = self._serialize_json_fields(item)
                cols = list(item.keys())
                placeholders = ", ".join("?" for _ in cols)
                col_names = ", ".join(f'"{c}"' for c in cols)
                vals = [item[c] for c in cols]
                self._conn.execute(
                    f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders})',
                    vals,
                )
                result_rows.append(item)
            self._conn.commit()
        return QueryResult(data=result_rows, count=len(result_rows))

    def list_schedule_items(
        self, plan_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_schedule_items")
        where_parts: List[str] = ['"plan_id" = ?']
        params: List[Any] = [plan_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "scheduled_date" ASC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def update_schedule_item(
        self, item_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_schedule_items", "id", item_id, data)

    # ──────────────────────────────────────────────
    # 21. Generation Progress
    # ──────────────────────────────────────────────

    def get_progress(
        self, project_id: str
    ) -> Optional[Dict[str, Any]]:
        return self._get_one(
            "editai_generation_progress", "project_id", project_id
        )

    def upsert_progress(
        self, project_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        table = self._t("editai_generation_progress")
        data["project_id"] = project_id
        data["updated_at"] = self._now()
        data = self._serialize_json_fields(data)
        cols = list(data.keys())
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(f'"{c}"' for c in cols)
        vals = [data[c] for c in cols]
        with self._write_lock:
            self._conn.execute(
                f'INSERT OR REPLACE INTO "{table}" ({col_names}) VALUES ({placeholders})',
                vals,
            )
            self._conn.commit()
        return self._get_one_raw(table, "project_id", project_id)

    def delete_progress(self, project_id: str) -> None:
        self._delete("editai_generation_progress", "project_id", project_id)

    # ──────────────────────────────────────────────
    # 22. Generated Images
    # ──────────────────────────────────────────────

    def create_generated_image(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._insert("editai_generated_images", data)

    def list_generated_images(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        return self._execute_select("editai_generated_images", filters)

    def get_generated_image(
        self, image_id: str
    ) -> Optional[Dict[str, Any]]:
        return self._get_one("editai_generated_images", "id", image_id)

    def update_generated_image(
        self, image_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_generated_images", "id", image_id, data)

    def delete_generated_image(self, image_id: str) -> None:
        self._delete("editai_generated_images", "id", image_id)

    # ──────────────────────────────────────────────
    # 23. Image Prompt Templates
    # ──────────────────────────────────────────────

    def list_prompt_templates(
        self, profile_id: str, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        table = self._t("editai_prompt_templates")
        where_parts: List[str] = ['"profile_id" = ?']
        params: List[Any] = [profile_id]
        self._apply_filters(where_parts, params, filters)

        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'
        else:
            sql += ' ORDER BY "created_at" DESC'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def create_prompt_template(
        self, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._insert("editai_prompt_templates", data)

    def update_prompt_template(
        self, template_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self._update("editai_prompt_templates", "id", template_id, data)

    def delete_prompt_template(self, template_id: str) -> None:
        self._delete("editai_prompt_templates", "id", template_id)

    # ──────────────────────────────────────────────
    # 24. Catalog Views (read-only)
    # ──────────────────────────────────────────────

    def list_catalog_products(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """Catalog products: JOIN products + product_feeds (no view in SQLite)."""
        prod_table = self._t("editai_products")
        feed_table = self._t("editai_feeds")

        where_parts: List[str] = []
        params: List[Any] = []
        if filters:
            for col, val in filters.eq.items():
                where_parts.append(f'p."{col}" = ?')
                params.append(val)
            for col, val in filters.neq.items():
                where_parts.append(f'p."{col}" != ?')
                params.append(val)
            for col, vals in filters.in_.items():
                if vals:
                    placeholders = ", ".join("?" for _ in vals)
                    where_parts.append(f'p."{col}" IN ({placeholders})')
                    params.extend(vals)
            for col, pattern in filters.like.items():
                where_parts.append(f'p."{col}" LIKE ? COLLATE NOCASE')
                params.append(pattern)

        sql = f"""
            SELECT p.*, f.name AS feed_name, f.profile_id
            FROM "{prod_table}" p
            LEFT JOIN "{feed_table}" f ON p.feed_id = f.id
        """
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY p."{filters.order_by}" {direction}'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

    def list_catalog_products_grouped(
        self, filters: Optional[QueryFilters] = None
    ) -> QueryResult:
        """Catalog products grouped by brand/product_type."""
        prod_table = self._t("editai_products")
        feed_table = self._t("editai_feeds")

        where_parts: List[str] = []
        params: List[Any] = []
        if filters:
            for col, val in filters.eq.items():
                where_parts.append(f'p."{col}" = ?')
                params.append(val)

        sql = f"""
            SELECT p.brand, p.product_type, COUNT(*) as product_count,
                   f.name AS feed_name, f.profile_id
            FROM "{prod_table}" p
            LEFT JOIN "{feed_table}" f ON p.feed_id = f.id
        """
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)

        sql += " GROUP BY p.brand, p.product_type, f.name, f.profile_id"

        if filters and filters.order_by:
            direction = "DESC" if filters.order_desc else "ASC"
            sql += f' ORDER BY "{filters.order_by}" {direction}'

        if filters:
            if filters.limit is not None:
                sql += " LIMIT ?"
                params.append(filters.limit)
            if filters.offset is not None:
                sql += " OFFSET ?"
                params.append(filters.offset)

        cur = self._conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))

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
        table = self._t(table_name)

        if operation == "select":
            where_parts: List[str] = []
            params: List[Any] = []
            self._apply_filters(where_parts, params, filters)

            sql = f'SELECT * FROM "{table}"'
            if where_parts:
                sql += " WHERE " + " AND ".join(where_parts)

            if filters:
                if filters.order_by:
                    direction = "DESC" if filters.order_desc else "ASC"
                    sql += f' ORDER BY "{filters.order_by}" {direction}'
                if filters.limit is not None:
                    sql += " LIMIT ?"
                    params.append(filters.limit)
                if filters.offset is not None:
                    sql += " OFFSET ?"
                    params.append(filters.offset)
                if (
                    filters.range_start is not None
                    and filters.range_end is not None
                    and filters.limit is None
                ):
                    limit = filters.range_end - filters.range_start + 1
                    sql += " LIMIT ? OFFSET ?"
                    params.extend([limit, filters.range_start])

            cur = self._conn.execute(sql, params)
            rows = [self._row_to_dict(r) for r in cur.fetchall()]

            count = len(rows)
            if filters and filters.count == "exact":
                count_where: List[str] = []
                count_params: List[Any] = []
                self._apply_filters(count_where, count_params, filters)
                count_sql = f'SELECT COUNT(*) FROM "{table}"'
                if count_where:
                    count_sql += " WHERE " + " AND ".join(count_where)
                count = self._conn.execute(count_sql, count_params).fetchone()[0]

            if filters and filters.maybe_single:
                if not rows:
                    return QueryResult(data=[], count=0)
                return QueryResult(data=[rows[0]], count=1)

            return QueryResult(data=rows, count=count)

        elif operation == "insert":
            if data is None:
                raise ValueError("data is required for insert operation")
            row = self._insert_raw(table, data)
            return QueryResult(data=[row] if row else [], count=1 if row else 0)

        elif operation == "update":
            if data is None:
                raise ValueError("data is required for update operation")
            where_parts = []
            params = []
            self._apply_filters(where_parts, params, filters)
            columns = self._get_table_columns(table)
            if "updated_at" not in data and "updated_at" in columns:
                data["updated_at"] = self._now()
            data = self._serialize_json_fields(data)
            set_clause = ", ".join(f'"{c}" = ?' for c in data.keys())
            vals = list(data.values()) + params
            sql = f'UPDATE "{table}" SET {set_clause}'
            if where_parts:
                sql += " WHERE " + " AND ".join(where_parts)
            with self._write_lock:
                self._conn.execute(sql, vals)
                self._conn.commit()
            # Return updated rows by re-selecting
            return self._reselect_after_write(table, filters)

        elif operation == "upsert":
            if data is None:
                raise ValueError("data is required for upsert operation")
            row = self._upsert_raw(table, data, filters)
            return QueryResult(data=[row] if row else [], count=1 if row else 0)

        elif operation == "delete":
            where_parts = []
            params = []
            self._apply_filters(where_parts, params, filters)
            # First select to return deleted rows
            select_sql = f'SELECT * FROM "{table}"'
            if where_parts:
                select_sql += " WHERE " + " AND ".join(where_parts)
            cur = self._conn.execute(select_sql, params)
            rows = [self._row_to_dict(r) for r in cur.fetchall()]
            # Now delete
            del_sql = f'DELETE FROM "{table}"'
            if where_parts:
                del_sql += " WHERE " + " AND ".join(where_parts)
            with self._write_lock:
                self._conn.execute(del_sql, params)
                self._conn.commit()
            return QueryResult(data=rows, count=len(rows))

        else:
            raise ValueError(
                f"Unknown operation: {operation}. Use select/insert/update/upsert/delete."
            )

    # ── table_query helpers ────────────────────────

    def _insert_raw(self, table: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert into an already-translated table name."""
        if "id" not in data:
            data["id"] = str(uuid.uuid4())
        now = self._now()
        columns = self._get_table_columns(table)
        if "created_at" not in data and "created_at" in columns:
            data["created_at"] = now
        if "updated_at" not in data and "updated_at" in columns:
            data["updated_at"] = now
        data = self._serialize_json_fields(data)
        cols = list(data.keys())
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(f'"{c}"' for c in cols)
        vals = [data[c] for c in cols]
        with self._write_lock:
            self._conn.execute(
                f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders})',
                vals,
            )
            self._conn.commit()
        return self._get_one_raw(table, "id", data["id"])

    def _upsert_raw(
        self, table: str, data: Dict[str, Any], filters: Optional[QueryFilters]
    ) -> Dict[str, Any]:
        """INSERT OR REPLACE into an already-translated table name."""
        if "id" not in data:
            data["id"] = str(uuid.uuid4())
        now = self._now()
        columns = self._get_table_columns(table)
        if "created_at" not in data and "created_at" in columns:
            data["created_at"] = now
        if "updated_at" not in data and "updated_at" in columns:
            data["updated_at"] = now
        data = self._serialize_json_fields(data)
        cols = list(data.keys())
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(f'"{c}"' for c in cols)
        vals = [data[c] for c in cols]
        with self._write_lock:
            self._conn.execute(
                f'INSERT OR REPLACE INTO "{table}" ({col_names}) VALUES ({placeholders})',
                vals,
            )
            self._conn.commit()
        return self._get_one_raw(table, "id", data["id"])

    def _reselect_after_write(
        self, table: str, filters: Optional[QueryFilters]
    ) -> QueryResult:
        """Re-select rows matching filters after an update."""
        where_parts: List[str] = []
        params: List[Any] = []
        self._apply_filters(where_parts, params, filters)
        sql = f'SELECT * FROM "{table}"'
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)
        cur = self._conn.execute(sql, params)
        rows = [self._row_to_dict(r) for r in cur.fetchall()]
        return QueryResult(data=rows, count=len(rows))
