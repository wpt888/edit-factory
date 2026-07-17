"""Context Library refactor: block label + legacy strip behavior."""

from app.api.pipeline_routes import (
    _build_effective_pipeline_context,
    _strip_embedded_product_blocks,
)


def test_strip_removes_legacy_and_new_blocks_with_descriptions():
    ctx = "Brand voice: friendly.\n\n[Product: Old]\nlegacy desc\n\n[Context: New]\nnew desc\nmore desc"
    assert _strip_embedded_product_blocks(ctx) == "Brand voice: friendly."


def test_strip_leaves_plain_manual_text_alone():
    assert _strip_embedded_product_blocks("Just brand info.\nSecond line.") == "Just brand info.\nSecond line."


def test_build_uses_neutral_context_label_and_extra_fields():
    result = _build_effective_pipeline_context(
        "Brand voice: friendly.",
        [{"title": "SEO Audit", "description": "Full audit", "extra_fields": {"price": "499 EUR", "title": "ignored"}}],
    )
    assert result == "Brand voice: friendly.\n\n[Context: SEO Audit]\nFull audit\nprice: 499 EUR"
    assert "[Product:" not in result
