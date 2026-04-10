import asyncio
from unittest.mock import patch


def test_render_preview_fingerprint_includes_subtitle_settings(tmp_path):
    from app.api.pipeline_routes import PreviewRenderRequest, render_preview

    audio_path = tmp_path / "tts.mp3"
    audio_path.write_bytes(b"audio")

    base_request = {
        "match_overrides": [{"segment_id": "seg-1", "merge_group": "", "transforms": {}}],
        "subtitle_settings": {"fontFamily": "Anton", "fontSize": 42, "textColor": "#FFFFFF"},
        "ultra_rapid_intro": True,
        "interstitial_slides": [],
        "visual_version": None,
    }
    changed_request = {
        **base_request,
        "subtitle_settings": {"fontFamily": "Anton", "fontSize": 42, "textColor": "#FF0000"},
    }

    class DummyBackgroundTasks:
        def add_task(self, *args, **kwargs):
            return None

    class DummyRequest:
        pass

    profile = type("Profile", (), {"profile_id": "profile-1"})()

    async def run_once(request_payload):
        pipeline = {
            "profile_id": "profile-1",
            "scripts": ["script"],
            "tts_previews": {
                0: {
                    "audio_path": str(audio_path),
                }
            },
            "preview_renders": {},
        }
        request_model = PreviewRenderRequest(**request_payload)
        with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
             patch("app.api.pipeline_routes.get_assembly_service", return_value=object()):
            result = await render_preview.__wrapped__(
                DummyRequest(),
                f"pipe-{request_payload['subtitle_settings']['textColor']}",
                0,
                request_model,
                DummyBackgroundTasks(),
                profile,
            )
        return result["matches_fingerprint"]

    fingerprint_a = asyncio.run(run_once(base_request))
    fingerprint_b = asyncio.run(run_once(changed_request))

    assert fingerprint_a != fingerprint_b
