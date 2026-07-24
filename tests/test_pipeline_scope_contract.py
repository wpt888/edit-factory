from __future__ import annotations

import asyncio
import copy
import inspect
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import pipeline_routes


def test_partial_pipeline_save_uses_update_for_existing_row() -> None:
    calls: list[tuple[str, dict]] = []

    class _Repo:
        def update_pipeline(self, pipeline_id, payload):
            calls.append((pipeline_id, copy.deepcopy(payload)))

        def upsert_pipeline(self, _payload):
            raise AssertionError("an existing partial row must not use UPSERT")

    pipeline_routes._upsert_pipeline_with_schema_fallback(
        _Repo(),
        {
            "id": "pipeline-existing",
            "attention_timeline": {"0_A": {"cues": []}},
        },
        update_existing=True,
    )

    assert calls == [
        (
            "pipeline-existing",
            {"attention_timeline": {"0_A": {"cues": []}}},
        )
    ]


def test_render_refresh_keeps_live_jobs_before_script_id_migration(
    monkeypatch,
) -> None:
    script_id = "script_11111111"
    output_id = pipeline_routes._build_output_id(script_id, "A")
    live_job = {
        "attempt_id": "render-attempt",
        "script_id": script_id,
        "output_id": output_id,
        "visual_version": "A",
        "status": "processing",
        "progress": 42,
    }
    pipeline = {
        "pipeline_id": "pipeline-legacy-refresh",
        "scripts": ["Render me"],
        "script_ids": [script_id],
        "render_jobs": {"0_A": live_job},
    }

    class _Repo:
        def get_pipeline(self, _pipeline_id):
            return {
                "id": "pipeline-legacy-refresh",
                "scripts": ["Render me"],
                # Migration 058 has not been applied yet.
                "render_jobs": {},
            }

    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())

    pipeline_routes._refresh_render_jobs_from_db(
        "pipeline-legacy-refresh",
        pipeline,
    )

    assert pipeline["render_jobs"]["0_A"]["output_id"] == output_id
    assert pipeline["render_jobs"]["0_A"]["progress"] == 42


def test_desktop_job_persistence_falls_back_before_cas_migration(
    monkeypatch,
) -> None:
    script_id = "script_11111111"
    output_id = pipeline_routes._build_output_id(script_id)
    updates: list[dict] = []

    class _Repo:
        def get_pipeline(self, _pipeline_id):
            return {
                "id": "pipeline-desktop-legacy-cas",
                "scripts": ["Render me"],
                "script_ids": [script_id],
                "render_jobs": {},
            }

        def table_query(self, *_args, **_kwargs):
            raise RuntimeError(
                "column editai_pipelines.jobs_revision does not exist"
            )

        def update_pipeline(self, _pipeline_id, payload):
            updates.append(copy.deepcopy(payload))

    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())
    monkeypatch.setattr(
        pipeline_routes,
        "get_settings",
        lambda: SimpleNamespace(desktop_mode=True),
    )

    merged = pipeline_routes._db_update_render_jobs(
        "pipeline-desktop-legacy-cas",
        {
            "0": {
                "attempt_id": "render-attempt",
                "script_id": script_id,
                "output_id": output_id,
                "status": "processing",
            }
        },
    )

    assert merged["0"]["output_id"] == output_id
    assert updates[0]["render_jobs"]["0"]["status"] == "processing"
    assert "jobs_revision" not in updates[0]


def test_script_state_remaps_by_stable_id_after_middle_delete() -> None:
    first = "script_11111111"
    removed = "script_22222222"
    last = "script_33333333"
    pipeline = {
        "previews": {
            "0_A": {"owner": first},
            "1_B": {"owner": removed},
            "2_A": {"owner": last},
        },
        "tts_previews": {
            0: {"owner": first},
            1: {"owner": removed},
            2: {"owner": last},
        },
        "subtitle_settings_by_key": {
            "default": {"fontSize": 48},
            "1_B": {"fontSize": 55},
            "2_A": {"fontSize": 60},
        },
        "preview_jobs": {
            f"{removed}:B": {"status": "completed"},
            f"{last}:A": {"status": "completed"},
        },
        "template_settings": {
            "timeline": {
                "matches": {
                    "1_B": [{"owner": removed}],
                    "2_A": [{"owner": last}],
                },
                "variantThumbnails": {
                    "1_B": {"owner": removed},
                    "2_A": {"owner": last},
                },
                "defaultTransitions": {
                    "1_B": {"type": "fade"},
                    "2_A": None,
                },
                "music": {
                    "1_B": {"assetId": "removed-song"},
                    "2_A": None,
                },
                "pipOverlays": {
                    "1_B": {"owner": removed},
                    "2_A": {"owner": last},
                },
                "selectedVariantIndices": [1, 2],
                "selectedOutputIds": [
                    f"{removed}:B",
                    f"{last}:A",
                ],
                "activeOutputId": f"{removed}:B",
            },
            "subtitles": {
                "variantOverrides": {
                    "1_B": {"fontSize": 55},
                    "2_A": {"fontSize": 60},
                },
                "variantTemplates": {
                    "1_B": "removed-template",
                    "2_A": "last-template",
                },
            },
        },
    }

    pipeline_routes._remap_pipeline_script_state(
        pipeline,
        [first, removed, last],
        [first, last],
    )

    assert pipeline["previews"] == {
        "0_A": {"owner": first},
        "1_A": {"owner": last},
    }
    assert pipeline["tts_previews"] == {
        0: {"owner": first},
        1: {"owner": last},
    }
    assert pipeline["subtitle_settings_by_key"] == {
        "default": {"fontSize": 48},
        "1_A": {"fontSize": 60},
    }
    timeline = pipeline["template_settings"]["timeline"]
    assert timeline["matches"] == {"1_A": [{"owner": last}]}
    assert timeline["variantThumbnails"] == {"1_A": {"owner": last}}
    assert timeline["defaultTransitions"] == {"1_A": None}
    assert timeline["music"] == {"1_A": None}
    assert timeline["pipOverlays"] == {"1_A": {"owner": last}}
    assert timeline["selectedVariantIndices"] == [1]
    assert timeline["selectedOutputIds"] == [f"{last}:A"]
    assert timeline["activeOutputId"] is None
    subtitles = pipeline["template_settings"]["subtitles"]
    assert subtitles["variantOverrides"] == {"1_A": {"fontSize": 60}}
    assert subtitles["variantTemplates"] == {"1_A": "last-template"}
    assert pipeline["preview_jobs"] == {
        f"{last}:A": {"status": "completed"},
    }


def test_embedded_identity_wins_when_a_stale_worker_persists_an_old_key() -> None:
    moved = "script_11111111"
    other = "script_22222222"
    pipeline = {
        # Current stored order is moved, other, but an old worker wrote the
        # moved asset back under its former numeric position 1.
        "tts_previews": {
            1: {
                "script_id": moved,
                "output_id": pipeline_routes._build_output_id(moved),
                "audio_path": "moved.mp3",
            },
        },
        "render_jobs": {
            "1_B": {
                "script_id": moved,
                "output_id": pipeline_routes._build_output_id(moved, "B"),
                "status": "completed",
            },
        },
    }

    pipeline_routes._remap_pipeline_script_state(
        pipeline,
        [moved, other],
        [other, moved],
    )

    assert pipeline["tts_previews"] == {
        1: {
            "script_id": moved,
            "output_id": pipeline_routes._build_output_id(moved),
            "audio_path": "moved.mp3",
        },
    }
    assert pipeline["render_jobs"] == {
        "1_B": {
            "script_id": moved,
            "output_id": pipeline_routes._build_output_id(moved, "B"),
            "status": "completed",
        },
    }


def test_legacy_identity_backfill_canonicalizes_a_stale_numeric_key() -> None:
    moved = "script_11111111"
    other = "script_22222222"
    pipeline = {
        "pipeline_id": "pipeline-backfill-contract",
        "scripts": ["Moved", "Other"],
        "script_ids": [moved, other],
        "tts_previews": {
            1: {
                "script_id": moved,
                "audio_path": "moved.mp3",
            },
        },
        "previews": {
            "0_B": {
                "preview_data": {},
            },
        },
    }

    changed = pipeline_routes._backfill_pipeline_output_identities(pipeline)

    assert changed == {"previews", "tts_previews"}
    assert pipeline["tts_previews"] == {
        0: {
            "script_id": moved,
            "output_id": pipeline_routes._build_output_id(moved),
            "audio_path": "moved.mp3",
        },
    }
    assert pipeline["previews"]["0_B"]["script_id"] == moved
    assert pipeline["previews"]["0_B"]["output_id"] == (
        pipeline_routes._build_output_id(moved, "B")
    )


def test_render_job_identity_resolves_current_position_not_storage_key() -> None:
    moved = "script_11111111"
    other = "script_22222222"
    pipeline = {
        "scripts": ["Other", "Moved"],
        "script_ids": [other, moved],
    }
    job = {
        "script_id": moved,
        "output_id": pipeline_routes._build_output_id(moved, "B"),
        "visual_version": "B",
    }

    assert pipeline_routes._resolve_render_job_identity(pipeline, job) == (
        1,
        "B",
        moved,
        pipeline_routes._build_output_id(moved, "B"),
    )
    assert pipeline_routes._resolve_render_job_identity(
        pipeline,
        {"status": "completed"},
    ) is None


def test_render_job_merge_keeps_outputs_separate_after_cross_instance_reorder() -> None:
    first = "script_11111111"
    second = "script_22222222"
    first_output = pipeline_routes._build_output_id(first)
    second_output = pipeline_routes._build_output_id(second)

    merged = pipeline_routes._merge_identity_job_maps(
        "render_jobs",
        {
            "0": {
                "attempt_id": "first-attempt",
                "script_id": first,
                "output_id": first_output,
                "status": "processing",
            },
        },
        {
            "0": {
                "attempt_id": "second-attempt",
                "script_id": second,
                "output_id": second_output,
                "status": "queued",
            },
        },
        [second, first],
    )

    assert merged["0"]["output_id"] == second_output
    assert merged["1"]["output_id"] == first_output


def test_render_job_merge_does_not_resurrect_a_cancelled_attempt() -> None:
    script_id = "script_11111111"
    output_id = pipeline_routes._build_output_id(script_id)
    merged = pipeline_routes._merge_identity_job_maps(
        "render_jobs",
        {
            "0": {
                "attempt_id": "same-attempt",
                "script_id": script_id,
                "output_id": output_id,
                "status": "cancelled",
                "cancelled_at": "2026-07-24T01:00:00+00:00",
            },
        },
        {
            "0": {
                "attempt_id": "same-attempt",
                "script_id": script_id,
                "output_id": output_id,
                "status": "processing",
                "progress": 99,
                "updated_at": "2026-07-24T01:01:00+00:00",
            },
        },
        [script_id],
    )

    assert merged["0"]["status"] == "cancelled"


def test_structural_snapshot_cas_blocks_job_active_only_in_database(
    monkeypatch,
) -> None:
    script_id = "script_11111111"

    class _Repo:
        def get_pipeline(self, _pipeline_id):
            return {
                "id": "pipeline-cross-instance-job",
                "profile_id": "profile-1",
                "scripts": ["Original"],
                "script_ids": [script_id],
                "settings_revision": 2,
                "jobs_revision": 7,
                "render_jobs": {
                    "0": {
                        "script_id": script_id,
                        "output_id": pipeline_routes._build_output_id(script_id),
                        "status": "processing",
                    },
                },
            }

        def table_query(self, *_args, **_kwargs):
            raise AssertionError("active job must block the structural CAS")

    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())

    with pytest.raises(HTTPException) as error:
        pipeline_routes._commit_script_snapshot_cas(
            "pipeline-cross-instance-job",
            "profile-1",
            {
                "scripts": ["Changed"],
                "script_ids": [script_id],
                "script_names": ["Script 1"],
                "settings_revision": 2,
                "jobs_revision": 7,
            },
            expected_script_ids=[script_id],
            expected_revision=2,
        )

    assert error.value.status_code == 409
    assert error.value.detail["active_jobs"] == ["render"]


def test_structural_snapshot_cas_compares_job_revision(monkeypatch) -> None:
    script_id = "script_11111111"
    captured: dict = {}

    class _Repo:
        def get_pipeline(self, _pipeline_id):
            return {
                "id": "pipeline-job-cas",
                "profile_id": "profile-1",
                "scripts": ["Original"],
                "script_ids": [script_id],
                "settings_revision": 4,
                "jobs_revision": 9,
            }

        def table_query(self, _table, _operation, *, data, filters):
            captured["data"] = copy.deepcopy(data)
            captured["filters"] = filters
            return SimpleNamespace(count=1)

    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())
    revision = pipeline_routes._commit_script_snapshot_cas(
        "pipeline-job-cas",
        "profile-1",
        {
            "scripts": ["Changed"],
            "script_ids": [script_id],
            "script_names": ["Script 1"],
            "settings_revision": 4,
            "jobs_revision": 9,
        },
        expected_script_ids=[script_id],
        expected_revision=4,
    )

    assert revision == 5
    assert captured["data"]["jobs_revision"] == 10
    assert captured["filters"].eq["jobs_revision"] == 9


def test_structural_snapshot_rebases_terminal_job_from_database(
    monkeypatch,
) -> None:
    script_id = "script_11111111"
    output_id = pipeline_routes._build_output_id(script_id)
    captured: dict = {}

    class _Repo:
        def get_pipeline(self, _pipeline_id):
            return {
                "id": "pipeline-terminal-rebase",
                "profile_id": "profile-1",
                "scripts": ["Original"],
                "script_ids": [script_id],
                "settings_revision": 3,
                "jobs_revision": 8,
                "render_jobs": {
                    "0": {
                        "attempt_id": "render-attempt",
                        "script_id": script_id,
                        "output_id": output_id,
                        "status": "completed",
                        "completed_at": "2026-07-24T01:00:00+00:00",
                    },
                },
            }

        def table_query(self, _table, _operation, *, data, filters):
            captured["data"] = copy.deepcopy(data)
            captured["filters"] = filters
            return SimpleNamespace(count=1)

    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())
    pipeline_routes._commit_script_snapshot_cas(
        "pipeline-terminal-rebase",
        "profile-1",
        {
            "scripts": ["Original"],
            "script_ids": [script_id],
            "script_names": ["Script 1"],
            "settings_revision": 3,
            "jobs_revision": 1,
            "render_jobs": {},
        },
        expected_script_ids=[script_id],
        expected_revision=3,
    )

    assert captured["data"]["render_jobs"]["0"]["status"] == "completed"
    assert captured["data"]["render_jobs"]["0"]["attempt_id"] == "render-attempt"
    assert captured["filters"].eq["jobs_revision"] == 8


def test_runtime_output_merge_preserves_concurrent_sibling_results() -> None:
    script_ids = ["script_11111111", "script_22222222"]
    current = {
        "1": {
            "output_id": pipeline_routes._build_output_id(script_ids[1]),
            "timestamp": "2026-07-24T01:01:00+00:00",
            "audio_path": "voice-b.mp3",
        },
    }
    incoming = {
        "0": {
            "output_id": pipeline_routes._build_output_id(script_ids[0]),
            "timestamp": "2026-07-24T01:02:00+00:00",
            "audio_path": "voice-a.mp3",
        },
    }

    merged = pipeline_routes._merge_runtime_output_map(
        "tts_previews",
        current,
        incoming,
        script_ids,
    )

    assert merged["0"]["audio_path"] == "voice-a.mp3"
    assert merged["1"]["audio_path"] == "voice-b.mp3"


def test_narrow_pipeline_save_cannot_overwrite_scripts_or_snapshot(
    monkeypatch,
) -> None:
    captured: list[dict] = []

    class _Repo:
        def get_pipeline(self, _pipeline_id):
            return {
                "id": "pipeline-narrow-save",
                "scripts": ["Authoritative"],
                "script_ids": ["script_authoritative"],
                "template_settings": {"snapshot": {"revision": 7}},
                "settings_revision": 7,
            }

        def upsert_pipeline(self, row):
            captured.append(copy.deepcopy(row))
            return row

    pipeline = {
        "pipeline_id": "pipeline-narrow-save",
        "profile_id": "profile-1",
        "scripts": ["Stale local script"],
        "script_ids": ["script_stale_local"],
        "template_settings": {"snapshot": {"revision": 3}},
        "settings_revision": 3,
        "previews": {"0": {"preview_data": {"audio_duration": 1}}},
    }
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())
    monkeypatch.setattr(
        pipeline_routes,
        "_promote_temp_audio_paths_to_library",
        lambda *_args: None,
    )

    pipeline_routes._db_save_pipeline(
        "pipeline-narrow-save",
        pipeline,
        fields={"previews"},
    )

    assert len(captured) == 1
    assert set(captured[0]) == {"id", "expires_at", "previews"}
    assert "scripts" not in captured[0]
    assert "script_ids" not in captured[0]
    assert "template_settings" not in captured[0]
    assert "settings_revision" not in captured[0]


def test_subtitle_overrides_participate_in_settings_revision_cas(
    monkeypatch,
) -> None:
    pipeline_id = "pipeline-subtitle-cas"
    pipeline = {
        "id": pipeline_id,
        "profile_id": "profile-1",
        "settings_revision": 5,
        "template_settings": {"snapshot": {"revision": 5}},
        "subtitle_settings_by_key": {"default": {"fontSize": 48}},
        "render_jobs": {},
    }
    writes = []

    class _Repo:
        def get_pipeline(self, _pipeline_id):
            return copy.deepcopy(pipeline)

        def table_query(self, table, operation, *, data, filters):
            writes.append(
                {
                    "table": table,
                    "operation": operation,
                    "data": copy.deepcopy(data),
                    "filters": filters,
                }
            )
            return SimpleNamespace(count=1)

    monkeypatch.setattr(
        pipeline_routes,
        "_get_pipeline_or_load",
        lambda _pipeline_id: pipeline,
    )
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())
    monkeypatch.setattr(
        pipeline_routes,
        "_db_update_render_jobs",
        lambda _pipeline_id, _jobs: {},
    )
    monkeypatch.setattr(
        pipeline_routes,
        "_invalidate_library_clips",
        lambda _clip_ids: None,
    )

    result = asyncio.run(
        pipeline_routes.update_subtitle_overrides(
            pipeline_id,
            pipeline_routes.SubtitleOverridesRequest(
                overrides={"default": {"fontSize": 64}},
                expected_revision=5,
            ),
            SimpleNamespace(profile_id="profile-1"),
        )
    )

    assert result["revision"] == 6
    assert pipeline["settings_revision"] == 6
    assert pipeline["template_settings"]["snapshot"]["revision"] == 6
    assert writes[0]["data"]["settings_revision"] == 6
    assert writes[0]["filters"].eq["settings_revision"] == 5

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            pipeline_routes.update_subtitle_overrides(
                pipeline_id,
                pipeline_routes.SubtitleOverridesRequest(
                    overrides={"default": {"fontSize": 72}},
                    expected_revision=4,
                ),
                SimpleNamespace(profile_id="profile-1"),
            )
        )

    assert error.value.status_code == 409
    assert len(writes) == 1


def test_meta_change_rejects_authoritative_active_voice_regeneration(
    monkeypatch,
) -> None:
    pipeline_id = "pipeline-meta-voice-gate"
    cached = {
        "pipeline_id": pipeline_id,
        "profile_id": "profile-1",
        "meta_multiplication": False,
        "tts_jobs": {},
    }
    authoritative = {
        **cached,
        "tts_jobs": {
            "0": {
                "status": "processing",
                "attempt_id": "active-voice-attempt",
                "output_id": "script_11111111:default",
            }
        },
    }

    class _Repo:
        def get_pipeline(self, _pipeline_id):
            return copy.deepcopy(authoritative)

    monkeypatch.setattr(
        pipeline_routes,
        "_get_pipeline_or_load",
        lambda _pipeline_id: cached,
    )
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            pipeline_routes.update_meta_multiplication(
                pipeline_id,
                pipeline_routes.MetaMultiplicationRequest(enabled=True),
                SimpleNamespace(profile_id="profile-1"),
            )
        )

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "voice_regeneration_active"
    assert cached["meta_multiplication"] is False


@pytest.mark.parametrize(
    "invalid_state",
    [None, [], "invalid", {}, {"tts_jobs": []}],
)
def test_voice_gate_fails_closed_for_invalid_authoritative_state(
    monkeypatch,
    invalid_state,
) -> None:
    class _Repo:
        def get_pipeline(self, _pipeline_id):
            return invalid_state

    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())

    with pytest.raises(HTTPException) as error:
        pipeline_routes._require_voice_generation_idle(
            "pipeline-missing-authoritative-state",
            {"tts_jobs": {}},
            action="rendering",
        )

    assert error.value.status_code == 503
    assert error.value.detail["code"] == "voice_regeneration_state_unavailable"


def test_cancel_finds_the_job_by_output_id_after_its_numeric_key_moves(
    monkeypatch,
) -> None:
    async def scenario() -> None:
        first = "script_11111111"
        moved = "script_22222222"
        moved_output = pipeline_routes._build_output_id(moved)
        job = {
            "script_id": moved,
            "output_id": moved_output,
            "status": "queued",
            "progress": 0,
        }
        pipeline = {
            "pipeline_id": "pipeline-cancel-stable-output",
            "profile_id": "profile-1",
            "scripts": ["First", "Moved"],
            "script_ids": [first, moved],
            # Simulate a job map written by an instance with the former order.
            "render_jobs": {0: job},
        }
        cancelled_queue_ids: list[str] = []

        class _Queue:
            async def cancel(self, job_id: str) -> bool:
                cancelled_queue_ids.append(job_id)
                return True

        async def passthrough(*_args, **_kwargs):
            return job

        monkeypatch.setattr(
            pipeline_routes,
            "_get_pipeline_or_load",
            lambda _pipeline_id: pipeline,
        )
        monkeypatch.setattr(
            pipeline_routes,
            "get_render_queue",
            lambda: _Queue(),
        )
        monkeypatch.setattr(
            "app.services.ffmpeg_registry.kill_job",
            lambda _job_id: None,
        )
        monkeypatch.setattr(
            pipeline_routes,
            "_db_update_render_jobs",
            lambda *_args: None,
        )
        monkeypatch.setattr(
            pipeline_routes,
            "_recover_render_reservation_for_settlement",
            passthrough,
        )
        monkeypatch.setattr(
            pipeline_routes,
            "_settle_render_metering",
            passthrough,
        )

        result = await pipeline_routes.cancel_variant_render(
            "pipeline-cancel-stable-output",
            "1",
            moved_output,
            SimpleNamespace(profile_id="profile-1", user_id="user-1"),
        )

        assert result["cancelled_keys"] == ["0"]
        assert job["status"] == "cancelled"
        assert cancelled_queue_ids == [
            pipeline_routes._render_queue_job_id(
                "pipeline-cancel-stable-output",
                0,
            ),
        ]

    asyncio.run(scenario())


def test_render_tasks_keep_meta_outputs_independent() -> None:
    request = pipeline_routes.PipelineRenderRequest(
        variant_indices=[0, 1],
        output_keys=["0_A", "1_B"],
        meta_multiplication=True,
    )

    assert pipeline_routes._render_tasks_for_request(request) == [
        (0, 0, "0_A"),
        (1, 1, "1_B"),
    ]

    only_b = pipeline_routes.PipelineRenderRequest(
        variant_indices=[0],
        output_keys=["0_B"],
        meta_multiplication=True,
    )
    assert pipeline_routes._render_tasks_for_request(only_b) == [(0, 1, "0_B")]


def test_render_tasks_require_and_validate_stable_output_identity() -> None:
    script_id = "script_11111111"
    pipeline = {
        "scripts": ["First"],
        "script_ids": [script_id],
    }
    output_id = pipeline_routes._build_output_id(script_id, "B")
    request = pipeline_routes.PipelineRenderRequest(
        variant_indices=[0],
        output_keys=["0_B"],
        output_ids={"0_B": output_id},
        meta_multiplication=True,
    )
    tasks = pipeline_routes._render_tasks_for_request(request)

    assert pipeline_routes._render_task_identities(
        pipeline,
        request,
        tasks,
    ) == {"0_B": (script_id, output_id)}

    missing = pipeline_routes.PipelineRenderRequest(
        variant_indices=[0],
        output_keys=["0_B"],
        meta_multiplication=True,
    )
    with pytest.raises(HTTPException) as missing_error:
        pipeline_routes._render_task_identities(
            pipeline,
            missing,
            pipeline_routes._render_tasks_for_request(missing),
        )
    assert missing_error.value.status_code == 409

    stale = pipeline_routes.PipelineRenderRequest(
        variant_indices=[0],
        output_keys=["0_B"],
        output_ids={
            "0_B": pipeline_routes._build_output_id("script_22222222", "B"),
        },
        meta_multiplication=True,
    )
    with pytest.raises(HTTPException) as stale_error:
        pipeline_routes._render_task_identities(
            pipeline,
            stale,
            pipeline_routes._render_tasks_for_request(stale),
        )
    assert stale_error.value.status_code == 409


def test_pacing_contract_accepts_step_two_minimum() -> None:
    assert pipeline_routes._clamp_min_segment_duration(0.5) == 0.5
    assert pipeline_routes._clamp_min_segment_duration(0.1) == 0.5
    assert pipeline_routes._clamp_min_segment_duration(5) == 5.0


def test_generated_tts_reuse_requires_complete_voice_configuration() -> None:
    entry = {
        "elevenlabs_model": "eleven_flash_v2_5",
        "voice_id": "voice-one",
        "voice_settings": {"speed": 1.0, "stability": 0.5},
    }
    assert pipeline_routes._tts_asset_matches_config(
        entry,
        "eleven_flash_v2_5",
        "voice-one",
        {"speed": 1.0, "stability": 0.5},
    )
    assert not pipeline_routes._tts_asset_matches_config(
        entry,
        "eleven_multilingual_v2",
        "voice-one",
        {"speed": 1.0, "stability": 0.5},
    )
    assert not pipeline_routes._tts_asset_matches_config(
        entry,
        "eleven_flash_v2_5",
        "voice-two",
        {"speed": 1.0, "stability": 0.5},
    )
    assert not pipeline_routes._tts_asset_matches_config(
        {"library_asset_id": "asset-1"},
        "any-model",
        "any-voice",
        {"speed": 2.0},
    )
    assert pipeline_routes._tts_asset_matches_config(
        {
            "library_asset_id": "asset-1",
            "asset_provenance": "library_adopted",
        },
        "any-model",
        "any-voice",
        {"speed": 2.0},
    )
    assert not pipeline_routes._tts_asset_matches_config(
        {},
        "eleven_flash_v2_5",
        None,
        None,
    )


def test_tts_reuse_requires_the_recorded_audio_hash(tmp_path) -> None:
    audio_path = tmp_path / "voiceover.mp3"
    audio_path.write_bytes(b"current audio bytes" * 20)
    entry = {
        "audio_path": str(audio_path),
        "audio_sha256": pipeline_routes._file_sha256(audio_path),
    }

    assert pipeline_routes._tts_audio_integrity_matches(entry, audio_path)

    audio_path.write_bytes(b"different audio bytes" * 20)
    assert not pipeline_routes._tts_audio_integrity_matches(entry, audio_path)


def test_missing_tts_restore_matches_text_voice_model_settings_and_hash(
    monkeypatch,
    tmp_path,
) -> None:
    wrong_voice_path = tmp_path / "wrong.mp3"
    right_voice_path = tmp_path / "right.mp3"
    wrong_voice_path.write_bytes(b"wrong voice" * 30)
    right_voice_path.write_bytes(b"right voice" * 30)
    voice_settings = {"speed": 1.0, "stability": 0.5}

    class _Repo:
        def list_tts_assets(self, _profile_id, _filters):
            return SimpleNamespace(data=[
                {
                    "id": "asset-wrong",
                    "tts_text": "The same script",
                    "mp3_path": str(wrong_voice_path),
                    "audio_duration": 1.0,
                    "tts_model": "eleven_flash_v2_5",
                    "tts_voice_id": "voice-wrong",
                    "tts_voice_settings": voice_settings,
                    "audio_sha256": pipeline_routes._file_sha256(wrong_voice_path),
                },
                {
                    "id": "asset-right",
                    "tts_text": "The same script",
                    "mp3_path": str(right_voice_path),
                    "audio_duration": 1.0,
                    "tts_model": "eleven_flash_v2_5",
                    "tts_voice_id": "voice-right",
                    "tts_voice_settings": voice_settings,
                    "audio_sha256": pipeline_routes._file_sha256(right_voice_path),
                },
            ])

    pipeline = {
        "profile_id": "profile-1",
        "scripts": ["The same script"],
        "tts_previews": {
            0: {
                "audio_path": str(tmp_path / "missing.mp3"),
                "script_hash": pipeline_routes._stable_hash("The same script"),
                "elevenlabs_model": "eleven_flash_v2_5",
                "voice_id": "voice-right",
                "voice_settings": voice_settings,
                "asset_provenance": "generated",
            },
        },
        "previews": {},
    }
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())

    restored = pipeline_routes._restore_missing_tts_audio_paths(
        "pipeline-voice-restore",
        pipeline,
        persist=False,
    )

    assert restored == 1
    assert pipeline["tts_previews"][0]["library_asset_id"] == "asset-right"
    assert pipeline["tts_previews"][0]["audio_path"] == str(right_voice_path)
    assert (
        pipeline["tts_previews"][0]["audio_sha256"]
        == pipeline_routes._file_sha256(right_voice_path)
    )


def test_missing_tts_restore_does_not_guess_from_text_only(
    monkeypatch,
    tmp_path,
) -> None:
    candidate_path = tmp_path / "candidate.mp3"
    candidate_path.write_bytes(b"candidate voice" * 30)

    class _Repo:
        def list_tts_assets(self, _profile_id, _filters):
            return SimpleNamespace(data=[{
                "id": "asset-candidate",
                "tts_text": "The same script",
                "mp3_path": str(candidate_path),
                "audio_duration": 1.0,
                "tts_model": "eleven_flash_v2_5",
                "tts_voice_id": "voice-other",
                "tts_voice_settings": {"speed": 1.0},
                "audio_sha256": pipeline_routes._file_sha256(candidate_path),
            }])

    pipeline = {
        "profile_id": "profile-1",
        "scripts": ["The same script"],
        "tts_previews": {
            0: {
                "audio_path": str(tmp_path / "missing.mp3"),
                "asset_provenance": "generated",
            },
        },
        "previews": {},
    }
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())

    restored = pipeline_routes._restore_missing_tts_audio_paths(
        "pipeline-no-text-only-restore",
        pipeline,
        persist=False,
    )

    assert restored == 0
    assert pipeline["tts_previews"][0]["audio_path"] is None


def test_reassembly_preserves_manual_editor_layers() -> None:
    existing = {
        "manual_matches": True,
        "matches": [
            {
                "srt_index": 0,
                "srt_text": "same phrase",
                "srt_start": 0.0,
                "srt_end": 1.0,
                "segment_id": "manual-segment",
                "source_video_id": "source-1",
                "pinned": False,
            },
            {
                "srt_index": 1,
                "srt_text": "old phrase",
                "srt_start": 1.0,
                "srt_end": 2.0,
                "segment_id": "pinned-segment",
                "source_video_id": "source-1",
                "pinned": True,
            },
        ],
        "manual_composition": True,
        "video_timeline": [
            {
                "kind": "intro",
                "segment_id": "manual-segment",
                "timeline_duration": 1.25,
            },
            {
                "kind": "body",
                "segment_id": "pinned-segment",
                "timeline_duration": 2.0,
            },
        ],
        "default_transition": {"type": "fade", "duration": 0.25},
        "music": {"assetId": "music-1", "volume": 0.2},
    }
    fresh = {
        "matches": [
            {
                "srt_index": 0,
                "srt_text": "same phrase",
                "srt_start": 0.2,
                "srt_end": 1.2,
                "segment_id": "auto-1",
                "source_video_id": "source-1",
                "pinned": False,
            },
            {
                "srt_index": 1,
                "srt_text": "new phrase",
                "srt_start": 1.2,
                "srt_end": 2.5,
                "segment_id": "auto-2",
                "source_video_id": "source-1",
                "pinned": False,
            },
        ],
        "video_timeline": [{"kind": "body", "timeline_duration": 3.0}],
    }

    matches_preserved, composition_preserved = (
        pipeline_routes._preserve_manual_preview_layers(
            existing,
            fresh,
            ["source-1"],
        )
    )

    assert matches_preserved is True
    assert composition_preserved is True
    assert fresh["matches"][0]["segment_id"] == "manual-segment"
    assert fresh["matches"][0]["srt_start"] == 0.2
    assert fresh["matches"][1]["segment_id"] == "pinned-segment"
    assert fresh["matches"][1]["srt_text"] == "new phrase"
    assert fresh["video_timeline"] == existing["video_timeline"]
    assert fresh["intro_offset_sec"] == 1.25
    assert fresh["default_transition"] == existing["default_transition"]
    assert fresh["music"] == existing["music"]

    source_changed = copy.deepcopy(fresh)
    source_changed["matches"] = [
        {
            "srt_index": 0,
            "srt_text": "same phrase",
            "srt_start": 0.2,
            "srt_end": 1.2,
            "segment_id": "new-source-segment",
            "source_video_id": "source-2",
            "pinned": False,
        }
    ]
    pipeline_routes._preserve_manual_preview_layers(
        existing,
        source_changed,
        ["source-2"],
    )
    assert source_changed["matches"][0]["segment_id"] == "new-source-segment"

    same_phrases = copy.deepcopy(fresh)
    same_phrases["matches"][0]["srt_start"] = 0.4
    same_phrases["matches"][0]["segment_id"] = "automatic-segment"
    pipeline_routes._preserve_manual_preview_layers(
        existing,
        same_phrases,
        ["source-1"],
    )
    assert same_phrases["matches"][0]["segment_id"] == "manual-segment"
    assert same_phrases["matches"][0]["srt_start"] == 0.4


def test_reassembly_preserves_explicit_music_and_transition_clears() -> None:
    existing = {
        "manual_composition": True,
        "video_timeline": [{"kind": "body", "timeline_duration": 1.0}],
        "default_transition": None,
        "music": None,
    }
    fresh = {
        "video_timeline": [{"kind": "body", "timeline_duration": 2.0}],
        "default_transition": {"type": "fade", "duration": 0.25},
        "music": {"assetId": "stale-music"},
    }

    pipeline_routes._preserve_manual_preview_layers(existing, fresh, [])

    assert "default_transition" in fresh
    assert fresh["default_transition"] is None
    assert "music" in fresh
    assert fresh["music"] is None


def test_script_audio_change_invalidates_default_and_all_meta_previews() -> None:
    pipeline = {
        "previews": {
            0: {"owner": "default-int"},
            "0": {"owner": "default-string"},
            "0_A": {"owner": "A"},
            "0_B": {"owner": "B"},
            "1_A": {"owner": "other-script"},
        }
    }

    pipeline_routes._drop_previews_for_variant(pipeline, 0)

    assert pipeline["previews"] == {"1_A": {"owner": "other-script"}}


def test_library_save_refuses_render_job_without_stable_identity(
    monkeypatch,
    tmp_path,
) -> None:
    pipeline = {
        "scripts": ["First"],
        "script_ids": ["script_11111111"],
        "render_jobs": {0: {"status": "completed"}},
    }
    persisted = []
    monkeypatch.setattr(
        pipeline_routes,
        "_db_update_render_jobs",
        lambda pipeline_id, jobs: persisted.append((pipeline_id, copy.deepcopy(jobs))),
    )

    library_saved = asyncio.run(
        pipeline_routes._save_clip_to_library(
            pipeline=pipeline,
            pipeline_id="pipeline-library-contract",
            vid=0,
            final_video_path=tmp_path / "unused.mp4",
            profile_id="profile-1",
            render_fingerprint="fingerprint",
            render_jobs_lock=pipeline_routes.threading.Lock(),
        )
    )

    assert library_saved is False
    job = pipeline["render_jobs"][0]
    assert job["library_saved"] is False
    assert "stable ScriptId/OutputId" in job["library_error"]
    assert persisted[-1][0] == "pipeline-library-contract"


def test_library_revalidates_identity_immediately_before_clip_upsert(
    monkeypatch,
    tmp_path,
) -> None:
    pipeline_id = "pipeline-library-final-authority"
    script_id = "script_11111111"
    output_id = pipeline_routes._build_output_id(script_id)
    final_video = tmp_path / "final.mp4"
    final_video.write_bytes(b"video")
    pipeline = {
        "pipeline_id": pipeline_id,
        "profile_id": "profile-1",
        "library_project_id": "project-1",
        "scripts": ["First"],
        "script_ids": [script_id],
        "selected_captions": {},
        "segment_usage": {},
        "tts_previews": {},
        "render_jobs": {
            0: {
                "status": "processing",
                "attempt_id": "render-attempt",
                "script_id": script_id,
                "output_id": output_id,
                "script_fingerprint": pipeline_routes._stable_hash("First"),
            }
        },
    }
    authoritative = copy.deepcopy(pipeline)

    class _Repo:
        def __init__(self):
            self.created_clips = []

        def get_pipeline(self, _pipeline_id):
            return copy.deepcopy(authoritative)

        def list_clips(self, _project_id, _filters):
            # Simulate a structural change after thumbnail/probe and lookup but
            # before the eventual create_clip call.
            authoritative["scripts"] = []
            authoritative["script_ids"] = []
            return SimpleNamespace(data=[])

        def create_clip(self, payload):
            self.created_clips.append(copy.deepcopy(payload))
            return {"id": "clip-1"}

    repo = _Repo()

    def _fake_ffmpeg(args, *_rest):
        if str(args[0]).endswith("ffprobe"):
            return SimpleNamespace(returncode=0, stdout="3.0")
        thumbnail = Path(args[-1])
        thumbnail.parent.mkdir(parents=True, exist_ok=True)
        thumbnail.write_bytes(b"thumbnail")
        return SimpleNamespace(returncode=0, stdout="")

    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: repo)
    monkeypatch.setattr(pipeline_routes, "safe_ffmpeg_run", _fake_ffmpeg)
    monkeypatch.setattr(
        pipeline_routes,
        "_db_update_render_jobs",
        lambda *_args, **_kwargs: {},
    )

    library_saved = asyncio.run(
        pipeline_routes._save_clip_to_library(
            pipeline=pipeline,
            pipeline_id=pipeline_id,
            vid=0,
            final_video_path=final_video,
            profile_id="profile-1",
            render_fingerprint="fingerprint",
            render_jobs_lock=pipeline_routes.threading.Lock(),
        )
    )

    assert library_saved is False
    assert repo.created_clips == []
    assert pipeline["render_jobs"][0]["library_saved"] is False
    assert "script" in pipeline["render_jobs"][0]["library_error"].lower()


def test_library_save_returns_true_only_after_clip_upsert(
    monkeypatch,
    tmp_path,
) -> None:
    pipeline_id = "pipeline-library-success-contract"
    script_id = "script_11111111"
    output_id = pipeline_routes._build_output_id(script_id)
    final_video = tmp_path / "final.mp4"
    final_video.write_bytes(b"video")
    pipeline = {
        "pipeline_id": pipeline_id,
        "profile_id": "profile-1",
        "library_project_id": "project-1",
        "scripts": ["First"],
        "script_ids": [script_id],
        "selected_captions": {},
        "segment_usage": {},
        "tts_previews": {},
        "render_jobs": {
            0: {
                "status": "processing",
                "attempt_id": "render-attempt",
                "script_id": script_id,
                "output_id": output_id,
                "script_fingerprint": pipeline_routes._stable_hash("First"),
            }
        },
    }

    class _Repo:
        def get_pipeline(self, _pipeline_id):
            return copy.deepcopy(pipeline)

        def list_clips(self, _project_id, _filters):
            return SimpleNamespace(data=[])

        def create_clip(self, _payload):
            return {"id": "clip-1"}

        def table_query(self, *_args, **_kwargs):
            return SimpleNamespace(data=[{"clip_id": "clip-1"}])

    def _fake_ffmpeg(args, *_rest):
        if str(args[0]).endswith("ffprobe"):
            return SimpleNamespace(returncode=0, stdout="3.0")
        thumbnail = Path(args[-1])
        thumbnail.parent.mkdir(parents=True, exist_ok=True)
        thumbnail.write_bytes(b"thumbnail")
        return SimpleNamespace(returncode=0, stdout="")

    async def _skip_cloud_mirror(*_args, **_kwargs):
        return None

    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())
    monkeypatch.setattr(pipeline_routes, "safe_ffmpeg_run", _fake_ffmpeg)
    monkeypatch.setattr(
        pipeline_routes,
        "_mirror_pipeline_output_to_cloud",
        _skip_cloud_mirror,
    )
    monkeypatch.setattr(
        pipeline_routes,
        "_db_update_render_jobs",
        lambda *_args, **_kwargs: {},
    )

    library_saved = asyncio.run(
        pipeline_routes._save_clip_to_library(
            pipeline=pipeline,
            pipeline_id=pipeline_id,
            vid=0,
            final_video_path=final_video,
            profile_id="profile-1",
            render_fingerprint="fingerprint",
            render_jobs_lock=pipeline_routes.threading.Lock(),
        )
    )

    assert library_saved is True
    assert pipeline["render_jobs"][0]["library_saved"] is True
    assert pipeline["render_jobs"][0]["clip_id"] == "clip-1"


def test_render_and_remake_complete_only_after_library_success() -> None:
    render_source = inspect.getsource(pipeline_routes.render_variants)
    remake_source = inspect.getsource(pipeline_routes.remake_variant)

    render_saving = render_source.index('job["current_step"] = "Saving render to Library"')
    render_library = render_source.index(
        "_library_saved = await _save_clip_to_library",
        render_saving,
    )
    render_completed = render_source.index(
        'job["status"] = "completed"',
        render_library,
    )
    assert render_saving < render_library < render_completed

    remake_saving = remake_source.index('job["current_step"] = "Saving remake to Library"')
    remake_library = remake_source.index(
        "_library_saved = await _save_clip_to_library",
        remake_saving,
    )
    remake_revalidation = remake_source.index(
        "authoritative_index = _validate_authoritative_output_identity",
        remake_library,
    )
    remake_completed = remake_source.index(
        'job["status"] = "completed"',
        remake_revalidation,
    )
    assert remake_saving < remake_library < remake_revalidation < remake_completed

    assert (
        "completed_job.get(\"library_saved\") is True"
        in render_source
    )
    assert (
        "completed_job.get(\"library_saved\") is True"
        in remake_source
    )


def test_migration_059_uses_unambiguous_links_and_duplicate_preflight() -> None:
    sql = Path(
        "supabase/migrations/059_add_pipeline_integrity_contract.sql"
    ).read_text(encoding="utf-8")

    assert "ADD COLUMN IF NOT EXISTS pipeline_id UUID" in sql
    assert "pipeline.id = project.pipeline_id" in sql
    assert "pipeline.name = project.name" not in sql
    assert "project_match_count = 1" in sql
    assert "pipeline_match_count = 1" in sql
    assert "COALESCE(NULLIF(pipeline.name, ''), pipeline.idea, '')" in sql
    assert "prospective_active" in sql
    assert "Migration 059 preflight failed" in sql
    assert "idx_editai_clips_project_output_id_active" in sql


def test_sync_to_library_refuses_legacy_index_identity(monkeypatch) -> None:
    script_id = "script_11111111"
    pipeline = {
        "pipeline_id": "pipeline-sync-contract",
        "profile_id": "profile-1",
        "scripts": ["First"],
        "script_ids": [script_id],
        "render_jobs": {
            0: {
                "status": "completed",
                "final_video_path": "unused.mp4",
                "script_id": script_id,
                "output_id": pipeline_routes._build_output_id(script_id),
            }
        },
    }

    class _Repo:
        def get_profile(self, _profile_id):
            return {}

        def get_project_by_name(self, _profile_id, _name):
            return {"id": "project-1"}

        def list_clips(self, _project_id, _filters):
            raise RuntimeError(
                "Could not find the 'output_id' column in the schema cache"
            )

    monkeypatch.setattr(
        pipeline_routes,
        "_get_pipeline_or_load",
        lambda _pipeline_id: pipeline,
    )
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: _Repo())

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            pipeline_routes.sync_pipeline_to_library(
                "pipeline-sync-contract",
                SimpleNamespace(profile_id="profile-1"),
            )
        )

    assert error.value.status_code == 503
    assert "migration 059" in str(error.value.detail)
    assert pipeline["render_jobs"][0].get("library_saved") is None


def test_legacy_pipeline_gets_stable_ids_without_mutating_template() -> None:
    pipeline = {
        "pipeline_id": "pipeline-contract-test",
        "scripts": ["first", "second"],
        "script_names": ["One", "Two"],
        "template_settings": {
            "content": {
                "scripts": [
                    {"name": "One", "text": "first"},
                    {"name": "Two", "text": "second"},
                ]
            }
        },
    }
    original_template = copy.deepcopy(pipeline["template_settings"])

    first_ids = pipeline_routes._ensure_pipeline_script_ids(pipeline)
    second_ids = pipeline_routes._ensure_pipeline_script_ids(pipeline)

    assert first_ids == second_ids
    assert len(set(first_ids)) == 2
    assert pipeline["script_ids"] == first_ids
    assert pipeline["template_settings"] == original_template
