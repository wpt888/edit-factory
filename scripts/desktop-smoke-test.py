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
# Mock helpers (using plain setattr — no monkeypatch available outside pytest)
# ─────────────────────────────────────────────────────────────────────────────
#
# Duplicated from tests/test_pipeline_e2e_sqlite.py and tests/conftest.py —
# keep in sync if the canonical source changes. The script intentionally does
# not import from `tests/` because `tests/` is not always on the Python path
# in CI. This is a deliberate cross-tree decoupling — DO NOT change it to
# an import.


def _install_ffmpeg_mock(tmp_path: Path) -> None:
    """Replace safe_ffmpeg_run with a stub that creates placeholder output files
    and returns a successful CompletedProcess. Mutates module-level attrs of
    BOTH app.services.ffmpeg_semaphore AND app.api.pipeline_routes (pipeline_routes
    imports safe_ffmpeg_run by symbol on module load — patching only the source
    module misses the alias)."""
    def _mocked_ffmpeg(cmd, *args, **kwargs):
        for arg in cmd:
            if not isinstance(arg, str):
                continue
            lowered = arg.lower()
            if lowered.endswith((".mp4", ".jpg", ".mp3", ".wav", ".png")):
                out_path = Path(arg)
                if out_path.is_absolute() and not out_path.exists():
                    try:
                        out_path.parent.mkdir(parents=True, exist_ok=True)
                        if lowered.endswith(".mp4"):
                            out_path.write_bytes(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isomavc1")
                        else:
                            out_path.touch()
                    except (OSError, PermissionError):
                        pass
        return CompletedProcess(args=cmd, returncode=0, stdout="12.34", stderr="")

    import app.services.ffmpeg_semaphore as _ffsem
    _ffsem.safe_ffmpeg_run = _mocked_ffmpeg
    try:
        import app.api.pipeline_routes as _plr
        _plr.safe_ffmpeg_run = _mocked_ffmpeg
    except (AttributeError, ImportError):
        pass


def _install_script_generator_mock() -> None:
    """Stub Gemini/script-generator entry points so the harness needs no API keys."""
    def _mocked_generate(*args, **kwargs):
        return [{"text": "test script with keyword test", "tts_text": "test script with keyword test"}]

    for target_module, attr_name in [
        ("app.services.script_generator", "ScriptGenerator"),
        ("app.services.gemini_service", "GeminiService"),
    ]:
        try:
            import importlib
            mod = importlib.import_module(target_module)
            cls = getattr(mod, attr_name, None)
            if cls is None:
                continue
            for method_name in ("generate_scripts", "generate"):
                if hasattr(cls, method_name):
                    setattr(cls, method_name, _mocked_generate)
        except (ImportError, ModuleNotFoundError, AttributeError):
            continue


def _install_tts_mock(tmp_path: Path) -> None:
    """Stub TTS providers to return a deterministic short SRT + fixture audio path."""
    fixture_audio = tmp_path / "fixture_tts.mp3"
    fixture_audio.write_bytes(b"fake mp3 audio content")

    def _mocked_synthesize(self, text, *args, **kwargs):
        return (
            str(fixture_audio),
            1.0,
            "1\n00:00:00,000 --> 00:00:01,000\n" + text + "\n",
        )

    for target_module, attr_name in [
        ("app.services.tts_provider", "TTSProvider"),
        ("app.services.elevenlabs_tts", "ElevenLabsTTS"),
        ("app.services.edge_tts", "EdgeTTSProvider"),
    ]:
        try:
            import importlib
            mod = importlib.import_module(target_module)
            cls = getattr(mod, attr_name, None)
            if cls is None:
                continue
            if hasattr(cls, "synthesize"):
                setattr(cls, "synthesize", _mocked_synthesize)
        except (ImportError, ModuleNotFoundError, AttributeError):
            continue


# ─────────────────────────────────────────────────────────────────────────────
# Seed helpers (duplicated from tests/conftest.py — see note above)
# ─────────────────────────────────────────────────────────────────────────────


def _seed_source_video(repo, profile_id, **overrides):
    """Create a minimal source_video record in the SQLite repo."""
    data = {
        "id": str(uuid.uuid4()),
        "filename": "test.mp4",
        "file_path": "/tmp/test.mp4",
        "duration": 10.0,
        "width": 1920,
        "height": 1080,
        "file_size": 1024,
        "status": "ready",
        "profile_id": profile_id,
        **overrides,
    }
    return repo.create_source_video(data)


def _seed_segment(repo, profile_id, source_video_id, **overrides):
    """Create a minimal segment record in the SQLite repo."""
    data = {
        "id": str(uuid.uuid4()),
        "source_video_id": source_video_id,
        "start_time": 0.0,
        "end_time": 2.0,
        "duration": 2.0,
        "profile_id": profile_id,
        **overrides,
    }
    return repo.create_segment(data)


def _seed_export_preset(repo, name="TikTok", **overrides):
    """Create a minimal export preset record in the SQLite repo."""
    data = {
        "name": name,
        "is_default": 0,
        "width": 1080,
        "height": 1920,
        "fps": 30,
        **overrides,
    }
    return repo.create_export_preset(data)


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

    # Install mocks BEFORE any route calls so all service stubs are in place
    _install_ffmpeg_mock(_TMP_BASE)
    _install_script_generator_mock()
    _install_tts_mock(_TMP_BASE)

    # Seed prerequisites: source video → segment → export preset
    source_video = _seed_source_video(repo, profile_id)
    _seed_segment(repo, profile_id, source_video["id"])
    _seed_export_preset(repo, "TikTok")

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
