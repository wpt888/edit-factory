import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.api.attention_routes import AttentionTemplateBody
from app.api.pipeline_routes import (
    PipelineRenderRequest,
    PreviewRenderRequest,
    _fetch_preset_and_settings,
)
from app.services.assembly_service import AssemblyService
from app.services.attention_templates import SYSTEM_TEMPLATES


def test_attention_template_canvas_defaults_and_validation():
    body = AttentionTemplateBody(name="Portrait")
    assert (body.canvasWidth, body.canvasHeight) == (1080, 1920)
    assert all(
        (template["canvasWidth"], template["canvasHeight"]) == (1080, 1920)
        for template in SYSTEM_TEMPLATES
    )

    square = AttentionTemplateBody(name="Square", canvasWidth=1080, canvasHeight=1080)
    assert square.model_dump()["canvasHeight"] == 1080
    with pytest.raises(ValidationError):
        AttentionTemplateBody(name="Invalid", canvasWidth=1079)


def test_explicit_render_dimensions_override_named_preset():
    request = PipelineRenderRequest(
        variant_indices=[0], output_width=1920, output_height=1080
    )
    repo = SimpleNamespace(get_export_preset_by_name=lambda _name: {
        "name": "TikTok", "width": 1080, "height": 1920,
    })
    with patch("app.api.pipeline_routes.get_repository", return_value=repo):
        preset, _subtitle = _fetch_preset_and_settings(request)
    assert (preset["width"], preset["height"]) == (1920, 1080)
    with pytest.raises(ValidationError):
        PipelineRenderRequest(variant_indices=[0], output_width=1920)


def test_preview_request_dimensions_are_even_and_default_to_portrait():
    request = PreviewRenderRequest(
        match_overrides=[],
        script_id="script_test_0001",
        output_id="script_test_0001:default",
    )
    assert (request.output_width, request.output_height) == (1080, 1920)
    with pytest.raises(ValidationError):
        PreviewRenderRequest(
            match_overrides=[],
            script_id="script_test_0001",
            output_id="script_test_0001:default",
            output_width=1919,
            output_height=1080,
        )


def test_preview_preset_preserves_selected_landscape_canvas():
    service = object.__new__(AssemblyService)
    captured = {}

    async def fake_assemble_and_render(**kwargs):
        captured.update(kwargs)
        return Path("preview.mp4"), None, []

    service.assemble_and_render = fake_assemble_and_render
    result = asyncio.run(service.assemble_and_render_preview(
        script_text="test",
        profile_id="profile",
        pipeline_id="pipeline",
        output_width=1920,
        output_height=1080,
    ))

    assert result == Path("preview.mp4")
    preset = captured["preset_data"]
    assert (preset["width"], preset["height"]) == (960, 540)
    assert (preset["subtitle_ref_width"], preset["subtitle_ref_height"]) == (1920, 1080)
