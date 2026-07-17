"""Local product library store — SQLite in userData, isolated from DATA_BACKEND.

Phase D1: per-user product library (title + images + description) stored
entirely on the local machine, independent of the Supabase/SQLite repository
selected by ``data_backend``. Images live as files under
``{base_dir}/product_library/images/<product_id>/``; the DB stores relative
paths only. ``synced_at`` is reserved for a future cloud-sync phase.
"""

import json
import hashlib
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

CREATE TABLE IF NOT EXISTS product_sources (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL,
    name            TEXT NOT NULL,
    source_type     TEXT NOT NULL,
    source_url      TEXT,
    mapping_json    TEXT DEFAULT '{}',
    headers_json    TEXT DEFAULT '[]',
    last_synced_at  TEXT,
    sync_status     TEXT DEFAULT 'idle',
    sync_error      TEXT,
    created_at      TEXT,
    updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_product_sources_profile ON product_sources(profile_id);
"""

_PRODUCT_COLUMNS = {
    "source_id": "TEXT",
    "source_type": "TEXT DEFAULT 'manual'",
    "external_id": "TEXT",
    "image_links": "TEXT DEFAULT '[]'",
    "brand": "TEXT DEFAULT ''",
    "category": "TEXT DEFAULT ''",
    "sku": "TEXT DEFAULT ''",
    "price": "TEXT DEFAULT ''",
    "sale_price": "TEXT DEFAULT ''",
    "product_url": "TEXT DEFAULT ''",
    "extra_fields": "TEXT DEFAULT '{}'",
}


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
            existing = {
                row[1] for row in self._conn.execute("PRAGMA table_info(local_products)").fetchall()
            }
            for column, definition in _PRODUCT_COLUMNS.items():
                if column not in existing:
                    self._conn.execute(f"ALTER TABLE local_products ADD COLUMN {column} {definition}")
            self._conn.execute("DROP INDEX IF EXISTS idx_local_products_source_external")
            self._conn.execute(
                "CREATE UNIQUE INDEX idx_local_products_source_external "
                "ON local_products(source_id, external_id)"
            )
            self._conn.commit()
        logger.info("ProductLibraryStore initialized at %s", self.base_dir)

    # ---- helpers ----

    def _row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        d = dict(row)
        for field, fallback in (("image_paths", []), ("image_links", []), ("extra_fields", {})):
            try:
                d[field] = json.loads(d.get(field) or json.dumps(fallback))
            except (json.JSONDecodeError, TypeError):
                d[field] = fallback
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
            "source_id": None,
            "source_type": "manual",
            "external_id": None,
            "image_links": [],
            "brand": "",
            "category": "",
            "sku": "",
            "price": "",
            "sale_price": "",
            "product_url": "",
            "extra_fields": {},
        }
        with self._write_lock:
            self._conn.execute(
                "INSERT INTO local_products (id, profile_id, title, description, image_paths, created_at, updated_at, synced_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (row["id"], profile_id, title, description, "[]", now, now, None),
            )
            self._conn.commit()
        return row

    def create_source(
        self,
        profile_id: str,
        name: str,
        source_type: str,
        source_url: str = "",
        mapping: Optional[Dict[str, Any]] = None,
        headers: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        now = _now()
        source = {
            "id": str(uuid.uuid4()),
            "profile_id": profile_id,
            "name": name,
            "source_type": source_type,
            "source_url": source_url,
            "mapping": mapping or {},
            "headers": headers or [],
            "last_synced_at": None,
            "sync_status": "idle",
            "sync_error": None,
            "created_at": now,
            "updated_at": now,
        }
        with self._write_lock:
            self._conn.execute(
                "INSERT INTO product_sources (id, profile_id, name, source_type, source_url, mapping_json, headers_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (source["id"], profile_id, name, source_type, source_url,
                 json.dumps(source["mapping"]), json.dumps(source["headers"]), now, now),
            )
            self._conn.commit()
        return source

    @staticmethod
    def _source_row(row: sqlite3.Row) -> Dict[str, Any]:
        data = dict(row)
        data["mapping"] = json.loads(data.pop("mapping_json", "{}") or "{}")
        data["headers"] = json.loads(data.pop("headers_json", "[]") or "[]")
        return data

    def list_sources(self, profile_id: str) -> List[Dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM product_sources WHERE profile_id = ? ORDER BY created_at DESC", (profile_id,)
        ).fetchall()
        return [self._source_row(row) for row in rows]

    def get_source(self, source_id: str, profile_id: str) -> Optional[Dict[str, Any]]:
        row = self._conn.execute(
            "SELECT * FROM product_sources WHERE id = ? AND profile_id = ?", (source_id, profile_id)
        ).fetchone()
        return self._source_row(row) if row else None

    def set_source_status(self, source_id: str, profile_id: str, status: str, error: Optional[str] = None) -> None:
        now = _now()
        with self._write_lock:
            self._conn.execute(
                "UPDATE product_sources SET sync_status = ?, sync_error = ?, last_synced_at = ?, updated_at = ? "
                "WHERE id = ? AND profile_id = ?",
                (status, error, now if status == "idle" else None, now, source_id, profile_id),
            )
            self._conn.commit()

    def import_products(
        self,
        profile_id: str,
        source: Dict[str, Any],
        products: List[Dict[str, Any]],
    ) -> Dict[str, int]:
        """Replace one source snapshot using stable upserts, preserving all columns."""
        now = _now()
        source_id = source["id"]
        imported_ids: List[str] = []
        with self._write_lock:
            for product in products:
                external_id = product.get("external_id") or hashlib.sha256(
                    json.dumps(product.get("extra_fields", {}), sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
                ).hexdigest()[:24]
                product_id = str(uuid.uuid4())
                imported_ids.append(external_id)
                self._conn.execute(
                    "INSERT INTO local_products (id, profile_id, title, description, image_paths, created_at, updated_at, "
                    "source_id, source_type, external_id, image_links, brand, category, sku, price, sale_price, product_url, extra_fields) "
                    "VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(source_id, external_id) DO UPDATE SET title=excluded.title, description=excluded.description, "
                    "updated_at=excluded.updated_at, image_links=excluded.image_links, brand=excluded.brand, category=excluded.category, "
                    "sku=excluded.sku, price=excluded.price, sale_price=excluded.sale_price, product_url=excluded.product_url, "
                    "extra_fields=excluded.extra_fields",
                    (product_id, profile_id, product["title"], product.get("description", ""), now, now,
                     source_id, source["source_type"], external_id, json.dumps(product.get("image_links", [])),
                     product.get("brand", ""), product.get("category", ""), product.get("sku", ""),
                     product.get("price", ""), product.get("sale_price", ""), product.get("product_url", ""),
                     json.dumps(product.get("extra_fields", {}), ensure_ascii=False, default=str)),
                )
            if imported_ids:
                placeholders = ",".join("?" for _ in imported_ids)
                self._conn.execute(
                    f"DELETE FROM local_products WHERE source_id = ? AND external_id NOT IN ({placeholders})",
                    [source_id, *imported_ids],
                )
            else:
                self._conn.execute("DELETE FROM local_products WHERE source_id = ?", (source_id,))
            self._conn.commit()
        return {"imported": len(products)}

    def list(
        self,
        profile_id: str,
        *,
        search: str = "",
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        where = "profile_id = ?"
        params: List[Any] = [profile_id]
        if search:
            where += (
                " AND (title LIKE ? OR description LIKE ? OR sku LIKE ? "
                "OR external_id LIKE ? OR brand LIKE ? OR category LIKE ? "
                "OR extra_fields LIKE ?)"
            )
            term = f"%{search}%"
            params.extend([term] * 7)
        sql = f"SELECT * FROM local_products WHERE {where} ORDER BY created_at DESC"
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            params.extend([limit, offset])
        cur = self._conn.execute(sql, params)
        return [self._row_to_dict(r) for r in cur.fetchall()]

    def count(self, profile_id: str, search: str = "") -> int:
        where = "profile_id = ?"
        params: List[Any] = [profile_id]
        if search:
            where += (
                " AND (title LIKE ? OR description LIKE ? OR sku LIKE ? "
                "OR external_id LIKE ? OR brand LIKE ? OR category LIKE ? "
                "OR extra_fields LIKE ?)"
            )
            term = f"%{search}%"
            params.extend([term] * 7)
        row = self._conn.execute(
            f"SELECT COUNT(*) FROM local_products WHERE {where}", params
        ).fetchone()
        return int(row[0]) if row else 0

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
