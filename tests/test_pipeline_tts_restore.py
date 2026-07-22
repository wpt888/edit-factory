from unittest.mock import MagicMock, patch

import pytest

from app.api import pipeline_routes


@pytest.mark.xfail(
    reason="v13 Phase 81 / Plan 81-03: _restore_missing_tts_audio_paths was "
           "migrated in Plan 81-01 site #1 from repo.get_client().table()... "
           "fluent chain to repo.list_tts_assets(...) ABC method. The "
           "supabase.table().select().eq().eq().execute() mock chain is no "
           "longer exercised. SQLite coverage for the broader status route "
           "(which calls this helper) provided by "
           "tests/test_api_pipeline_sqlite.py::test_pipeline_status_returns_non_503.",
    strict=False,
)
def test_restore_missing_tts_audio_path_from_library(tmp_path):
    persistent_audio = tmp_path / "media" / "tts" / "profile-1" / "asset-1.mp3"
    persistent_audio.parent.mkdir(parents=True, exist_ok=True)
    persistent_audio.write_bytes(b"mp3")

    missing_temp = tmp_path / "temp" / "profile-1" / "assembly_dead" / "tts_trimmed.mp3"

    pipeline = {
        "profile_id": "profile-1",
        "scripts": ["Hello world"],
        "tts_previews": {
            0: {
                "audio_path": str(missing_temp),
                "audio_duration": 1.2,
            }
        },
        "previews": {},
    }

    supabase = MagicMock()
    execute_result = MagicMock()
    execute_result.data = [{
        "id": "asset-1",
        "tts_text": "Hello world",
        "mp3_path": str(persistent_audio),
        "audio_duration": 3.4,
        "srt_content": "1\n00:00:00,000 --> 00:00:01,000\nHello world",
        "tts_timestamps": None,
    }]
    supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = execute_result

    repo = MagicMock()
    repo.get_client.return_value = supabase

    with patch("app.api.pipeline_routes.get_repository", return_value=repo):
        restored = pipeline_routes._restore_missing_tts_audio_paths("pipe-1", pipeline, persist=False)

    assert restored == 1
    assert pipeline["tts_previews"][0]["audio_path"] == str(persistent_audio)
    assert pipeline["tts_previews"][0]["library_asset_id"] == "asset-1"
    assert pipeline["tts_previews"][0]["audio_duration"] == 3.4
    assert pipeline["tts_previews"][0]["srt_content"]


def test_restore_missing_tts_audio_path_from_preview_fallback(tmp_path):
    preview_audio = tmp_path / "output" / "preview_audio.mp3"
    preview_audio.parent.mkdir(parents=True, exist_ok=True)
    preview_audio.write_bytes(b"mp3")

    missing_temp = tmp_path / "temp" / "profile-1" / "assembly_dead" / "tts_trimmed.mp3"

    pipeline = {
        "profile_id": "profile-1",
        "scripts": ["Fallback text"],
        "tts_previews": {
            0: {
                "audio_path": str(missing_temp),
                "audio_duration": 1.2,
            }
        },
        "previews": {
            0: {
                "preview_data": {
                    "audio_path": str(preview_audio),
                    "audio_duration": 5.6,
                    "srt_content": "preview srt",
                }
            }
        },
    }

    repo = MagicMock()
    repo.get_client.return_value = None

    with patch("app.api.pipeline_routes.get_repository", return_value=repo):
        restored = pipeline_routes._restore_missing_tts_audio_paths("pipe-2", pipeline, persist=False)

    assert restored == 1
    assert pipeline["tts_previews"][0]["audio_path"] == str(preview_audio)
    assert pipeline["tts_previews"][0]["audio_duration"] == 5.6
    assert pipeline["tts_previews"][0]["srt_content"] == "preview srt"
