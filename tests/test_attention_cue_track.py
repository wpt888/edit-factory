"""Attention cue `track` field — additive multi-track placement.

Offline: just the Pydantic model. Guards against Pydantic silently stripping the
field on PUT (which would un-persist every cross-track drag) and pins the V2
default when the field is absent.
"""


def test_track_survives_model_dump():
    from app.api.pipeline_routes import AttentionCue

    cue = AttentionCue(id="c1", startMs=0, durationMs=1000, track=3)
    assert cue.track == 3
    assert cue.model_dump()["track"] == 3


def test_track_defaults_to_2_when_absent():
    from app.api.pipeline_routes import AttentionCue

    cue = AttentionCue(id="c1", startMs=0, durationMs=1000)
    assert cue.track == 2
    assert cue.model_dump()["track"] == 2
