from app.services.attention_templates import SYSTEM_TEMPLATES, distribute_attention_cues


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
