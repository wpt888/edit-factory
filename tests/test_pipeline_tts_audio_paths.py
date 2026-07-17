from pathlib import Path
from types import SimpleNamespace

from app.api import pipeline_routes


class _Library:
    def __init__(self, base_dir: Path, asset_ids):
        self.base_dir = base_dir
        self.asset_ids = iter(asset_ids)

    def save_from_pipeline(self, profile_id, audio_path, **_kwargs):
        asset_id = next(self.asset_ids)
        if asset_id:
            destination = self.base_dir / "media" / "tts" / profile_id / f"{asset_id}.mp3"
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(Path(audio_path).read_bytes())
        return asset_id


def _patch_runtime(monkeypatch, tmp_path, library):
    monkeypatch.setattr(
        pipeline_routes,
        "get_settings",
        lambda: SimpleNamespace(base_dir=tmp_path),
    )
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: None)
    monkeypatch.setattr(
        "app.services.tts_library_service.get_tts_library_service",
        lambda: library,
    )


def _persist(source, profile="profile"):
    return pipeline_routes._persist_tts_audio(
        profile_id=profile,
        cleaned_text=source.read_text(encoding="utf-8"),
        audio_path=str(source),
        srt_content=None,
        timestamps=None,
        model="eleven_flash_v2_5",
        duration=1.0,
        voice_id="ana-maria",
        deduplicate=False,
    )


def test_library_relative_path_is_resolved_against_appdata(tmp_path, monkeypatch):
    source = tmp_path / "source.mp3"
    source.write_text("varianta unu", encoding="utf-8")
    _patch_runtime(monkeypatch, tmp_path, _Library(tmp_path, ["asset-one"]))

    audio_path, asset_id = _persist(source)

    assert audio_path == "media/tts/profile/asset-one.mp3"
    assert asset_id == "asset-one"
    assert pipeline_routes._resolve_pipeline_audio_path(audio_path).read_text(
        encoding="utf-8"
    ) == "varianta unu"


def test_fallback_uses_unique_file_for_each_variant(tmp_path, monkeypatch):
    first = tmp_path / "first" / "tts_trimmed.mp3"
    second = tmp_path / "second" / "tts_trimmed.mp3"
    first.parent.mkdir()
    second.parent.mkdir()
    first.write_text("varianta unu", encoding="utf-8")
    second.write_text("varianta doi", encoding="utf-8")
    _patch_runtime(monkeypatch, tmp_path, _Library(tmp_path, [None, None]))

    first_path, _ = _persist(first)
    second_path, _ = _persist(second)

    assert first_path != second_path
    assert pipeline_routes._resolve_pipeline_audio_path(first_path).read_text(
        encoding="utf-8"
    ) == "varianta unu"
    assert pipeline_routes._resolve_pipeline_audio_path(second_path).read_text(
        encoding="utf-8"
    ) == "varianta doi"
