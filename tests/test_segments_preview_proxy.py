import asyncio
from pathlib import Path
from types import SimpleNamespace

from fastapi import BackgroundTasks

from app.api import segments_routes
from app.api.auth import ProfileContext


class _FakeTable:
    def __init__(self, data):
        self.data = data
        self.updates = []

    def select(self, *_args, **_kwargs):
        return self

    def update(self, data):
        self.updates.append(data)
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=self.data)


class _FakeSupabase:
    def __init__(self, data):
        self.table_obj = _FakeTable(data)

    def table(self, _name):
        return self.table_obj


class _FakeRepo:
    def __init__(self, supabase):
        self.supabase = supabase

    def get_client(self):
        return self.supabase


def test_generate_preview_proxy_success(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    settings = SimpleNamespace(base_dir=tmp_path)
    monkeypatch.setattr(segments_routes, "get_settings", lambda: settings)

    def _fake_ffmpeg(*_args, **_kwargs):
        (tmp_path / "source_videos" / "proxies" / "vid_preview.mp4").write_bytes(b"proxy")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(segments_routes, "safe_ffmpeg_run", _fake_ffmpeg)

    result = segments_routes._generate_preview_proxy("vid", source)

    assert result["preview_proxy_status"] == "ready"
    assert result["preview_proxy_path"].endswith("vid_preview.mp4")
    assert Path(result["preview_proxy_path"]).exists()
    assert result["preview_proxy_error"] is None


def test_generate_preview_proxy_failure_does_not_raise(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    settings = SimpleNamespace(base_dir=tmp_path)
    monkeypatch.setattr(segments_routes, "get_settings", lambda: settings)
    monkeypatch.setattr(
        segments_routes,
        "safe_ffmpeg_run",
        lambda *_args, **_kwargs: SimpleNamespace(returncode=1, stderr="bad codec"),
    )

    result = segments_routes._generate_preview_proxy("vid", source)

    assert result["preview_proxy_status"] == "failed"
    assert result["preview_proxy_path"] is None
    assert "bad codec" in result["preview_proxy_error"]


def test_preview_stream_uses_ready_proxy(tmp_path, monkeypatch):
    original = tmp_path / "original.mp4"
    proxy = tmp_path / "proxy.mp4"
    original.write_bytes(b"original")
    proxy.write_bytes(b"proxy")

    supabase = _FakeSupabase([{
        "file_path": str(original),
        "preview_proxy_path": str(proxy),
        "preview_proxy_status": "ready",
    }])
    monkeypatch.setattr(segments_routes, "get_repository", lambda: _FakeRepo(supabase))

    response = asyncio.run(segments_routes.preview_stream_source_video(
        "video-id",
        BackgroundTasks(),
        ProfileContext(profile_id="profile-id", user_id="user-id"),
    ))

    assert Path(response.path) == proxy


def test_preview_stream_falls_back_and_schedules_lazy_proxy(tmp_path, monkeypatch):
    original = tmp_path / "original.mp4"
    original.write_bytes(b"original")

    supabase = _FakeSupabase([{
        "file_path": str(original),
        "preview_proxy_path": None,
        "preview_proxy_status": None,
    }])
    monkeypatch.setattr(segments_routes, "get_repository", lambda: _FakeRepo(supabase))

    tasks = BackgroundTasks()
    response = asyncio.run(segments_routes.preview_stream_source_video(
        "video-id",
        tasks,
        ProfileContext(profile_id="profile-id", user_id="user-id"),
    ))

    assert Path(response.path) == original
    assert supabase.table_obj.updates[-1]["preview_proxy_status"] == "pending"
    assert len(tasks.tasks) == 1
