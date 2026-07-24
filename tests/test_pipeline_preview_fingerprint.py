import asyncio
from types import SimpleNamespace
from unittest.mock import patch

SCRIPT_ID = "script_preview_001"


class _AuthoritativePipelineRepo:
    def __init__(self, pipeline):
        self.pipeline = pipeline

    def get_pipeline(self, _pipeline_id):
        return {**self.pipeline, "tts_jobs": self.pipeline.get("tts_jobs", {})}


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
        "script_id": SCRIPT_ID,
        "output_id": f"{SCRIPT_ID}:default",
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
            "script_ids": [SCRIPT_ID],
            "tts_previews": {
                0: {
                    "audio_path": str(audio_path),
                }
            },
            "preview_renders": {},
        }
        request_model = PreviewRenderRequest(**request_payload)
        with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
             patch(
                 "app.api.pipeline_routes.get_repository",
                 return_value=_AuthoritativePipelineRepo(pipeline),
             ), \
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


def test_render_preview_fingerprint_includes_composition_order_and_trims(tmp_path):
    """A timeline edit must invalidate the cached FFmpeg preview."""
    from app.api import pipeline_routes as pipeline_module
    from app.api.pipeline_routes import PreviewRenderRequest, render_preview

    audio_path = tmp_path / "tts.mp3"
    audio_path.write_bytes(b"audio")

    class DummyBackgroundTasks:
        def add_task(self, *args, **kwargs):
            return None

    profile = type("Profile", (), {"profile_id": "profile-1"})()

    async def run_once(label, composition):
        pipeline_id = f"composition-fingerprint-{label}-{tmp_path.name}"
        pipeline = {
            "profile_id": "profile-1",
            "scripts": ["script"],
            "script_ids": [SCRIPT_ID],
            "tts_previews": {0: {"audio_path": str(audio_path)}},
            "preview_renders": {},
        }
        request_model = PreviewRenderRequest(
            match_overrides=[{"segment_id": "seg-1", "merge_group": "", "transforms": {}}],
            composition_override=composition,
            script_id=SCRIPT_ID,
            output_id=f"{SCRIPT_ID}:default",
        )
        try:
            with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
                 patch(
                     "app.api.pipeline_routes.get_repository",
                     return_value=_AuthoritativePipelineRepo(pipeline),
                 ), \
                 patch("app.api.pipeline_routes.get_assembly_service", return_value=object()):
                result = await render_preview.__wrapped__(
                    object(),
                    pipeline_id,
                    0,
                    request_model,
                    DummyBackgroundTasks(),
                    profile,
                )
            return result["matches_fingerprint"]
        finally:
            lock = pipeline_module._preview_locks.pop(f"{pipeline_id}:0", None)
            if lock and lock.locked():
                lock.release()

    base_clip = {
        "id": "clip-1",
        "kind": "body",
        "segment_id": "seg-1",
        "source_start": 0.0,
        "source_end": 1.0,
        "timeline_start": 0.0,
        "timeline_duration": 1.0,
    }
    trimmed_clip = {**base_clip, "source_end": 0.8, "timeline_duration": 0.8}

    fingerprint_a = asyncio.run(run_once("base", [base_clip]))
    fingerprint_b = asyncio.run(run_once("trimmed", [trimmed_clip]))

    assert fingerprint_a != fingerprint_b


def test_render_preview_isolates_each_variant_and_meta_version(tmp_path):
    """Every card must own a distinct FFmpeg job/cache entry."""
    from app.api import pipeline_routes as pipeline_module
    from app.api.pipeline_routes import PreviewRenderRequest, render_preview

    audio_paths = []
    for index in range(2):
        audio_path = tmp_path / f"tts-{index}.mp3"
        audio_path.write_bytes(f"audio-{index}".encode())
        audio_paths.append(audio_path)

    pipeline = {
        "profile_id": "profile-1",
        "scripts": ["first script", "second script"],
        "script_ids": ["script_preview_001", "script_preview_002"],
        "tts_previews": {
            index: {"audio_path": str(audio_path)}
            for index, audio_path in enumerate(audio_paths)
        },
        "preview_renders": {},
    }

    class DummyBackgroundTasks:
        def __init__(self):
            self.tasks = []

        def add_task(self, task, *args, **kwargs):
            self.tasks.append((task, args, kwargs))

    class DummyRequest:
        pass

    profile = type("Profile", (), {"profile_id": "profile-1"})()
    pipeline_id = f"isolated-preview-{tmp_path.name}"

    async def start(variant_index, visual_version=None):
        script_id = pipeline["script_ids"][variant_index]
        background_tasks = DummyBackgroundTasks()
        result = await render_preview.__wrapped__(
            DummyRequest(),
            pipeline_id,
            variant_index,
            PreviewRenderRequest(
                match_overrides=[{
                    "srt_index": 0,
                    "segment_id": f"segment-{variant_index}-{visual_version or 'base'}",
                    "merge_group": "",
                    "transforms": {},
                }],
                visual_version=visual_version,
                script_id=script_id,
                output_id=f"{script_id}:{visual_version or 'default'}",
            ),
            background_tasks,
            profile,
        )
        assert len(background_tasks.tasks) == 1
        return result

    preview_keys = {"0", "1", "0_A", "0_B"}
    try:
        with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
             patch(
                 "app.api.pipeline_routes.get_repository",
                 return_value=_AuthoritativePipelineRepo(pipeline),
             ):
            variant_0 = asyncio.run(start(0))
            variant_1 = asyncio.run(start(1))
            meta_a = asyncio.run(start(0, "A"))
            meta_b = asyncio.run(start(0, "B"))

        assert set(pipeline["preview_renders"]) == preview_keys
        assert len({
            variant_0["matches_fingerprint"],
            variant_1["matches_fingerprint"],
            meta_a["matches_fingerprint"],
            meta_b["matches_fingerprint"],
        }) == 4
    finally:
        # DummyBackgroundTasks intentionally does not execute the queued render;
        # release the route locks so this focused test does not pollute the
        # module-level lock registry for later tests in the same process.
        for preview_key in preview_keys:
            lock = pipeline_module._preview_locks.pop(f"{pipeline_id}:{preview_key}", None)
            if lock and lock.locked():
                lock.release()


def test_render_preview_accepts_appdata_relative_voiceover_path(tmp_path):
    """Persistent Step 2 paths must be resolved before the FFmpeg preflight."""
    from app.api import pipeline_routes as pipeline_module
    from app.api.pipeline_routes import PreviewRenderRequest, render_preview

    relative_audio_path = "media/tts/profile-1/voiceover.mp3"
    audio_path = tmp_path / relative_audio_path
    audio_path.parent.mkdir(parents=True)
    audio_path.write_bytes(b"voiceover" * 32)
    pipeline = {
        "profile_id": "profile-1",
        "scripts": ["script"],
        "script_ids": [SCRIPT_ID],
        "tts_previews": {0: {"audio_path": relative_audio_path}},
        "preview_renders": {},
    }
    pipeline_id = f"relative-preview-{tmp_path.name}"

    class DummyBackgroundTasks:
        def __init__(self):
            self.tasks = []

        def add_task(self, task, *args, **kwargs):
            self.tasks.append((task, args, kwargs))

    background_tasks = DummyBackgroundTasks()
    profile = type("Profile", (), {"profile_id": "profile-1"})()

    try:
        with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
             patch(
                 "app.api.pipeline_routes.get_repository",
                 return_value=_AuthoritativePipelineRepo(pipeline),
             ), \
             patch("app.api.pipeline_routes.get_settings", return_value=SimpleNamespace(base_dir=tmp_path)):
            result = asyncio.run(render_preview.__wrapped__(
                object(),
                pipeline_id,
                0,
                PreviewRenderRequest(
                    match_overrides=[{"segment_id": "segment-1"}],
                    script_id=SCRIPT_ID,
                    output_id=f"{SCRIPT_ID}:default",
                ),
                background_tasks,
                profile,
            ))

        assert result["status"] == "processing"
        assert len(background_tasks.tasks) == 1
        with patch("app.api.pipeline_routes.get_settings", return_value=SimpleNamespace(base_dir=tmp_path)):
            assert pipeline_module._existing_pipeline_audio_path(relative_audio_path) == audio_path
    finally:
        lock = pipeline_module._preview_locks.pop(f"{pipeline_id}:0", None)
        if lock and lock.locked():
            lock.release()
