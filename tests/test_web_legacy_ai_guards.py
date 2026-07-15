"""Web mode cannot reach historical provider/render compatibility workflows."""

from types import SimpleNamespace

import pytest

from app.api import desktop_only


_DETAIL = desktop_only.DESKTOP_ONLY_LEGACY_AI_DETAIL


@pytest.fixture(autouse=True)
def _web_mode(monkeypatch):
    monkeypatch.setattr(
        desktop_only,
        "get_settings",
        lambda: SimpleNamespace(desktop_mode=False),
    )


@pytest.mark.parametrize(
    ("path", "kwargs"),
    [
        ("/api/v1/assembly/preview", {"json": {"script_text": "Hello"}}),
        ("/api/v1/assembly/render", {"json": {"script_text": "Hello"}}),
        ("/api/v1/tts/generate-legacy", {"data": {"text": "Hello"}}),
        (
            "/api/v1/tts/add-to-videos",
            {"data": {"video_paths": '["video.mp4"]', "tts_text": "Hello"}},
        ),
        ("/api/v1/library/projects/project-1/generate", {}),
        (
            "/api/v1/library/clips/clip-1/render",
            {"data": {"preset_name": "instagram_reels"}},
        ),
        (
            "/api/v1/library/clips/bulk-render",
            {"json": {"clip_ids": ["clip-1"], "preset_name": "instagram_reels"}},
        ),
    ],
)
def test_legacy_ai_routes_reject_web_before_dispatch(client, path, kwargs):
    response = client.post(path, **kwargs)

    assert response.status_code == 501, response.text
    assert response.json() == {"detail": _DETAIL}


def test_legacy_upload_job_rejects_web_before_file_processing(client):
    response = client.post(
        "/api/v1/jobs",
        files={"video": ("video.mp4", b"not-a-real-video", "video/mp4")},
    )

    assert response.status_code == 501
    assert response.json() == {"detail": _DETAIL}


def test_legacy_guard_allows_desktop(monkeypatch):
    monkeypatch.setattr(
        desktop_only,
        "get_settings",
        lambda: SimpleNamespace(desktop_mode=True),
    )

    assert desktop_only.require_desktop_legacy_ai_workflow() is None
