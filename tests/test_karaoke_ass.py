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


def test_box_mode_builds_per_word_layered_events(tmp_path: Path):
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
    assert ",3,0,0,5,0,0,0,1" in body
    box_events = [line for line in body.splitlines() if line.startswith("Dialogue: 0,")]
    line_events = [line for line in body.splitlines() if line.startswith("Dialogue: 1,")]
    assert len(box_events) == 4
    assert len(line_events) == 4
    assert all(",Box,," in line and "\\1a&HFF&" in line and "\\pos(" in line for line in box_events)
    assert all(",Line,," in line and "\\pos(" in line for line in line_events)
    box_positions = {line.split("\\pos(", 1)[1].split(")", 1)[0] for line in box_events}
    line_positions = {line.split("\\pos(", 1)[1].split(")", 1)[0] for line in line_events}
    assert box_positions == line_positions
    # Box events carry the complete phrase so libass shapes the background and
    # visible text identically. Only the active word makes its box opaque.
    assert all(all(word in line for word in ("KARAOKE", "TEST", "WORDS", "HERE")) for line in box_events)
    assert all("\\3a&H00&\\xbord8.64\\ybord3.84" in line for line in box_events)
    assert all("\\3a&HFF&\\xbord0\\ybord0" in line for line in box_events)
    assert all("{\\3a&HFF&\\xbord0\\ybord0} " in line for line in box_events[:-1])
    assert all(all(word in line for word in ("KARAOKE", "TEST", "WORDS", "HERE")) for line in line_events)


def test_box_mode_does_not_depend_on_external_font_measurement(tmp_path: Path):
    srt_path = tmp_path / "fallback.srt"
    srt_path.write_text(_KARAOKE_SRT, encoding="utf-8")
    box_config = _karaoke_config()
    box_config.font_family = "Missing Font"
    box_config.karaoke_style = "box"
    box_path = build_karaoke_ass_file(srt_path, box_config, 1080, 1920)

    assert box_path is not None
    body = box_path.read_text(encoding="utf-8")
    assert "Style: Box," in body
    assert "\\3a&H00&\\xbord8.64\\ybord3.84" in body


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


def test_box_karaoke_background_is_centered_on_active_word(tmp_path: Path):
    """Pixel guard: the ASS box and glyphs must share libass shaping.

    This specifically prevents the old Pillow-measurement regression where
    the background of a word away from the phrase centre drifted sideways.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("FFmpeg is not installed")
    image_module = pytest.importorskip("PIL.Image")

    srt_path = tmp_path / "box-centering.srt"
    srt_path.write_text(
        "1\n00:00:00,000 --> 00:00:02,000\n{\\k100}cu {\\k100}150\n\n",
        encoding="utf-8",
    )
    config = SubtitleStyleConfig(
        font_size=100,
        font_family="Arial",
        primary_color="&H00FFFFFF",
        outline_color="&H00000000",
        outline_width=3,
        bold=1,
        alignment=2,
        margin_v=600,
        karaoke=True,
        highlight_color="&H00FFFFFF",
        karaoke_style="box",
        highlight_bg_color="&H000000FF",
        video_width=1080,
        video_height=1920,
    )
    ass_path = build_karaoke_ass_file(srt_path, config, 1080, 1920)
    assert ass_path is not None

    from app.services.video_processor import escape_srt_path_for_ffmpeg

    output_path = tmp_path / "box-centering.png"
    escaped_ass_path = escape_srt_path_for_ffmpeg(ass_path)
    result = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=1080x1920:d=2:r=10",
            "-vf",
            f"ass='{escaped_ass_path}',select='gte(t,1.5)'",
            "-fps_mode",
            "vfr",
            "-frames:v",
            "1",
            "-y",
            str(output_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    with image_module.open(output_path) as image:
        rgb = image.convert("RGB")
        red_pixels = []
        for y in range(rgb.height):
            for x in range(rgb.width):
                red, green, blue = rgb.getpixel((x, y))
                if red > 140 and red > green * 1.7 and red > blue * 1.7:
                    red_pixels.append((x, y))

        assert red_pixels
        box_left = min(x for x, _ in red_pixels)
        box_right = max(x for x, _ in red_pixels)
        box_top = min(y for _, y in red_pixels)
        box_bottom = max(y for _, y in red_pixels)

        glyph_pixels = []
        for y in range(box_top, box_bottom + 1):
            for x in range(box_left, box_right + 1):
                red, green, blue = rgb.getpixel((x, y))
                if red > 170 and green > 170 and blue > 170:
                    glyph_pixels.append((x, y))

        assert glyph_pixels
        glyph_left = min(x for x, _ in glyph_pixels)
        glyph_right = max(x for x, _ in glyph_pixels)

    box_center = (box_left + box_right) / 2
    glyph_center = (glyph_left + glyph_right) / 2
    assert abs(box_center - glyph_center) <= 2

    glyph_top = min(y for _, y in glyph_pixels)
    glyph_bottom = max(y for _, y in glyph_pixels)
    box_height = box_bottom - box_top + 1
    glyph_height = glyph_bottom - glyph_top + 1
    # The browser sample measures ~1.77x (23 px box / 13 px glyphs). The old
    # uniform ASS border measured ~2.03x. Protect the rendered visual ratio,
    # including the font's own line metrics, rather than comparing raw ASS
    # border values to CSS padding values.
    assert 1.65 <= box_height / glyph_height <= 1.9


if __name__ == "__main__":
    import tempfile

    test_ass_style_line_swaps_primary_and_secondary()
    with tempfile.TemporaryDirectory() as d:
        test_build_ass_from_karaoke_srt(Path(d))
        test_plain_srt_returns_none(Path(d))
    print("OK — karaoke ASS builder checks passed")
