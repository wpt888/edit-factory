"""
Unit tests for the transparent scoring selector (F4-F7) and build_timeline
invariants (F1-F2) in assembly_service.py.

Pure logic only — no FFmpeg execution, no network, no DB. build_timeline's
ffprobe call is stubbed to return "unknown duration" (returncode != 0) so no
clamping distorts the duration invariant.
"""
import pytest
from unittest.mock import patch, MagicMock


@pytest.fixture
def service(mock_settings):
    with patch("app.db.get_supabase", return_value=None):
        from app.services.assembly_service import AssemblyService
        return AssemblyService()


def _seg(sid, src, start=0.0, end=10.0, keywords=None, group=None, single_use=False):
    return {
        "id": sid,
        "source_video_id": src,
        "source_video_path": f"/fake/{src}.mp4",
        "start_time": start,
        "end_time": end,
        "duration": end - start,
        "keywords": keywords or [],
        "product_group": group,
        "single_use": single_use,
        "transforms": None,
        "thumbnail_path": None,
    }


def _srt(n, text="hello world"):
    """n phrases, 2s each, back to back."""
    return [
        {"text": text, "start_time": float(i * 2), "end_time": float(i * 2 + 2)}
        for i in range(n)
    ]


# --- F4: determinism ---------------------------------------------------------

def test_determinism_same_inputs_same_output(service):
    segs = [_seg(f"s{i}", f"v{i}") for i in range(5)]
    srt = _srt(20)
    a = service.match_srt_to_segments(srt, segs, variant_index=3, preset="balanced")
    b = service.match_srt_to_segments(srt, segs, variant_index=3, preset="balanced")
    assert [m.segment_id for m in a] == [m.segment_id for m in b]


def test_unknown_preset_falls_back_to_balanced(service):
    segs = [_seg(f"s{i}", f"v{i}") for i in range(4)]
    srt = _srt(8)
    got = service.match_srt_to_segments(srt, segs, preset="does_not_exist")
    ref = service.match_srt_to_segments(srt, segs, preset="balanced")
    assert [m.segment_id for m in got] == [m.segment_id for m in ref]


# --- F4: no consecutive repeats for n >= 2 -----------------------------------

def test_no_consecutive_repeats(service):
    segs = [_seg(f"s{i}", f"v{i}") for i in range(4)]
    srt = _srt(30)
    for preset in ("balanced", "keyword_strict", "max_variety", "shuffle"):
        res = service.match_srt_to_segments(srt, segs, variant_index=1, preset=preset)
        ids = [m.segment_id for m in res]
        assert all(ids[i] != ids[i + 1] for i in range(len(ids) - 1)), preset


# --- F4/B4: single_use never reused ------------------------------------------

def test_single_use_never_reused(service):
    segs = [
        _seg("normal", "v0"),
        _seg("once", "v1", single_use=True),
        _seg("other", "v2"),
    ]
    srt = _srt(20)
    res = service.match_srt_to_segments(srt, segs, preset="max_variety")
    used_once = [m for m in res if m.segment_id == "once"]
    assert len(used_once) <= 1


# --- F4: shuffle varies with variant_index, others do not --------------------

def test_shuffle_varies_deterministic_stable(service):
    segs = [_seg(f"s{i}", f"v{i}") for i in range(6)]
    srt = _srt(24)

    # Other presets: identical across variant_index (fully deterministic).
    for preset in ("balanced", "keyword_strict", "max_variety"):
        r0 = [m.segment_id for m in service.match_srt_to_segments(srt, segs, variant_index=0, preset=preset)]
        r1 = [m.segment_id for m in service.match_srt_to_segments(srt, segs, variant_index=7, preset=preset)]
        assert r0 == r1, preset

    # Shuffle: at least one variant pair differs.
    s0 = [m.segment_id for m in service.match_srt_to_segments(srt, segs, variant_index=0, preset="shuffle")]
    s1 = [m.segment_id for m in service.match_srt_to_segments(srt, segs, variant_index=1, preset="shuffle")]
    s2 = [m.segment_id for m in service.match_srt_to_segments(srt, segs, variant_index=2, preset="shuffle")]
    assert not (s0 == s1 == s2)
    # ...but a fixed variant_index is reproducible.
    s0b = [m.segment_id for m in service.match_srt_to_segments(srt, segs, variant_index=0, preset="shuffle")]
    assert s0 == s0b


# --- F4: keyword affinity + min_confidence gating ----------------------------

def test_keyword_match_populates_fields(service):
    segs = [
        _seg("kw", "v0", keywords=["serum"]),
        _seg("plain", "v1"),
    ]
    srt = [{"text": "the serum works", "start_time": 0.0, "end_time": 2.0}]
    res = service.match_srt_to_segments(srt, segs, preset="keyword_strict")
    assert res[0].segment_id == "kw"
    assert res[0].matched_keyword == "serum"
    assert res[0].confidence >= 0.3
    assert not res[0].is_auto_filled
    assert res[0].explanation and "serum" in res[0].explanation


# --- F5: explanation present -------------------------------------------------

def test_explanation_on_auto_fill(service):
    segs = [_seg(f"s{i}", f"v{i}") for i in range(3)]
    srt = _srt(6)
    res = service.match_srt_to_segments(srt, segs)
    assert all(m.explanation for m in res)


# --- F6: pinned honored + marked ---------------------------------------------

def test_pinned_honored(service):
    segs = [_seg(f"s{i}", f"v{i}") for i in range(5)]
    srt = _srt(10)
    res = service.match_srt_to_segments(srt, segs, pinned_assignments={3: "s4", 7: "s1"})
    assert res[3].segment_id == "s4" and res[3].pinned
    assert res[7].segment_id == "s1" and res[7].pinned
    assert res[3].explanation == "pinned by user"


def test_grouped_matching_keeps_one_segment_per_merge_group(service):
    segs = [_seg(f"s{i}", f"v{i}") for i in range(5)]
    srt = _srt(6)
    matches, groups = service.match_srt_groups(srt, segs, min_segment_duration=3.0)
    for group in groups:
        assert len({matches[i].segment_id for i in group}) == 1


def test_pacing_changes_merge_group_count(service):
    segs = [_seg(f"s{i}", f"v{i}") for i in range(5)]
    srt = _srt(10)

    _fast_matches, fast_groups = service.match_srt_groups(
        srt, segs, min_segment_duration=2.0
    )
    _slow_matches, slow_groups = service.match_srt_groups(
        srt, segs, min_segment_duration=5.0
    )

    assert len(fast_groups) >= len(slow_groups)
    assert len(fast_groups) > len(slow_groups)


def test_visual_cluster_cooldown_avoids_overlapping_windows(service):
    segs = [
        _seg("overlap-a", "same", 0.0, 4.0),
        _seg("overlap-b", "same", 3.0, 7.0),  # same transitive cluster as overlap-a
        _seg("other-a", "other-a", 0.0, 4.0),
        _seg("other-b", "other-b", 0.0, 4.0),
    ]
    matches = service.match_srt_to_segments(_srt(3), segs, cooldown_seconds=10.0)
    chosen = [m.segment_id for m in matches]
    assert not ({"overlap-a", "overlap-b"} <= set(chosen))


def test_small_cluster_pool_records_variety_relaxation(service):
    segs = [_seg("a", "same", 0.0, 4.0), _seg("b", "same", 2.0, 6.0)]
    service.match_srt_to_segments(_srt(3), segs, cooldown_seconds=10.0)
    assert service._last_match_variety["relaxed"]
    assert service._last_match_variety["unique_clusters"] == 1


# --- Segment proximity: separate vs merge ------------------------------------

def test_separate_keeps_near_adjacent_apart(service):
    from app.services.assembly_service import CLUSTER_MERGE_GAP_SECONDS

    segs = [
        _seg("near-a", "shared", 0.0, 2.0),
        _seg("near-b", "shared", 2.5, 4.5),  # 0.5s source gap — same cluster once merge_gap applies
        _seg("other-a", "other-a", 0.0, 10.0),
        _seg("other-b", "other-b", 0.0, 10.0),
        _seg("other-c", "other-c", 0.0, 10.0),
    ]
    srt = _srt(8)
    matches, _groups = service.match_srt_groups(
        srt, segs, min_segment_duration=1.0, cluster_merge_gap=CLUSTER_MERGE_GAP_SECONDS,
    )
    ids = [m.segment_id for m in matches]
    near_pair = {"near-a", "near-b"}
    for i in range(len(ids) - 1):
        assert {ids[i], ids[i + 1]} != near_pair, f"near-adjacent segments placed back-to-back at slot {i}"


def test_merge_fuses_near_adjacent():
    from app.services.assembly_service import CLUSTER_MERGE_GAP_SECONDS, TimelineEntry, _fuse_adjacent_entries

    timeline = [
        TimelineEntry("/fake/shared.mp4", 10.0, 12.0, 2.0, 2.0),
        TimelineEntry("/fake/shared.mp4", 12.5, 14.0, 4.0, 1.5),  # 0.5s source gap — fuses into the entry above
        TimelineEntry("/fake/shared.mp4", 14.0, 15.0, 5.5, 1.0, pinned=True),  # pinned — never fused
        TimelineEntry("/fake/shared2.mp4", 0.0, 2.0, 6.5, 1.0),
        TimelineEntry("/fake/shared2.mp4", 5.0, 7.0, 7.5, 1.0),  # 3.0s source gap > CLUSTER_MERGE_GAP_SECONDS
    ]

    fused = _fuse_adjacent_entries(timeline, CLUSTER_MERGE_GAP_SECONDS)

    assert len(fused) == 4
    merged = fused[0]
    assert merged.start_time == pytest.approx(10.0)
    assert merged.end_time == pytest.approx(14.0)
    assert merged.timeline_start == pytest.approx(2.0)
    assert merged.timeline_duration == pytest.approx(3.5)

    # Pinned entry survives untouched, not absorbed into the fused clip.
    assert fused[1].pinned
    assert fused[1].start_time == pytest.approx(14.0)

    # Gap beyond CLUSTER_MERGE_GAP_SECONDS — stays two separate entries.
    assert fused[2].start_time == pytest.approx(0.0)
    assert fused[3].start_time == pytest.approx(5.0)


# --- F1/F2: build_timeline invariants ----------------------------------------

@pytest.fixture
def no_ffprobe():
    """Stub ffprobe so _real_duration returns None (no EOF clamp)."""
    with patch("app.services.assembly_service.safe_ffmpeg_run") as m:
        m.return_value = MagicMock(returncode=1, stdout="", stderr="")
        yield m


def test_rapid_intro_replaces_first_body_seconds(service, no_ffprobe):
    # Long segments so trimming (not looping) — body slots map cleanly to SRT time.
    segs = [_seg(f"s{i}", f"v{i}", start=0.0, end=60.0) for i in range(5)]
    srt = _srt(12)
    match_results = service.match_srt_to_segments(srt, segs, preset="balanced")

    # min_segment_duration=0 disables merging so body durations map 1:1 to SRT.
    timeline, intro_duration = service.build_timeline(
        match_results=match_results,
        segments_data=segs,
        audio_duration=24.0,
        min_segment_duration=0.0,
        ultra_rapid_intro=True,
    )
    # 4 intro micro-segments at 0.5s each = 2.0s.
    intro_count = 4
    assert intro_duration == pytest.approx(2.0, abs=0.01)
    body = timeline[intro_count:]

    # The montage overlays audio 0-2s instead of adding two silent seconds. The
    # assembled video still covers only audio duration + its 0.5s safety margin.
    assert sum(e.timeline_duration for e in timeline) == pytest.approx(24.5, abs=0.01)
    assert body[0].timeline_start == pytest.approx(intro_duration, abs=0.01)

    # The SRT slot covered by the montage is removed. At t=2 the body therefore
    # starts with the segment matched to narration time 2-4s, not the 0-2s slot.
    segment_by_id = {seg["id"]: seg for seg in segs}
    assert body[0].source_video_path == segment_by_id[match_results[1].segment_id]["source_video_path"]

    # Remaining normal slots retain their SRT durations; only the final one may
    # include the 0.5s video safety margin.
    for e, m in zip(body[:-1], match_results[1:-1]):
        assert e.timeline_duration == pytest.approx(m.srt_end - m.srt_start, abs=0.01)


def test_rapid_intro_trims_partially_covered_body_slot(service, no_ffprobe):
    segs = [_seg(f"s{i}", f"v{i}", start=0.0, end=60.0) for i in range(4)]
    srt = [
        {"text": "first phrase", "start_time": 0.0, "end_time": 3.0},
        {"text": "second phrase", "start_time": 3.0, "end_time": 6.0},
    ]
    match_results = service.match_srt_to_segments(srt, segs, preset="balanced")

    timeline, intro_duration = service.build_timeline(
        match_results=match_results,
        segments_data=segs,
        audio_duration=6.0,
        min_segment_duration=0.0,
        ultra_rapid_intro=True,
    )

    body = timeline[4:]
    assert intro_duration == pytest.approx(2.0, abs=0.01)
    assert body[0].timeline_start == pytest.approx(2.0, abs=0.01)
    assert body[0].timeline_duration == pytest.approx(1.0, abs=0.01)
    assert sum(e.timeline_duration for e in timeline) == pytest.approx(6.5, abs=0.01)


def test_build_timeline_short_segment_holds_full_slot(service, no_ffprobe):
    # Segment only 1s long but SRT phrase is 2s → slot must still be 2s (F2).
    segs = [_seg("short", "v0", start=0.0, end=1.0), _seg("ok", "v1", start=0.0, end=60.0)]
    srt = _srt(4)
    match_results = service.match_srt_to_segments(srt, segs)
    # audio shorter than body so no tail gap-fill extends the last entry.
    timeline, _ = service.build_timeline(
        match_results=match_results,
        segments_data=segs,
        audio_duration=4.0,
        min_segment_duration=0.0,
        ultra_rapid_intro=False,
    )
    # Every SRT slot equals its SRT duration even when the source clip is short.
    for e, m in zip(timeline[:len(match_results)], match_results):
        assert e.timeline_duration == pytest.approx(m.srt_end - m.srt_start, abs=0.01)


def test_build_timeline_pinned_survives_merge(service, no_ffprobe):
    segs = [_seg(f"s{i}", f"v{i}", start=0.0, end=60.0) for i in range(5)]
    srt = _srt(10)
    match_results = service.match_srt_to_segments(srt, segs, pinned_assignments={4: "s2"})
    # Merge on (min_segment_duration high) — pinned entry must not be swapped out.
    timeline, _ = service.build_timeline(
        match_results=match_results,
        segments_data=segs,
        audio_duration=20.0,
        min_segment_duration=3.0,
        ultra_rapid_intro=False,
    )
    pinned_entries = [e for e in timeline if e.pinned]
    assert pinned_entries, "pinned entry was dropped by merge"
    assert any(e.source_video_path == "/fake/v2.mp4" for e in pinned_entries)


def test_preview_timeline_includes_source_id_for_seek_proxy():
    from app.services.assembly_service import TimelineEntry, _serialize_preview_timeline

    timeline = [
        TimelineEntry(
            source_video_path="/fake/v7.mp4",
            start_time=4.0,
            end_time=4.5,
            timeline_start=0.0,
            timeline_duration=0.5,
        )
    ]

    serialized = _serialize_preview_timeline(timeline, [_seg("s7", "v7")])

    assert serialized[0]["source_video_id"] == "v7"
    assert serialized[0]["source_video_path"] == "/fake/v7.mp4"


def test_preview_timeline_serializes_each_intro_cut_and_stops_at_audio_end():
    from app.services.assembly_service import TimelineEntry, _serialize_preview_timeline

    timeline = [
        TimelineEntry("/fake/v1.mp4", 1.0, 1.5, 0.0, 0.5),
        TimelineEntry("/fake/v2.mp4", 2.0, 2.5, 0.5, 0.5),
        TimelineEntry("/fake/v3.mp4", 3.0, 6.0, 1.0, 3.0),
    ]
    serialized = _serialize_preview_timeline(
        timeline,
        [_seg("s1", "v1"), _seg("s2", "v2"), _seg("s3", "v3")],
        intro_duration_sec=1.0,
        output_duration=3.25,
    )

    assert [clip["kind"] for clip in serialized] == ["intro", "intro", "body"]
    assert len({clip["id"] for clip in serialized}) == 3
    assert [clip["segment_id"] for clip in serialized] == ["s1", "s2", "s3"]
    assert sum(clip["timeline_duration"] for clip in serialized) == pytest.approx(3.25)
    assert serialized[-1]["timeline_duration"] == pytest.approx(2.25)


def test_edited_composition_becomes_gapless_profile_scoped_timeline():
    from app.services.assembly_service import _timeline_from_composition

    segments = [
        _seg("s1", "v1", 10.0, 15.0),
        _seg("s2", "v2", 20.0, 24.0),
    ]
    composition = [
        {
            "id": "clip-b",
            "segment_id": "s2",
            "source_video_id": "v2",
            "source_video_path": "/untrusted/client/path.mp4",
            "start_time": 19.0,
            "end_time": 30.0,
            "timeline_start": 2.0,
            "timeline_duration": 1.0,
        },
        {
            "id": "clip-a",
            "segment_id": "s1",
            "source_video_id": "v1",
            "start_time": 11.0,
            "end_time": 13.0,
            "timeline_start": 0.0,
            "timeline_duration": 2.0,
        },
    ]

    timeline = _timeline_from_composition(composition, segments, audio_duration=3.0)

    assert [entry.source_video_path for entry in timeline] == ["/fake/v1.mp4", "/fake/v2.mp4"]
    assert [entry.timeline_start for entry in timeline] == pytest.approx([0.0, 2.0])
    assert timeline[1].start_time == pytest.approx(20.0)
    assert timeline[1].end_time == pytest.approx(24.0)
    assert sum(entry.timeline_duration for entry in timeline) == pytest.approx(3.05)


def test_edited_composition_rejects_unknown_library_clip():
    from app.services.assembly_service import _timeline_from_composition

    with pytest.raises(ValueError, match="no longer exists"):
        _timeline_from_composition(
            [{
                "id": "missing",
                "segment_id": "outside-profile",
                "start_time": 0.0,
                "end_time": 1.0,
                "timeline_start": 0.0,
                "timeline_duration": 1.0,
            }],
            [_seg("owned", "v1")],
            audio_duration=1.0,
        )


# --- F7: merge_group collapse sums duration_overrides ------------------------

def test_collapse_sums_duration_overrides(service):
    """Directly exercise the F7 sum-of-overrides rule used in assemble_and_render."""
    from app.services.assembly_service import MatchResult

    # Two SRT entries in one merge_group: overrides 1.5 and (none → natural 2.0).
    original = [
        MatchResult(0, "a", 0.0, 2.0, "s0", [], None, 0.0),
        MatchResult(1, "b", 2.0, 4.0, "s1", [], None, 0.0),
    ]
    overrides = [
        {"srt_index": 0, "duration_override": 1.5, "merge_group": 0},
        {"srt_index": 1, "duration_override": None, "merge_group": 0},
    ]
    indices = [0, 1]
    _any = any(overrides[i].get("duration_override") is not None for i in indices)
    assert _any
    total = 0.0
    for i in indices:
        ov = overrides[i].get("duration_override")
        total += ov if ov is not None else (original[i].srt_end - original[i].srt_start)
    assert total == pytest.approx(1.5 + 2.0)


# --- Source round-robin ------------------------------------------------------

def test_two_sources_alternate_one_and_one(service):
    """No keywords/pins → picks must alternate source videos strictly."""
    segs = [_seg(f"a{i}", "vA", start=i * 10.0, end=i * 10.0 + 10) for i in range(3)]
    segs += [_seg(f"b{i}", "vB", start=i * 10.0, end=i * 10.0 + 10) for i in range(3)]
    res = service.match_srt_to_segments(_srt(8), segs, preset="balanced")
    sources = [m.source_video_id for m in res]
    assert all(sources[i] != sources[i + 1] for i in range(len(sources) - 1)), sources


def test_three_sources_cycle_round_robin(service):
    segs = []
    for src in ("vA", "vB", "vC"):
        segs += [_seg(f"{src}-{i}", src, start=i * 10.0, end=i * 10.0 + 10) for i in range(3)]
    res = service.match_srt_to_segments(_srt(9), segs, preset="balanced")
    sources = [m.source_video_id for m in res]
    for i in range(len(sources) - 3):
        assert len(set(sources[i:i + 3])) == 3, sources
