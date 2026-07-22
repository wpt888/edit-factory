"""Tests for app.ffmpeg_setup._resolve_ffmpeg_path() — FUNC-05.

Resolver order is env → bundled → system PATH (per v13-ROADMAP.md line 101).
Tests target the pure function _resolve_ffmpeg_path() not the side-effecting
wrapper _setup_ffmpeg_path() — the wrapper only mutates os.environ['PATH'].

NOTE: Tests import from app.ffmpeg_setup (thin module, no FastAPI/scipy deps)
rather than app.main to allow testing on Python 3.14 where scipy has no wheel.
app/main.py re-exports _resolve_ffmpeg_path via a def-stub that delegates to
app.ffmpeg_setup — the resolver logic is identical.
"""
import sys
import shutil
import stat
from pathlib import Path
import pytest

from app.ffmpeg_setup import _resolve_ffmpeg_path


def _make_exe(path: Path) -> Path:
    """Create a file and mark it executable (POSIX). Returns the path."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\necho fake ffmpeg")
    if sys.platform != "win32":
        path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return path


def _make_dir_with_ffmpeg(parent: Path) -> Path:
    """Create a bin/ dir containing a fake ffmpeg(.exe). Returns the bin dir."""
    parent.mkdir(parents=True, exist_ok=True)
    exe_name = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
    _make_exe(parent / exe_name)
    return parent


def test_env_binary_existing_executable_wins(monkeypatch, tmp_path):
    """FFMPEG_BINARY env var pointing to an existing executable returns its parent dir."""
    fake_ffmpeg = _make_exe(tmp_path / "custom" / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"))
    monkeypatch.setenv("FFMPEG_BINARY", str(fake_ffmpeg))
    monkeypatch.delenv("DESKTOP_MODE", raising=False)
    monkeypatch.delenv("RESOURCES_PATH", raising=False)
    # Block PATH discovery so we know env override is what won
    monkeypatch.setattr(shutil, "which", lambda _: None)
    result = _resolve_ffmpeg_path()
    assert result == fake_ffmpeg.parent


def test_env_binary_nonexistent_falls_through(monkeypatch, tmp_path):
    """FFMPEG_BINARY pointing to a missing file falls through to next candidate.

    freebsd is an unknown platform that adds no dev candidate, isolating the test
    from the host repo's win64-gpl/ffmpeg-mac/ffmpeg-linux directories.
    """
    monkeypatch.setattr(sys, "platform", "freebsd")
    monkeypatch.setenv("FFMPEG_BINARY", "/nonexistent/ffmpeg")
    monkeypatch.delenv("DESKTOP_MODE", raising=False)
    monkeypatch.delenv("RESOURCES_PATH", raising=False)
    monkeypatch.setattr(shutil, "which", lambda _: None)
    result = _resolve_ffmpeg_path()
    assert result is None  # all fall-throughs exhausted


def test_desktop_resources_path_bundled_binary(monkeypatch, tmp_path):
    """DESKTOP_MODE + RESOURCES_PATH with ffmpeg/bin present returns the bundled bin dir."""
    bundled = _make_dir_with_ffmpeg(tmp_path / "resources" / "ffmpeg" / "bin")
    monkeypatch.delenv("FFMPEG_BINARY", raising=False)
    monkeypatch.setenv("DESKTOP_MODE", "true")
    monkeypatch.setenv("RESOURCES_PATH", str(tmp_path / "resources"))
    monkeypatch.setattr(shutil, "which", lambda _: None)
    result = _resolve_ffmpeg_path()
    assert result == bundled


def test_macos_dev_fallback_repo_ffmpeg_mac(monkeypatch, tmp_path):
    """On macOS in desktop mode, repo ffmpeg/ffmpeg-mac/bin is the dev fallback."""
    import app.ffmpeg_setup as _ffmpeg_setup
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setenv("DESKTOP_MODE", "true")
    monkeypatch.delenv("FFMPEG_BINARY", raising=False)
    monkeypatch.delenv("RESOURCES_PATH", raising=False)
    monkeypatch.setattr(shutil, "which", lambda _: None)
    # Repo root is app/ffmpeg_setup.py.parent.parent.
    expected = Path(_ffmpeg_setup.__file__).parent.parent / "ffmpeg" / "ffmpeg-mac" / "bin"
    if expected.exists():
        result = _resolve_ffmpeg_path()
        assert result == expected
    else:
        # Binary not present in repo — expected per STATE.md blockers. Just confirm we returned None.
        result = _resolve_ffmpeg_path()
        assert result is None


def test_linux_dev_fallback_repo_ffmpeg_linux(monkeypatch, tmp_path):
    """On Linux in desktop mode, repo ffmpeg/ffmpeg-linux/bin is the dev fallback."""
    import app.ffmpeg_setup as _ffmpeg_setup
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("DESKTOP_MODE", "true")
    monkeypatch.delenv("FFMPEG_BINARY", raising=False)
    monkeypatch.delenv("RESOURCES_PATH", raising=False)
    monkeypatch.setattr(shutil, "which", lambda _: None)
    expected = Path(_ffmpeg_setup.__file__).parent.parent / "ffmpeg" / "ffmpeg-linux" / "bin"
    if expected.exists():
        result = _resolve_ffmpeg_path()
        assert result == expected
    else:
        result = _resolve_ffmpeg_path()
        assert result is None


def test_windows_dev_fallback_repo_win64_gpl(monkeypatch, tmp_path):
    """On Windows in desktop mode, repo ffmpeg/ffmpeg-master-latest-win64-gpl/bin is the dev fallback."""
    import app.ffmpeg_setup as _ffmpeg_setup
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("DESKTOP_MODE", "true")
    monkeypatch.delenv("FFMPEG_BINARY", raising=False)
    monkeypatch.delenv("RESOURCES_PATH", raising=False)
    monkeypatch.delenv("APPDATA", raising=False)
    monkeypatch.setattr(shutil, "which", lambda _: None)
    expected = Path(_ffmpeg_setup.__file__).parent.parent / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin"
    if expected.exists():
        result = _resolve_ffmpeg_path()
        assert result == expected
    else:
        result = _resolve_ffmpeg_path()
        assert result is None


def test_no_ffmpeg_anywhere_returns_none(monkeypatch, tmp_path):
    """No env override, no bundled binary, no PATH ffmpeg → None."""
    monkeypatch.delenv("FFMPEG_BINARY", raising=False)
    monkeypatch.delenv("DESKTOP_MODE", raising=False)
    monkeypatch.delenv("RESOURCES_PATH", raising=False)
    monkeypatch.setattr(shutil, "which", lambda _: None)
    # If repo has a bundled ffmpeg, this test cannot prove None — skip in that case.
    import app.ffmpeg_setup as _ffmpeg_setup
    repo_root = Path(_ffmpeg_setup.__file__).parent.parent
    win = (repo_root / "ffmpeg" / "ffmpeg-master-latest-win64-gpl" / "bin").exists()
    mac = (repo_root / "ffmpeg" / "ffmpeg-mac" / "bin").exists()
    lin = (repo_root / "ffmpeg" / "ffmpeg-linux" / "bin").exists()
    if win or mac or lin:
        pytest.skip("Repo has a bundled ffmpeg — cannot test 'no ffmpeg anywhere' path")
    result = _resolve_ffmpeg_path()
    assert result is None


def test_system_path_fallback(monkeypatch, tmp_path):
    """When env + bundled both miss, shutil.which finds ffmpeg → returns its parent dir.

    freebsd is an unknown platform that adds no dev candidate, isolating the test
    from the host repo's win64-gpl/ffmpeg-mac/ffmpeg-linux directories.
    """
    monkeypatch.setattr(sys, "platform", "freebsd")
    monkeypatch.delenv("FFMPEG_BINARY", raising=False)
    monkeypatch.delenv("DESKTOP_MODE", raising=False)
    monkeypatch.delenv("RESOURCES_PATH", raising=False)
    # Fake shutil.which to return a known path
    fake_path = str(tmp_path / "usr" / "local" / "bin" / "ffmpeg")
    monkeypatch.setattr(shutil, "which", lambda name: fake_path if name == "ffmpeg" else None)
    result = _resolve_ffmpeg_path()
    assert result == Path(fake_path).parent
