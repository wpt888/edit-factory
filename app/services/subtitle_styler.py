"""
Subtitle style builder for FFmpeg ASS force_style parameter.
Implements shadow depth, glow effects, and adaptive font sizing.
"""
import logging
import srt
from dataclasses import dataclass
from typing import Tuple
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class SubtitleStyleConfig:
    """
    ASS subtitle style configuration for FFmpeg force_style parameter.

    Reference: https://hhsprings.bitbucket.io/docs/programming/examples/ffmpeg/subtitle/ass.html

    ASS Style Fields:
    - PlayResX/Y: Video resolution (required for correct positioning on portrait video)
    - FontName, FontSize, Bold: Text appearance
    - PrimaryColour: Text color (&H00BBGGRR format)
    - OutlineColour: Border color
    - BackColour: Shadow color (used with Shadow parameter)
    - Outline: Border thickness (0-10 typical)
    - Shadow: Drop shadow offset (0-4 typical)
    - BorderStyle: 1=outline+shadow, 3=box background
    - Alignment: 1-9 numpad (2=bottom-center, 8=top-center)
    - MarginV: Distance from edge in pixels
    """
    # Basic text properties
    font_size: int = 48
    font_family: str = "Montserrat"
    primary_color: str = "&H00FFFFFF"  # White text
    outline_color: str = "&H00000000"  # Black outline
    outline_width: int = 3
    bold: int = 1
    alignment: int = 2  # Bottom-center
    margin_v: int = 50

    # Shadow effects (SUB-01)
    shadow_depth: int = 0  # 0-4 pixels
    shadow_color: str = "&H80000000"  # Semi-transparent black

    # Glow effects (SUB-02)
    enable_glow: bool = False
    glow_blur: int = 0  # 0-10

    # Style controls
    border_style: int = 1  # 1=outline+shadow

    # Video resolution
    video_width: int = 1080
    video_height: int = 1920

    def to_force_style_string(self) -> str:
        """Generate FFmpeg force_style parameter string."""
        style_parts = [
            f"PlayResX={self.video_width}",
            f"PlayResY={self.video_height}",
            f"FontName={self.font_family}",
            f"FontSize={self.font_size}",
            f"PrimaryColour={self.primary_color}",
            f"Bold={self.bold}",
            f"Alignment={self.alignment}",
            f"MarginV={self.margin_v}",
        ]

        # Glow effect: increase outline width and use semi-transparent outline
        if self.enable_glow and self.glow_blur > 0:
            glow_outline = self.outline_width + self.glow_blur
            style_parts.append(f"Outline={glow_outline}")
            # Semi-transparent outline for glow (50% alpha)
            glow_color = f"&H80{self.outline_color[4:]}"
            style_parts.append(f"OutlineColour={glow_color}")
        else:
            style_parts.append(f"Outline={self.outline_width}")
            style_parts.append(f"OutlineColour={self.outline_color}")

        # Shadow configuration
        if self.shadow_depth > 0:
            style_parts.append(f"Shadow={self.shadow_depth}")
            style_parts.append(f"BackColour={self.shadow_color}")
            style_parts.append(f"BorderStyle={self.border_style}")
        else:
            style_parts.append("Shadow=0")
            style_parts.append(f"BorderStyle={self.border_style}")

        return ",".join(style_parts)

    @staticmethod
    def from_dict(settings: dict, video_width: int, video_height: int) -> 'SubtitleStyleConfig':
        """Create SubtitleStyleConfig from frontend subtitle_settings dict."""
        # Convert hex to ASS color format
        def hex_to_ass(hex_color: str) -> str:
            hex_color = hex_color.lstrip('#')
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            return f"&H00{b:02X}{g:02X}{r:02X}"

        # Extract font family
        font_family = settings.get('fontFamily', 'Montserrat')
        if 'var(--' in font_family:
            parts = font_family.split(',')
            for part in parts:
                part = part.strip()
                if not part.startswith('var(') and part not in ['sans-serif', 'serif', 'monospace']:
                    font_family = part.strip("'\"")
                    break

        # Position to alignment and margin
        position_y = settings.get('positionY', 85)
        if position_y <= 20:
            alignment = 8
            margin_v = int(position_y / 100 * video_height)
        else:
            alignment = 2
            margin_v = int((100 - position_y) / 100 * video_height)

        # Add extra margin for shadow clearance
        shadow_depth = int(settings.get('shadowDepth', 0))
        if shadow_depth > 2:
            margin_v += shadow_depth * 2  # Prevent shadow clipping

        margin_v = max(50, margin_v)

        return SubtitleStyleConfig(
            font_size=int(settings.get('fontSize', 48)),
            font_family=font_family,
            primary_color=hex_to_ass(settings.get('textColor', '#FFFFFF')),
            outline_color=hex_to_ass(settings.get('outlineColor', '#000000')),
            outline_width=int(settings.get('outlineWidth', 3)),
            alignment=alignment,
            margin_v=margin_v,
            shadow_depth=shadow_depth,
            shadow_color=hex_to_ass(settings.get('shadowColor', '#000000')),
            enable_glow=settings.get('enableGlow', False),
            glow_blur=int(settings.get('glowBlur', 0)),
            border_style=settings.get('borderStyle', 1),
            video_width=video_width,
            video_height=video_height,
        )


def calculate_adaptive_font_size(
    srt_path: Path,
    base_font_size: int = 48,
    min_font_size: int = 32,
    max_chars_threshold: int = 40,
    max_chars_limit: int = 60
) -> Tuple[int, int]:
    """
    Calculate adaptive font size based on longest subtitle line.

    Implements linear interpolation formula:
    fontSize = maxSize - ((maxSize - minSize) * (textLength - minLength) / (maxLength - minLength))

    Args:
        srt_path: Path to SRT file
        base_font_size: Default font size for short text
        min_font_size: Minimum font size for very long text
        max_chars_threshold: Character count where size reduction starts
        max_chars_limit: Character count at minimum font size

    Returns:
        Tuple of (calculated_font_size, max_line_length)
    """
    try:
        # Read SRT with encoding fallback
        try:
            srt_content = srt_path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            # Fallback to latin-1 for non-UTF8 files
            srt_content = srt_path.read_text(encoding='latin-1')
            logger.warning(f"SRT file not UTF-8, using latin-1: {srt_path}")

        # Parse subtitles
        subtitles = list(srt.parse(srt_content))

        # Find longest line
        max_line_length = 0
        for subtitle in subtitles:
            lines = subtitle.content.split('\n')
            for line in lines:
                # Strip HTML tags
                clean_line = line.replace('<i>', '').replace('</i>', '')
                clean_line = clean_line.replace('<b>', '').replace('</b>', '')
                clean_line = clean_line.replace('<u>', '').replace('</u>', '')
                line_length = len(clean_line.strip())
                max_line_length = max(max_line_length, line_length)

        # Adaptive sizing logic
        if max_line_length <= max_chars_threshold:
            return base_font_size, max_line_length
        elif max_line_length >= max_chars_limit:
            return min_font_size, max_line_length
        else:
            # Linear interpolation
            font_size = base_font_size - (
                (base_font_size - min_font_size) *
                (max_line_length - max_chars_threshold) /
                (max_chars_limit - max_chars_threshold)
            )
            return int(font_size), max_line_length

    except Exception as e:
        logger.error(f"SRT parsing failed for adaptive sizing: {e}")
        return base_font_size, 0


def build_subtitle_filter(
    srt_path: Path,
    subtitle_settings: dict,
    video_width: int,
    video_height: int
) -> str:
    """
    Build complete FFmpeg subtitles filter with force_style.

    Args:
        srt_path: Path to SRT subtitle file
        subtitle_settings: Frontend SubtitleSettings dict
        video_width: Video resolution width
        video_height: Video resolution height

    Returns:
        FFmpeg filter string like:
        "subtitles='path.srt':force_style='FontName=Arial,FontSize=48,...'"
    """
    # Apply adaptive sizing if enabled
    settings = subtitle_settings.copy()
    if settings.get('adaptiveSizing', False):
        base_size = settings.get('fontSize', 48)
        adaptive_size, max_chars = calculate_adaptive_font_size(
            srt_path=srt_path,
            base_font_size=base_size,
            min_font_size=max(16, base_size - 16),
            max_chars_threshold=40,
            max_chars_limit=60
        )
        settings['fontSize'] = adaptive_size
        logger.info(f"Adaptive sizing: {max_chars} chars → {adaptive_size}px (base: {base_size}px)")

    # Build ASS style config
    style_config = SubtitleStyleConfig.from_dict(
        settings=settings,
        video_width=video_width,
        video_height=video_height
    )

    force_style = style_config.to_force_style_string()

    # Escape SRT path for FFmpeg (Windows compatibility)
    srt_path_escaped = str(srt_path).replace('\\', '/')
    srt_path_escaped = srt_path_escaped.replace("'", "'\\''")
    srt_path_escaped = srt_path_escaped.replace(':', '\\:')
    srt_path_escaped = srt_path_escaped.replace('[', '\\[')
    srt_path_escaped = srt_path_escaped.replace(']', '\\]')

    # Build filter
    filter_str = f"subtitles='{srt_path_escaped}':force_style='{force_style}'"

    logger.debug(f"Subtitle filter: {filter_str[:150]}...")
    return filter_str
