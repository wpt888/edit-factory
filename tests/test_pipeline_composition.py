import asyncio
from unittest.mock import patch


def _profile():
    return type("Profile", (), {"profile_id": "profile-1"})()


def test_save_composition_persists_gapless_sanitized_timeline():
    from app.api.pipeline_routes import SaveCompositionRequest, save_composition

    pipeline = {
        "profile_id": "profile-1",
        "scripts": ["test script"],
        "script_ids": ["script_test_0001"],
        "previews": {
            "0": {
                "preview_data": {
                    "matches": [{"segment_id": "s1"}],
                },
            },
        },
    }
    body = SaveCompositionRequest(
        script_id="script_test_0001",
        output_id="script_test_0001:default",
        video_timeline=[
        {
            "id": "intro-1",
            "kind": "intro",
            "segment_id": "s1",
            "source_video_id": "v1",
            "source_video_path": "C:/private/source.mp4",
            "start_time": 1.0,
            "end_time": 1.5,
            "timeline_start": 99.0,
            "timeline_duration": 0.5,
        },
        {
            "id": "body-1",
            "kind": "body",
            "segment_id": "s2",
            "source_video_id": "v2",
            "start_time": 2.0,
            "end_time": 4.0,
            "timeline_start": 150.0,
            "timeline_duration": 1.5,
        },
        ],
    )

    with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
         patch("app.api.pipeline_routes._db_save_pipeline") as save:
        result = asyncio.run(save_composition("pipeline-1", 0, body, _profile()))

    saved = pipeline["previews"]["0"]["preview_data"]["video_timeline"]
    assert [clip["timeline_start"] for clip in saved] == [0.0, 0.5]
    assert "source_video_path" not in saved[0]
    assert pipeline["previews"]["0"]["preview_data"]["intro_offset_sec"] == 0.5
    assert result["clip_count"] == 2
    assert result["duration"] == 2.0
    save.assert_called_once_with(
        "pipeline-1",
        pipeline,
        fields={"previews", "render_jobs"},
    )


def test_restore_previews_returns_canonical_timeline_without_host_paths():
    from app.api.pipeline_routes import restore_previews

    pipeline = {
        "profile_id": "profile-1",
        "scripts": ["test script"],
        "script_ids": ["script_test_0001"],
        "previews": {
            "0": {
                "script_id": "script_test_0001",
                "output_id": "script_test_0001:default",
                "preview_data": {
                    "audio_duration": 1.0,
                    "matches": [{
                        "srt_index": 0,
                        "srt_text": "hello",
                        "srt_start": 0.0,
                        "srt_end": 1.0,
                        "segment_id": "s1",
                        "segment_keywords": [],
                        "pinned": True,
                    }],
                    "video_timeline": [{
                        "id": "clip-1",
                        "kind": "body",
                        "segment_id": "s1",
                        "source_video_id": "v1",
                        "source_video_path": "C:/private/source.mp4",
                        "start_time": 1.0,
                        "end_time": 2.0,
                        "timeline_start": 0.0,
                        "timeline_duration": 1.0,
                    }],
                },
            },
        },
    }

    with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
         patch("app.api.pipeline_routes._legacy_preview_source_ids_by_path", return_value={}):
        restored = asyncio.run(restore_previews("pipeline-1", _profile()))

    clip = restored["previews"]["0"]["video_timeline"][0]
    assert clip["id"] == "clip-1"
    assert clip["source_video_id"] == "v1"
    assert "source_video_path" not in clip
    assert restored["previews"]["0"]["script_id"] == "script_test_0001"
    assert restored["previews"]["0"]["output_id"] == "script_test_0001:default"
    assert restored["previews"]["0"]["matches"][0]["pinned"] is True


def test_restore_previews_remaps_stale_index_by_output_id():
    from app.api.pipeline_routes import restore_previews

    moved_script_id = "script_moved_0002"
    pipeline = {
        "profile_id": "profile-1",
        "scripts": ["first", "moved"],
        "script_ids": ["script_first_0001", moved_script_id],
        # The durable owner moved from index 0 to index 1 before this legacy
        # map key was rewritten.
        "previews": {
            "0_B": {
                "script_id": moved_script_id,
                "output_id": f"{moved_script_id}:B",
                "preview_data": {
                    "audio_duration": 1.0,
                    "matches": [{
                        "srt_index": 0,
                        "srt_text": "hello",
                        "srt_start": 0.0,
                        "srt_end": 1.0,
                        "segment_id": "s1",
                        "segment_keywords": [],
                    }],
                },
            },
        },
    }

    with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
         patch("app.api.pipeline_routes._legacy_preview_source_ids_by_path", return_value={}):
        restored = asyncio.run(restore_previews("pipeline-1", _profile()))

    assert list(restored["previews"]) == ["1_B"]
    assert restored["previews"]["1_B"]["script_id"] == moved_script_id
    assert restored["previews"]["1_B"]["output_id"] == f"{moved_script_id}:B"
