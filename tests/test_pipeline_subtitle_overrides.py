"""
Unit tests for per-Meta-version subtitle override resolution in the pipeline
render dispatch. After the refactor, the override dict is keyed by StyleKey
("A" | "B" | "default") rather than per-(script × version) PreviewKey.

These tests cover:
  - _style_key_for_lookup: PreviewKey → StyleKey mapping
  - _normalize_overrides: legacy key collapse + idempotency
  - _get_subtitle_settings_for_key: merge semantics + legacy fallback
"""

import logging

from app.api.pipeline_routes import (
    _fetch_preset_and_settings,
    _get_subtitle_settings_for_key,
    _normalize_overrides,
    _style_key_for_lookup,
    PipelineRenderRequest,
)


def _make_request(**overrides) -> PipelineRenderRequest:
    """Build a minimal valid PipelineRenderRequest with sensible defaults."""
    base = {
        "variant_indices": [0],
        "preset_name": "TikTok",
        "font_size": 48,
        "font_family": "Montserrat",
        "text_color": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 3,
        "position_y": 85,
    }
    base.update(overrides)
    return PipelineRenderRequest(**base)


def _default_settings() -> dict:
    """Mirror what _fetch_preset_and_settings would build for the request above."""
    return {
        "fontSize": 48,
        "fontFamily": "Montserrat",
        "textColor": "#FFFFFF",
        "outlineColor": "#000000",
        "outlineWidth": 3,
        "positionY": 85,
        "shadowDepth": 0,
        "shadowColor": "#000000",
        "borderStyle": 1,
        "enableGlow": False,
        "glowBlur": 0,
        "adaptiveSizing": False,
        "opacity": 100,
        "horizontalAlignment": "center",
        "letterSpacing": 0,
        "karaoke": False,
        "highlightColor": "#FFFF00",
    }


# ─────────────────────────────────────────────────────────────────────────────
# _style_key_for_lookup
# ─────────────────────────────────────────────────────────────────────────────

def test_style_key_for_lookup_plain_index_returns_default():
    assert _style_key_for_lookup("0") == "default"
    assert _style_key_for_lookup("12") == "default"


def test_style_key_for_lookup_meta_a_and_b():
    assert _style_key_for_lookup("0_A") == "A"
    assert _style_key_for_lookup("3_B") == "B"
    assert _style_key_for_lookup("12_A") == "A"


def test_style_key_for_lookup_unknown_suffix_falls_back_to_default():
    # Defensive: any unexpected suffix is treated as "default" rather than crashing.
    assert _style_key_for_lookup("0_X") == "default"
    assert _style_key_for_lookup("weird") == "default"


# ─────────────────────────────────────────────────────────────────────────────
# _get_subtitle_settings_for_key — primary resolution path
# ─────────────────────────────────────────────────────────────────────────────

def test_no_overrides_returns_default_and_no_user_override_flag():
    request = _make_request()
    defaults = _default_settings()

    settings, has_user_override = _get_subtitle_settings_for_key(request, "0_A", defaults)

    assert settings == defaults
    assert has_user_override is False
    # Helper must return a copy, not the same dict reference
    assert settings is not defaults


def test_flat_karaoke_fields_reach_default_render_settings(monkeypatch):
    """Karaoke must work without a per-style override entry."""
    monkeypatch.setattr("app.api.pipeline_routes.get_repository", lambda: None)
    request = _make_request(karaoke=True, highlight_color="#12AB34")

    _, settings = _fetch_preset_and_settings(request)

    assert settings["karaoke"] is True
    assert settings["highlightColor"] == "#12AB34"


def test_override_present_for_version_wins_and_sets_flag():
    request = _make_request(subtitle_settings_by_key={
        "A": {"textColor": "#FF0000", "fontSize": 60},
    })
    defaults = _default_settings()

    settings, has_user_override = _get_subtitle_settings_for_key(request, "0_A", defaults)

    assert has_user_override is True
    # Override fields win
    assert settings["textColor"] == "#FF0000"
    assert settings["fontSize"] == 60
    # Untouched default fields fall through (shallow merge)
    assert settings["outlineColor"] == "#000000"
    assert settings["fontFamily"] == "Montserrat"


def test_override_a_does_not_affect_lookup_b():
    request = _make_request(subtitle_settings_by_key={
        "A": {"textColor": "#FF0000"},
    })
    defaults = _default_settings()

    settings, has_user_override = _get_subtitle_settings_for_key(request, "0_B", defaults)

    assert has_user_override is False
    assert settings == defaults


def test_a_and_b_resolve_independently_across_all_script_indexes():
    """Style A is shared across ALL '*_A' previews; style B across all '*_B'."""
    request = _make_request(subtitle_settings_by_key={
        "A": {"textColor": "#FFFF00"},  # Yellow for Instagram
        "B": {"textColor": "#00FF00"},  # Green for Facebook
    })
    defaults = _default_settings()

    # Multiple scripts, same Meta version → same style
    a0, _ = _get_subtitle_settings_for_key(request, "0_A", defaults)
    a1, _ = _get_subtitle_settings_for_key(request, "1_A", defaults)
    a2, _ = _get_subtitle_settings_for_key(request, "2_A", defaults)
    b0, _ = _get_subtitle_settings_for_key(request, "0_B", defaults)
    b1, _ = _get_subtitle_settings_for_key(request, "1_B", defaults)

    assert a0["textColor"] == "#FFFF00"
    assert a1["textColor"] == "#FFFF00"
    assert a2["textColor"] == "#FFFF00"
    assert b0["textColor"] == "#00FF00"
    assert b1["textColor"] == "#00FF00"
    # Distinct dict references — no shared state
    assert a0 is not a1
    assert a0 is not b0


def test_default_override_applies_to_plain_key():
    """For non-Meta renders, 'default' is the canonical key."""
    request = _make_request(subtitle_settings_by_key={
        "default": {"textColor": "#AABBCC"},
    })
    defaults = _default_settings()

    settings, has_user_override = _get_subtitle_settings_for_key(request, "0", defaults)

    assert has_user_override is True
    assert settings["textColor"] == "#AABBCC"
    # Untouched fields fall through
    assert settings["fontFamily"] == "Montserrat"


def test_empty_override_dict_treated_as_no_override():
    """An override entry that is an empty dict should NOT set the flag —
    matches the frontend's `Object.keys(override).length === 0` rule."""
    request = _make_request(subtitle_settings_by_key={
        "A": {},
    })
    defaults = _default_settings()

    settings, has_user_override = _get_subtitle_settings_for_key(request, "0_A", defaults)

    assert has_user_override is False
    assert settings == defaults


def test_non_dict_override_value_is_ignored():
    """Tolerant against malformed entries arriving from the network."""
    request = _make_request()
    # Bypass Pydantic validation by reaching into the model — Pydantic v1 keeps
    # the field accessible as a dict on the instance.
    request.subtitle_settings_by_key = {"A": "not a dict"}  # type: ignore[assignment]
    defaults = _default_settings()

    settings, has_user_override = _get_subtitle_settings_for_key(request, "0_A", defaults)

    assert has_user_override is False
    assert settings == defaults


# ─────────────────────────────────────────────────────────────────────────────
# _get_subtitle_settings_for_key — legacy fallback
# ─────────────────────────────────────────────────────────────────────────────

def test_legacy_fallback_in_resolver_hits_full_key():
    """Protects in-flight pipelines whose stored overrides haven't yet been
    normalized on load (stale cached dicts from before the refactor shipped).
    If the primary StyleKey lookup misses, the resolver retries with the raw
    render-time key as-is."""
    request = _make_request(subtitle_settings_by_key={
        "0_A": {"textColor": "#ABC123"},  # legacy shape, not yet normalized
    })
    defaults = _default_settings()

    settings, has_user_override = _get_subtitle_settings_for_key(request, "0_A", defaults)

    assert has_user_override is True
    assert settings["textColor"] == "#ABC123"


# ─────────────────────────────────────────────────────────────────────────────
# _normalize_overrides
# ─────────────────────────────────────────────────────────────────────────────

def test_normalize_overrides_empty_input():
    assert _normalize_overrides({}) == {}
    assert _normalize_overrides(None) == {}  # type: ignore[arg-type]
    assert _normalize_overrides("not a dict") == {}  # type: ignore[arg-type]


def test_normalize_overrides_collapses_legacy_keys():
    """Legacy per-script granular keys collapse to per-Meta-version keys.
    Sort order is alphabetical, so '0_A' < '1_A' — last-wins means '1_A'
    overwrites '0_A' in the final dict."""
    raw = {
        "0_A": {"textColor": "#FF0000"},  # red
        "1_A": {"textColor": "#00FF00"},  # green (wins — later in sort)
        "0_B": {"textColor": "#0000FF"},  # blue
    }
    result = _normalize_overrides(raw)

    assert set(result.keys()) == {"A", "B"}
    assert result["A"]["textColor"] == "#00FF00"  # last-wins: '1_A' overwrites '0_A'
    assert result["B"]["textColor"] == "#0000FF"


def test_normalize_overrides_idempotent_on_canonical_input():
    canonical = {
        "A": {"textColor": "#FFFF00"},
        "B": {"textColor": "#00FFFF"},
        "default": {"fontSize": 72},
    }
    result = _normalize_overrides(canonical)
    assert result == canonical


def test_normalize_overrides_canonical_wins_over_legacy_on_tie():
    """When both a legacy '0_A' and a canonical 'A' exist, canonical wins —
    because '0_A' < 'A' alphabetically, so 'A' is processed last."""
    raw = {
        "0_A": {"textColor": "#FF0000"},  # legacy red
        "A": {"textColor": "#00FF00"},    # canonical green (wins)
    }
    result = _normalize_overrides(raw)
    assert result["A"]["textColor"] == "#00FF00"


def test_normalize_overrides_logs_warning_on_value_conflict(caplog):
    """Forensic evidence for user reports: log a WARNING when a collapse
    discards a differing value."""
    raw = {
        "0_A": {"textColor": "#FF0000"},
        "1_A": {"textColor": "#00FF00"},  # different value — triggers warning
    }
    with caplog.at_level(logging.WARNING, logger="app.api.pipeline_routes"):
        _normalize_overrides(raw)

    warning_messages = [
        rec.message for rec in caplog.records if rec.levelname == "WARNING"
    ]
    assert any("collapsing" in msg for msg in warning_messages), (
        f"Expected a WARNING about collapsing, got: {warning_messages}"
    )


def test_normalize_overrides_no_warning_when_values_match():
    """Identical values collapsing together should NOT emit a warning."""
    import logging as _logging
    caplog_records = []

    class _Capture(_logging.Handler):
        def emit(self, record):
            caplog_records.append(record)

    logger = _logging.getLogger("app.api.pipeline_routes")
    handler = _Capture(level=_logging.WARNING)
    logger.addHandler(handler)
    try:
        raw = {
            "0_A": {"textColor": "#FF0000"},
            "1_A": {"textColor": "#FF0000"},  # identical → no warning
        }
        _normalize_overrides(raw)
    finally:
        logger.removeHandler(handler)

    warnings = [r for r in caplog_records if r.levelname == "WARNING"]
    assert warnings == []


def test_normalize_overrides_drops_non_dict_values():
    raw = {
        "0_A": "not a dict",
        "1_A": {"textColor": "#00FF00"},
    }
    result = _normalize_overrides(raw)
    assert result == {"A": {"textColor": "#00FF00"}}


def test_normalize_overrides_handles_plain_numeric_keys_as_default():
    raw = {
        "0": {"fontSize": 50},
        "1": {"fontSize": 60},  # last-wins for default
    }
    result = _normalize_overrides(raw)
    assert result == {"default": {"fontSize": 60}}
