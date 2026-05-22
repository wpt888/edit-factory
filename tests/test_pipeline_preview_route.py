import asyncio


class _FakeQuery:
    data = []

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def gt(self, *_args, **_kwargs):
        return self

    def in_(self, *_args, **_kwargs):
        return self

    def execute(self):
        return self


class _FakeSupabase:
    def table(self, *_args, **_kwargs):
        return _FakeQuery()


class _FakeRepo:
    def get_client(self):
        return _FakeSupabase()


class _FakeAssemblyService:
    async def preview_matches(self, **_kwargs):
        return {
            "audio_duration": 1.0,
            "srt_content": "1\n00:00:00,000 --> 00:00:01,000\nhello\n",
            "matches": [
                {
                    "srt_index": 1,
                    "srt_text": "hello",
                    "srt_start": 0.0,
                    "srt_end": 1.0,
                    "segment_id": "seg-1",
                    "segment_keywords": ["hello"],
                    "matched_keyword": "hello",
                    "confidence": 1.0,
                }
            ],
            "total_phrases": 1,
            "matched_count": 1,
            "unmatched_count": 0,
            "available_segments": [],
        }


def test_preview_variant_uses_repository_without_local_shadow(monkeypatch):
    from app.api import pipeline_routes
    from app.api.auth import ProfileContext

    pipeline = {
        "profile_id": "profile-1",
        "scripts": ["hello world"],
        "previews": {},
        "segment_usage": {"1": ["seg-old"]},
        "tts_previews": {},
    }

    monkeypatch.setattr(pipeline_routes, "_get_pipeline_or_load", lambda _pipeline_id: pipeline)
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _FakeRepo())
    monkeypatch.setattr(pipeline_routes, "get_assembly_service", lambda: _FakeAssemblyService())
    monkeypatch.setattr(pipeline_routes, "_db_save_pipeline", lambda *_args, **_kwargs: None)

    response = asyncio.run(
        pipeline_routes.preview_variant(
            "pipeline-1",
            0,
            ProfileContext(profile_id="profile-1", user_id="user-1"),
        )
    )

    assert response.matched_count == 1
    assert pipeline["segment_usage"]["0"] == ["seg-1"]


def test_assembly_preview_matches_repository_is_not_shadowed():
    import symtable
    from pathlib import Path

    source = Path("app/services/assembly_service.py").read_text(encoding="utf-8")
    table = symtable.symtable(source, "app/services/assembly_service.py", "exec")

    def find_preview_matches(current):
        if current.get_name() == "preview_matches":
            return current
        for child in current.get_children():
            found = find_preview_matches(child)
            if found is not None:
                return found
        return None

    preview_table = find_preview_matches(table)
    assert preview_table is not None
    get_repository_symbol = preview_table.lookup("get_repository")
    assert get_repository_symbol.is_global()
    assert not get_repository_symbol.is_local()
