"""Local product library store — SQLite in userData, isolated from DATA_BACKEND.

Phase D1: per-user product library (title + images + description) stored
entirely on the local machine, independent of the Supabase/SQLite repository
selected by ``data_backend``. Images live as files under
``{base_dir}/product_library/images/<product_id>/``; the DB stores relative
paths only. ``synced_at`` is reserved for a future cloud-sync phase.
"""

import json
import logging
import shutil
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS local_products (
    id          TEXT PRIMARY KEY,
    profile_id  TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    image_paths TEXT DEFAULT '[]',
    created_at  TEXT,
    updated_at  TEXT,
    synced_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_local_products_profile ON local_products(profile_id);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProductLibraryStore:
    """Tiny standalone SQLite store for the local product library."""

    def __init__(self) -> None:
        from app.config import get_settings

        settings = get_settings()
        self.base_dir: Path = settings.base_dir / "product_library"
        self.images_dir: Path = self.base_dir / "images"
        self.images_dir.mkdir(parents=True, exist_ok=True)

        self._write_lock = threading.Lock()
        self._conn = sqlite3.connect(
            str(self.base_dir / "products.db"), check_same_thread=False
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode = WAL")
        with self._write_lock:
            self._conn.executescript(_SCHEMA)
        logger.info("ProductLibraryStore initialized at %s", self.base_dir)

    # ---- helpers ----

    def _row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        d = dict(row)
        try:
            d["image_paths"] = json.loads(d.get("image_paths") or "[]")
        except (json.JSONDecodeError, TypeError):
            d["image_paths"] = []
        return d

    def image_dir(self, product_id: str) -> Path:
        return self.images_dir / product_id

    def abs_image_path(self, rel_path: str) -> Optional[Path]:
        """Resolve a stored relative path, guarding against traversal."""
        candidate = (self.base_dir / rel_path).resolve()
        try:
            candidate.relative_to(self.images_dir.resolve())
        except ValueError:
            return None
        return candidate if candidate.exists() else None

    # ---- CRUD ----

    def create(self, profile_id: str, title: str, description: str = "") -> Dict[str, Any]:
        now = _now()
        row = {
            "id": str(uuid.uuid4()),
            "profile_id": profile_id,
            "title": title,
            "description": description,
            "image_paths": [],
            "created_at": now,
            "updated_at": now,
            "synced_at": None,
        }
        with self._write_lock:
            self._conn.execute(
                "INSERT INTO local_products (id, profile_id, title, description, image_paths, created_at, updated_at, synced_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (row["id"], profile_id, title, description, "[]", now, now, None),
            )
            self._conn.commit()
        return row

    def list(self, profile_id: str) -> List[Dict[str, Any]]:
        cur = self._conn.execute(
            "SELECT * FROM local_products WHERE profile_id = ? ORDER BY created_at DESC",
            (profile_id,),
        )
        return [self._row_to_dict(r) for r in cur.fetchall()]

    def get(self, product_id: str, profile_id: str) -> Optional[Dict[str, Any]]:
        cur = self._conn.execute(
            "SELECT * FROM local_products WHERE id = ? AND profile_id = ?",
            (product_id, profile_id),
        )
        row = cur.fetchone()
        return self._row_to_dict(row) if row else None

    def update(
        self,
        product_id: str,
        profile_id: str,
        *,
        title: Optional[str] = None,
        description: Optional[str] = None,
        image_paths: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        sets, params = ["updated_at = ?"], [_now()]
        if title is not None:
            sets.append("title = ?")
            params.append(title)
        if description is not None:
            sets.append("description = ?")
            params.append(description)
        if image_paths is not None:
            sets.append("image_paths = ?")
            params.append(json.dumps(image_paths))
        params.extend([product_id, profile_id])
        with self._write_lock:
            self._conn.execute(
                f"UPDATE local_products SET {', '.join(sets)} WHERE id = ? AND profile_id = ?",
                params,
            )
            self._conn.commit()
        return self.get(product_id, profile_id)

    def delete(self, product_id: str, profile_id: str) -> bool:
        with self._write_lock:
            cur = self._conn.execute(
                "DELETE FROM local_products WHERE id = ? AND profile_id = ?",
                (product_id, profile_id),
            )
            self._conn.commit()
        if cur.rowcount:
            shutil.rmtree(self.image_dir(product_id), ignore_errors=True)
            return True
        return False


_store: Optional[ProductLibraryStore] = None
_store_lock = threading.Lock()


def get_product_library() -> ProductLibraryStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = ProductLibraryStore()
    return _store
