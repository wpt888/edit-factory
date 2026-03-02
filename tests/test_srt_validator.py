"""
Unit tests for SRTValidator, sanitize_srt_text, sanitize_srt_for_ffmpeg, and sanitize_srt_full.

No external dependencies — SRTValidator is pure Python string processing.
"""
import pytest
from app.services.srt_validator import (
    SRTValidator,
    SRTEntry,
    sanitize_srt_text,
    sanitize_srt_for_ffmpeg,
    sanitize_srt_full,
)


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


# ---------------------------------------------------------------------------
# sanitize_srt_for_ffmpeg tests
# ---------------------------------------------------------------------------

SRT_TEMPLATE = """\
1
00:00:01,000 --> 00:00:03,500
{text}

2
00:00:04,000 --> 00:00:06,000
Another line
"""


def test_ffmpeg_sanitize_plain_text_unchanged():
    """Normal text without special chars passes through unchanged."""
    result = sanitize_srt_for_ffmpeg("Hello world")
    assert result == "Hello world"


def test_ffmpeg_sanitize_apostrophe_preserved():
    """Apostrophes in SRT content are safe inside the SRT file — no escaping needed."""
    result = sanitize_srt_for_ffmpeg("It's a test")
    assert "It's a test" in result


def test_ffmpeg_sanitize_backslash_escaped():
    """Backslashes are escaped to prevent ASS control sequence interpretation."""
    result = sanitize_srt_for_ffmpeg("C:\\path\\to\\file")
    assert "\\\\" in result  # Each \ becomes \\


def test_ffmpeg_sanitize_colon_preserved():
    """Colons in SRT text content are safe inside the file — no escaping needed."""
    result = sanitize_srt_for_ffmpeg("time: 12:30")
    assert "time: 12:30" in result


def test_ffmpeg_sanitize_curly_braces_escaped():
    """Curly braces are escaped to prevent ASS override tag interpretation."""
    result = sanitize_srt_for_ffmpeg("use {braces}")
    assert "\\{braces\\}" in result


def test_ffmpeg_sanitize_square_brackets_preserved():
    """Square brackets in SRT text content are safe — no escaping needed."""
    result = sanitize_srt_for_ffmpeg("[brackets]")
    assert "[brackets]" in result


def test_ffmpeg_sanitize_mixed_special_chars():
    """Mixed special chars are fully sanitized (backslash and braces escaped)."""
    text = "It's {here}: test\\n[ok]"
    result = sanitize_srt_for_ffmpeg(text)
    # Backslash should be escaped
    assert "\\\\" in result
    # Curly braces should be escaped
    assert "\\{" in result
    assert "\\}" in result
    # Apostrophe and brackets preserved as-is
    assert "It's" in result
    assert "[ok]" in result


def test_ffmpeg_sanitize_srt_structure_preserved():
    """Timestamps, sequence numbers, and blank lines are NOT modified."""
    srt = SRT_TEMPLATE.format(text="Hello world")
    result = sanitize_srt_for_ffmpeg(srt)
    assert "00:00:01,000 --> 00:00:03,500" in result
    assert "00:00:04,000 --> 00:00:06,000" in result
    assert "1\n" in result
    assert "2\n" in result


def test_ffmpeg_sanitize_only_text_lines_modified():
    """Only text lines get modified; timestamps and indices are untouched."""
    srt = "1\n00:00:01,000 --> 00:00:03,500\nText with {braces} and \\backslash\n\n"
    result = sanitize_srt_for_ffmpeg(srt)
    assert "00:00:01,000 --> 00:00:03,500" in result
    assert "\\{braces\\}" in result
    assert "\\\\" in result


def test_ffmpeg_sanitize_empty_input_unchanged():
    """Empty string input returns empty string."""
    assert sanitize_srt_for_ffmpeg("") == ""


def test_ffmpeg_sanitize_none_input_unchanged():
    """None input returns None (falsy passthrough)."""
    assert sanitize_srt_for_ffmpeg(None) is None


# ---------------------------------------------------------------------------
# sanitize_srt_full tests (combined HTML + FFmpeg sanitization)
# ---------------------------------------------------------------------------

def test_srt_full_strips_html_and_escapes_braces():
    """sanitize_srt_full applies both HTML stripping and FFmpeg escaping."""
    content = "Hello <script>alert(1)</script> world {bold}"
    result = sanitize_srt_full(content)
    assert "<script>" not in result
    assert "alert" not in result
    assert "\\{bold\\}" in result
    assert "Hello" in result
    assert "world" in result


def test_srt_full_plain_text_unchanged():
    """Plain text without HTML or special chars passes through sanitize_srt_full unchanged."""
    plain = "Normal subtitle text here"
    result = sanitize_srt_full(plain)
    assert result == plain


def test_srt_full_backslash_in_html_context():
    """sanitize_srt_full handles backslashes that appear after HTML stripping."""
    content = "Path is C:\\users\\test"
    result = sanitize_srt_full(content)
    assert "\\\\" in result
