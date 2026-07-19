"""Versioned, portable pipeline-template bundles.

This module is the backend contract for template files. Runtime artifacts
(jobs, generated audio/video paths and ownership data) never enter the bundle;
all user-configurable fields live under ``settings`` and are preserved even
when a newer client adds fields that this backend does not know yet.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, Mapping


PIPELINE_TEMPLATE_FORMAT = "edit-factory.pipeline-template"
PIPELINE_TEMPLATE_SCHEMA_VERSION = 1
PIPELINE_TEMPLATE_MAX_BYTES = 2_000_000
PIPELINE_TEMPLATE_REQUIRED_SECTIONS = (
    "generation",
    "content",
    "voice",
    "assembly",
    "timeline",
    "subtitles",
    "render",
)

_SENSITIVE_KEY = re.compile(
    r"(?:api[_-]?key|private[_-]?key|supabase[_-]?key|client[_-]?secret|secret|password|credentials?|authorization|token)$",
    re.IGNORECASE,
)


class PipelineTemplateValidationError(ValueError):
    """Raised when a template is incomplete, unsafe, or incompatible."""


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _scan_for_sensitive_keys(value: Any, path: str = "settings", depth: int = 0) -> None:
    if depth > 30:
        raise PipelineTemplateValidationError("Template nesting is too deep")
    if isinstance(value, Mapping):
        for raw_key, child in value.items():
            key = str(raw_key)
            if _SENSITIVE_KEY.search(key):
                raise PipelineTemplateValidationError(
                    f"Sensitive field is not allowed in a template: {path}.{key}"
                )
            _scan_for_sensitive_keys(child, f"{path}.{key}", depth + 1)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _scan_for_sensitive_keys(child, f"{path}[{index}]", depth + 1)


def normalize_pipeline_template_settings(settings: Any) -> dict[str, Any]:
    """Validate and deep-copy the complete settings payload.

    Unknown fields are deliberately retained for forward compatibility. New
    settings belong in one of the required sections instead of a new ad-hoc
    export path.
    """
    if not isinstance(settings, Mapping):
        raise PipelineTemplateValidationError("Template settings must be an object")

    normalized = copy.deepcopy(dict(settings))
    missing = [
        section
        for section in PIPELINE_TEMPLATE_REQUIRED_SECTIONS
        if not isinstance(normalized.get(section), Mapping)
    ]
    if missing:
        raise PipelineTemplateValidationError(
            "Template is missing settings sections: " + ", ".join(missing)
        )

    expected_nested_types = {
        ("generation", "contextProducts"): list,
        ("content", "scripts"): list,
        ("content", "approvedScriptIndices"): list,
        ("content", "generatedCaptions"): Mapping,
        ("content", "generatedYoutubeTitles"): Mapping,
        ("voice", "voice"): Mapping,
        ("assembly", "sourceVideos"): list,
        ("timeline", "selectedVariantIndices"): list,
        ("timeline", "matches"): Mapping,
        ("timeline", "compositions"): Mapping,
        ("timeline", "interstitialSlides"): Mapping,
        ("timeline", "attentionSelection"): Mapping,
        ("timeline", "attentionTimelines"): Mapping,
        ("timeline", "variantThumbnails"): Mapping,
        ("timeline", "pipOverlays"): Mapping,
        ("subtitles", "default"): Mapping,
        ("subtitles", "overrides"): Mapping,
        ("render", "encoding"): Mapping,
        ("render", "adjustments"): Mapping,
    }
    for (section, field), expected_type in expected_nested_types.items():
        value = normalized[section].get(field)
        if not isinstance(value, expected_type):
            expected_label = "array" if expected_type is list else "object"
            raise PipelineTemplateValidationError(
                f"settings.{section}.{field} must be an {expected_label}"
            )

    _scan_for_sensitive_keys(normalized)
    try:
        encoded = _canonical_json(normalized).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise PipelineTemplateValidationError("Template settings must contain JSON values only") from exc
    if len(encoded) > PIPELINE_TEMPLATE_MAX_BYTES:
        raise PipelineTemplateValidationError(
            f"Template exceeds the {PIPELINE_TEMPLATE_MAX_BYTES // 1_000_000} MB limit"
        )
    return normalized


def pipeline_template_checksum(settings: Mapping[str, Any]) -> str:
    return hashlib.sha256(_canonical_json(settings).encode("utf-8")).hexdigest()


def build_pipeline_template_document(
    *,
    pipeline_id: str,
    pipeline_name: str,
    settings: Any,
    app_version: str,
) -> dict[str, Any]:
    normalized = normalize_pipeline_template_settings(settings)
    return {
        "format": PIPELINE_TEMPLATE_FORMAT,
        "schemaVersion": PIPELINE_TEMPLATE_SCHEMA_VERSION,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "application": {"name": "Edit Factory", "version": app_version},
        "source": {"pipelineId": pipeline_id, "name": pipeline_name},
        "settings": normalized,
        "checksum": {"algorithm": "sha256", "value": pipeline_template_checksum(normalized)},
    }


def validate_pipeline_template_document(document: Any) -> dict[str, Any]:
    if not isinstance(document, Mapping):
        raise PipelineTemplateValidationError("Template file must contain a JSON object")
    if document.get("format") != PIPELINE_TEMPLATE_FORMAT:
        raise PipelineTemplateValidationError("Unsupported template format")

    version = document.get("schemaVersion")
    if version != PIPELINE_TEMPLATE_SCHEMA_VERSION:
        if isinstance(version, int) and version > PIPELINE_TEMPLATE_SCHEMA_VERSION:
            raise PipelineTemplateValidationError(
                "This template was created by a newer Edit Factory version"
            )
        raise PipelineTemplateValidationError(f"Unsupported template schema version: {version!r}")

    settings = normalize_pipeline_template_settings(document.get("settings"))
    checksum = document.get("checksum")
    if not isinstance(checksum, Mapping) or checksum.get("algorithm") != "sha256":
        raise PipelineTemplateValidationError("Template checksum is missing or unsupported")
    expected = pipeline_template_checksum(settings)
    if checksum.get("value") != expected:
        raise PipelineTemplateValidationError("Template checksum does not match its settings")

    normalized_document = copy.deepcopy(dict(document))
    normalized_document["settings"] = settings
    return normalized_document


def fallback_pipeline_template_settings(pipeline: Mapping[str, Any]) -> dict[str, Any]:
    """Build a complete v1 contract for pipelines saved before this feature."""
    scripts = list(pipeline.get("scripts") or [])
    names = list(pipeline.get("script_names") or [])
    previews = pipeline.get("previews") or {}
    matches: dict[str, Any] = {}
    compositions: dict[str, Any] = {}
    for raw_key, raw_preview in previews.items():
        if not isinstance(raw_preview, Mapping):
            continue
        preview_data = raw_preview.get("preview_data")
        if not isinstance(preview_data, Mapping):
            continue
        key = str(raw_key)
        if isinstance(preview_data.get("matches"), list):
            matches[key] = copy.deepcopy(preview_data["matches"])
        timeline = preview_data.get("video_timeline") or preview_data.get("timeline")
        if isinstance(timeline, list):
            compositions[key] = copy.deepcopy(timeline)

    attention = copy.deepcopy(dict(pipeline.get("attention_timeline") or {}))
    attention_selection = attention.pop("_selection", {})
    source_ids = [str(value) for value in (pipeline.get("source_video_ids") or [])]

    return {
        "generation": {
            "name": pipeline.get("name", ""),
            "idea": pipeline.get("idea", ""),
            "context": pipeline.get("context", ""),
            "contextProducts": copy.deepcopy(pipeline.get("context_products") or []),
            "variantCount": pipeline.get("variant_count") or len(scripts) or 1,
            "targetScriptDuration": pipeline.get("target_script_duration") or 30,
            "provider": pipeline.get("provider", "gemini"),
            "codexModel": pipeline.get("codex_model"),
            "aiInstructions": "",
        },
        "content": {
            "scripts": [
                {"name": names[index] if index < len(names) else f"Script {index + 1}", "text": text}
                for index, text in enumerate(scripts)
            ],
            "approvedScriptIndices": [],
            "generatedCaptions": copy.deepcopy(pipeline.get("captions") or {}),
            "generatedYoutubeTitles": {},
        },
        "voice": {
            "model": "eleven_flash_v2_5",
            "voice": {"id": "", "name": ""},
            "stability": 0.5,
            "similarity": 0.75,
            "style": 0.0,
            "speed": 1.0,
            "speakerBoost": True,
            "wordsPerSubtitle": 2,
        },
        "assembly": {
            "minSegmentDuration": pipeline.get("min_segment_duration") or 3.0,
            "ultraRapidIntro": True,
            "preset": "balanced",
            "segmentProximity": "separate",
            "sourceVideos": [{"id": source_id, "name": ""} for source_id in source_ids],
        },
        "timeline": {
            "selectedVariantIndices": list(range(len(scripts))),
            "matches": matches,
            "compositions": compositions,
            "interstitialSlides": {},
            "attentionSelection": attention_selection,
            "attentionTimelines": attention,
            "variantThumbnails": {},
            "pipOverlays": {},
        },
        "subtitles": {
            "default": {
                "fontSize": 48,
                "fontFamily": "Montserrat",
                "textColor": "#FFFFFF",
                "outlineColor": "#000000",
                "outlineWidth": 3,
                "positionY": 85,
            },
            "overrides": copy.deepcopy(pipeline.get("subtitle_settings_by_key") or {}),
        },
        "render": {
            "presetName": "TikTok",
            "encoding": {
                "encoding_mode": "vbr_2pass",
                "target_bitrate_kbps": 10000,
                "audio_bitrate_kbps": 320,
                "video_profile": "main",
                "video_level": "4.1",
                "force_cpu": False,
                "preset_speed": "medium",
                "gop_size": 60,
            },
            "adjustments": {
                "enableColor": False,
                "brightness": 0.0,
                "contrast": 1.0,
                "saturation": 1.0,
                "voiceVolume": 1.0,
                "audioFadeIn": 0.0,
                "audioFadeOut": 0.0,
            },
            "metaMultiplication": bool(pipeline.get("meta_multiplication", True)),
        },
    }
