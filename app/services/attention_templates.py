"""Deterministic placement for Attention Hooks templates."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional


SYSTEM_TEMPLATES: List[Dict[str, Any]] = [
    {"id": "system-quick-pulse", "name": "Quick Pulse", "is_system": True,
     "canvasWidth": 1080, "canvasHeight": 1920,
     "strategy": "count", "count": 3, "durationMs": 1200, "animation": "pop", "sfx": "whoosh"},
    {"id": "system-product-focus", "name": "Product Focus", "is_system": True,
     "canvasWidth": 1080, "canvasHeight": 1920,
     "strategy": "everySeconds", "everySeconds": 6, "durationMs": 1800, "animation": "zoom"},
    {"id": "system-tornado-stack", "name": "Tornado Stack", "is_system": True,
     "canvasWidth": 1080, "canvasHeight": 1920,
     "strategy": "count", "count": 2, "durationMs": 1800, "animation": "tornado", "layers": 3, "sfx": "impact"},
]


def _normalize_assets(asset_ids: Optional[List[Any]]) -> List[tuple[str, str]]:
    """Coerce the incoming asset list into (id/url, media_type) pairs.

    Accepts both the legacy flat form (``["url", ...]`` = all images) and the
    typed form (``[{"url"|"assetId", "type": "image"|"video"}, ...]``). Anything
    else falls back to the pending sentinel so slots stay resolvable.
    """
    entries = asset_ids or ["pending:choose-asset"]
    pairs: List[tuple[str, str]] = []
    for entry in entries:
        if isinstance(entry, dict):
            url = str(entry.get("url") or entry.get("assetId") or "pending:choose-asset")
            media_type = "video" if entry.get("type") == "video" else "image"
        else:
            url, media_type = str(entry), "image"
        pairs.append((url, media_type))
    return pairs or [("pending:choose-asset", "image")]


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


def template_track_cues(
    *,
    template: Dict[str, Any],
    asset_ids: Optional[List[Any]] = None,
    duration_ms: int = 0,
    animation_override: Optional[str] = None,
    enter_ms_override: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Track-based templates: each authored image becomes one cue on lane V(2+track).

    ``template['tracks']`` is a list of tracks, each a list of images with
    x/y/width/height (0..1 frame fractions), startMs and durationMs. Assets from
    Step 1 rotate into slots in authored order. Cues starting past the video end
    are dropped.
    """
    tracks = template.get("tracks") or []
    zone = template.get("zone", "behind")
    animation = template.get("animation", "pop")
    enter_ms = max(0, min(10_000, int(template.get("enterMs", 250))))
    assets = _normalize_assets(asset_ids)
    cues: List[Dict[str, Any]] = []
    asset_cursor = 0
    for track_index, images in enumerate(tracks):
        for image_index, image in enumerate(images or []):
            start = max(0, int(image.get("startMs", 0)))
            if duration_ms and start >= duration_ms:
                continue
            asset, media_type = assets[asset_cursor % len(assets)]
            asset_cursor += 1
            sfx_asset_id = image.get("sfxAssetId") or template.get("sfx")
            sfx_url = image.get("sfxUrl")
            try:
                sfx_volume_db = float(image.get("sfxVolumeDb") or 0)
            except (TypeError, ValueError):
                sfx_volume_db = 0.0
            slot_animation = animation_override or image.get("animation") or animation
            raw_slot_enter_ms = (
                enter_ms_override
                if enter_ms_override is not None
                else image.get("enterMs", enter_ms)
            )
            slot_enter_ms = max(0, min(10_000, int(raw_slot_enter_ms)))
            cues.append({
                "id": f"attention-t{track_index}-{image_index}-{start}",
                "startMs": start,
                "durationMs": max(100, int(image.get("durationMs", 1200))),
                "track": 2 + track_index,
                "zone": zone,
                "sfxAssetId": sfx_asset_id,
                "sfxUrl": sfx_url,
                "sfxVolumeDb": max(-60.0, min(12.0, sfx_volume_db)),
                "templateId": template.get("id"),
                "layers": [{
                    "id": f"cue-t{track_index}-{image_index}-layer-0",
                    "assetId": asset,
                    "mediaType": media_type,
                    "x": float(image.get("x", 0.1)), "y": float(image.get("y", 0.1)),
                    "width": float(image.get("width", 0.8)), "height": float(image.get("height", 0.8)),
                    "opacity": float(image.get("opacity", 1.0)),
                    "zIndex": track_index + 1,
                    "fit": image.get("fit") if image.get("fit") in ("contain", "cover") else "contain",
                    "animation": {"preset": slot_animation, "enterMs": slot_enter_ms,
                                  "exitMs": 200, "delayMs": 0, "intensity": 1},
                }],
            })
    return sorted(cues, key=lambda cue: cue["startMs"])


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

    assets = _normalize_assets(asset_ids)
    layer_count = max(1, min(10, int(template.get("layers", 1))))
    size = float(template.get("size", 0.8))
    zone = template.get("zone", "behind")
    enter_ms = max(0, min(10_000, int(template.get("enterMs", 250))))
    positions = layout_positions(layer_count, size)
    cues = []
    asset_cursor = 0
    for cue_index, start in enumerate(placed):
        cue_layers = []
        for layer_index in range(layer_count):
            asset, media_type = assets[asset_cursor % len(assets)]
            asset_cursor += 1
            cue_layers.append({
                "id": f"cue-{cue_index}-layer-{layer_index}", "assetId": asset,
                "mediaType": media_type,
                "x": positions[layer_index][0], "y": positions[layer_index][1],
                "width": size, "height": size, "zIndex": layer_index + 1, "fit": "contain",
                "animation": {"preset": template.get("animation", "static"), "enterMs": enter_ms,
                              "exitMs": 200, "delayMs": layer_index * 120, "intensity": 1},
            })
        cues.append({"id": f"attention-{cue_index}-{start}", "startMs": start,
                     "durationMs": cue_duration, "layers": cue_layers, "zone": zone,
                     "sfxAssetId": template.get("sfx"), "sfxVolumeDb": 0,
                     "templateId": template.get("id")})
    return cues
