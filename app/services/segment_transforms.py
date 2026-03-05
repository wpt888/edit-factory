"""
Segment Transform Service.
Per-segment visual transforms: rotation, scale, pan, flip, opacity.

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
    """Visual transform properties for a video segment."""
    rotation: float = 0.0       # 0-360 degrees
    scale: float = 1.0          # 0.1-5.0
    pan_x: int = 0              # pixels, horizontal offset
    pan_y: int = 0              # pixels, vertical offset
    flip_h: bool = False        # horizontal flip
    flip_v: bool = False        # vertical flip
    opacity: float = 1.0        # 0.0-1.0

    @classmethod
    def from_dict(cls, data: Optional[dict]) -> "SegmentTransform":
        """Parse JSONB dict into SegmentTransform. Returns identity if None."""
        if not data:
            return cls()
        return cls(
            rotation=float(data.get("rotation", 0)),
            scale=float(data.get("scale", 1.0)),
            pan_x=int(data.get("pan_x", 0)),
            pan_y=int(data.get("pan_y", 0)),
            flip_h=bool(data.get("flip_h", False)),
            flip_v=bool(data.get("flip_v", False)),
            opacity=max(0.0, min(1.0, float(data.get("opacity", 1.0)))),
        )

    def is_identity(self) -> bool:
        """Check if all values are defaults (no transform needed)."""
        return (
            abs(self.rotation) < 0.1
            and abs(self.scale - 1.0) < 0.01
            and self.pan_x == 0
            and self.pan_y == 0
            and not self.flip_h
            and not self.flip_v
            and abs(self.opacity - 1.0) < 0.01
        )

    def to_ffmpeg_filters(self, width: int, height: int) -> List[str]:
        """
        Build FFmpeg video filter chain for this transform.

        Args:
            width: Output video width
            height: Output video height

        Returns:
            List of filter strings to join with comma for -vf
        """
        if self.is_identity():
            return []

        filters = []

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

        # 3. Scale (zoom)
        if abs(self.scale - 1.0) >= 0.01:
            scaled_w = int(width * self.scale)
            scaled_h = int(height * self.scale)
            # Scale up/down then crop back to target size
            filters.append(f"scale={scaled_w}:{scaled_h}")
            filters.append(f"crop={width}:{height}")

        # 4. Pan (offset via pad + crop)
        if self.pan_x != 0 or self.pan_y != 0:
            # Pad creates extra space, crop repositions
            pad_w = width + abs(self.pan_x) * 2
            pad_h = height + abs(self.pan_y) * 2
            pad_x = abs(self.pan_x) - self.pan_x
            pad_y = abs(self.pan_y) - self.pan_y
            filters.append(f"pad={pad_w}:{pad_h}:{pad_x}:{pad_y}:black")
            filters.append(f"crop={width}:{height}")

        # 5. Opacity via RGB channel dimming (compatible with yuv420p)
        if abs(self.opacity - 1.0) >= 0.01:
            a = max(0.0, min(1.0, self.opacity))
            filters.append(f"colorchannelmixer=rr={a:.2f}:gg={a:.2f}:bb={a:.2f}")

        # 6. Safety net: ensure output matches target dimensions (crop, not letterbox)
        filters.append(f"scale={width}:{height}:force_original_aspect_ratio=increase")
        filters.append(f"crop={width}:{height}")

        logger.debug(f"Transform filters: {','.join(filters)}")
        return filters


def merge_transforms(
    segment_transforms: Optional[dict],
    project_transforms: Optional[dict]
) -> SegmentTransform:
    """
    Merge segment default transforms with project overrides.
    Project overrides take full precedence if present.
    """
    if project_transforms:
        return SegmentTransform.from_dict(project_transforms)
    return SegmentTransform.from_dict(segment_transforms)
