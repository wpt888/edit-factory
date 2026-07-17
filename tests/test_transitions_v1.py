"""Timeline transitions V1 — P0 data model, validation and cache-key tests.

All offline: no Supabase, no FFmpeg, no network. Covers the shared validator,
the fade-spec adjacency rule, the cache-key inclusion rule, and the 422 paths at
every composition ingress (save loop + both render/preview request models).
"""
import asyncio
from unittest.mock import patch

import pytest


# --------------------------------------------------------------------------- #
# normalize_transition_in — the single shared validator                        #
# --------------------------------------------------------------------------- #

def test_normalize_unknown_kind_raises():
    from app.services.assembly_service import normalize_transition_in

    with pytest.raises(ValueError):
        normalize_transition_in({"kind": "wipe_left", "durationMs": 300})


def test_normalize_non_numeric_duration_raises():
    from app.services.assembly_service import normalize_transition_in

    with pytest.raises(ValueError):
        normalize_transition_in({"kind": "dip_black", "durationMs": "fast"})


def test_normalize_out_of_range_clamps():
    from app.services.assembly_service import normalize_transition_in

    assert normalize_transition_in({"kind": "dip_black", "durationMs": 5000}) == {
        "kind": "dip_black",
        "durationMs": 600,
    }
    assert normalize_transition_in({"kind": "flash_white", "durationMs": 10}) == {
        "kind": "flash_white",
        "durationMs": 150,
    }


def test_normalize_intro_clip_is_stripped():
    from app.services.assembly_service import normalize_transition_in

    assert (
        normalize_transition_in(
            {"kind": "dip_black", "durationMs": 300}, clip_kind="intro"
        )
        is None
    )


def test_normalize_absent_is_none():
    from app.services.assembly_service import normalize_transition_in

    assert normalize_transition_in(None) is None


def test_normalize_valid_passthrough():
    from app.services.assembly_service import normalize_transition_in

    assert normalize_transition_in({"kind": "dip_black", "durationMs": 350}) == {
        "kind": "dip_black",
        "durationMs": 350,
    }


# --------------------------------------------------------------------------- #
# resolve_fade_spec — adjacency: a boundary edit touches only its two slots     #
# --------------------------------------------------------------------------- #

def _entry(transition_in=None, duration=1.0):
    from app.services.assembly_service import TimelineEntry

    return TimelineEntry(
        source_video_path="x.mp4",
        start_time=0.0,
        end_time=1.0,
        timeline_start=0.0,
        timeline_duration=duration,
        transition_in=transition_in,
    )


def test_resolve_fade_spec_adjacency():
    from app.services.assembly_service import resolve_fade_spec

    t = {"kind": "dip_black", "durationMs": 300}
    # clip[1] carries the transition → boundary between slot 0 and slot 1.
    timeline = [_entry(), _entry(t), _entry()]

    assert resolve_fade_spec(timeline, 0) == {"out": {"kind": "dip_black", "ms": 300}}
    assert resolve_fade_spec(timeline, 1) == {"in": {"kind": "dip_black", "ms": 300}}
    assert resolve_fade_spec(timeline, 2) is None  # untouched, no adjacent transition

    # First clip's own transition_in is ignored: slot 0 gets no fade-in, and with
    # no transition on clip[1] there is no fade-out either.
    assert resolve_fade_spec([_entry(t), _entry()], 0) is None


def test_resolve_fade_spec_strips_short_boundary():
    from app.services.assembly_service import resolve_fade_spec

    t = {"kind": "dip_black", "durationMs": 400}  # needs both sides >= 0.8s
    # Previous clip too short -> whole boundary stripped (both in and out).
    timeline = [_entry(duration=0.5), _entry(t, duration=2.0)]
    assert resolve_fade_spec(timeline, 0) is None
    assert resolve_fade_spec(timeline, 1) is None
    # This clip too short -> stripped too.
    timeline = [_entry(duration=2.0), _entry(t, duration=0.5)]
    assert resolve_fade_spec(timeline, 0) is None
    assert resolve_fade_spec(timeline, 1) is None
    # Both sides long enough -> effective.
    timeline = [_entry(duration=2.0), _entry(t, duration=2.0)]
    assert resolve_fade_spec(timeline, 0) == {"out": {"kind": "dip_black", "ms": 400}}
    assert resolve_fade_spec(timeline, 1) == {"in": {"kind": "dip_black", "ms": 400}}


# --------------------------------------------------------------------------- #
# _fade_filters — filter strings built only from the enum + clamped int         #
# --------------------------------------------------------------------------- #

def test_fade_filters_strings():
    from app.services.assembly_service import _fade_filters

    spec = {
        "in": {"kind": "dip_black", "ms": 300},
        "out": {"kind": "flash_white", "ms": 200},
    }
    assert _fade_filters(spec, needed_duration=2.0) == [
        "fade=t=in:st=0:d=0.150:color=black",
        "fade=t=out:st=1.900:d=0.100:color=white",
    ]
    assert _fade_filters(None, needed_duration=2.0) == []
    assert _fade_filters({}, needed_duration=2.0) == []


def test_fade_filters_reject_unknown_kind():
    # The color dict is the last allowlist: an un-validated kind can never be
    # interpolated into the -vf argument — it raises instead.
    from app.services.assembly_service import _fade_filters

    with pytest.raises(KeyError):
        _fade_filters({"in": {"kind": "evil:string", "ms": 300}}, needed_duration=2.0)


def test_zero_transition_vf_chain_is_byte_identical():
    # No transitions anywhere -> _fade_filters contributes nothing, so the -vf
    # chain (and thus the ffmpeg command) is identical to the legacy pipeline.
    from app.services.assembly_service import _fade_filters, resolve_fade_spec

    timeline = [_entry(), _entry(), _entry()]
    for i in range(len(timeline)):
        spec = resolve_fade_spec(timeline, i)
        assert spec is None
        base = ["scale=1080:1920", "crop=1080:1920"]
        assert base + _fade_filters(spec, 1.0) == base


# --------------------------------------------------------------------------- #
# make_key — fade in the key only when present (legacy stays byte-identical)    #
# --------------------------------------------------------------------------- #

def _key(tmp_path, fade):
    from app.services import segment_cache

    src = tmp_path / "src.mp4"
    src.write_bytes(b"data")
    return segment_cache.make_key(
        source_video_path=str(src),
        start_time=0.0,
        end_time=1.0,
        needed_duration=1.0,
        use_loop=False,
        transform_filters=["scale=1080:1920"],
        codec_params=["-c:v", "libx264"],
        fps=30,
        fade=fade,
    )


def test_make_key_legacy_identical_when_no_fade(tmp_path):
    # Absent fade must be byte-identical to omitting the argument entirely.
    from app.services import segment_cache

    src = tmp_path / "src.mp4"
    src.write_bytes(b"data")
    common = dict(
        source_video_path=str(src),
        start_time=0.0,
        end_time=1.0,
        needed_duration=1.0,
        use_loop=False,
        transform_filters=["scale=1080:1920"],
        codec_params=["-c:v", "libx264"],
        fps=30,
    )
    assert segment_cache.make_key(**common) == segment_cache.make_key(**common, fade=None)


def test_make_key_changes_when_boundary_transition_changes(tmp_path):
    base = _key(tmp_path, None)
    with_out = _key(tmp_path, {"out": {"kind": "dip_black", "ms": 300}})
    with_out_white = _key(tmp_path, {"out": {"kind": "flash_white", "ms": 300}})

    assert with_out != base            # adding a transition invalidates the slot
    assert with_out_white != with_out  # changing the kind invalidates it again


# --------------------------------------------------------------------------- #
# Request-model ingress — bad transition -> 422 (ValidationError)              #
# --------------------------------------------------------------------------- #

def test_preview_request_rejects_unknown_kind():
    from pydantic import ValidationError
    from app.api.pipeline_routes import PreviewRenderRequest

    with pytest.raises(ValidationError):
        PreviewRenderRequest(
            match_overrides=[],
            composition_override=[
                {"kind": "body", "transitionIn": {"kind": "nope", "durationMs": 300}}
            ],
        )


def test_render_request_rejects_non_numeric_duration():
    from pydantic import ValidationError
    from app.api.pipeline_routes import PipelineRenderRequest

    with pytest.raises(ValidationError):
        PipelineRenderRequest(
            variant_indices=[0],
            composition_overrides={
                "0": [{"kind": "body", "transitionIn": {"kind": "dip_black", "durationMs": "x"}}]
            },
        )


def test_preview_request_clamps_and_strips_intro():
    from app.api.pipeline_routes import PreviewRenderRequest

    req = PreviewRenderRequest(
        match_overrides=[],
        composition_override=[
            {"kind": "body", "transitionIn": {"kind": "dip_black", "durationMs": 5000}},
            {"kind": "intro", "transitionIn": {"kind": "flash_white", "durationMs": 300}},
        ],
    )
    assert req.composition_override[0]["transitionIn"] == {"kind": "dip_black", "durationMs": 600}
    assert "transitionIn" not in req.composition_override[1]  # intro stripped


# --------------------------------------------------------------------------- #
# save_composition ingress — 422 on bad kind, persist valid, legacy unaffected  #
# --------------------------------------------------------------------------- #

def _profile():
    return type("Profile", (), {"profile_id": "profile-1"})()


def _pipeline_with_preview():
    return {
        "profile_id": "profile-1",
        "previews": {"0": {"preview_data": {"matches": [{"segment_id": "s1"}]}}},
    }


def _save(video_timeline):
    from app.api.pipeline_routes import SaveCompositionRequest, save_composition

    pipeline = _pipeline_with_preview()
    body = SaveCompositionRequest(video_timeline=video_timeline)
    with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
         patch("app.api.pipeline_routes._db_save_pipeline"):
        asyncio.run(save_composition("pipeline-1", 0, body, _profile()))
    return pipeline["previews"]["0"]["preview_data"]["video_timeline"]


def _body_clip(**over):
    clip = {
        "id": "body-1",
        "kind": "body",
        "segment_id": "s2",
        "source_video_id": "v2",
        "start_time": 2.0,
        "end_time": 4.0,
        "timeline_start": 0.0,
        "timeline_duration": 1.5,
    }
    clip.update(over)
    return clip


def test_save_composition_rejects_unknown_kind():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        _save([_body_clip(transitionIn={"kind": "bogus", "durationMs": 300})])
    assert exc.value.status_code == 422


def test_save_composition_persists_clamped_transition():
    saved = _save([_body_clip(transitionIn={"kind": "dip_black", "durationMs": 5000})])
    assert saved[0]["transitionIn"] == {"kind": "dip_black", "durationMs": 600}


def test_save_composition_legacy_clip_parses_without_field():
    saved = _save([_body_clip()])
    assert "transitionIn" not in saved[0]
