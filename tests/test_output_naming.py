from datetime import datetime


def test_build_output_basename_uses_human_readable_labels():
    from app.services.assembly_service import build_output_basename

    stem = build_output_basename(
        variant_index=1,
        visual_version_label="A",
        preset_name="TikTok",
        project_label="Summer Launch Hooks",
        script_label="3 motive pentru care acest produs merita atentia ta",
        created_at=datetime(2026, 4, 9, 23, 51, 41),
    )

    assert stem == "summer_launch_hooks_3_motive_pentru_care_acest_produs_merita_v2a_20260409_235141"


def test_build_output_basename_keeps_non_default_preset():
    from app.services.assembly_service import build_output_basename

    stem = build_output_basename(
        variant_index=0,
        preset_name="YouTube Shorts",
        project_label="Promo Clips",
        script_label="Primul script",
        created_at=datetime(2026, 4, 9, 12, 30, 0),
    )

    assert stem.endswith("_youtube_shorts")
