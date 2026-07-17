"""Regression check for Context Library searches by imported SKU."""

import importlib.util
import sqlite3
import unittest
from pathlib import Path

_MODULE_PATH = Path(__file__).parent.parent / "app" / "repositories" / "product_library.py"
_SPEC = importlib.util.spec_from_file_location("product_library_under_test", _MODULE_PATH)
assert _SPEC and _SPEC.loader
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)
ProductLibraryStore = _MODULE.ProductLibraryStore


class ProductLibrarySearchTests(unittest.TestCase):
    def test_search_finds_imported_item_by_sku(self) -> None:
        store = ProductLibraryStore.__new__(ProductLibraryStore)
        store._conn = sqlite3.connect(":memory:")
        store._conn.row_factory = sqlite3.Row
        store._conn.execute(
            """
            CREATE TABLE local_products (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                sku TEXT DEFAULT '',
                external_id TEXT,
                brand TEXT DEFAULT '',
                category TEXT DEFAULT '',
                extra_fields TEXT DEFAULT '{}',
                created_at TEXT
            )
            """
        )
        store._conn.execute(
            """
            INSERT INTO local_products
                (id, profile_id, title, description, sku, extra_fields, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "item-1",
                "profile-1",
                "Fes călduros de iarnă",
                "Descriere produs",
                "H6017-2",
                "{}",
                "2026-07-16T00:00:00Z",
            ),
        )

        results = store.list("profile-1", search="H6017-2")

        self.assertEqual([item["id"] for item in results], ["item-1"])
        self.assertEqual(store.count("profile-1", search="H6017-2"), 1)
        self.assertEqual(store.count("profile-1", search="H6017"), 1)


if __name__ == "__main__":
    unittest.main()
