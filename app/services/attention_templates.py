"""Deterministic placement for Attention Hooks templates."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional


SYSTEM_TEMPLATES: List[Dict[str, Any]] = [
    {"id": "system-quick-pulse", "name": "Quick Pulse", "is_system": True,
     "strategy": "count", "count": 3, "durationMs": 1200, "animation": "pop", "sfx": "whoosh"},
    {"id": "system-product-focus", "name": "Product Focus", "is_system": True,
     "strategy": "everySeconds", "everySeconds": 6, "durationMs": 1800, "animation": "zoom"},
    {"id": "system-tornado-stack", "name": "Tornado Stack", "is_system": True,
     "strategy": "count", "count": 2, "durationMs": 1800, "animation": "tornado", "layers": 3, "sfx": "impact"},
]


def layout_positions(layer_count: int, size: float) -> List[tuple[float, float]]:
    """Where each stacked image sits — the template's visual signature.

    Given ``layer_count`` images that each occupy ``size`` x ``size`` of the
    frame, return the (x, y) top-left fraction (0..1) for each image in spawn
    order (index 0 = first image in). This is what makes "3 images" read as a
    diagonal cascade vs. a centered stack vs. a spread across the frame.

    Constraint: keep every image on-frame -> 0 <= x, y and x + size <= 1 and
    y + size <= 1.

    NOTE: the body below is the original diagonal cascade, kept so nothing
    breaks. It is the ~3 lines meant to carry your taste — rewrite it to change
    how a template's stack looks (cascade / centered / spread).
    """
    base = (1 - size) / 2          # centered anchor for the first image
    step = 0.03                    # nudge per subsequent image
    return [(round(base + i * step, 4), round(base + i * step, 4))
            for i in range(layer_count)]


def distribute_attention_cues(
    *,
    duration_ms: int,
    subtitle_boundaries_ms: Iterable[int],
    template: Dict[str, Any],
    asset_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Place cues predictably, snapping at most 1.5 s to SRT boundaries."""
    if duration_ms <= 0:
        return []
    protected_start = int(template.get("protectedStartMs", 1500))
    protected_end = int(template.get("protectedEndMs", 1500))
    minimum_gap = int(template.get("minimumGapMs", 1800))
    cue_duration = max(100, int(template.get("durationMs", 1200)))
    usable_start = protected_start
    usable_end = duration_ms - protected_end - cue_duration
    if usable_end < usable_start:
        return []

    if template.get("strategy") == "everySeconds":
        cadence = max(1, float(template.get("everySeconds", 6))) * 1000
        targets = []
        cursor = usable_start + cadence
        while cursor <= usable_end:
            targets.append(round(cursor))
            cursor += cadence
    else:
        count = max(0, int(template.get("count", 3)))
        spacing = (usable_end - usable_start) / (count + 1) if count else 0
        targets = [round(usable_start + spacing * (i + 1)) for i in range(count)]

    boundaries = sorted(set(int(v) for v in subtitle_boundaries_ms if 0 <= int(v) <= duration_ms))
    placed: List[int] = []
    for target in targets:
        nearest = min(boundaries, key=lambda point: (abs(point - target), point), default=target)
        candidate = nearest if abs(nearest - target) <= 1500 else target
        candidate = min(max(candidate, usable_start), usable_end)
        if placed and candidate - placed[-1] < minimum_gap:
            continue
        placed.append(candidate)

    assets = asset_ids or ["pending:choose-asset"]
    layer_count = max(1, min(10, int(template.get("layers", 1))))
    size = float(template.get("size", 0.8))
    zone = template.get("zone", "behind")
    positions = layout_positions(layer_count, size)
    cues = []
    last_asset = None
    asset_cursor = 0
    for cue_index, start in enumerate(placed):
        cue_layers = []
        for layer_index in range(layer_count):
            candidates = [asset for asset in assets if asset != last_asset] or assets
            asset = candidates[asset_cursor % len(candidates)]
            asset_cursor += 1
            last_asset = asset
            cue_layers.append({
                "id": f"cue-{cue_index}-layer-{layer_index}", "assetId": asset,
                "x": positions[layer_index][0], "y": positions[layer_index][1],
                "width": size, "height": size, "zIndex": layer_index + 1, "fit": "contain",
                "animation": {"preset": template.get("animation", "static"), "enterMs": 250,
                              "exitMs": 200, "delayMs": layer_index * 120, "intensity": 1},
            })
        cues.append({"id": f"attention-{cue_index}-{start}", "startMs": start,
                     "durationMs": cue_duration, "layers": cue_layers, "zone": zone,
                     "sfxAssetId": template.get("sfx"), "sfxVolumeDb": 0,
                     "templateId": template.get("id")})
    return cues
