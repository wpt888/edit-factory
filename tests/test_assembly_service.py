"""
Unit tests for pure functions and parsing methods in assembly_service.py.

Tests cover:
- strip_product_group_tags
- build_word_to_group_map
- assign_groups_to_srt
- AssemblyService._parse_srt
- AssemblyService._srt_time_to_seconds

All tests run fully offline — no Supabase, no FFmpeg, no network.
"""
import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Fixture: patch get_settings and get_supabase so AssemblyService can init
# ---------------------------------------------------------------------------

@pytest.fixture
def assembly_service(mock_settings):
    """Return an AssemblyService with settings patched to use tmp_path."""
    # Patch get_supabase to return None (no DB calls)
    with patch("app.db.get_supabase", return_value=None), \
         patch("app.services.assembly_service.get_supabase", return_value=None):
        from app.services.assembly_service import AssemblyService
        service = AssemblyService()
        return service


# ---------------------------------------------------------------------------
# strip_product_group_tags
# ---------------------------------------------------------------------------

def test_strip_tags_basic():
    """[Product] hello world → 'hello world'."""
    from app.services.assembly_service import strip_product_group_tags
    assert strip_product_group_tags("[Product] hello world") == "hello world"


def test_strip_tags_multiple():
    """Multiple tags are all removed."""
    from app.services.assembly_service import strip_product_group_tags
    result = strip_product_group_tags("[A] hello [B] world")
    assert "[A]" not in result
    assert "[B]" not in result
    assert "hello" in result
    assert "world" in result


def test_strip_tags_no_tags():
    """Plain text is returned unchanged."""
    from app.services.assembly_service import strip_product_group_tags
    assert strip_product_group_tags("hello world") == "hello world"


def test_strip_tags_empty():
    """Empty string stays empty."""
    from app.services.assembly_service import strip_product_group_tags
    assert strip_product_group_tags("") == ""


def test_strip_tags_only_tag():
    """String that is only a tag → empty string."""
    from app.services.assembly_service import strip_product_group_tags
    assert strip_product_group_tags("[GroupA]") == ""


def test_strip_tags_nested_spacing():
    """Tags with spaces around them — result is stripped."""
    from app.services.assembly_service import strip_product_group_tags
    result = strip_product_group_tags("[Tag] word1 word2")
    assert result == "word1 word2"


# ---------------------------------------------------------------------------
# build_word_to_group_map
# ---------------------------------------------------------------------------

def test_word_map_single_unpaired_tag():
    """[GroupA] word1 word2 → both words tagged as GroupA (tag stays open)."""
    from app.services.assembly_service import build_word_to_group_map
    result = build_word_to_group_map("[GroupA] word1 word2")
    assert result == ["GroupA", "GroupA"]


def test_word_map_paired_tags():
    """[GroupA] w1 w2 [GroupA] w3 → w1, w2 tagged GroupA; w3 untagged (None)."""
    from app.services.assembly_service import build_word_to_group_map
    result = build_word_to_group_map("[GroupA] w1 w2 [GroupA] w3")
    assert result[0] == "GroupA"
    assert result[1] == "GroupA"
    assert result[2] is None


def test_word_map_no_tags():
    """Plain text → all None."""
    from app.services.assembly_service import build_word_to_group_map
    result = build_word_to_group_map("word1 word2 word3")
    assert all(g is None for g in result)
    assert len(result) == 3


def test_word_map_empty_string():
    """Empty string → empty list."""
    from app.services.assembly_service import build_word_to_group_map
    result = build_word_to_group_map("")
    assert result == []


def test_word_map_nested_groups():
    """[A] w1 [B] w2 [B] w3 [A] → w1=A, w2=B, w3=A (last open after B closes)."""
    from app.services.assembly_service import build_word_to_group_map
    result = build_word_to_group_map("[A] w1 [B] w2 [B] w3 [A]")
    # After [A]: open_stack=[A]. w1 → A
    # After [B]: open_stack=[A,B]. w2 → B (top)
    # After second [B]: open_stack=[A]. w3 → A
    # After second [A]: open_stack=[]
    assert result[0] == "A"
    assert result[1] == "B"
    assert result[2] == "A"


def test_word_map_multiple_groups_no_close():
    """[A] w1 [B] w2 → w1=A, w2=B (both open at same time, top of stack wins)."""
    from app.services.assembly_service import build_word_to_group_map
    result = build_word_to_group_map("[A] w1 [B] w2")
    assert result[0] == "A"
    assert result[1] == "B"


# ---------------------------------------------------------------------------
# assign_groups_to_srt
# ---------------------------------------------------------------------------

def test_assign_groups_basic():
    """Script with [Tag], SRT entries with tagged words → correct group assignment."""
    from app.services.assembly_service import assign_groups_to_srt
    script = "[ProductA] buy this now [ProductA] then watch later"
    srt_entries = [
        {"text": "buy this now"},
        {"text": "then watch later"},
    ]
    groups = assign_groups_to_srt(script, srt_entries)
    assert len(groups) == 2
    assert groups[0] == "ProductA"
    assert groups[1] is None


def test_assign_groups_no_tags():
    """Plain script → all groups are None."""
    from app.services.assembly_service import assign_groups_to_srt
    script = "hello world foo bar"
    srt_entries = [
        {"text": "hello world"},
        {"text": "foo bar"},
    ]
    groups = assign_groups_to_srt(script, srt_entries)
    assert all(g is None for g in groups)


def test_assign_groups_empty_srt():
    """No SRT entries → empty result list."""
    from app.services.assembly_service import assign_groups_to_srt
    groups = assign_groups_to_srt("[Tag] word1 word2", [])
    assert groups == []


# ---------------------------------------------------------------------------
# AssemblyService._parse_srt
# ---------------------------------------------------------------------------

SRT_SAMPLE = """\
1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:03,500 --> 00:00:05,000
This is a test

3
00:00:06,000 --> 00:00:08,500
Final entry
"""


def test_parse_srt_standard(assembly_service):
    """Standard SRT with 3 entries → list of 3 dicts."""
    entries = assembly_service._parse_srt(SRT_SAMPLE)
    assert len(entries) == 3


def test_parse_srt_timestamps(assembly_service):
    """SRT entries have correct start_time, end_time, text."""
    entries = assembly_service._parse_srt(SRT_SAMPLE)
    assert entries[0]["start_time"] == pytest.approx(1.0)
    assert entries[0]["end_time"] == pytest.approx(3.0)
    assert entries[0]["text"] == "Hello world"

    assert entries[1]["start_time"] == pytest.approx(3.5)
    assert entries[1]["end_time"] == pytest.approx(5.0)
    assert entries[1]["text"] == "This is a test"


def test_parse_srt_empty(assembly_service):
    """Empty string → empty list."""
    entries = assembly_service._parse_srt("")
    assert entries == []


def test_parse_srt_malformed_skips_gracefully(assembly_service):
    """Block without arrow separator is skipped without crashing."""
    malformed = "1\nno timestamp here\nsome text\n\n2\n00:00:01,000 --> 00:00:02,000\nGood entry"
    entries = assembly_service._parse_srt(malformed)
    # Should parse only the valid block
    assert len(entries) == 1
    assert entries[0]["text"] == "Good entry"


def test_parse_srt_multiline_text(assembly_service):
    """SRT block with multiple text lines — all joined with space."""
    srt = "1\n00:00:01,000 --> 00:00:03,000\nLine one\nLine two\n"
    entries = assembly_service._parse_srt(srt)
    assert len(entries) == 1
    assert "Line one" in entries[0]["text"]
    assert "Line two" in entries[0]["text"]


def test_parse_srt_block_with_no_text(assembly_service):
    """SRT block with only index + timestamp (no text) → empty string text."""
    srt = "1\n00:00:01,000 --> 00:00:02,000\n\n"
    entries = assembly_service._parse_srt(srt)
    assert len(entries) == 1
    assert entries[0]["text"] == ""


# ---------------------------------------------------------------------------
# AssemblyService._srt_time_to_seconds
# ---------------------------------------------------------------------------

def test_time_parse_basic(assembly_service):
    """00:01:30,500 → 90.5 seconds."""
    assert assembly_service._srt_time_to_seconds("00:01:30,500") == pytest.approx(90.5)


def test_time_parse_zero(assembly_service):
    """00:00:00,000 → 0.0 seconds."""
    assert assembly_service._srt_time_to_seconds("00:00:00,000") == pytest.approx(0.0)


def test_time_parse_hours(assembly_service):
    """01:30:00,000 → 5400.0 seconds."""
    assert assembly_service._srt_time_to_seconds("01:30:00,000") == pytest.approx(5400.0)


def test_time_parse_dot_separator(assembly_service):
    """00:01:30.500 (dot instead of comma) → 90.5 seconds."""
    assert assembly_service._srt_time_to_seconds("00:01:30.500") == pytest.approx(90.5)


def test_time_parse_invalid(assembly_service):
    """Invalid format → returns 0.0 without crashing."""
    assert assembly_service._srt_time_to_seconds("invalid") == pytest.approx(0.0)


def test_time_parse_partial_invalid(assembly_service):
    """Partial/malformed string → returns 0.0."""
    assert assembly_service._srt_time_to_seconds("00:01") == pytest.approx(0.0)


def test_time_parse_minutes_only(assembly_service):
    """00:02:30,000 → 150.0 seconds."""
    assert assembly_service._srt_time_to_seconds("00:02:30,000") == pytest.approx(150.0)


def test_time_parse_milliseconds_precision(assembly_service):
    """00:00:01,250 → 1.25 seconds."""
    assert assembly_service._srt_time_to_seconds("00:00:01,250") == pytest.approx(1.25)
