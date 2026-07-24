from app.services.attention_templates import SYSTEM_TEMPLATES, distribute_attention_cues, template_track_cues


ALL_ATTENTION_TRANSITIONS = [
    "static", "fade", "pop", "zoom", "bounce", "slide", "slide-right",
    "slide-up", "slide-down", "wipe-left", "wipe-right", "spin", "tornado",
]


def test_distribution_is_deterministic_and_snaps_to_srt():
    template = SYSTEM_TEMPLATES[0]
    kwargs = dict(duration_ms=20000, subtitle_boundaries_ms=[4000, 8000, 12000, 16000],
                  template=template, asset_ids=["a", "b"])
    first = distribute_attention_cues(**kwargs)
    assert first == distribute_attention_cues(**kwargs)
    assert all(cue["startMs"] in {4000, 8000, 12000, 16000} for cue in first)
    assert all(cue["layers"][0]["assetId"] != first[i - 1]["layers"][0]["assetId"]
               for i, cue in enumerate(first) if i)


def test_short_clip_reduces_count_without_leaving_protected_zone():
    cues = distribute_attention_cues(
        duration_ms=2500, subtitle_boundaries_ms=[500, 1000, 1500],
        template=SYSTEM_TEMPLATES[0], asset_ids=["a"],
    )
    assert cues == []


def test_tornado_creates_delayed_multiple_layers():
    cues = distribute_attention_cues(
        duration_ms=15000, subtitle_boundaries_ms=[3000, 6000, 9000, 12000],
        template=SYSTEM_TEMPLATES[2], asset_ids=["a", "b", "c"],
    )
    assert cues
    assert len(cues[0]["layers"]) == 3
    assert [layer["animation"]["delayMs"] for layer in cues[0]["layers"]] == [0, 120, 240]


def test_fade_filter_anchors_to_absolute_timeline():
    from app.services.video_effects.overlay_renderer import _fade_filter
    # Cue at 3.0s, 1.2s long, 250ms in / 200ms out -> fades sit on the real timeline
    f = _fade_filter(3.0, 4.2, {"enterMs": 250, "exitMs": 200})
    assert f.startswith(",")
    assert "fade=t=in:st=3.0:d=0.25:alpha=1" in f
    assert "fade=t=out:st=" in f and ":d=0.2:alpha=1" in f
    # Collapsed window -> nothing
    assert _fade_filter(3.0, 3.0, {"enterMs": 250, "exitMs": 200}) == ""
    # Tiny window: in-fade is clamped to the window, out-fade gets no room left
    tiny = _fade_filter(0.0, 0.1, {"enterMs": 250, "exitMs": 200})
    assert "fade=t=in:st=0.0:d=0.1" in tiny
    assert "t=out" not in tiny


def test_static_attention_transition_has_no_fade_or_motion():
    from app.services.video_effects.overlay_renderer import (
        _attention_motion_filters,
        _fade_filter,
    )

    animation = {"preset": "static", "enterMs": 250, "exitMs": 200}
    assert _fade_filter(3.0, 4.2, animation) == ""
    assert _attention_motion_filters(3.0, 4.2, animation, 100, 200, 400, 500) == (
        "", "100", "200",
    )


def test_attention_directional_and_scale_presets_build_motion():
    from app.services.video_effects.overlay_renderer import _attention_motion_filters

    _, slide_x, slide_y = _attention_motion_filters(
        2.0, 4.0, {"preset": "slide-right", "enterMs": 300}, 100, 200, 400, 500,
    )
    assert "overlay_w" not in slide_x
    assert "t-2.000" in slide_x
    assert slide_y == "200"

    zoom_filter, zoom_x, zoom_y = _attention_motion_filters(
        2.0, 4.0, {"preset": "zoom", "enterMs": 300}, 100, 200, 400, 500,
    )
    assert "scale=" in zoom_filter and "eval=frame" in zoom_filter
    assert "overlay_w" in zoom_x and "overlay_h" in zoom_y


def test_unknown_attention_preset_falls_back_to_legacy_fade():
    from app.services.video_effects.overlay_renderer import _fade_filter

    rendered = _fade_filter(1.0, 2.0, {"preset": "not-a-filter", "enterMs": 100})
    assert "fade=t=in" in rendered


def test_all_attention_transitions_are_accepted_by_template_and_timeline_apis():
    from app.api.attention_routes import AttentionTemplateBody
    from app.api.pipeline_routes import AttentionAnimation

    for preset in ALL_ATTENTION_TRANSITIONS:
        assert AttentionTemplateBody(name="Transitions", animation=preset).animation == preset
        assert AttentionAnimation(preset=preset).preset == preset


def test_content_templates_and_track_slots_are_static_by_default():
    from app.api.attention_routes import AttentionTemplateBody

    assert AttentionTemplateBody(name="Static default").animation == "static"
    cues = template_track_cues(
        template={"tracks": [[{"id": "slot-1", "startMs": 0, "durationMs": 1000}]]},
        asset_ids=["asset-1"],
        duration_ms=5000,
    )
    assert cues[0]["layers"][0]["animation"]["preset"] == "static"


def test_template_size_and_zone_thread_into_cues():
    tmpl = {**SYSTEM_TEMPLATES[2], "size": 0.5, "zone": "front"}
    cues = distribute_attention_cues(
        duration_ms=15000, subtitle_boundaries_ms=[3000, 6000, 9000, 12000],
        template=tmpl, asset_ids=["a", "b", "c"],
    )
    assert cues
    assert cues[0]["zone"] == "front"
    assert all(layer["width"] == 0.5 and layer["height"] == 0.5 for layer in cues[0]["layers"])


def test_track_template_threads_slot_rendering_into_layer():
    cues = template_track_cues(
        template={
            "tracks": [[{
                "id": "slot-1", "x": 0.1, "y": 0.2,
                "width": 0.5, "height": 0.4, "opacity": 0.35, "fit": "cover",
                "startMs": 500, "durationMs": 1200,
            }]],
        },
        asset_ids=["asset-1"],
        duration_ms=5000,
    )
    assert cues[0]["layers"][0]["opacity"] == 0.35
    assert cues[0]["layers"][0]["fit"] == "cover"


def test_track_template_threads_fixed_entrance_duration_into_layer():
    cues = template_track_cues(
        template={
            "animation": "fade",
            "enterMs": 475,
            "tracks": [[{"id": "short", "startMs": 0, "durationMs": 900}, {
                "id": "long", "startMs": 1500, "durationMs": 5000,
            }]],
        },
        asset_ids=["asset-1"],
        duration_ms=10_000,
    )
    assert [cue["layers"][0]["animation"]["enterMs"] for cue in cues] == [475, 475]


def test_track_template_prefers_per_slot_effects_and_supports_run_overrides():
    template = {
        "animation": "fade",
        "enterMs": 300,
        "tracks": [[
            {"id": "inherits", "startMs": 0, "durationMs": 900},
            {
                "id": "custom",
                "startMs": 1200,
                "durationMs": 900,
                "animation": "wipe-right",
                "enterMs": 650,
            },
        ]],
    }

    authored = template_track_cues(template=template, asset_ids=["asset-1"], duration_ms=5000)
    assert [cue["layers"][0]["animation"]["preset"] for cue in authored] == ["fade", "wipe-right"]
    assert [cue["layers"][0]["animation"]["enterMs"] for cue in authored] == [300, 650]

    overridden = template_track_cues(
        template=template,
        asset_ids=["asset-1"],
        duration_ms=5000,
        animation_override="slide-up",
        enter_ms_override=425,
    )
    assert [cue["layers"][0]["animation"]["preset"] for cue in overridden] == ["slide-up", "slide-up"]
    assert [cue["layers"][0]["animation"]["enterMs"] for cue in overridden] == [425, 425]


def test_typed_assets_thread_media_type_onto_layers():
    # Typed asset dicts (image/video) rotate into slots and stamp mediaType;
    # legacy flat strings still default to image.
    cues = template_track_cues(
        template={"tracks": [[
            {"id": "s1", "startMs": 0, "durationMs": 1000},
            {"id": "s2", "startMs": 1200, "durationMs": 1000},
        ]]},
        asset_ids=[{"url": "http://x/a.mp4", "type": "video"}, {"url": "http://x/b.jpg", "type": "image"}],
        duration_ms=5000,
    )
    assert cues[0]["layers"][0]["mediaType"] == "video"
    assert cues[0]["layers"][0]["assetId"] == "http://x/a.mp4"
    assert cues[1]["layers"][0]["mediaType"] == "image"

    legacy = distribute_attention_cues(
        duration_ms=15000, subtitle_boundaries_ms=[3000, 6000, 9000],
        template=SYSTEM_TEMPLATES[0], asset_ids=["a", "b"],
    )
    assert all(layer["mediaType"] == "image" for cue in legacy for layer in cue["layers"])


def test_track_template_defaults_invalid_slot_fit_to_contain():
    cues = template_track_cues(
        template={"tracks": [[{"startMs": 0, "durationMs": 1000, "fit": "stretch"}]]},
        asset_ids=["asset-1"],
        duration_ms=5000,
    )
    assert cues[0]["layers"][0]["fit"] == "contain"


def test_track_template_threads_each_slots_sound_effect_into_its_cue():
    cues = template_track_cues(
        template={
            "sfx": "legacy-default.wav",
            "tracks": [[{
                "id": "slot-1",
                "startMs": 750,
                "durationMs": 1250,
                "sfxUrl": "https://example.com/whoosh.mp3",
                "sfxVolumeDb": -7.5,
                "sfxTrack": 2,
            }]],
        },
        asset_ids=["asset-1"],
        duration_ms=5000,
    )

    assert cues[0]["sfxUrl"] == "https://example.com/whoosh.mp3"
    assert cues[0]["sfxAssetId"] == "legacy-default.wav"
    assert cues[0]["sfxVolumeDb"] == -7.5
