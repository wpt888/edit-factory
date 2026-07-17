import pytest

from app.api import pipeline_routes


class _SchemaDriftRepo:
    def __init__(self):
        self.calls = []

    def upsert_pipeline(self, row):
        snapshot = dict(row)
        self.calls.append(snapshot)
        for missing in ("attention_timeline", "script_names", "generation_job"):
            if missing in snapshot:
                raise RuntimeError(
                    f"Could not find the '{missing}' column of "
                    "'editai_pipelines' in the schema cache"
                )


def test_schema_fallback_removes_multiple_missing_columns_and_keeps_scripts():
    repo = _SchemaDriftRepo()
    row = {
        "id": "pipeline-1",
        "scripts": ["Scriptul trebuie păstrat în istoric"],
        "script_names": ["Script 1"],
        "attention_timeline": {},
        "generation_job": {},
        "tts_jobs": {},
    }

    pipeline_routes._upsert_pipeline_with_schema_fallback(repo, row)

    assert len(repo.calls) == 4
    persisted = repo.calls[-1]
    assert persisted["scripts"] == row["scripts"]
    assert "attention_timeline" not in persisted
    assert "script_names" not in persisted
    assert "generation_job" not in persisted
    assert "tts_jobs" not in persisted


def test_schema_fallback_does_not_hide_unrelated_database_errors():
    class _BrokenRepo:
        def upsert_pipeline(self, _row):
            raise RuntimeError("database connection failed")

    with pytest.raises(RuntimeError, match="database connection failed"):
        pipeline_routes._upsert_pipeline_with_schema_fallback(
            _BrokenRepo(), {"id": "pipeline-1", "scripts": ["text"]}
        )
