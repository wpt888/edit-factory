from __future__ import annotations

import copy

from app.services.pipeline_template_bundle import build_pipeline_template_document
from app.services.subtitle_rotation import NO_SUBTITLES_PRESET_ID


HEADERS = {"X-Profile-Id": "test-profile-001"}


def _complete_settings() -> dict:
    return {
        "generation": {
            "name": "Portable launch template",
            "idea": "Show the complete product workflow",
            "context": "Warm, concise brand voice",
            "contextProducts": [{"title": "Demo product", "description": "Portable context"}],
            "variantCount": 2,
            "targetScriptDuration": 42,
            "provider": "gemini",
            "codexModel": "gpt-5.2-codex",
            "aiInstructions": "Start with the outcome.",
        },
        "content": {
            "scripts": [
                {"name": "Hook A", "text": "First complete script."},
                {"name": "Hook B", "text": "Second complete script."},
            ],
            "approvedScriptIndices": [0],
            "generatedCaptions": {"0": "A caption"},
            "generatedYoutubeTitles": {"0": "A title"},
        },
        "voice": {
            "model": "eleven_flash_v2_5",
            "voice": {"id": "voice-portable", "name": "Narrator"},
            "stability": 0.44,
            "similarity": 0.82,
            "style": 0.15,
            "speed": 1.08,
            "speakerBoost": True,
            "wordsPerSubtitle": 3,
        },
        "assembly": {
            "minSegmentDuration": 4.5,
            "ultraRapidIntro": False,
            "preset": "max_variety",
            "segmentProximity": "merge",
            "sourceVideos": [],
        },
        "timeline": {
            "selectedVariantIndices": [0, 1],
            "matches": {"0": []},
            "compositions": {},
            "defaultTransitions": {"0_A": None},
            "music": {"0_A": None},
            "interstitialSlides": {"0": []},
            "attentionSelection": {
                "templateId": "system-tornado-stack",
                "assetUrls": ["https://cdn.example.test/attention.png"],
                "staggerSeconds": 1,
                "maxVariants": 2,
            },
            "attentionTimelines": {"0": {"revision": 1, "cues": []}},
            "variantThumbnails": {},
            "pipOverlays": {},
        },
        "subtitles": {
            "default": {
                "fontSize": 56,
                "fontFamily": "Montserrat",
                "textColor": "#FAFAFA",
                "outlineColor": "#111111",
                "outlineWidth": 4,
                "positionY": 82,
                "karaoke": True,
                "highlightColor": "#FACC15",
            },
            "overrides": {"A": {"fontSize": 60, "textColor": "#FF0000"}},
            "rotation": {
                "enabled": True,
                "presetIds": [
                    "subtitle-template-one",
                    "subtitle-template-two",
                    NO_SUBTITLES_PRESET_ID,
                ],
            },
            "variantTemplates": {"1": NO_SUBTITLES_PRESET_ID},
        },
        "render": {
            "presetName": "Instagram Reels",
            "encoding": {
                "encoding_mode": "vbr_2pass",
                "target_bitrate_kbps": 14000,
                "audio_bitrate_kbps": 320,
                "video_profile": "high",
                "video_level": "4.2",
                "force_cpu": False,
                "preset_speed": "slow",
                "gop_size": 60,
            },
            "adjustments": {
                "enableColor": True,
                "brightness": 0.05,
                "contrast": 1.1,
                "saturation": 1.2,
                "voiceVolume": 1.15,
                "audioFadeIn": 0.5,
                "audioFadeOut": 1.0,
            },
            "metaMultiplication": True,
        },
    }


def _create_pipeline(client) -> str:
    response = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={
            "name": "Source pipeline",
            "idea": "Source idea",
            "scripts": ["Initial script"],
            "provider": "gemini",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["pipeline_id"]


def test_pipeline_template_round_trip_preserves_complete_settings(sqlite_backend):
    client, repo, _profile_id = sqlite_backend
    pipeline_id = _create_pipeline(client)
    settings = _complete_settings()

    saved = client.put(
        f"/api/v1/pipeline/{pipeline_id}/template-settings",
        headers=HEADERS,
        json={"settings": settings, "expected_revision": 0},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1
    persisted_settings = repo.get_pipeline(pipeline_id)["template_settings"]
    assert persisted_settings["snapshot"]["revision"] == 1
    assert {key: value for key, value in persisted_settings.items() if key != "snapshot"} == settings

    exported = client.get(
        f"/api/v1/pipeline/{pipeline_id}/template",
        headers=HEADERS,
    )
    assert exported.status_code == 200, exported.text
    document = exported.json()
    assert document["format"] == "edit-factory.pipeline-template"
    assert document["schemaVersion"] == 1
    assert document["settings"] == persisted_settings
    assert "profile_id" not in document
    assert document["checksum"]["algorithm"] == "sha256"

    imported = client.post(
        "/api/v1/pipeline/template/import",
        headers=HEADERS,
        json=document,
    )
    assert imported.status_code == 200, imported.text
    payload = imported.json()
    assert payload["pipeline_id"] != pipeline_id
    assert payload["settings"] == persisted_settings
    assert payload["scripts"] == ["First complete script.", "Second complete script."]
    assert payload["script_names"] == ["Hook A", "Hook B"]

    imported_row = repo.get_pipeline(payload["pipeline_id"])
    assert imported_row["profile_id"] == "test-profile-001"
    assert imported_row["template_settings"] == persisted_settings
    assert imported_row["min_segment_duration"] == 4.5
    assert imported_row["meta_multiplication"] == 1
    assert imported_row["subtitle_settings_by_key"]["A"]["fontSize"] == 60
    assert imported_row["template_settings"]["subtitles"]["rotation"]["presetIds"] == [
        "subtitle-template-one",
        "subtitle-template-two",
        NO_SUBTITLES_PRESET_ID,
    ]
    assert imported_row["template_settings"]["subtitles"]["variantTemplates"] == {
        "1": NO_SUBTITLES_PRESET_ID,
    }


def test_pipeline_snapshot_rejects_out_of_order_autosave(sqlite_backend):
    client, repo, _profile_id = sqlite_backend
    pipeline_id = _create_pipeline(client)
    newer = _complete_settings()
    newer["snapshot"] = {"revision": 99, "savedAt": "2026-07-23T12:00:02Z"}
    newer["generation"]["name"] = "Newer snapshot"
    older = _complete_settings()
    older["snapshot"] = {"revision": 98, "savedAt": "2026-07-23T12:00:01Z"}
    older["generation"]["name"] = "Older snapshot"

    saved = client.put(
        f"/api/v1/pipeline/{pipeline_id}/template-settings",
        headers=HEADERS,
        json={"settings": newer, "mode": "autosave", "expected_revision": 0},
    )
    assert saved.status_code == 200
    assert saved.json()["revision"] == 1

    stale = client.put(
        f"/api/v1/pipeline/{pipeline_id}/template-settings",
        headers=HEADERS,
        json={"settings": older, "mode": "autosave", "expected_revision": 0},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["current_revision"] == 1
    assert (
        stale.json()["detail"]["current_settings"]["generation"]["name"]
        == "Newer snapshot"
    )
    assert repo.get_pipeline(pipeline_id)["template_settings"]["generation"]["name"] == "Newer snapshot"


def test_pipeline_template_export_backfills_legacy_pipeline_contract(sqlite_backend):
    client, _repo, _profile_id = sqlite_backend
    pipeline_id = _create_pipeline(client)

    response = client.get(
        f"/api/v1/pipeline/{pipeline_id}/template",
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    settings = response.json()["settings"]
    assert set(settings) >= {
        "generation", "content", "voice", "assembly", "timeline", "subtitles", "render"
    }
    assert settings["content"]["scripts"] == [
        {"name": "Script 1", "text": "Initial script"}
    ]


def test_pipeline_template_import_rejects_tampering(sqlite_backend):
    client, _repo, _profile_id = sqlite_backend
    document = build_pipeline_template_document(
        pipeline_id="source",
        pipeline_name="Source",
        settings=_complete_settings(),
        app_version="test",
    )
    document["settings"]["voice"]["speed"] = 2.0

    response = client.post(
        "/api/v1/pipeline/template/import",
        headers=HEADERS,
        json=document,
    )
    assert response.status_code == 422
    assert "checksum" in response.text.lower()


def test_pipeline_template_rejects_sensitive_and_incomplete_settings(sqlite_backend):
    client, _repo, _profile_id = sqlite_backend
    pipeline_id = _create_pipeline(client)
    settings = _complete_settings()
    settings["voice"]["api_key"] = "must-never-export"

    sensitive = client.put(
        f"/api/v1/pipeline/{pipeline_id}/template-settings",
        headers=HEADERS,
        json={"settings": settings, "expected_revision": 0},
    )
    assert sensitive.status_code == 422
    assert "sensitive" in sensitive.text.lower()

    incomplete = _complete_settings()
    incomplete.pop("render")
    missing = client.put(
        f"/api/v1/pipeline/{pipeline_id}/template-settings",
        headers=HEADERS,
        json={"settings": incomplete, "expected_revision": 0},
    )
    assert missing.status_code == 422
    assert "render" in missing.text


def test_pipeline_template_import_keeps_foreign_media_unresolved(sqlite_backend):
    client, repo, _profile_id = sqlite_backend
    settings = _complete_settings()
    settings["assembly"]["sourceVideos"] = [
        {"id": "foreign-source-id", "name": "Another user's footage"}
    ]
    settings["timeline"]["matches"] = {
        "0": [{"segment_id": "foreign-segment", "source_video_id": "foreign-source-id"}]
    }
    document = build_pipeline_template_document(
        pipeline_id="foreign-source",
        pipeline_name="Shared",
        settings=settings,
        app_version="test",
    )

    response = client.post(
        "/api/v1/pipeline/template/import",
        headers=HEADERS,
        json=document,
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["warnings"]
    assert payload["settings"]["assembly"]["sourceVideos"] == []
    assert payload["settings"]["assembly"]["unresolvedSourceVideos"] == [
        {"id": "foreign-source-id", "name": "Another user's footage"}
    ]
    assert payload["settings"]["timeline"]["matches"]["0"][0]["segment_id"] is None
    assert repo.get_pipeline(payload["pipeline_id"])["source_video_ids"] == []


def test_pipeline_template_import_rejects_newer_schema(sqlite_backend):
    client, _repo, _profile_id = sqlite_backend
    document = build_pipeline_template_document(
        pipeline_id="source",
        pipeline_name="Source",
        settings=_complete_settings(),
        app_version="test",
    )
    newer = copy.deepcopy(document)
    newer["schemaVersion"] = 999

    response = client.post(
        "/api/v1/pipeline/template/import",
        headers=HEADERS,
        json=newer,
    )
    assert response.status_code == 422
    assert "newer" in response.text.lower()
