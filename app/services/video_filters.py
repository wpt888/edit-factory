"""
Video Enhancement Filter Configuration Service.
Implements hqdn3d (denoise), unsharp (sharpen), and eq (color correction) filters.

Filter order is locked: denoise -> sharpen -> color (don't sharpen noise).
All filters disabled by default - user must opt-in.
"""
from dataclasses import dataclass, field
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class DenoiseConfig:
    """
    hqdn3d denoising filter configuration.

    Reference: https://ffmpeg.org/ffmpeg-filters.html#hqdn3d

    Parameters control 3D denoising (spatial + temporal):
    - Spatial: reduces noise within single frame
    - Temporal: averages across multiple frames

    Conservative defaults for social media (lower than FFmpeg defaults):
    - luma_spatial: 2.0 (vs FFmpeg default 4.0)
    - Auto-derived: chroma_spatial, luma_temporal, chroma_temporal
    """
    enabled: bool = False
    luma_spatial: float = 2.0  # Range: 0-10, default 2.0 (FFmpeg default 4.0 too strong)

    def validate(self) -> bool:
        """Validate parameter ranges."""
        if self.luma_spatial < 0 or self.luma_spatial > 10:
            logger.error(f"Invalid luma_spatial: {self.luma_spatial} (must be 0-10)")
            return False
        return True

    def to_filter_string(self) -> Optional[str]:
        """
        Generate FFmpeg hqdn3d filter string.

        Auto-derives chroma_spatial (luma * 0.75), luma_temporal (luma * 1.5),
        and chroma_temporal from luma_spatial.

        Returns:
            Filter string like "hqdn3d=2.0:1.5:3.0:2.25" or None if disabled/invalid
        """
        if not self.enabled or not self.validate():
            return None

        # Auto-derive parameters from luma_spatial
        chroma_spatial = self.luma_spatial * 0.75
        luma_temporal = self.luma_spatial * 1.5
        chroma_temporal = chroma_spatial * 1.5

        filter_str = f"hqdn3d={self.luma_spatial:.1f}:{chroma_spatial:.2f}:{luma_temporal:.1f}:{chroma_temporal:.2f}"
        logger.debug(f"Denoise filter: {filter_str}")
        return filter_str


@dataclass
class SharpenConfig:
    """
    unsharp sharpening filter configuration.

    Reference: https://ffmpeg.org/ffmpeg-filters.html#unsharp

    Conservative defaults for social media to prevent halo artifacts:
    - luma_amount: 0.5 (vs FFmpeg default 1.0)
    - matrix_size: 5 (standard 5x5 kernel)
    - chroma_amount: 0.0 ALWAYS (never sharpen chroma - prevents color artifacts)
    """
    enabled: bool = False
    luma_amount: float = 0.5  # Range: -2 to 5, default 0.5 (FFmpeg default 1.0 too strong)
    matrix_size: int = 5  # Range: 3-23 (odd), default 5 (standard kernel)
    chroma_amount: float = 0.0  # LOCKED: never sharpen chroma (prevents color artifacts)

    def validate(self) -> bool:
        """Validate parameter ranges."""
        if self.luma_amount < -2 or self.luma_amount > 5:
            logger.error(f"Invalid luma_amount: {self.luma_amount} (must be -2 to 5)")
            return False
        if self.matrix_size < 3 or self.matrix_size > 23 or self.matrix_size % 2 == 0:
            logger.error(f"Invalid matrix_size: {self.matrix_size} (must be odd, 3-23)")
            return False
        return True

    def to_filter_string(self) -> Optional[str]:
        """
        Generate FFmpeg unsharp filter string.

        Format: luma_msize_x:luma_msize_y:luma_amount:chroma_msize_x:chroma_msize_y:chroma_amount
        chroma_amount is ALWAYS 0.0 to prevent color artifacts.

        Returns:
            Filter string like "unsharp=5:5:0.50:5:5:0.0" or None if disabled/invalid
        """
        if not self.enabled or not self.validate():
            return None

        # Always use 0.0 for chroma_amount (prevent color artifacts)
        filter_str = (
            f"unsharp={self.matrix_size}:{self.matrix_size}:{self.luma_amount:.2f}:"
            f"{self.matrix_size}:{self.matrix_size}:{self.chroma_amount:.1f}"
        )
        logger.debug(f"Sharpen filter: {filter_str}")
        return filter_str


@dataclass
class ColorConfig:
    """
    eq color correction filter configuration.

    Reference: https://ffmpeg.org/ffmpeg-filters.html#eq

    Conservative defaults for subtle corrections:
    - brightness: 0.0 (range: -1 to 1)
    - contrast: 1.0 (range: 0-3, 1.0 = no change)
    - saturation: 1.0 (range: 0-3, 1.0 = no change)
    """
    enabled: bool = False
    brightness: float = 0.0  # Range: -1 to 1, default 0 (no change)
    contrast: float = 1.0  # Range: 0-3, default 1 (no change)
    saturation: float = 1.0  # Range: 0-3, default 1 (no change)

    def validate(self) -> bool:
        """Validate parameter ranges."""
        if self.brightness < -1 or self.brightness > 1:
            logger.error(f"Invalid brightness: {self.brightness} (must be -1 to 1)")
            return False
        if self.contrast < 0 or self.contrast > 3:
            logger.error(f"Invalid contrast: {self.contrast} (must be 0-3)")
            return False
        if self.saturation < 0 or self.saturation > 3:
            logger.error(f"Invalid saturation: {self.saturation} (must be 0-3)")
            return False
        return True

    def to_filter_string(self) -> Optional[str]:
        """
        Generate FFmpeg eq filter string.

        Only includes parameters that deviate from defaults (efficiency).

        Returns:
            Filter string like "eq=brightness=0.05:contrast=1.1" or None if disabled/invalid
        """
        if not self.enabled or not self.validate():
            return None

        # Only include non-default parameters (reduce command length)
        params = []
        if abs(self.brightness) > 0.001:  # Changed from 0
            params.append(f"brightness={self.brightness:.2f}")
        if abs(self.contrast - 1.0) > 0.001:  # Changed from 1.0
            params.append(f"contrast={self.contrast:.2f}")
        if abs(self.saturation - 1.0) > 0.001:  # Changed from 1.0
            params.append(f"saturation={self.saturation:.2f}")

        if not params:
            # All values at defaults, no filter needed
            return None

        filter_str = f"eq={':'.join(params)}"
        logger.debug(f"Color filter: {filter_str}")
        return filter_str


@dataclass
class VideoFilters:
    """
    Complete video enhancement filter pipeline configuration.

    Applies filters in mandatory order: denoise -> sharpen -> color
    (order locked to prevent sharpening noise)
    """
    denoise: DenoiseConfig = field(default_factory=DenoiseConfig)
    sharpen: SharpenConfig = field(default_factory=SharpenConfig)
    color: ColorConfig = field(default_factory=ColorConfig)

    def build_filter_chain(self) -> list[str]:
        """
        Build ordered filter chain respecting filter order best practices.

        Order (locked, not user-configurable):
        1. Denoise (clean signal first)
        2. Sharpen (enhance cleaned signal)
        3. Color correction (adjust final appearance)

        Returns:
            List of filter strings (empty if no filters enabled)
        """
        filters = []

        # Step 1: Denoise (must be first - don't sharpen noise)
        denoise_filter = self.denoise.to_filter_string()
        if denoise_filter:
            filters.append(denoise_filter)
            logger.info(f"Enabled denoise: luma_spatial={self.denoise.luma_spatial}")

        # Step 2: Sharpen (operates on cleaned signal)
        sharpen_filter = self.sharpen.to_filter_string()
        if sharpen_filter:
            filters.append(sharpen_filter)
            logger.info(f"Enabled sharpen: luma_amount={self.sharpen.luma_amount}")

        # Step 3: Color correction (final appearance adjustment)
        color_filter = self.color.to_filter_string()
        if color_filter:
            filters.append(color_filter)
            logger.info(
                f"Enabled color correction: brightness={self.color.brightness}, "
                f"contrast={self.color.contrast}, saturation={self.color.saturation}"
            )

        return filters

    def has_any_enabled(self) -> bool:
        """Check if any filters are enabled."""
        return self.denoise.enabled or self.sharpen.enabled or self.color.enabled

    def estimate_performance_impact(self) -> str:
        """
        Estimate performance overhead of enabled filters.

        Based on benchmarks:
        - hqdn3d: ~5% overhead (21 fps on 1080p)
        - unsharp: ~10% overhead (10-15 fps on 1080p)
        - eq: ~2% overhead (negligible)

        Returns:
            String like "None", "Low (<10%)", "Medium (10-20%)", "High (>20%)"
        """
        if not self.has_any_enabled():
            return "None"

        overhead = 0
        if self.denoise.enabled:
            overhead += 5  # ~5% overhead
        if self.sharpen.enabled:
            overhead += 10  # ~10% overhead
        if self.color.enabled:
            overhead += 2  # ~2% overhead

        if overhead < 10:
            return "Low (<10%)"
        elif overhead < 20:
            return "Medium (10-20%)"
        else:
            return "High (>20%)"
