"""
Unit tests for SRTValidator and sanitize_srt_text.

No external dependencies — SRTValidator is pure Python string processing.
"""
import pytest
from app.services.srt_validator import SRTValidator, SRTEntry, sanitize_srt_text


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def validator():
    """Return a fresh SRTValidator instance."""
    return SRTValidator()


VALID_SRT = """\
1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:04,000 --> 00:00:06,000
This is a subtitle
"""


# ---------------------------------------------------------------------------
# validate_content tests
# ---------------------------------------------------------------------------

def test_valid_srt(validator):
    """validate_content with well-formed SRT returns (True, [])."""
    is_valid, errors = validator.validate_content(VALID_SRT)
    assert is_valid is True
    assert errors == []


def test_empty_srt(validator):
    """validate_content with empty string returns (False, errors)."""
    is_valid, errors = validator.validate_content("")
    assert is_valid is False
    assert len(errors) > 0


def test_empty_whitespace_srt(validator):
    """validate_content with only whitespace returns (False, errors)."""
    is_valid, errors = validator.validate_content("   \n\n  ")
    assert is_valid is False
    assert len(errors) > 0


def test_invalid_timestamp(validator):
    """validate_content with out-of-range timestamp returns errors."""
    bad_srt = """\
1
99:99:99,999 --> 99:99:99,999
Text here
"""
    is_valid, errors = validator.validate_content(bad_srt)
    assert is_valid is False
    assert len(errors) > 0


def test_end_before_start(validator):
    """validate_content with end < start returns an error."""
    bad_srt = """\
1
00:00:05,000 --> 00:00:02,000
Text here
"""
    is_valid, errors = validator.validate_content(bad_srt)
    assert is_valid is False
    # The error message should reference end time being before start
    combined = " ".join(errors).lower()
    assert "end" in combined or "after" in combined


def test_missing_text(validator):
    """validate_content with timestamp but no text returns an error."""
    bad_srt = """\
1
00:00:01,000 --> 00:00:03,000

"""
    is_valid, errors = validator.validate_content(bad_srt)
    assert is_valid is False
    assert any("text" in e.lower() or "missing" in e.lower() for e in errors)


# ---------------------------------------------------------------------------
# parse_entries tests
# ---------------------------------------------------------------------------

def test_parse_entries(validator):
    """parse_entries returns list of SRTEntry with correct fields."""
    entries = validator.parse_entries(VALID_SRT)

    assert len(entries) == 2

    first = entries[0]
    assert isinstance(first, SRTEntry)
    assert first.index == 1
    assert first.start_time == "00:00:01,000"
    assert first.end_time == "00:00:03,500"
    assert first.text == "Hello world"

    second = entries[1]
    assert second.index == 2
    assert second.text == "This is a subtitle"


# ---------------------------------------------------------------------------
# fix_common_issues tests
# ---------------------------------------------------------------------------

def test_fix_dot_timestamps(validator):
    """fix_common_issues converts dot timestamps (00:00:01.500) to comma (00:00:01,500)."""
    dot_srt = """\
1
00:00:01.500 --> 00:00:03.000
Text here
"""
    fixed = validator.fix_common_issues(dot_srt)
    assert "00:00:01,500" in fixed
    assert "00:00:03,000" in fixed
    # Original dot format should be gone
    assert "01.500" not in fixed


# ---------------------------------------------------------------------------
# sanitize_srt_text tests
# ---------------------------------------------------------------------------

def test_sanitize_removes_script():
    """sanitize_srt_text strips <script>alert(1)</script> content entirely."""
    malicious = "Hello <script>alert(1)</script> world"
    result = sanitize_srt_text(malicious)
    assert "<script>" not in result
    assert "alert" not in result
    assert "Hello" in result
    assert "world" in result


def test_sanitize_removes_html_tags():
    """sanitize_srt_text strips HTML tags but keeps the text content."""
    html_srt = "This is <b>bold</b> text"
    result = sanitize_srt_text(html_srt)
    assert "<b>" not in result
    assert "</b>" not in result
    assert "bold" in result
    assert "This is" in result
    assert "text" in result


def test_sanitize_preserves_arrow():
    """sanitize_srt_text does not strip SRT arrow operator (-->)."""
    srt_line = "00:00:01,000 --> 00:00:03,000"
    result = sanitize_srt_text(srt_line)
    assert "-->" in result
    assert "00:00:01,000" in result
    assert "00:00:03,000" in result


def test_sanitize_empty_input():
    """sanitize_srt_text with empty/None-like input returns input unchanged."""
    assert sanitize_srt_text("") == ""
    assert sanitize_srt_text(None) is None


def test_sanitize_no_tags():
    """sanitize_srt_text leaves plain text unchanged."""
    plain = "This is plain text without any HTML"
    result = sanitize_srt_text(plain)
    assert result == plain


# ---------------------------------------------------------------------------
# timestamp_to_seconds tests
# ---------------------------------------------------------------------------

def test_timestamp_to_seconds(validator):
    """timestamp_to_seconds('01:30:45,500') == 5445.5."""
    result = validator.timestamp_to_seconds("01:30:45,500")
    assert result == pytest.approx(5445.5, abs=1e-9)


def test_timestamp_to_seconds_zero(validator):
    """timestamp_to_seconds('00:00:00,000') == 0.0."""
    result = validator.timestamp_to_seconds("00:00:00,000")
    assert result == pytest.approx(0.0)


def test_timestamp_to_seconds_invalid(validator):
    """timestamp_to_seconds raises ValueError for invalid timestamps."""
    with pytest.raises(ValueError):
        validator.timestamp_to_seconds("not-a-timestamp")
