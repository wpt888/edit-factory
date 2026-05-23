"""Parametrized tests for app.config._get_app_base_dir() — FUNC-04.

Each test monkeypatches sys.platform + relevant env vars, then calls
the function directly (NOT via _BASE_DIR which is import-time-evaluated).
"""
import os
import sys
from pathlib import Path
import pytest

from app.config import _get_app_base_dir


def _clear_env(monkeypatch, names):
    for n in names:
        monkeypatch.delenv(n, raising=False)


def test_windows_desktop_with_appdata(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("DESKTOP_MODE", "true")
    monkeypatch.setenv("APPDATA", str(tmp_path))
    _clear_env(monkeypatch, ["XDG_CONFIG_HOME"])
    result = _get_app_base_dir()
    assert result == tmp_path / "EditFactory"
    assert result.exists()  # mkdir was called


def test_windows_desktop_missing_appdata_falls_back(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("DESKTOP_MODE", "true")
    monkeypatch.delenv("APPDATA", raising=False)
    result = _get_app_base_dir()
    # Falls back to project root (parent of app/)
    assert result == Path(__import__("app.config", fromlist=["_"]).__file__).parent.parent


def test_macos_desktop(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setenv("DESKTOP_MODE", "true")
    monkeypatch.setenv("HOME", str(tmp_path))
    # Path.home() on Linux/Mac reads HOME; on Windows reads USERPROFILE.
    # Force Path.home() to honor our HOME override:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path(os.environ["HOME"])))
    result = _get_app_base_dir()
    assert result == tmp_path / "Library" / "Application Support" / "EditFactory"
    assert result.exists()


def test_linux_desktop_with_xdg_config_home(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("DESKTOP_MODE", "true")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    result = _get_app_base_dir()
    assert result == tmp_path / "EditFactory"
    assert result.exists()


def test_linux_desktop_empty_xdg_falls_back_to_home_config(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("DESKTOP_MODE", "true")
    monkeypatch.setenv("XDG_CONFIG_HOME", "")  # empty string — XDG spec says treat as unset
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path(os.environ["HOME"])))
    result = _get_app_base_dir()
    assert result == tmp_path / ".config" / "EditFactory"
    assert result.exists()


def test_linux_desktop_xdg_unset_falls_back_to_home_config(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("DESKTOP_MODE", "true")
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path(os.environ["HOME"])))
    result = _get_app_base_dir()
    assert result == tmp_path / ".config" / "EditFactory"


def test_desktop_mode_off_returns_project_root(monkeypatch, tmp_path):
    monkeypatch.delenv("DESKTOP_MODE", raising=False)
    # Platform doesn't matter when DESKTOP_MODE is off
    monkeypatch.setattr(sys, "platform", "darwin")
    result = _get_app_base_dir()
    import app.config as _cfg
    assert result == Path(_cfg.__file__).parent.parent


def test_unknown_platform_falls_back(monkeypatch, tmp_path, caplog):
    monkeypatch.setattr(sys, "platform", "freebsd")
    monkeypatch.setenv("DESKTOP_MODE", "true")
    result = _get_app_base_dir()
    import app.config as _cfg
    assert result == Path(_cfg.__file__).parent.parent
