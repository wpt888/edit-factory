"""
Segment Transform Service.
Per-segment video transforms: geometry, speed, blur fill, and color.

Generates FFmpeg filter chains for each transform property.
Follows the same dataclass + to_filter pattern as video_filters.py.
"""
import math
from dataclasses import dataclass
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class SegmentTransform:
    """Transform properties for a video segment."""
    rotation: float = 0.0       # 0-360 degrees
    scale: float = 1.0          # 0.1-5.0
    pan_x: int = 0              # pixels, horizontal offset
    pan_y: int = 0              # pixels, vertical offset
    flip_h: bool = False        # horizontal flip
    flip_v: bool = False        # vertical flip
    speed: float = 1.0          # 0.25-4.0
    blur_fill: bool = False
    brightness: float = 0.0     # -1.0-1.0
    contrast: float = 1.0       # 0.0-3.0
    saturation: float = 1.0     # 0.0-3.0

    @classmethod
    def from_dict(cls, data: Optional[dict]) -> "SegmentTransform":
        """Parse a JSONB dict, silently ignoring legacy or unknown keys."""
        if not data:
            return cls()
        return cls(
            rotation=float(data.get("rotation", 0)),
            scale=float(data.get("scale", 1.0)),
            pan_x=int(data.get("pan_x", 0)),
            pan_y=int(data.get("pan_y", 0)),
            flip_h=bool(data.get("flip_h", False)),
            flip_v=bool(data.get("flip_v", False)),
            speed=max(0.25, min(4.0, float(data.get("speed", 1.0)))),
            blur_fill=bool(data.get("blur_fill", False)),
            brightness=max(-1.0, min(1.0, float(data.get("brightness", 0.0)))),
            contrast=max(0.0, min(3.0, float(data.get("contrast", 1.0)))),
            saturation=max(0.0, min(3.0, float(data.get("saturation", 1.0)))),
        )

    def has_visual_transforms(self) -> bool:
        """Return whether a custom visual filter chain is required."""
        return (
            abs(self.rotation) >= 0.1
            or abs(self.scale - 1.0) >= 0.01
            or self.pan_x != 0
            or self.pan_y != 0
            or self.flip_h
            or self.flip_v
            or self.blur_fill
            or abs(self.brightness) >= 0.001
            or abs(self.contrast - 1.0) >= 0.001
            or abs(self.saturation - 1.0) >= 0.001
        )

    def has_transforms(self) -> bool:
        """Return whether any visual or timing transform is non-default."""
        return self.has_visual_transforms() or abs(self.speed - 1.0) >= 0.001

    def is_identity(self) -> bool:
        """Check if all values are defaults (no transform needed)."""
        return not self.has_transforms()

    def to_ffmpeg_filters(self, width: int, height: int) -> List[str]:
        """
        Build FFmpeg video filter chain for this transform.

        Args:
            width: Output video width
            height: Output video height

        Returns:
            List of filter strings to join with comma for -vf
        """
        if not self.has_visual_transforms():
            return []

        # Normalize to the target frame FIRST. The transform chain replaces the
        # default scale+crop normalization in assembly, so without this the zoom
        # step force-scales the RAW source (any size/orientation) and distorts
        # aspect ratio. It also guarantees zoom/pan operate on exactly WxH.
        norm = [
            f"scale={width}:{height}:force_original_aspect_ratio=increase",
            f"crop={width}:{height}",
        ]
        filters = list(norm)

        # 1. Flips (cheapest, do first)
        if self.flip_h:
            filters.append("hflip")
        if self.flip_v:
            filters.append("vflip")

        # 2. Rotation
        if abs(self.rotation) >= 0.1:
            rot = self.rotation % 360
            if abs(rot - 90) < 0.1:
                filters.append("transpose=1")
            elif abs(rot - 180) < 0.1:
                filters.append("transpose=1,transpose=1")
            elif abs(rot - 270) < 0.1:
                filters.append("transpose=2")
            else:
                # Arbitrary angle rotation (in radians)
                radians = rot * math.pi / 180
                filters.append(f"rotate={radians:.4f}:fillcolor=black")
            # transpose swaps WxH — restore target dims so zoom/pan stay valid
            filters.extend(norm)

        # 3. Scale (zoom)
        if abs(self.scale - 1.0) >= 0.01:
            scaled_w = max(2, int(width * self.scale) // 2 * 2)
            scaled_h = max(2, int(height * self.scale) // 2 * 2)
            filters.append(f"scale={scaled_w}:{scaled_h}")
            if self.scale > 1.0:
                # Zoom-in: crop the enlarged frame back to target
                filters.append(f"crop={width}:{height}")
            else:
                # Zoom-out: frame is now smaller than target, so composite it
                # over a blurred cover or pad it instead of attempting a fatal
                # oversized crop.
                if self.blur_fill:
                    filters.append(
                        "split=2[blur_bg][blur_fg];"
                        f"[blur_bg]scale={width}:{height}:force_original_aspect_ratio=increase,"
                        f"crop={width}:{height},boxblur=20:2[blurred_bg];"
                        f"[blur_fg]scale={scaled_w}:{scaled_h}[scaled_fg];"
                        "[blurred_bg][scaled_fg]overlay=(W-w)/2:(H-h)/2"
                    )
                else:
                    filters.append(f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black")

        # 4. Pan (offset via pad + crop)
        if self.pan_x != 0 or self.pan_y != 0:
            # Pad creates extra space, crop repositions
            pad_w = width + abs(self.pan_x) * 2
            pad_h = height + abs(self.pan_y) * 2
            pad_x = abs(self.pan_x) - self.pan_x
            pad_y = abs(self.pan_y) - self.pan_y
            filters.append(f"pad={pad_w}:{pad_h}:{pad_x}:{pad_y}:black")
            filters.append(f"crop={width}:{height}")

        # 5. Per-segment color correction
        color_params = []
        if abs(self.brightness) >= 0.001:
            color_params.append(f"brightness={max(-1.0, min(1.0, self.brightness)):.2f}")
        if abs(self.contrast - 1.0) >= 0.001:
            color_params.append(f"contrast={max(0.0, min(3.0, self.contrast)):.2f}")
        if abs(self.saturation - 1.0) >= 0.001:
            color_params.append(f"saturation={max(0.0, min(3.0, self.saturation)):.2f}")
        if color_params:
            filters.append(f"eq={':'.join(color_params)}")

        # 6. Safety net: ensure output matches target dimensions (crop, not letterbox)
        filters.append(f"scale={width}:{height}:force_original_aspect_ratio=increase")
        filters.append(f"crop={width}:{height}")

        logger.debug(f"Transform filters: {','.join(filters)}")
        return filters
