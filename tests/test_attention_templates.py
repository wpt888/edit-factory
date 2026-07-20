from app.services.attention_templates import SYSTEM_TEMPLATES, distribute_attention_cues, template_track_cues


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


def test_template_size_and_zone_thread_into_cues():
    tmpl = {**SYSTEM_TEMPLATES[2], "size": 0.5, "zone": "front"}
    cues = distribute_attention_cues(
        duration_ms=15000, subtitle_boundaries_ms=[3000, 6000, 9000, 12000],
        template=tmpl, asset_ids=["a", "b", "c"],
    )
    assert cues
    assert cues[0]["zone"] == "front"
    assert all(l["width"] == 0.5 and l["height"] == 0.5 for l in cues[0]["layers"])


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


def test_track_template_defaults_invalid_slot_fit_to_contain():
    cues = template_track_cues(
        template={"tracks": [[{"startMs": 0, "durationMs": 1000, "fit": "stretch"}]]},
        asset_ids=["asset-1"],
        duration_ms=5000,
    )
    assert cues[0]["layers"][0]["fit"] == "contain"
