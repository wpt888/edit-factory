from pathlib import Path
from unittest.mock import patch

from app.services.font_manager import DEFAULT_SUBTITLE_FONT, prepare_render_fonts
from app.services.video_effects.subtitle_styler import SubtitleStyleConfig, build_subtitle_filter


def test_prepare_render_fonts_copies_exact_installed_font(tmp_path: Path):
    source = tmp_path / "Custom.ttf"
    source.write_bytes(b"font")
    with patch("app.services.font_manager._find_bundled_font", return_value=None), patch(
        "app.services.font_manager.installed_font_index",
        return_value={"custom family": source},
    ), patch("app.services.font_manager.tempfile.gettempdir", return_value=str(tmp_path)):
        family, fonts_dir, warning = prepare_render_fonts("Custom Family")

    assert family == "Custom Family"
    assert warning is None
    assert fonts_dir is not None
    assert (fonts_dir / source.name).read_bytes() == b"font"


def test_prepare_render_fonts_uses_explicit_default_for_missing_font(tmp_path: Path):
    fallback = tmp_path / "Montserrat.ttf"
    fallback.write_bytes(b"font")
    with patch("app.services.font_manager._find_bundled_font", side_effect=[None, fallback]), patch(
        "app.services.font_manager.installed_font_index", return_value={}
    ), patch("app.services.font_manager.tempfile.gettempdir", return_value=str(tmp_path)):
        family, fonts_dir, warning = prepare_render_fonts("Missing Family")

    assert family == DEFAULT_SUBTITLE_FONT
    assert fonts_dir is not None
    assert warning == "Font 'Missing Family' not found; using 'Montserrat'."


def test_filter_includes_fontsdir_and_effective_family(tmp_path: Path):
    srt_path = tmp_path / "captions.srt"
    srt_path.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n", encoding="utf-8")
    fonts_dir = tmp_path / "fonts"
    with patch(
        "app.services.font_manager.prepare_render_fonts",
        return_value=("Custom Family", fonts_dir, None),
    ):
        result = build_subtitle_filter(srt_path, {"fontFamily": "Custom Family"}, 1080, 1920)

    assert ":fontsdir='" in result
    assert "FontName=Custom Family" in result


def test_subtitle_style_supports_horizontal_alignment_and_letter_spacing():
    style = SubtitleStyleConfig.from_dict(
        {"positionY": 85, "horizontalAlignment": "left", "letterSpacing": 1.5},
        1080,
        1920,
    )

    assert style.alignment == 1
    assert "Alignment=1" in style.to_force_style_string()
    assert "Spacing=1.5" in style.to_force_style_string()
