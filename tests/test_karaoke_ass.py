"""Karaoke ASS burn — the {\\k} word-highlight only sweeps from a real .ass
file (libass ignores {\\k} tags embedded in an SRT via the `subtitles` filter).

These guard the SRT→ASS conversion that makes word-level karaoke actually
render. Run: pytest tests/test_karaoke_ass.py
"""
from pathlib import Path
import shutil
import subprocess

import pytest

from app.services.srt_validator import sanitize_srt_full
from app.services.video_effects import subtitle_styler
from app.services.video_effects.subtitle_styler import (
    SubtitleStyleConfig,
    build_karaoke_ass_file,
    build_subtitle_filter,
)

_KARAOKE_SRT = (
    "1\n"
    "00:00:00,000 --> 00:00:02,400\n"
    "{\\k60}KARAOKE {\\k60}TEST {\\k60}WORDS {\\k60}HERE\n\n"
)
_PLAIN_SRT = (
    "1\n"
    "00:00:00,000 --> 00:00:02,400\n"
    "KARAOKE TEST WORDS HERE\n\n"
)


def _karaoke_config() -> SubtitleStyleConfig:
    return SubtitleStyleConfig(
        karaoke=True,
        primary_color="&H00FFFFFF",   # base / unsung = white
        highlight_color="&H0000FFFF",  # sung = yellow
        video_width=1080,
        video_height=1920,
    )


def test_ass_style_line_swaps_primary_and_secondary():
    """Karaoke Style must have Primary(sung) != Secondary(unsung), else no sweep."""
    line = _karaoke_config().to_ass_style_line("Default")
    assert line.startswith("Style: Default,")
    fields = line[len("Style: "):].split(",")
    # Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, ...
    primary, secondary = fields[3], fields[4]
    assert primary == "&H0000FFFF"   # yellow = highlight (sung)
    assert secondary == "&H00FFFFFF"  # white = base (unsung)
    assert primary != secondary


def test_build_ass_from_karaoke_srt(tmp_path: Path):
    srt_path = tmp_path / "cue.srt"
    srt_path.write_text(_KARAOKE_SRT, encoding="utf-8")

    ass_path = build_karaoke_ass_file(srt_path, _karaoke_config(), 1080, 1920)

    assert ass_path is not None and ass_path.exists()
    assert ass_path.suffix == ".ass"
    body = ass_path.read_text(encoding="utf-8")
    assert "[V4+ Styles]" in body
    assert "[Events]" in body
    assert "Style: Default," in body
    assert "PlayResX: 1080" in body and "PlayResY: 1920" in body
    # The per-word {\k} timing tags must survive into the Dialogue line.
    assert "Dialogue:" in body
    assert "{\\k60}KARAOKE" in body


def test_sanitize_srt_full_preserves_karaoke_tags():
    content = (
        "1\n00:00:00,000 --> 00:00:01,000\n"
        "{\\an8}{\\k50}Hello {\\k50}world {literal}\n"
    )

    sanitized = sanitize_srt_full(content)

    assert "{\\an8}{\\k50}Hello {\\k50}world" in sanitized
    assert "\\{literal\\}" in sanitized


def test_box_mode_builds_per_word_layered_events(tmp_path: Path, monkeypatch):
    image_font = pytest.importorskip("PIL.ImageFont")
    test_font = image_font.truetype("DejaVuSans.ttf", 24)
    monkeypatch.setattr(
        subtitle_styler,
        "_resolve_karaoke_font_file",
        lambda _family: Path(test_font.path),
    )
    srt_path = tmp_path / "box.srt"
    srt_path.write_text(_KARAOKE_SRT, encoding="utf-8")
    config = _karaoke_config()
    config.karaoke_style = "box"
    config.highlight_bg_color = "&H0035E6A3"

    ass_path = build_karaoke_ass_file(srt_path, config, 1080, 1920)

    assert ass_path is not None
    body = ass_path.read_text(encoding="utf-8")
    assert "WrapStyle: 2" in body
    assert "Style: Box," in body
    assert ",3,8,0,5,0,0,0,1" in body
    box_events = [line for line in body.splitlines() if line.startswith("Dialogue: 0,")]
    line_events = [line for line in body.splitlines() if line.startswith("Dialogue: 1,")]
    assert len(box_events) == 4
    assert len(line_events) == 4
    assert all(",Box,," in line and "\\1a&HFF&" in line and "\\pos(" in line for line in box_events)
    assert all(",Line,," in line and "\\pos(" in line for line in line_events)
    assert all(all(word in line for word in ("KARAOKE", "TEST", "WORDS", "HERE")) for line in line_events)


def test_box_mode_missing_font_falls_back_to_color_bytes(tmp_path: Path, monkeypatch):
    srt_path = tmp_path / "fallback.srt"
    srt_path.write_text(_KARAOKE_SRT, encoding="utf-8")
    color_config = _karaoke_config()
    color_config.font_family = "Missing Font"
    color_path = build_karaoke_ass_file(srt_path, color_config, 1080, 1920)
    assert color_path is not None
    color_bytes = color_path.read_bytes()

    monkeypatch.setattr(subtitle_styler, "_resolve_karaoke_font_file", lambda _family: None)
    box_config = _karaoke_config()
    box_config.font_family = "Missing Font"
    box_config.karaoke_style = "box"
    box_path = build_karaoke_ass_file(srt_path, box_config, 1080, 1920)

    assert box_path is not None
    assert box_path.read_bytes() == color_bytes


def test_plain_srt_returns_none(tmp_path: Path):
    """No {\\k} tags → nothing to sweep → caller falls back to the static SRT path."""
    srt_path = tmp_path / "plain.srt"
    srt_path.write_text(_PLAIN_SRT, encoding="utf-8")
    assert build_karaoke_ass_file(srt_path, _karaoke_config(), 1080, 1920) is None


def test_karaoke_filter_renders_progressive_word_highlight(tmp_path: Path):
    """Integration guard: FFmpeg must visibly advance the ASS highlight."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("FFmpeg is not installed")
    image_module = pytest.importorskip("PIL.Image")

    srt_path = tmp_path / "cue.srt"
    srt_path.write_text(_KARAOKE_SRT, encoding="utf-8")
    filter_string = build_subtitle_filter(
        srt_path,
        {
            "fontFamily": "Arial",
            "fontSize": 48,
            "textColor": "#FFFFFF",
            "outlineColor": "#000000",
            "outlineWidth": 1,
            "positionY": 50,
            "karaoke": True,
            "highlightColor": "#FFFF00",
        },
        640,
        360,
    )
    assert filter_string.startswith("ass=")

    output_pattern = str(tmp_path / "frame_%03d.png")
    result = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=640x360:d=2.4:r=10",
            "-vf",
            filter_string,
            "-frames:v",
            "24",
            "-y",
            output_pattern,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    def color_counts(frame_number: int) -> tuple[int, int]:
        with image_module.open(tmp_path / f"frame_{frame_number:03d}.png") as image:
            yellow = 0
            white = 0
            for red, green, blue in image.convert("RGB").get_flattened_data():
                yellow += red > 160 and green > 160 and blue < 130
                white += red > 160 and green > 160 and blue > 160
        return yellow, white

    early_yellow, early_white = color_counts(3)
    late_yellow, late_white = color_counts(21)
    assert late_yellow > early_yellow * 2
    assert early_white > late_white


if __name__ == "__main__":
    import tempfile

    test_ass_style_line_swaps_primary_and_secondary()
    with tempfile.TemporaryDirectory() as d:
        test_build_ass_from_karaoke_srt(Path(d))
        test_plain_srt_returns_none(Path(d))
    print("OK — karaoke ASS builder checks passed")
