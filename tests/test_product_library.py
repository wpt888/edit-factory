"""Self-check for the local product library store (Phase D1).

Run directly: python tests/test_product_library.py
Creates a product, reads it back, attaches an image, resolves its path,
deletes everything — asserts on every step. Uses a temp base_dir so the
real userData store is untouched.
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))


def main() -> None:
    tmp = tempfile.mkdtemp(prefix="prodlib_test_")
    os.environ.pop("DESKTOP_MODE", None)  # keep config out of APPDATA

    from app.config import get_settings
    get_settings.cache_clear() if hasattr(get_settings, "cache_clear") else None
    settings = get_settings()
    settings.base_dir = Path(tmp)

    import app.repositories.product_library as pl
    pl._store = None  # fresh store bound to the temp dir
    store = pl.get_product_library()

    profile = "test-profile"

    # create
    product = store.create(profile, "Parfum Test 50ml", "O aromă de test.")
    assert product["id"], "create() must return an id"
    assert product["title"] == "Parfum Test 50ml"
    assert product["synced_at"] is None

    # read back
    fetched = store.get(product["id"], profile)
    assert fetched is not None, "get() must find the created product"
    assert fetched["description"] == "O aromă de test."

    # profile isolation
    assert store.get(product["id"], "other-profile") is None, "must not leak across profiles"

    # attach an image file
    img_dir = store.image_dir(product["id"])
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / "test.jpg").write_bytes(b"\xff\xd8\xff\xe0fakejpeg")
    rel = f"images/{product['id']}/test.jpg"
    updated = store.update(product["id"], profile, image_paths=[rel])
    assert updated["image_paths"] == [rel]

    # resolve image path (with traversal guard)
    abs_path = store.abs_image_path(rel)
    assert abs_path is not None and abs_path.exists(), "image path must resolve"
    assert store.abs_image_path("../../../etc/passwd") is None, "traversal must be blocked"

    # list
    items = store.list(profile)
    assert len(items) == 1 and items[0]["id"] == product["id"]

    # update fields
    updated = store.update(product["id"], profile, title="Parfum Editat", description="Nou.")
    assert updated["title"] == "Parfum Editat" and updated["description"] == "Nou."

    # delete removes row + files
    assert store.delete(product["id"], profile) is True
    assert store.get(product["id"], profile) is None
    assert not img_dir.exists(), "image dir must be removed on delete"
    assert store.delete(product["id"], profile) is False, "second delete is a no-op"

    print("test_product_library: ALL ASSERTIONS PASSED")


if __name__ == "__main__":
    main()
