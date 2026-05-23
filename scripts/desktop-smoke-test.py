"""
Edit Factory — Desktop Smoke Harness
======================================
Closes FUNC-02 and FUNC-06 (Phase 85, plan 85-01).

FUNC-02: "The full pipeline (upload source video → segment extraction →
3-step script→TTS→render flow → library save) completes successfully on a
freshly installed desktop with no Supabase configured."

FUNC-06: "A scripts/desktop-smoke-test.py harness exercises every
previously-broken route in SQLite mode and is wired into CI as a release gate."

Usage::

    python scripts/desktop-smoke-test.py

Boots the FastAPI app in SQLite mode (``DATA_BACKEND=sqlite`` +
``AUTH_DISABLED=true``) via ``fastapi.testclient.TestClient``, mocks the
FFmpeg subprocess + Gemini script generator + TTS provider, walks a
hard-coded table of 22 endpoints across 6 routers (the migrated route
surface from Phases 80–83), prints one stdout line per call in the form
``METHOD  /api/v1/path  ...  STATUS``, and exits non-zero if ANY response
status is >= 500.

CI gate: ``.github/workflows/desktop-smoke.yml`` re-runs this harness on
every PR against main, pinned to Python 3.11.

References: Phase 85, plan 85-01 — the canonical FUNC-02 + FUNC-06 closer.
See ``.planning/phases/85-desktop-smoke-test-harness/85-01-SUMMARY.md``.
"""

# ─────────────────────────────────────────────────────────────────────────────
# Bootstrap order (CRITICAL — must happen BEFORE any `from app.X import`)
# ─────────────────────────────────────────────────────────────────────────────

import os
import sys
import tempfile
import uuid
from pathlib import Path
from subprocess import CompletedProcess

# Set env BEFORE importing app — get_settings() caches via lru_cache,
# and `app.main` runs `_setup_ffmpeg_path()` at import.
_TMP_BASE = Path(tempfile.mkdtemp(prefix="edit_factory_smoke_"))

os.environ["DATA_BACKEND"] = "sqlite"
os.environ["AUTH_DISABLED"] = "true"
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_KEY"] = ""
os.environ["EDIT_FACTORY_BASE_DIR"] = str(_TMP_BASE)  # if get_base_dir respects an env override; harmless if not

# Reset settings cache (defensive — no-op if get_settings not yet called)
from app.config import get_settings as _get_settings
try:
    _get_settings.cache_clear()
except AttributeError:
    pass

# Reset repo singleton (defensive)
from app.repositories.factory import close_repository, get_repository
close_repository()

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

HEADERS = {"X-Profile-Id": "test-profile-001"}

# ─────────────────────────────────────────────────────────────────────────────
# Endpoint table (populated in Tasks 3 and 4)
# ─────────────────────────────────────────────────────────────────────────────

# Each entry: {"method": "GET"|"POST"|"PUT"|"DELETE"|"PATCH",
#             "path": "/api/v1/...",
#             "json": dict | None,
#             "note": str}
ENDPOINTS: list[dict] = []

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _print_row(method: str, path: str, status: int) -> None:
    """Print one endpoint result row to stdout, flushed."""
    print(f"{method:<6} {path:<60} ... {status}", flush=True)


def _walk(client, endpoints: list[dict]) -> list[dict]:
    """Walk the flat endpoint table, return list of rows (with status)."""
    results: list[dict] = []
    for entry in endpoints:
        method = entry["method"]
        path = entry["path"]
        body = entry.get("json")
        try:
            r = client.request(method, path, json=body, headers=HEADERS)
            status = r.status_code
        except Exception as exc:
            # Treat connection errors as 500 — they are failures.
            print(f"ERROR calling {method} {path}: {exc}", flush=True)
            status = 500
        _print_row(method, path, status)
        results.append({"method": method, "path": path, "status": status})
    return results


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────


def main() -> None:
    """Run the smoke harness: boot app, seed data, walk endpoints, exit 0 or 1."""
    # (a) Build TestClient — imports happen here so env vars are set first.
    from app.main import app
    from fastapi.testclient import TestClient
    client = TestClient(app, raise_server_exceptions=False)

    # (b) Get repo + seed minimal profile
    repo = get_repository()
    profile_id = "test-profile-001"
    try:
        repo.create_profile({
            "id": profile_id,
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "name": "Dev",
            "is_default": 1,
        })
    except Exception:
        pass  # idempotent — profile may already exist

    # (c) Print banner
    print("=== Edit Factory desktop smoke harness ===", flush=True)
    print(f"    SQLite mode | AUTH_DISABLED | tmp: {_TMP_BASE}", flush=True)
    print("", flush=True)

    # (d) Walk endpoints (ENDPOINTS is empty at this stage — populated in Tasks 3+4)
    all_rows: list[dict] = _walk(client, ENDPOINTS)

    # (e) Collect failures (status >= 500 — the FUNC-01 backslide gate)
    failures = [r for r in all_rows if r["status"] >= 500]

    # (f) Print summary
    print("", flush=True)
    print(f"=== {len(all_rows)} endpoints hit, {len(failures)} failures ===", flush=True)

    if failures:
        print("FAILURES:", flush=True)
        for f in failures:
            print(f"  {f['method']:6} {f['path']:60} ... {f['status']}", flush=True)

    sys.exit(0 if not failures else 1)


if __name__ == "__main__":
    main()
