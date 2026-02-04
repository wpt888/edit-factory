"""
Unit tests for encoding presets service.
"""
import pytest
from pydantic import ValidationError
from app.services.encoding_presets import (
    EncodingPreset,
    get_preset,
    list_presets,
    PRESETS,
    PRESET_TIKTOK,
    PRESET_REELS,
    PRESET_YOUTUBE_SHORTS,
    PRESET_GENERIC,
)


def test_preset_validation():
    """Test that Pydantic validates fields correctly."""
    # Valid preset should work
    valid_preset = EncodingPreset(
        name="Test",
        platform="tiktok",
        description="Test preset",
        crf=20,
    )
    assert valid_preset.crf == 20

    # Invalid CRF > 51 should raise ValidationError
    with pytest.raises(ValidationError) as exc_info:
        EncodingPreset(
            name="Invalid",
            platform="tiktok",
            description="Invalid CRF",
            crf=52,  # Out of range
        )
    assert "crf" in str(exc_info.value).lower()

    # Invalid CRF < 0 should raise ValidationError
    with pytest.raises(ValidationError):
        EncodingPreset(
            name="Invalid",
            platform="tiktok",
            description="Invalid CRF",
            crf=-1,
        )

    # Invalid audio bitrate pattern should raise ValidationError
    with pytest.raises(ValidationError):
        EncodingPreset(
            name="Invalid",
            platform="tiktok",
            description="Invalid audio",
            audio_bitrate="192",  # Missing 'k' suffix
        )


def test_all_presets_exist():
    """Test that PRESETS dict has all 4 platforms."""
    assert len(PRESETS) == 4
    assert "tiktok" in PRESETS
    assert "reels" in PRESETS
    assert "youtube_shorts" in PRESETS
    assert "generic" in PRESETS


def test_get_preset_returns_correct():
    """Test that get_preset() returns the correct preset."""
    preset = get_preset("tiktok")
    assert preset == PRESET_TIKTOK
    assert preset.platform == "tiktok"
    assert preset.name == "TikTok"

    preset = get_preset("reels")
    assert preset == PRESET_REELS
    assert preset.platform == "reels"

    preset = get_preset("youtube_shorts")
    assert preset == PRESET_YOUTUBE_SHORTS
    assert preset.platform == "youtube_shorts"

    preset = get_preset("generic")
    assert preset == PRESET_GENERIC
    assert preset.platform == "generic"


def test_get_preset_fallback():
    """Test that unknown platform returns PRESET_GENERIC."""
    preset = get_preset("unknown_platform")
    assert preset == PRESET_GENERIC
    assert preset.platform == "generic"

    # Case insensitive should still work
    preset = get_preset("TIKTOK")
    assert preset == PRESET_TIKTOK


def test_ffmpeg_params_cpu():
    """Test that to_ffmpeg_params(use_gpu=False) contains correct params."""
    preset = PRESET_TIKTOK
    params = preset.to_ffmpeg_params(use_gpu=False)

    # Check it's a list
    assert isinstance(params, list)

    # Check CPU codec
    assert "-c:v" in params
    codec_idx = params.index("-c:v")
    assert params[codec_idx + 1] == "libx264"

    # Check preset
    assert "-preset" in params
    preset_idx = params.index("-preset")
    assert params[preset_idx + 1] == "medium"

    # Check CRF
    assert "-crf" in params
    crf_idx = params.index("-crf")
    assert params[crf_idx + 1] == "20"

    # Check keyframe params
    assert "-g" in params
    g_idx = params.index("-g")
    assert params[g_idx + 1] == "60"

    assert "-keyint_min" in params
    keyint_idx = params.index("-keyint_min")
    assert params[keyint_idx + 1] == "60"

    # Check audio
    assert "-b:a" in params
    bitrate_idx = params.index("-b:a")
    assert params[bitrate_idx + 1] == "192k"


def test_ffmpeg_params_gpu():
    """Test that to_ffmpeg_params(use_gpu=True) uses h264_nvenc."""
    preset = PRESET_REELS
    params = preset.to_ffmpeg_params(use_gpu=True)

    # Check GPU codec
    assert "-c:v" in params
    codec_idx = params.index("-c:v")
    assert params[codec_idx + 1] == "h264_nvenc"

    # Check NVENC preset
    assert "-preset" in params
    preset_idx = params.index("-preset")
    assert params[preset_idx + 1] == "p4"

    # Check CQ instead of CRF
    assert "-cq" in params
    cq_idx = params.index("-cq")
    assert params[cq_idx + 1] == "18"

    # Should not have -crf when using GPU
    assert "-crf" not in params

    # Keyframe params should still be present
    assert "-g" in params
    assert "-keyint_min" in params


def test_audio_bitrate_192k():
    """Test that all presets use 192k audio bitrate."""
    for preset_id, preset in PRESETS.items():
        assert preset.audio_bitrate == "192k", f"Preset {preset_id} should have 192k audio"


def test_keyframe_params():
    """Test that all presets have gop_size and keyint_min set to 60."""
    for preset_id, preset in PRESETS.items():
        assert preset.gop_size == 60, f"Preset {preset_id} should have gop_size=60"
        assert preset.keyint_min == 60, f"Preset {preset_id} should have keyint_min=60"


def test_list_presets():
    """Test that list_presets() returns list of dicts with required fields."""
    presets_list = list_presets()

    # Should return a list
    assert isinstance(presets_list, list)

    # Should have 4 presets
    assert len(presets_list) == 4

    # Check structure of each preset
    for preset_info in presets_list:
        assert isinstance(preset_info, dict)
        assert "id" in preset_info
        assert "name" in preset_info
        assert "platform" in preset_info
        assert "description" in preset_info
        assert "crf" in preset_info
        assert "audio_bitrate" in preset_info

    # Check specific preset
    tiktok_info = next(p for p in presets_list if p["id"] == "tiktok")
    assert tiktok_info["name"] == "TikTok"
    assert tiktok_info["platform"] == "tiktok"
    assert tiktok_info["crf"] == 20
    assert tiktok_info["audio_bitrate"] == "192k"
