import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.api import library_routes, pipeline_routes


class _FakeResult:
    def __init__(self, data=None, count=None):
        self.data = data or []
        self.count = count


class _FakeSupabasePipeline:
    def __init__(self):
        self.project_insert_payloads = []
        self.clip_insert_payloads = []
        self.clip_content_upserts = []
        self._table = None
        self._insert_payload = None
        self._eq_filters = {}
        self._is_filters = {}

    def table(self, name):
        self._table = name
        self._insert_payload = None
        self._eq_filters = {}
        self._is_filters = {}
        return self

    def select(self, _fields):
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def upsert(self, payload, on_conflict=None):
        if self._table == "editai_clip_content":
            self.clip_content_upserts.append((payload, on_conflict))
        return self

    def update(self, payload):
        self._insert_payload = payload
        return self

    def eq(self, key, value):
        self._eq_filters[key] = value
        return self

    def is_(self, key, value):
        self._is_filters[key] = value
        return self

    def limit(self, _value):
        return self

    def execute(self):
        if self._table == "editai_projects" and self._insert_payload is not None:
            self.project_insert_payloads.append(dict(self._insert_payload))
            if "pipeline_id" in self._insert_payload:
                raise Exception("Could not find the 'pipeline_id' column of 'editai_projects'")
            return _FakeResult(data=[{"id": "proj-1"}])

        if self._table == "editai_projects":
            return _FakeResult(data=[])

        if self._table == "editai_clips" and self._insert_payload is None:
            return _FakeResult(data=[])

        if self._table == "editai_clips" and self._insert_payload is not None:
            self.clip_insert_payloads.append(dict(self._insert_payload))
            return _FakeResult(data=[{"id": "clip-1"}])

        if self._table == "editai_clip_content":
            return _FakeResult(data=[{"clip_id": "clip-1"}])

        return _FakeResult(data=[])


class _FakeRepo:
    def __init__(self, client):
        self._client = client

    def get_client(self):
        return self._client


def test_save_clip_to_library_retries_without_pipeline_id(tmp_path):
    final_video = tmp_path / "output" / "profile-1" / "variant_1_abc_TikTok.mp4"
    raw_video = tmp_path / "output" / "profile-1" / "variant_1_abc_TikTok_raw.mp4"
    final_video.parent.mkdir(parents=True, exist_ok=True)
    final_video.write_bytes(b"video")
    raw_video.write_bytes(b"raw-video")

    pipeline = {
        "idea": "Test idea",
        "scripts": ["hello world"],
        "tts_previews": {0: {"srt_content": "srt", "audio_path": str(tmp_path / "audio.mp3")}},
        "selected_captions": {},
        "segment_usage": {},
        "render_jobs": {
            0: {
                "status": "completed",
                "progress": 100,
                "current_step": "Render complete",
            }
        },
    }
    render_lock = pipeline_routes.threading.Lock()
    fake_sb = _FakeSupabasePipeline()

    def _fake_ffmpeg(args, *_rest):
        output_path = Path(args[-1])
        if output_path.suffix == ".jpg":
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(b"thumb")
            return SimpleNamespace(returncode=0, stdout="")
        if "ffprobe" in args[0]:
            return SimpleNamespace(returncode=0, stdout="12.34")
        return SimpleNamespace(returncode=0, stdout="")

    with patch("app.api.pipeline_routes.get_repository", return_value=_FakeRepo(fake_sb)), \
         patch("app.api.pipeline_routes.safe_ffmpeg_run", side_effect=_fake_ffmpeg), \
         patch("app.api.pipeline_routes._increment_segment_usage"):
        asyncio.run(pipeline_routes._save_clip_to_library(
            pipeline=pipeline,
            pipeline_id="pipe-1",
            vid=0,
            final_video_path=final_video,
            profile_id="profile-1",
            render_fingerprint="fp-1",
            render_jobs_lock=render_lock,
            raw_assembly_path=raw_video,
            subtitle_settings=None,
            segment_composition=None,
        ))

    assert fake_sb.project_insert_payloads[0]["pipeline_id"] == "pipe-1"
    assert "pipeline_id" not in fake_sb.project_insert_payloads[1]
    assert pipeline["library_project_id"] == "proj-1"
    assert pipeline["render_jobs"][0]["library_saved"] is True
    assert pipeline["render_jobs"][0]["clip_id"] == "clip-1"
    assert fake_sb.clip_insert_payloads[0]["final_video_path"] == str(final_video)


class _FakeSupabaseMissingVisualVersion(_FakeSupabasePipeline):
    def __init__(self):
        super().__init__()
        self._selected_fields = None

    def select(self, fields):
        self._selected_fields = fields
        return self

    def execute(self):
        if self._table == "editai_projects" and self._insert_payload is not None:
            return _FakeResult(data=[{"id": "proj-1"}])

        if self._table == "editai_clips" and self._insert_payload is None:
            if self._selected_fields and "visual_version" in self._selected_fields:
                raise Exception("Could not find the 'visual_version' column of 'editai_clips'")
            return _FakeResult(data=[])

        if self._table == "editai_clips" and self._insert_payload is not None:
            if "visual_version" in self._insert_payload:
                raise Exception("Could not find the 'visual_version' column of 'editai_clips'")
            self.clip_insert_payloads.append(dict(self._insert_payload))
            return _FakeResult(data=[{"id": "clip-1"}])

        if self._table == "editai_clip_content":
            return _FakeResult(data=[{"clip_id": "clip-1"}])

        return _FakeResult(data=[])


def test_save_clip_to_library_retries_without_visual_version(tmp_path):
    final_video = tmp_path / "output" / "profile-1" / "variant_1_abc_TikTok.mp4"
    final_video.parent.mkdir(parents=True, exist_ok=True)
    final_video.write_bytes(b"video")

    pipeline = {
        "idea": "Test idea",
        "scripts": ["hello world"],
        "tts_previews": {0: {}},
        "selected_captions": {},
        "segment_usage": {},
        "render_jobs": {
            0: {
                "status": "completed",
                "progress": 100,
                "current_step": "Render complete",
            }
        },
    }
    render_lock = pipeline_routes.threading.Lock()
    fake_sb = _FakeSupabaseMissingVisualVersion()

    def _fake_ffmpeg(args, *_rest):
        output_path = Path(args[-1])
        if output_path.suffix == ".jpg":
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(b"thumb")
            return SimpleNamespace(returncode=0, stdout="")
        if "ffprobe" in args[0]:
            return SimpleNamespace(returncode=0, stdout="12.34")
        return SimpleNamespace(returncode=0, stdout="")

    with patch("app.api.pipeline_routes.get_repository", return_value=_FakeRepo(fake_sb)), \
         patch("app.api.pipeline_routes.safe_ffmpeg_run", side_effect=_fake_ffmpeg), \
         patch("app.api.pipeline_routes._increment_segment_usage"):
        asyncio.run(pipeline_routes._save_clip_to_library(
            pipeline=pipeline,
            pipeline_id="pipe-1",
            vid=0,
            final_video_path=final_video,
            profile_id="profile-1",
            render_fingerprint="fp-1",
            render_jobs_lock=render_lock,
            visual_version="A",
        ))

    assert pipeline["render_jobs"][0]["library_saved"] is True
    assert fake_sb.clip_insert_payloads[0]["variant_index"] == 0
    assert "visual_version" not in fake_sb.clip_insert_payloads[0]


class _FakeSupabaseOrphans:
    def __init__(self):
        self._table = None
        self.inserted = []

    def table(self, name):
        self._table = name
        return self

    def select(self, _fields):
        return self

    def eq(self, *_args):
        return self

    def insert(self, payload):
        self.inserted.append(dict(payload))
        return self

    def execute(self):
        if self._table == "editai_clips":
            return _FakeResult(data=[])
        return _FakeResult(data=[{"id": "clip-1"}])


def test_sync_orphan_clips_skips_raw_mp4_files(tmp_path):
    profile_id = "profile-1"
    output_dir = tmp_path / "output" / profile_id
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "variant_1_ok_TikTok.mp4").write_bytes(b"final")
    (output_dir / "variant_1_ok_TikTok_raw.mp4").write_bytes(b"raw")

    fake_sb = _FakeSupabaseOrphans()

    with patch("app.api.library_routes.get_settings", return_value=SimpleNamespace(output_dir=tmp_path / "output")), \
         patch("app.api.library_routes._get_or_create_sync_project", return_value="proj-sync"), \
         patch("app.api.library_routes._get_video_duration", return_value=9.87), \
         patch("app.api.library_routes._generate_thumbnail", return_value=output_dir / "thumb.jpg"):
        inserted = asyncio.run(library_routes._sync_orphan_clips(profile_id, fake_sb))

    assert inserted == 1
    assert len(fake_sb.inserted) == 1
    assert fake_sb.inserted[0]["final_video_path"].endswith("variant_1_ok_TikTok.mp4")
