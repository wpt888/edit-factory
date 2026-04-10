"""
Meta Visual Profiles — platform-specific rendering overrides.

When meta_multiplication is enabled, each variant is rendered twice:
  - Version A (Instagram): different subtitle style + segment_offset=0
  - Version B (Facebook):  different subtitle style + segment_offset=100

The segment_offset is added to variant_index when calling match_srt_to_segments(),
causing the round-robin pointer to start at a different position and select
entirely different video segments from the library.

Profiles may override only color/outline/glow/shadow/opacity attributes.
User-controlled typography attributes like fontFamily and fontSize are never
overridden by profiles.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class MetaVisualProfile:
    """A single platform's visual rendering overrides."""
    name: str                          # e.g. "instagram", "facebook"
    label: str                         # Human-readable, e.g. "Instagram"
    segment_offset: int                # Added to variant_index for segment selection
    subtitle_style: Dict[str, object]  # Overrides for subtitle_settings dict


# ── Profile Definitions ──────────────────────────────────────────────────────
# Color scheme: Red + White (user requirement)
#   Profile A: Red text, white outline  →  Instagram
#   Profile B: White text, red outline  →  Facebook

PROFILE_A = MetaVisualProfile(
    name="instagram",
    label="Instagram",
    segment_offset=0,       # Normal variant_index (original segments)
    subtitle_style={
        "textColor": "#FF0000",       # Red text
        "outlineColor": "#FFFFFF",    # White outline
        "outlineWidth": 3,
        "shadowDepth": 2,
        "enableGlow": False,
        "glowBlur": 0,
        "opacity": 100,
    },
)

PROFILE_B = MetaVisualProfile(
    name="facebook",
    label="Facebook",
    segment_offset=100,     # +100 to variant_index → completely different segments
    subtitle_style={
        "textColor": "#FFFFFF",       # White text
        "outlineColor": "#FF0000",    # Red outline
        "outlineWidth": 4,
        "shadowDepth": 0,
        "enableGlow": True,
        "glowBlur": 3,
        "opacity": 100,
    },
)

# Ordered list: index 0 = version A, index 1 = version B
META_PROFILES: List[MetaVisualProfile] = [PROFILE_A, PROFILE_B]

# Quick lookup by platform name
META_PROFILES_BY_NAME: Dict[str, MetaVisualProfile] = {
    p.name: p for p in META_PROFILES
}

# Version labels used in render_jobs keys and file naming
VERSION_LABELS = ["A", "B"]


def get_meta_profiles() -> List[MetaVisualProfile]:
    """Return the list of Meta visual profiles."""
    return META_PROFILES


def get_profile_for_platform(platform: str) -> Optional[MetaVisualProfile]:
    """Look up a profile by platform name (e.g. 'instagram', 'facebook')."""
    return META_PROFILES_BY_NAME.get(platform.lower())


def get_version_label(version_index: int) -> str:
    """Return 'A' or 'B' for the given version index."""
    if 0 <= version_index < len(VERSION_LABELS):
        return VERSION_LABELS[version_index]
    return chr(ord("A") + version_index)
