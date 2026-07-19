"""
Subtitle style builder for FFmpeg ASS force_style parameter.
Implements shadow depth, glow effects, and adaptive font sizing.
"""
import logging
import re
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
    letter_spacing: float = 0

    # Shadow effects (SUB-01)
    shadow_depth: int = 0  # 0-4 pixels
    shadow_color: str = "&H80000000"  # Semi-transparent black

    # Glow effects (SUB-02)
    enable_glow: bool = False
    glow_blur: int = 0  # 0-10

    # Style controls
    border_style: int = 1  # 1=outline+shadow

    # Text opacity (0-100, default 100)
    opacity: int = 100

    # Karaoke (word-level highlight) — pairs with {\k} tags in the cue text.
    # When enabled, PrimaryColour is the "already sung / highlighted" colour and
    # SecondaryColour is the base colour words start in.
    karaoke: bool = False
    highlight_color: str = "&H0000FFFF"  # Yellow (ASS &H00BBGGRR) — sung word

    # Video resolution
    video_width: int = 1080
    video_height: int = 1920

    def to_force_style_string(self) -> str:
        """Generate FFmpeg force_style parameter string."""
        # Always apply opacity to the alpha channel of the active text colour.
        # ASS alpha: 00=opaque, FF=transparent.
        ass_alpha = int((100 - self.opacity) / 100 * 255)

        def _with_alpha(color: str) -> str:
            return f"&H{ass_alpha:02X}{color[4:]}" if color.startswith("&H") and len(color) >= 6 else color

        # Karaoke: words start in the base colour (Secondary) and flip to the
        # highlight colour (Primary) as the \k clock passes each word.
        if self.karaoke:
            primary = _with_alpha(self.highlight_color)
            secondary = _with_alpha(self.primary_color)
        else:
            primary = _with_alpha(self.primary_color)
            secondary = None

        style_parts = [
            f"PlayResX={self.video_width}",
            f"PlayResY={self.video_height}",
            f"FontName={self.font_family}",
            f"FontSize={self.font_size}",
            f"PrimaryColour={primary}",
        ]
        if secondary is not None:
            style_parts.append(f"SecondaryColour={secondary}")
        style_parts += [
            f"Bold={self.bold}",
            f"Alignment={self.alignment}",
            f"MarginV={self.margin_v}",
            f"Spacing={self.letter_spacing}",
            "MarginL=60",
            "MarginR=60",
            # WrapStyle=2: no automatic line wrapping — break only on \N.
            # WrapStyle=0 (smart wrap) causes FFmpeg to wrap long phrases onto
            # two lines, while the CSS preview shows them on a single line.
            "WrapStyle=2",
        ]

        # Glow effect: increase outline width and use semi-transparent outline
        if self.enable_glow and self.glow_blur > 0:
            glow_outline = self.outline_width + self.glow_blur
            style_parts.append(f"Outline={glow_outline}")
            # Semi-transparent outline for glow (50% alpha)
            # ASS color format: &HAABBGGRR — strip leading &H before slicing
            oc = self.outline_color
            if oc.startswith("&H") and len(oc) >= 10:
                glow_color = f"&H80{oc[4:]}"
            elif oc.startswith("&H"):
                glow_color = f"&H80{oc[2:]}"
            else:
                # Non-standard color, convert to a safe default
                glow_color = "&H80000000"
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
            # Default subtle shadow to match CSS preview textShadow
            # Preview always has: textShadow: "0 1px 4px rgba(0,0,0,0.9)"
            # &HE0000000 = ~88% opaque black, Shadow=1 for minimal offset
            style_parts.append("Shadow=1")
            style_parts.append("BackColour=&HE0000000")
            style_parts.append(f"BorderStyle={self.border_style}")

        return ",".join(style_parts)

    def to_ass_style_line(self, name: str = "Default") -> str:
        """Render a full positional ASS ``Style:`` line for a real .ass file.

        Used for karaoke burn-in: unlike ``force_style`` on an SRT (where libass
        ignores embedded ``{\\k}`` tags), a proper ``[V4+ Styles]`` line with
        distinct Primary/Secondary colours makes the word-level highlight sweep
        actually render. Secondary is the base ("unsung") colour; Primary is the
        highlight ("sung") colour.

        ponytail: mirrors the karaoke colour math in to_force_style_string —
        keep the alpha/glow/shadow rules here in sync with that method.
        """
        ass_alpha = int((100 - self.opacity) / 100 * 255)

        def _with_alpha(color: str) -> str:
            return f"&H{ass_alpha:02X}{color[4:]}" if color.startswith("&H") and len(color) >= 6 else color

        # Karaoke: text starts in Secondary (base) and flips to Primary
        # (highlight) as each word's \k clock elapses.
        primary = _with_alpha(self.highlight_color)
        secondary = _with_alpha(self.primary_color)

        if self.enable_glow and self.glow_blur > 0:
            outline_w = self.outline_width + self.glow_blur
            oc = self.outline_color
            if oc.startswith("&H") and len(oc) >= 10:
                outline_colour = f"&H80{oc[4:]}"
            elif oc.startswith("&H"):
                outline_colour = f"&H80{oc[2:]}"
            else:
                outline_colour = "&H80000000"
        else:
            outline_w = self.outline_width
            outline_colour = self.outline_color

        if self.shadow_depth > 0:
            shadow_v = self.shadow_depth
            back_colour = self.shadow_color
        else:
            # Match the default subtle shadow the force_style path applies.
            shadow_v = 1
            back_colour = "&HE0000000"

        bold = -1 if self.bold else 0  # ASS: -1 = true, 0 = false
        return (
            f"Style: {name},{self.font_family},{self.font_size},"
            f"{primary},{secondary},{outline_colour},{back_colour},"
            f"{bold},0,0,0,100,100,{self.letter_spacing},0,"
            f"{self.border_style},{outline_w},{shadow_v},{self.alignment},"
            f"60,60,{self.margin_v},1"
        )

    @staticmethod
    def from_dict(settings: dict, video_width: int, video_height: int) -> 'SubtitleStyleConfig':
        """Create SubtitleStyleConfig from frontend subtitle_settings dict."""
        # Convert hex to ASS color format
        def hex_to_ass(hex_color: str) -> str:
            try:
                hex_color = hex_color.lstrip('#')
                if len(hex_color) == 6:
                    # 6-char hex (#RRGGBB) → fully opaque (ASS alpha 00)
                    r = int(hex_color[0:2], 16)
                    g = int(hex_color[2:4], 16)
                    b = int(hex_color[4:6], 16)
                    return f"&H00{b:02X}{g:02X}{r:02X}"
                elif len(hex_color) == 8:
                    # 8-char hex (#RRGGBBAA) — CSS alpha convention (00=transparent, FF=opaque)
                    r = int(hex_color[0:2], 16)
                    g = int(hex_color[2:4], 16)
                    b = int(hex_color[4:6], 16)
                    css_alpha = int(hex_color[6:8], 16)
                    # Invert: CSS (FF=opaque) → ASS (00=opaque)
                    ass_alpha = 255 - css_alpha
                    return f"&H{ass_alpha:02X}{b:02X}{g:02X}{r:02X}"
                else:
                    return "&H00FFFFFF"
            except (ValueError, IndexError):
                return "&H00FFFFFF"

        font_family = settings.get('fontFamily', 'Montserrat')

        # Position to ASS alignment and margin. Keep vertical placement driven
        # by positionY while allowing the editor to choose left/center/right.
        position_y = settings.get('positionY', 85)
        horizontal = settings.get('horizontalAlignment', 'center')
        horizontal_offset = {'left': 1, 'center': 2, 'right': 3}.get(horizontal, 2)
        if position_y <= 20:
            alignment = 6 + horizontal_offset  # 7/8/9: top left/center/right
            margin_v = int(position_y / 100 * video_height)
        else:
            alignment = horizontal_offset  # 1/2/3: bottom left/center/right
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
            letter_spacing=max(-2, min(10, float(settings.get('letterSpacing', 0)))),
            shadow_depth=shadow_depth,
            shadow_color=hex_to_ass(settings.get('shadowColor', '#000000')),
            enable_glow=settings.get('enableGlow', False),
            glow_blur=int(settings.get('glowBlur', 0)),
            border_style=settings.get('borderStyle', 1),
            opacity=int(settings.get('opacity', 100)),
            karaoke=bool(settings.get('karaoke', False)),
            highlight_color=hex_to_ass(settings.get('highlightColor', '#FFFF00')),
            video_width=video_width,
            video_height=video_height,
        )


def calculate_adaptive_font_size(
    srt_path: Path,
    base_font_size: int = 48,
    min_font_size: int = 32,
    max_chars_threshold: int = 25,
    max_chars_limit: int = 40
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
                # VID-10: Strip HTML tags and ASS override tags before measuring
                clean_line = re.sub(r'<[^>]+>', '', line)       # HTML tags like <i>, <b>
                clean_line = re.sub(r'\{[^}]+\}', '', clean_line)  # ASS override tags like {\an8}
                line_length = len(clean_line.strip())
                max_line_length = max(max_line_length, line_length)

        # Adaptive sizing logic
        if max_line_length <= max_chars_threshold:
            return base_font_size, max_line_length
        elif max_line_length >= max_chars_limit:
            return min_font_size, max_line_length
        else:
            # Linear interpolation (guard against ZeroDivisionError)
            denom = max_chars_limit - max_chars_threshold
            if denom == 0:
                font_size = min_font_size
            else:
                font_size = base_font_size - (
                    (base_font_size - min_font_size) *
                    (max_line_length - max_chars_threshold) /
                    denom
                )
            return int(font_size), max_line_length

    except Exception as e:
        logger.error(f"SRT parsing failed for adaptive sizing: {e}")
        return base_font_size, 0


def _inject_wrap_style_override_in_srt(srt_path: Path) -> None:
    """Prepend `{\\q2}` to each subtitle text line in the SRT file.

    `{\\q2}` is an ASS override tag that sets WrapStyle=2 (no automatic
    wrapping — break only on explicit \\N). libass parses override tags
    inside SRT text consistently across frame sizes, unlike the WrapStyle
    key in the `force_style` argument.

    If a cue already starts with `{\\q2}` (e.g. from a prior pass) the
    function is a no-op for that cue. Runs idempotently and rewrites the
    file in place. Errors are swallowed — wrap style is a rendering
    preference, not a correctness requirement.
    """
    try:
        content = srt_path.read_text(encoding="utf-8")
    except Exception:
        try:
            content = srt_path.read_text(encoding="latin-1")
        except Exception as e:
            logger.warning(f"Could not read SRT for wrap-style injection: {e}")
            return

    lines = content.split("\n")
    out: list[str] = []
    # State machine: after a timestamp line, the next non-empty lines are text.
    saw_timestamp = False
    for line in lines:
        stripped = line.strip()
        if " --> " in stripped:
            saw_timestamp = True
            out.append(line)
            continue
        if saw_timestamp and stripped:
            # First text line after timestamp — inject override if not already present.
            if not stripped.startswith("{\\q2}"):
                # Preserve leading whitespace (unlikely but harmless) by inserting
                # at the start of the content, keeping trailing content intact.
                out.append("{\\q2}" + line)
            else:
                out.append(line)
            saw_timestamp = False  # subsequent text lines in the same cue untouched
            continue
        if not stripped:
            saw_timestamp = False
        out.append(line)

    new_content = "\n".join(out)
    if new_content != content:
        try:
            srt_path.write_text(new_content, encoding="utf-8")
        except Exception as e:
            logger.warning(f"Could not write SRT after wrap-style injection: {e}")


def _timedelta_to_ass(td) -> str:
    """Format a timedelta as an ASS timestamp ``H:MM:SS.cc`` (centiseconds)."""
    total = max(0.0, td.total_seconds())
    hours = int(total // 3600)
    minutes = int((total % 3600) // 60)
    secs = int(total % 60)
    centis = int(round((total - int(total)) * 100))
    if centis >= 100:  # rounding can push to 100 → roll into the next second
        secs += 1
        centis = 0
        if secs >= 60:
            secs = 0
            minutes += 1
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def build_karaoke_ass_file(
    srt_path: Path,
    style_config: 'SubtitleStyleConfig',
    video_width: int,
    video_height: int,
) -> 'Path | None':
    """Convert a ``{\\k}``-tagged SRT into a real .ass file for karaoke burn-in.

    libass ignores ``{\\k}`` karaoke tags embedded in an SRT fed through
    FFmpeg's ``subtitles`` filter — the word-level highlight only sweeps from a
    proper ``[V4+ Styles]`` karaoke Style in an actual .ass file (verified with
    frame-by-frame FFmpeg tests). This reads the karaoke SRT the pipeline
    already produced (``generate_srt_from_timestamps(..., karaoke=True)``) and
    re-emits it as an .ass alongside the SRT.

    Returns the .ass Path, or ``None`` if the SRT has no ``{\\k}`` tags or can't
    be parsed — in which case the caller falls back to the static SRT burn.
    """
    try:
        content = srt_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        content = srt_path.read_text(encoding="latin-1")
    except Exception as e:
        logger.warning(f"Karaoke ASS: could not read SRT ({e}) — static fallback")
        return None

    if "{\\k" not in content:
        # No per-word timing tags present — nothing to sweep.
        return None

    try:
        subs = list(srt.parse(content))
    except Exception as e:
        logger.warning(f"Karaoke ASS: SRT parse failed ({e}) — static fallback")
        return None
    if not subs:
        return None

    events = []
    for sub in subs:
        # ASS uses \N for hard line breaks; collapse any SRT newlines.
        text = sub.content.replace("\r\n", "\n").replace("\n", "\\N")
        events.append(
            f"Dialogue: 0,{_timedelta_to_ass(sub.start)},{_timedelta_to_ass(sub.end)},"
            f"Default,,0,0,0,,{text}"
        )

    ass_content = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {video_width}\n"
        f"PlayResY: {video_height}\n"
        "WrapStyle: 2\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, "
        "ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding\n"
        f"{style_config.to_ass_style_line('Default')}\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        + "\n".join(events) + "\n"
    )

    ass_path = srt_path.with_suffix(".ass")
    try:
        ass_path.write_text(ass_content, encoding="utf-8")
    except Exception as e:
        logger.warning(f"Karaoke ASS: could not write .ass ({e}) — static fallback")
        return None
    return ass_path


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
            max_chars_threshold=25,
            max_chars_limit=40
        )
        settings['fontSize'] = adaptive_size
        logger.info(f"Adaptive sizing: {max_chars} chars → {adaptive_size}px (base: {base_size}px)")

    # Build ASS style config
    style_config = SubtitleStyleConfig.from_dict(
        settings=settings,
        video_width=video_width,
        video_height=video_height
    )

    from app.services.font_manager import prepare_render_fonts
    from app.services.video_processor import escape_srt_path_for_ffmpeg
    effective_family, fonts_dir, _warning = prepare_render_fonts(style_config.font_family)
    style_config.font_family = effective_family

    # Karaoke (word-level highlight) MUST burn via a real .ass file — libass
    # silently ignores {\k} tags embedded in an SRT via the `subtitles` filter,
    # rendering the whole line static (verified with frame-by-frame tests). When
    # karaoke is on and the SRT carries {\k} tags, emit an `ass=` filter built
    # from the same style config; otherwise fall through to the static path.
    if style_config.karaoke:
        ass_path = build_karaoke_ass_file(srt_path, style_config, video_width, video_height)
        if ass_path is not None:
            ass_escaped = escape_srt_path_for_ffmpeg(ass_path)
            fontsdir_clause = (
                f":fontsdir='{escape_srt_path_for_ffmpeg(fonts_dir)}'" if fonts_dir else ""
            )
            filter_str = (
                f"ass='{ass_escaped}'"
                f"{fontsdir_clause}"
                f":original_size={video_width}x{video_height}"
            )
            logger.info(f"Karaoke captions: burning word-highlight via ASS ({ass_path.name})")
            return filter_str
        logger.warning("Karaoke requested but SRT lacks {\\k} tags — using static style")

    force_style = style_config.to_force_style_string()

    # DEBUG: Log the complete subtitle style config to diagnose transparency bug
    logger.debug(
        f"[SUBTITLE-DEBUG] Input settings: opacity={settings.get('opacity', 'MISSING')}, "
        f"textColor={settings.get('textColor', 'MISSING')}, "
        f"outlineColor={settings.get('outlineColor', 'MISSING')}, "
        f"enableGlow={settings.get('enableGlow', 'MISSING')}, "
        f"glowBlur={settings.get('glowBlur', 'MISSING')}, "
        f"shadowDepth={settings.get('shadowDepth', 'MISSING')}, "
        f"fontSize={settings.get('fontSize', 'MISSING')}"
    )
    logger.debug(
        f"[SUBTITLE-DEBUG] StyleConfig: opacity={style_config.opacity}, "
        f"primary_color={style_config.primary_color}, "
        f"outline_color={style_config.outline_color}, "
        f"enable_glow={style_config.enable_glow}, "
        f"glow_blur={style_config.glow_blur}, "
        f"shadow_depth={style_config.shadow_depth}"
    )
    logger.debug(f"[SUBTITLE-DEBUG] force_style={force_style}")

    # Log SRT file content (first 200 chars) to verify it's not empty/malformed
    try:
        srt_content_sample = srt_path.read_text(encoding='utf-8')[:200]
        logger.debug(f"[SUBTITLE-DEBUG] SRT content (first 200 chars): {srt_content_sample!r}")
        logger.debug(f"[SUBTITLE-DEBUG] SRT file size: {srt_path.stat().st_size} bytes")
    except Exception as e:
        logger.debug(f"[SUBTITLE-DEBUG] Could not read SRT file: {e}")

    # Force WrapStyle=2 (no automatic wrapping) per-cue via the ASS `{\q2}`
    # override tag, injected at the start of each subtitle text line. The
    # `WrapStyle` key inside `force_style` is unreliable for SRT inputs — it
    # lives in [Script Info], not the [V4+ Styles] line, and FFmpeg's SRT→ASS
    # conversion + libass scaling will otherwise wrap short phrases
    # differently depending on the frame size (e.g. the 540x960 preview
    # wraps "Ești gata" onto two lines while the 1080x1920 final render
    # keeps it on one). Override tags embedded in the subtitle text ARE
    # honored consistently by libass.
    _inject_wrap_style_override_in_srt(srt_path)

    # BUG-1.4: Use shared escape function for consistent path handling across codepaths
    from app.services.video_processor import escape_srt_path_for_ffmpeg
    srt_path_escaped = escape_srt_path_for_ffmpeg(srt_path)

    # Build filter.
    # `original_size` tells libass to use (video_width, video_height) as the
    # reference resolution when scaling subtitle sizes. Without it, libass
    # uses the actual frame dimensions for SRT input, which breaks the
    # preview render (540x960 frame) — FontSize=100 would render ~2x too
    # large relative to the frame compared to the final 1080x1920 render.
    # PlayResX/PlayResY inside force_style don't help because those live in
    # the ASS [Script Info] section, not the [Style] line that force_style
    # can override.
    fontsdir_clause = (
        f":fontsdir='{escape_srt_path_for_ffmpeg(fonts_dir)}'" if fonts_dir else ""
    )
    filter_str = (
        f"subtitles='{srt_path_escaped}'"
        f"{fontsdir_clause}"
        f":original_size={video_width}x{video_height}"
        f":force_style='{force_style}'"
    )

    logger.debug(f"Subtitle filter: {filter_str[:150]}...")
    return filter_str
