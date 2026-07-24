from __future__ import annotations

from app.api import pipeline_routes
from app.services.subtitle_rotation import NO_SUBTITLES_PRESET_ID


HEADERS = {"X-Profile-Id": "test-profile-001"}


def _settings(color: str = "#ffffff") -> dict:
    return {
        "fontSize": 48,
        "fontFamily": "Montserrat",
        "textColor": color,
        "outlineColor": "#000000",
        "outlineWidth": 3,
        "positionY": 85,
        "karaoke": False,
    }


def _pipeline(client) -> str:
    response = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={
            "name": "Rotation API",
            "idea": "Rotation API",
            "scripts": ["One", "Two", "Three"],
            "provider": "gemini",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["pipeline_id"]


def test_subtitle_preset_words_can_be_created_and_updated(sqlite_backend):
    client, _repo, profile_id = sqlite_backend
    created = client.post(
        f"/api/v1/profiles/{profile_id}/subtitle-presets",
        headers=HEADERS,
        json={"name": "Two words", "settings": _settings(), "wordsPerSubtitle": 2},
    )
    assert created.status_code == 200, created.text
    preset = created.json()
    assert preset["wordsPerSubtitle"] == 2

    updated = client.put(
        f"/api/v1/profiles/{profile_id}/subtitle-presets/{preset['id']}",
        headers=HEADERS,
        json={"name": "Three words", "settings": _settings("#a3e635"), "wordsPerSubtitle": 3},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Three words"
    assert updated.json()["wordsPerSubtitle"] == 3
    assert updated.json()["settings"]["textColor"] == "#a3e635"


def test_subtitle_template_contains_ordered_styles_and_flattens_for_rotation(sqlite_backend):
    client, _repo, profile_id = sqlite_backend
    created = client.post(
        f"/api/v1/profiles/{profile_id}/subtitle-templates",
        headers=HEADERS,
        json={
            "name": "Launch captions",
            "styles": [
                {"name": "Punchy", "settings": _settings("#a3e635"), "wordsPerSubtitle": 2},
                {"name": "Clean", "settings": _settings("#ffffff"), "wordsPerSubtitle": 4},
            ],
        },
    )
    assert created.status_code == 200, created.text
    template = created.json()
    assert template["name"] == "Launch captions"
    assert [style["name"] for style in template["styles"]] == ["Punchy", "Clean"]
    assert len({style["id"] for style in template["styles"]}) == 2

    listed = client.get(
        f"/api/v1/profiles/{profile_id}/subtitle-templates",
        headers=HEADERS,
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["templates"] == [template]

    flattened = client.get(
        f"/api/v1/profiles/{profile_id}/subtitle-presets",
        headers=HEADERS,
    )
    assert flattened.status_code == 200, flattened.text
    presets = flattened.json()["presets"]
    assert [preset["id"] for preset in presets] == [style["id"] for style in template["styles"]]
    assert {preset["templateId"] for preset in presets} == {template["id"]}
    assert {preset["templateName"] for preset in presets} == {"Launch captions"}

    first_id = template["styles"][0]["id"]
    updated = client.put(
        f"/api/v1/profiles/{profile_id}/subtitle-templates/{template['id']}",
        headers=HEADERS,
        json={
            "name": "Launch captions v2",
            "styles": [
                {"id": first_id, "name": "Punchy", "settings": _settings("#ffff00"), "wordsPerSubtitle": 3},
                {"name": "Boxed", "settings": _settings("#00ffff"), "wordsPerSubtitle": 5},
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["styles"][0]["id"] == first_id
    assert updated.json()["styles"][1]["id"] != first_id
    assert [style["wordsPerSubtitle"] for style in updated.json()["styles"]] == [3, 5]


def test_legacy_subtitle_preset_is_exposed_as_one_style_template(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    profile = repo.get_profile(profile_id)
    repo.update_profile(profile_id, {
        "user_subtitle_presets": [
            {"id": "legacy", "name": "Legacy look", "created_at": "", "settings": _settings()},
        ],
        "updated_at": profile.get("updated_at"),
    })

    response = client.get(
        f"/api/v1/profiles/{profile_id}/subtitle-templates",
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    template = response.json()["templates"][0]
    assert template["id"] == "legacy"
    assert template["name"] == "Legacy look"
    assert template["styles"][0]["id"] == "legacy"
    assert template["styles"][0]["name"] == "Default style"


def test_rotation_persists_order_in_pipeline_template_state(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    profile = repo.get_profile(profile_id)
    profile_presets = [
        {"id": "preset-one", "name": "One", "created_at": "", "settings": _settings(), "wordsPerSubtitle": 2},
        {"id": "preset-two", "name": "Two", "created_at": "", "settings": _settings(), "wordsPerSubtitle": 4},
    ]
    repo.update_profile(profile_id, {
        "user_subtitle_presets": profile_presets,
        "updated_at": profile.get("updated_at"),
    })
    pipeline_id = _pipeline(client)

    saved = client.put(
        f"/api/v1/pipeline/{pipeline_id}/subtitle-rotation",
        headers=HEADERS,
        json={
            "enabled": True,
            "presetIds": ["preset-two", "preset-one", NO_SUBTITLES_PRESET_ID],
            "expected_revision": 0,
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json() == {
        "enabled": True,
        "presetIds": ["preset-two", "preset-one", NO_SUBTITLES_PRESET_ID],
        "variantTemplates": {},
        "revision": 1,
    }

    restored = client.get(
        f"/api/v1/pipeline/{pipeline_id}/subtitle-rotation",
        headers=HEADERS,
    )
    assert restored.status_code == 200, restored.text
    assert restored.json() == saved.json()
    stored_rotation = repo.get_pipeline(pipeline_id)["template_settings"]["subtitles"]["rotation"]
    assert stored_rotation == {
        "enabled": True,
        "presetIds": ["preset-two", "preset-one", NO_SUBTITLES_PRESET_ID],
    }


def test_rotation_accepts_style_ids_inside_subtitle_template(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    profile = repo.get_profile(profile_id)
    repo.update_profile(profile_id, {
        "user_subtitle_presets": [{
            "id": "template-one",
            "name": "Template one",
            "created_at": "",
            "styles": [
                {"id": "style-one", "name": "One", "created_at": "", "settings": _settings()},
                {"id": "style-two", "name": "Two", "created_at": "", "settings": _settings()},
            ],
        }],
        "updated_at": profile.get("updated_at"),
    })
    pipeline_id = _pipeline(client)

    saved = client.put(
        f"/api/v1/pipeline/{pipeline_id}/subtitle-rotation",
        headers=HEADERS,
        json={
            "enabled": True,
            "presetIds": ["style-one", "style-two"],
            "expected_revision": 0,
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["presetIds"] == ["style-one", "style-two"]


def test_variant_template_selections_persist_and_drop_unknown(sqlite_backend):
    """Explicit per-variant picks persist; unknown/deleted presetIds are dropped."""
    client, repo, profile_id = sqlite_backend
    profile = repo.get_profile(profile_id)
    repo.update_profile(profile_id, {
        "user_subtitle_presets": [
            {"id": "preset-one", "name": "One", "created_at": "", "settings": _settings(), "wordsPerSubtitle": 2},
            {"id": "preset-two", "name": "Two", "created_at": "", "settings": _settings(), "wordsPerSubtitle": 4},
        ],
        "updated_at": profile.get("updated_at"),
    })
    pipeline_id = _pipeline(client)
    script_ids = repo.get_pipeline(pipeline_id)["script_ids"]
    output_ids = {
        str(index): pipeline_routes._build_output_id(script_id)
        for index, script_id in enumerate(script_ids)
    }

    # Manual pick works even with rotation disabled; the "ghost" key referencing
    # an unowned preset is silently dropped.
    saved = client.put(
        f"/api/v1/pipeline/{pipeline_id}/subtitle-rotation",
        headers=HEADERS,
        json={
            "enabled": False,
            "presetIds": [],
            "variantTemplates": {
                "0": "preset-two",
                "1": "ghost-preset",
                "2": NO_SUBTITLES_PRESET_ID,
            },
            "output_ids": output_ids,
            "expected_revision": 0,
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["variantTemplates"] == {
        "0": "preset-two",
        "2": NO_SUBTITLES_PRESET_ID,
    }

    restored = client.get(
        f"/api/v1/pipeline/{pipeline_id}/subtitle-rotation",
        headers=HEADERS,
    )
    assert restored.json()["variantTemplates"] == {
        "0": "preset-two",
        "2": NO_SUBTITLES_PRESET_ID,
    }


def test_variant_template_save_rejects_stale_output_identity(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    profile = repo.get_profile(profile_id)
    repo.update_profile(profile_id, {
        "user_subtitle_presets": [
            {"id": "preset-one", "name": "One", "created_at": "", "settings": _settings()},
        ],
        "updated_at": profile.get("updated_at"),
    })
    pipeline_id = _pipeline(client)
    pipeline = repo.get_pipeline(pipeline_id)
    first_id, second_id, third_id = pipeline["script_ids"]

    reordered = client.put(
        f"/api/v1/pipeline/{pipeline_id}/scripts",
        headers=HEADERS,
        json={
            "scripts": ["Two", "One", "Three"],
            "script_names": ["Variant 2", "Variant 1", "Variant 3"],
            "script_ids": [second_id, first_id, third_id],
            "expected_script_ids": [first_id, second_id, third_id],
            "expected_revision": int(pipeline.get("settings_revision") or 0),
        },
    )
    assert reordered.status_code == 200, reordered.text

    stale = client.put(
        f"/api/v1/pipeline/{pipeline_id}/subtitle-rotation",
        headers=HEADERS,
        json={
            "enabled": False,
            "presetIds": [],
            "variantTemplates": {"0": "preset-one"},
            "output_ids": {
                "0": pipeline_routes._build_output_id(first_id),
            },
            "expected_revision": 0,
        },
    )

    assert stale.status_code == 409, stale.text
    restored = client.get(
        f"/api/v1/pipeline/{pipeline_id}/subtitle-rotation",
        headers=HEADERS,
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["variantTemplates"] == {}


def test_output_subtitle_override_requires_stable_identity(sqlite_backend):
    client, repo, _profile_id = sqlite_backend
    pipeline_id = _pipeline(client)
    first_id = repo.get_pipeline(pipeline_id)["script_ids"][0]

    missing_identity = client.put(
        f"/api/v1/pipeline/{pipeline_id}/subtitle-overrides",
        headers=HEADERS,
        json={"overrides": {"0": {"fontSize": 60}}},
    )
    assert missing_identity.status_code == 409, missing_identity.text

    saved = client.put(
        f"/api/v1/pipeline/{pipeline_id}/subtitle-overrides",
        headers=HEADERS,
        json={
            "overrides": {"0": {"fontSize": 60}},
            "output_ids": {
                "0": pipeline_routes._build_output_id(first_id),
            },
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["overrides"] == {"0": {"fontSize": 60}}
