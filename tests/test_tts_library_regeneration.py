from pathlib import Path
from types import SimpleNamespace

from app.services.tts_library_service import TTSLibraryService


class _Result:
    def __init__(self, data):
        self.data = data


class _Repo:
    def __init__(self, existing=None):
        self.existing = existing or []
        self.filters = None
        self.created = None

    def list_tts_assets(self, _profile_id, filters):
        self.filters = filters
        return _Result(self.existing)

    def create_tts_asset(self, row):
        self.created = row
        return row


def _service(tmp_path: Path) -> TTSLibraryService:
    service = TTSLibraryService.__new__(TTSLibraryService)
    service.settings = SimpleNamespace(base_dir=tmp_path)
    service.media_base = tmp_path / "media" / "tts"
    return service


def test_pipeline_dedup_identity_includes_voice_and_provider(tmp_path, monkeypatch):
    repo = _Repo(existing=[{"id": "existing"}])
    monkeypatch.setattr("app.repositories.factory.get_repository", lambda: repo)
    source = tmp_path / "source.mp3"
    source.write_bytes(b"fresh")

    result = _service(tmp_path).save_from_pipeline(
        profile_id="profile",
        text="Același text",
        audio_path=str(source),
        srt_content=None,
        timestamps=None,
        model="eleven_flash_v2_5",
        duration=1.0,
        voice_id="ana-maria",
    )

    assert result is None
    assert repo.filters.eq == {
        "tts_text": "Același text",
        "tts_model": "eleven_flash_v2_5",
        "tts_provider": "elevenlabs",
        "tts_voice_id": "ana-maria",
    }


def test_explicit_regeneration_bypasses_old_library_asset(tmp_path, monkeypatch):
    repo = _Repo(existing=[{"id": "old-male-audio"}])
    monkeypatch.setattr("app.repositories.factory.get_repository", lambda: repo)
    source = tmp_path / "ana-maria.mp3"
    source.write_bytes(b"fresh-ana-maria")

    asset_id = _service(tmp_path).save_from_pipeline(
        profile_id="profile",
        text="Același text",
        audio_path=str(source),
        srt_content=None,
        timestamps=None,
        model="eleven_flash_v2_5",
        duration=1.0,
        voice_id="ana-maria",
        deduplicate=False,
    )

    assert asset_id is not None
    assert repo.filters is None
    assert repo.created["tts_voice_id"] == "ana-maria"
    saved = tmp_path / repo.created["mp3_path"]
    assert saved.read_bytes() == b"fresh-ana-maria"
