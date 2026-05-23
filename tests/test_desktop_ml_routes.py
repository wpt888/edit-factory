"""
Tests for POST /api/v1/desktop/ml/download.

All tests use httpx.AsyncClient with httpx.ASGITransport (NOT TestClient) for
SSE framing assertions. Upstream HTTP is mocked via httpx.MockTransport so NO
real network request goes out. base_dir is patched to tmp_path for filesystem
isolation. Each test completes in < 5 seconds.
"""
import asyncio
import gzip
import hashlib
import io
import json
import os
import sys
import tarfile as _tarfile
import time
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

# ---------------------------------------------------------------------------
# Pre-import: stub any modules that may fail to import on Python 3.13+
# Some packages (e.g. google-genai 1.56.0) have internal incompatibilities
# with Python 3.13. Mock them before importing app.main to prevent collection
# errors. This is identical to what the CI environment (Python 3.11) avoids
# naturally — these stubs are only loaded when the real module fails.
# ---------------------------------------------------------------------------

_STUBS_NEEDED = [
    "google.genai",
    "google.genai.types",
    "google.genai.client",
    "google",
]
for _mod_name in _STUBS_NEEDED:
    if _mod_name not in sys.modules:
        sys.modules[_mod_name] = MagicMock()

# Also stub optional heavy ML deps that may be absent
for _opt_mod in [
    "torch", "torchaudio", "whisper", "TTS", "TTS.api",
    "silero_vad", "librosa", "pydub", "soundfile", "kokoro",
]:
    if _opt_mod not in sys.modules:
        sys.modules[_opt_mod] = MagicMock()

# ---------------------------------------------------------------------------
# Module-level test tarball fixture (built once per session)
# ---------------------------------------------------------------------------

def _build_test_tarball() -> bytes:
    """Build a minimal in-memory tar.gz containing marker.txt."""
    buf = io.BytesIO()
    with _tarfile.open(fileobj=buf, mode="w:gz") as tar:
        content = b"hello\n"
        info = _tarfile.TarInfo(name="marker.txt")
        info.size = len(content)
        tar.addfile(info, io.BytesIO(content))
    return buf.getvalue()


# Module-level constants computed once
_TARBALL_BYTES: bytes = _build_test_tarball()
_TARBALL_SHA256: str = hashlib.sha256(_TARBALL_BYTES).hexdigest()

# ---------------------------------------------------------------------------
# Import the ASGI app (module-level so env is set once)
# ---------------------------------------------------------------------------

os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_KEY", "")
os.environ.setdefault("DATA_BACKEND", "sqlite")

# Clear settings cache so our env vars take effect
from app.config import get_settings as _get_settings  # noqa: E402
try:
    _get_settings.cache_clear()
except AttributeError:
    pass

# Import the app (triggers full import chain)
from app.main import app  # noqa: E402

# ---------------------------------------------------------------------------
# Autouse fixture: reset module-level download flag between tests
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_download_flag():
    import app.api.desktop_ml_routes as mod
    mod._download_in_progress = False
    # Reset sse_starlette AppStatus event so each asyncio.run() gets a fresh event loop binding.
    # Without this, the second test's asyncio.run() creates a new event loop but
    # sse_starlette's module-level AppStatus.should_exit_event is bound to the first loop.
    try:
        from sse_starlette.sse import AppStatus
        AppStatus.should_exit_event = None
    except Exception:
        pass
    yield
    mod._download_in_progress = False
    try:
        from sse_starlette.sse import AppStatus
        AppStatus.should_exit_event = None
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Helper: build a MockTransport that serves the test tarball
# ---------------------------------------------------------------------------

def _make_mock_transport(
    tarball: bytes = None,
    sha256_hex: str = None,
    first_response_status: int = 200,
) -> httpx.MockTransport:
    """Return an httpx.MockTransport that serves the tarball + sha256 sibling."""
    if tarball is None:
        tarball = _TARBALL_BYTES
    if sha256_hex is None:
        sha256_hex = _TARBALL_SHA256

    def _handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.endswith(".sha256"):
            filename = url.rsplit("/", 1)[-1]
            body = f"{sha256_hex}  {filename}\n".encode()
            return httpx.Response(200, content=body)

        # Main tarball request
        range_header = request.headers.get("range", "")
        if range_header and range_header.startswith("bytes="):
            start_str = range_header[6:].rstrip("-")
            try:
                start = int(start_str)
            except ValueError:
                start = 0

            if first_response_status == 416:
                return httpx.Response(416, content=b"")

            remaining = tarball[start:]
            return httpx.Response(
                206,
                headers={"Content-Length": str(len(remaining))},
                stream=httpx.ByteStream(remaining),
            )

        # No Range header — serve full file
        return httpx.Response(
            first_response_status,
            headers={"Content-Length": str(len(tarball))},
            stream=httpx.ByteStream(tarball),
        )

    return httpx.MockTransport(_handler)


def _patch_httpx_client(monkeypatch, transport: httpx.MockTransport):
    """Patch the _AsyncClient alias in desktop_ml_routes to use the given transport.
    We patch the module-level _AsyncClient alias (not httpx.AsyncClient directly) so
    the patch stays scoped to desktop_ml_routes and does not replace httpx.AsyncClient
    in the test module itself (which would break the ASGI streaming client)."""
    _real_cls = httpx.AsyncClient

    def _mock_async_client(*args, **kwargs):
        kwargs.pop("transport", None)
        return _real_cls(transport=transport, follow_redirects=kwargs.get("follow_redirects", True))

    monkeypatch.setattr("app.api.desktop_ml_routes._AsyncClient", _mock_async_client)


def _expected_filename() -> str:
    import app.api.desktop_ml_routes as mod
    return mod._resolve_bundle_filename()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestDownloadSSEContentType:
    """test_download_returns_event_stream_content_type"""

    def test_download_returns_event_stream_content_type(self, monkeypatch, tmp_path):
        """POST returns 200 with Content-Type starting 'text/event-stream'."""
        monkeypatch.setattr("app.api.desktop_ml_routes.get_base_dir", lambda: tmp_path)
        transport = _make_mock_transport()
        _patch_httpx_client(monkeypatch, transport)

        async def _run():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://localhost"
            ) as ac:
                async with ac.stream("POST", "http://localhost/api/v1/desktop/ml/download") as response:
                    assert response.status_code == 200
                    ct = response.headers.get("content-type", "")
                    assert ct.startswith("text/event-stream"), f"Expected text/event-stream, got: {ct}"
                    async for _ in response.aiter_bytes():
                        pass

        asyncio.run(_run())


class TestDownloadHappyPath:
    """test_download_emits_done_and_writes_installed_marker"""

    def test_download_emits_done_and_writes_installed_marker(self, monkeypatch, tmp_path):
        """Full happy path: SSE body has progress+verify+unpack+done events; .installed written."""
        monkeypatch.setattr("app.api.desktop_ml_routes.get_base_dir", lambda: tmp_path)
        transport = _make_mock_transport()
        _patch_httpx_client(monkeypatch, transport)

        async def _run():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://localhost"
            ) as ac:
                async with ac.stream("POST", "http://localhost/api/v1/desktop/ml/download") as response:
                    assert response.status_code == 200
                    body = b""
                    async for chunk in response.aiter_bytes():
                        body += chunk
            return body

        body = asyncio.run(_run())

        assert b"event: progress" in body, f"No progress event in body: {body[:500]}"
        assert b"event: done" in body, f"No done event in body: {body[:500]}"

        lines = body.decode(errors="replace").splitlines()
        done_data = None
        for i, line in enumerate(lines):
            if line.strip() == "event: done":
                for j in range(i + 1, min(i + 5, len(lines))):
                    if lines[j].startswith("data: "):
                        done_data = json.loads(lines[j][6:])
                        break
                break

        assert done_data is not None, f"Could not find done event data in: {body[:1000]}"
        assert done_data.get("status") == "installed", f"done.status != 'installed': {done_data}"
        assert done_data.get("version") == "0.1.0", f"done.version != '0.1.0': {done_data}"

        installed_path = tmp_path / "ml" / ".installed"
        assert installed_path.exists(), f".installed not found at {installed_path}"
        assert installed_path.read_text(encoding="utf-8") == "0.1.0\n"

        filename = _expected_filename()
        partial_path = tmp_path / "ml" / ".partial" / filename
        assert not partial_path.exists(), f".partial file not cleaned up: {partial_path}"

        staging_path = tmp_path / "ml" / ".staging" / "0.1.0"
        assert not staging_path.exists(), f".staging dir not cleaned up: {staging_path}"


class TestDownloadSHA256Mismatch:
    """test_download_emits_error_on_sha256_mismatch"""

    def test_download_emits_error_on_sha256_mismatch(self, monkeypatch, tmp_path):
        """Mocked .sha256 returns wrong hex; response contains event: error with stage=verify; .installed must NOT exist."""
        monkeypatch.setattr("app.api.desktop_ml_routes.get_base_dir", lambda: tmp_path)
        wrong_hex = "a" * 64
        transport = _make_mock_transport(sha256_hex=wrong_hex)
        _patch_httpx_client(monkeypatch, transport)

        async def _run():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://localhost"
            ) as ac:
                async with ac.stream("POST", "http://localhost/api/v1/desktop/ml/download") as response:
                    body = b""
                    async for chunk in response.aiter_bytes():
                        body += chunk
            return body

        body = asyncio.run(_run())

        assert b"event: error" in body, f"No error event in body: {body[:500]}"

        lines = body.decode(errors="replace").splitlines()
        error_data = None
        for i, line in enumerate(lines):
            if line.strip() == "event: error":
                for j in range(i + 1, min(i + 5, len(lines))):
                    if lines[j].startswith("data: "):
                        error_data = json.loads(lines[j][6:])
                        break
                break

        assert error_data is not None, f"Could not parse error event: {body[:1000]}"
        assert error_data.get("stage") == "verify", f"error.stage != 'verify': {error_data}"

        installed_path = tmp_path / "ml" / ".installed"
        assert not installed_path.exists(), f".installed should not exist after sha256 mismatch"

        filename = _expected_filename()
        partial_path = tmp_path / "ml" / ".partial" / filename
        assert not partial_path.exists(), f".partial should be deleted after sha256 mismatch"


class TestDownloadRangeResume:
    """test_download_resumes_with_range_header"""

    def test_download_resumes_with_range_header(self, monkeypatch, tmp_path):
        """Pre-existing .partial/<filename> with 256 bytes triggers Range: bytes=256-; final .installed exists."""
        import app.api.desktop_ml_routes as mod
        monkeypatch.setattr("app.api.desktop_ml_routes.get_base_dir", lambda: tmp_path)

        filename = mod._resolve_bundle_filename()
        partial_dir = tmp_path / "ml" / ".partial"
        partial_dir.mkdir(parents=True, exist_ok=True)
        partial_path = partial_dir / filename

        first_256 = _TARBALL_BYTES[:256]
        partial_path.write_bytes(first_256)

        received_range_headers = []

        def _handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if url.endswith(".sha256"):
                body = f"{_TARBALL_SHA256}  {url.rsplit('/', 1)[-1]}\n".encode()
                return httpx.Response(200, content=body)

            range_header = request.headers.get("range", "")
            received_range_headers.append(range_header)

            assert range_header == "bytes=256-", f"Expected 'bytes=256-', got: {range_header!r}"

            remaining = _TARBALL_BYTES[256:]
            return httpx.Response(
                206,
                headers={"Content-Length": str(len(remaining))},
                stream=httpx.ByteStream(remaining),
            )

        transport = httpx.MockTransport(_handler)
        _patch_httpx_client(monkeypatch, transport)

        async def _run():
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://localhost"
            ) as ac:
                async with ac.stream("POST", "http://localhost/api/v1/desktop/ml/download") as response:
                    body = b""
                    async for chunk in response.aiter_bytes():
                        body += chunk
            return body

        body = asyncio.run(_run())

        assert len(received_range_headers) > 0, "No Range header was seen by mock transport"
        assert received_range_headers[0] == "bytes=256-"

        installed_path = tmp_path / "ml" / ".installed"
        assert installed_path.exists(), f".installed not found after resume: {body[:500]}"
        assert installed_path.read_text(encoding="utf-8") == "0.1.0\n"


class TestDownload409Conflict:
    """test_download_409_on_concurrent_invocation"""

    def test_download_409_on_concurrent_invocation(self, monkeypatch, tmp_path):
        """Setting _download_in_progress=True makes POST return 409 JSON (NOT SSE)."""
        import app.api.desktop_ml_routes as mod
        monkeypatch.setattr("app.api.desktop_ml_routes.get_base_dir", lambda: tmp_path)
        mod._download_in_progress = True

        from fastapi.testclient import TestClient

        client = TestClient(app, raise_server_exceptions=False)
        response = client.post("/api/v1/desktop/ml/download")

        assert response.status_code == 409, f"Expected 409, got {response.status_code}"
        body = response.json()
        assert body.get("error") == "download_in_progress", f"Unexpected body: {body}"


class TestDownloadUnsupportedPlatform:
    """test_download_unsupported_platform_returns_400"""

    def test_download_unsupported_platform_returns_400(self, monkeypatch, tmp_path):
        """monkeypatching sys.platform to 'freebsd-15' returns 400 with unsupported platform detail."""
        monkeypatch.setattr("app.api.desktop_ml_routes.get_base_dir", lambda: tmp_path)

        mock_sys = types.ModuleType("_mock_sys")
        mock_sys.platform = "freebsd-15"
        monkeypatch.setattr("app.api.desktop_ml_routes.sys", mock_sys)

        from fastapi.testclient import TestClient

        client = TestClient(app, raise_server_exceptions=False)
        response = client.post("/api/v1/desktop/ml/download")

        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        body = response.json()
        detail = body.get("detail", "")
        assert "Unsupported platform" in detail, f"Expected 'Unsupported platform' in detail: {body}"
        assert "freebsd-15" in detail, f"Expected 'freebsd-15' in detail: {body}"
