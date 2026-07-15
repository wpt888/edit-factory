"""Web-mode routes must fail before touching the server filesystem."""

import asyncio
import inspect
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api import desktop_only, library_routes, segments_routes
from app.api.auth import ProfileContext


PROFILE = ProfileContext(profile_id="profile-1", user_id="user-1")


@pytest.fixture
def web_mode(monkeypatch):
    monkeypatch.setattr(
        desktop_only,
        "get_settings",
        lambda: SimpleNamespace(desktop_mode=False),
    )


def _assert_desktop_only(exc_info: pytest.ExceptionInfo[HTTPException]) -> None:
    assert exc_info.value.status_code == 501
    assert "desktop-only" in exc_info.value.detail
    assert "BlipStudio desktop app" in exc_info.value.detail


def test_find_local_is_rejected_before_disk_scan(web_mode, monkeypatch):
    def fail_path_access(*_args, **_kwargs):
        raise AssertionError("web mode must not inspect filesystem paths")

    monkeypatch.setattr(segments_routes, "Path", fail_path_access)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(segments_routes.find_local_file(
            request=None,
            body=segments_routes.FindLocalRequest(filename="video.mp4", size=123),
            profile=PROFILE,
        ))

    _assert_desktop_only(exc_info)


def test_browse_local_is_rejected_before_picker_process(web_mode, monkeypatch):
    async def fail_spawn(*_args, **_kwargs):
        raise AssertionError("web mode must not spawn a native picker")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fail_spawn)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(segments_routes.browse_local_file(
            request=None,
            profile=PROFILE,
        ))

    _assert_desktop_only(exc_info)


def test_add_local_video_is_rejected_before_path_access(web_mode, monkeypatch):
    def fail_path_access(*_args, **_kwargs):
        raise AssertionError("web mode must not inspect a submitted local path")

    monkeypatch.setattr(segments_routes, "Path", fail_path_access)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(inspect.unwrap(segments_routes.add_local_source_video)(
            request=None,
            background_tasks=BackgroundTasks(),
            body=segments_routes.LocalVideoRequest(file_path="C:/private/video.mp4"),
            profile=PROFILE,
        ))

    _assert_desktop_only(exc_info)


def test_library_local_video_path_is_rejected_before_repository_access(
    web_mode,
    monkeypatch,
):
    def fail_repository_access():
        raise AssertionError("web mode must reject local paths before repository access")

    monkeypatch.setattr(library_routes, "get_repository", fail_repository_access)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(inspect.unwrap(library_routes.generate_raw_clips)(
            request=None,
            background_tasks=BackgroundTasks(),
            project_id="project-1",
            video=None,
            video_path="C:/private/video.mp4",
            variant_count=1,
            profile=PROFILE,
        ))

    _assert_desktop_only(exc_info)


def test_desktop_mode_allows_local_filesystem_guard(monkeypatch):
    monkeypatch.setattr(
        desktop_only,
        "get_settings",
        lambda: SimpleNamespace(desktop_mode=True),
    )

    desktop_only.require_desktop_local_filesystem()


def test_browse_local_is_dead_in_desktop_mode(monkeypatch):
    # The native picker moved to the Electron IPC bridge; the HTTP endpoint is
    # inert in *both* modes and must never spawn tkinter inside the packaged
    # desktop backend (0xC0000409).
    monkeypatch.setattr(
        desktop_only,
        "get_settings",
        lambda: SimpleNamespace(desktop_mode=True),
    )

    async def fail_spawn(*_args, **_kwargs):
        raise AssertionError("desktop mode must not spawn a native picker either")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fail_spawn)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(segments_routes.browse_local_file(
            request=None,
            profile=PROFILE,
        ))

    _assert_desktop_only(exc_info)
