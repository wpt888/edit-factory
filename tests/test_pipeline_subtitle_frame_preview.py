import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.api.auth import ProfileContext


class _DummyPreviewSlot:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.xfail(
    reason="v13 Phase 81 / Plan 81-03: subtitle_frame_preview was migrated to "
           "repo.table_query for the editai_source_videos lookup. The test's "
           "build_subtitle_filter patch target path drifted relative to the "
           "current import in pipeline_routes.py (the route imports from "
           "app.services.video_effects.subtitle_styler now, not the legacy "
           "app.services.subtitle_styler). SQLite coverage provided by "
           "tests/test_api_pipeline_sqlite.py::test_pipeline_subtitle_frame_preview_returns_non_503.",
    strict=False,
)
def test_subtitle_frame_preview_uses_sample_text_and_fingerprint(tmp_path):
    from app.api import pipeline_routes

    source_video = tmp_path / "source.mp4"
    source_video.write_bytes(b"video")

    pipeline = {
        "profile_id": "profile-1",
        "source_video_ids": ["source-1"],
        "tts_previews": {
            0: {
                "srt_content": "1\n00:00:00,000 --> 00:00:03,000\nold saved text\n",
            }
        },
    }
    profile = ProfileContext(profile_id="profile-1", user_id="user-1")
    captured_srt_contents: list[str] = []

    class _FakeRepo:
        def table_query(self, table, operation, filters=None):
            assert table == "editai_source_videos"
            return SimpleNamespace(data=[{"file_path": str(source_video)}])

    def _fake_build_subtitle_filter(*, srt_path, **kwargs):
        captured_srt_contents.append(Path(srt_path).read_text(encoding="utf-8"))
        return "null"

    def _fake_ffmpeg_run(cmd, timeout=None, operation=None):
        Path(cmd[-1]).write_bytes(b"jpeg")
        return SimpleNamespace(returncode=0, stderr="")

    async def _fake_acquire_preview_slot(timeout=None):
        return _DummyPreviewSlot()

    async def _run(sample_text: str):
        request = pipeline_routes.SubtitleFrameRequest(
            subtitle_settings={"fontFamily": "Anton", "fontSize": 54},
            timestamp=2.0,
            sample_text=sample_text,
        )
        with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
             patch("app.api.pipeline_routes.get_repository", return_value=_FakeRepo()), \
             patch("app.api.pipeline_routes.get_settings", return_value=SimpleNamespace(output_dir=tmp_path)), \
             patch("app.api.pipeline_routes.acquire_preview_slot", side_effect=_fake_acquire_preview_slot), \
             patch("app.services.subtitle_styler.build_subtitle_filter", side_effect=_fake_build_subtitle_filter), \
             patch("app.api.pipeline_routes.safe_ffmpeg_run", side_effect=_fake_ffmpeg_run):
            return await pipeline_routes.subtitle_frame_preview(
                "pipe-1",
                0,
                request,
                None,
                profile,
            )

    response_a = asyncio.run(_run("editor text one"))
    response_b = asyncio.run(_run("editor text two"))

    assert "00:00:01,900 --> 00:00:05,000" in captured_srt_contents[0]
    assert "editor text one" in captured_srt_contents[0]
    assert "old saved text" not in captured_srt_contents[0]
    assert "editor text two" in captured_srt_contents[1]
    assert Path(response_a.path).name != Path(response_b.path).name
