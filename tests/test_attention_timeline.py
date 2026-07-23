from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import pipeline_routes
from app.api.auth import ProfileContext, get_profile_context


class _AttentionRepository:
    def __init__(self, template):
        self.template = template
        self.pipeline_updates = []

    def get_attention_template(self, template_id):
        return self.template if self.template["id"] == template_id else None

    def update_pipeline(self, pipeline_id, changes):
        self.pipeline_updates.append((pipeline_id, changes))
        return changes

    def upsert_pipeline(self, row):
        # The route now persists the full pipeline row; keep this focused fake's
        # assertion surface limited to the attention document under test.
        self.pipeline_updates.append((row["id"], {"attention_timeline": row["attention_timeline"]}))
        return row


def test_apply_template_threads_layout_and_rejects_stale_revision(monkeypatch):
    profile_id = "profile-attention"
    pipeline = {"id": "pipeline-attention", "profile_id": profile_id, "attention_timeline": {}}
    template = {
        "id": "personal-stack",
        "profile_id": profile_id,
        "name": "Personal Stack",
        "config": {
            "strategy": "count",
            "count": 1,
            "protectedStartMs": 0,
            "protectedEndMs": 0,
            "minimumGapMs": 0,
            "durationMs": 900,
            "animation": "pop",
            "layers": 3,
            "size": 0.42,
            "zone": "front",
        },
    }
    repository = _AttentionRepository(template)
    monkeypatch.setattr(pipeline_routes, "_get_pipeline_or_load", lambda pipeline_id: pipeline)
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: repository)

    app = FastAPI()
    app.include_router(pipeline_routes.router)
    app.dependency_overrides[get_profile_context] = lambda: ProfileContext(
        profile_id=profile_id,
        user_id="user-attention",
    )

    body = {
        "templateId": "personal-stack",
        # Step 3 may override the template's authored "pop" without mutating it.
        "animation": "static",
        "assetUrls": ["https://assets.test/one.png", "https://assets.test/two.png", "https://assets.test/three.png"],
        "durationMs": 10000,
        "subtitleBoundariesMs": [4500],
        "revision": 0,
        "mode": "replace",
    }
    with TestClient(app) as client:
        response = client.post(
            "/pipeline/pipeline-attention/attention-timeline/0/apply-template",
            json=body,
        )
        assert response.status_code == 200, response.text
        document = response.json()
        assert document["revision"] == 1
        assert len(document["cues"]) == 1
        cue = document["cues"][0]
        assert cue["zone"] == "front"
        assert cue["startMs"] == 4500
        assert len(cue["layers"]) == 3
        assert [layer["width"] for layer in cue["layers"]] == [0.42, 0.42, 0.42]
        assert [layer["assetId"] for layer in cue["layers"]] == body["assetUrls"]
        assert all(layer["animation"]["preset"] == "static" for layer in cue["layers"])
        assert template["config"]["animation"] == "pop"
        assert repository.pipeline_updates[-1] == (
            "pipeline-attention",
            {"attention_timeline": {"0": document}},
        )

        conflict = client.post(
            "/pipeline/pipeline-attention/attention-timeline/0/apply-template",
            json=body,
        )
        assert conflict.status_code == 409
        assert conflict.json()["detail"] == {
            "message": "Attention timeline revision conflict",
            "current": document,
        }


def test_apply_template_start_offset_staggers_and_drops_overflow(monkeypatch):
    profile_id = "profile-attention"
    pipeline = {"id": "pipeline-attention", "profile_id": profile_id, "attention_timeline": {}}
    template = {
        "id": "personal-stack",
        "profile_id": profile_id,
        "name": "Personal Stack",
        "config": {
            "strategy": "count",
            "count": 2,
            "protectedStartMs": 0,
            "protectedEndMs": 0,
            "minimumGapMs": 0,
            "durationMs": 900,
        },
    }
    repository = _AttentionRepository(template)
    monkeypatch.setattr(pipeline_routes, "_get_pipeline_or_load", lambda pipeline_id: pipeline)
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: repository)

    app = FastAPI()
    app.include_router(pipeline_routes.router)
    app.dependency_overrides[get_profile_context] = lambda: ProfileContext(
        profile_id=profile_id,
        user_id="user-attention",
    )

    body = {
        "templateId": "personal-stack",
        "assetUrls": ["a.png"],
        "durationMs": 10000,
        "revision": 0,
        "mode": "replace",
    }
    with TestClient(app) as client:
        baseline = client.post(
            "/pipeline/pipeline-attention/attention-timeline/0/apply-template",
            json=body,
        )
        assert baseline.status_code == 200, baseline.text
        base_starts = [cue["startMs"] for cue in baseline.json()["cues"]]
        assert len(base_starts) == 2

        staggered = client.post(
            "/pipeline/pipeline-attention/attention-timeline/0/apply-template",
            json={**body, "revision": 1, "startOffsetMs": 2000},
        )
        assert staggered.status_code == 200, staggered.text
        offset_starts = [cue["startMs"] for cue in staggered.json()["cues"]]
        assert offset_starts == [start + 2000 for start in base_starts]

        # A huge offset pushes every cue past the end -> all dropped, not clamped.
        overflow = client.post(
            "/pipeline/pipeline-attention/attention-timeline/0/apply-template",
            json={**body, "revision": 2, "startOffsetMs": 9800},
        )
        assert overflow.status_code == 200, overflow.text
        assert overflow.json()["cues"] == []


def test_apply_system_template_appends_and_rejects_foreign_personal_template(monkeypatch):
    profile_id = "profile-attention"
    existing_cue = {
        "id": "existing",
        "startMs": 100,
        "durationMs": 500,
        "layers": [],
        "zone": "behind",
    }
    pipeline = {
        "id": "pipeline-attention",
        "profile_id": profile_id,
        "attention_timeline": {"0": {"revision": 4, "cues": [existing_cue]}},
    }
    foreign_template = {
        "id": "foreign-stack",
        "profile_id": "another-profile",
        "name": "Foreign Stack",
        "config": {"strategy": "count", "count": 1, "layers": 2},
    }
    repository = _AttentionRepository(foreign_template)
    monkeypatch.setattr(pipeline_routes, "_get_pipeline_or_load", lambda pipeline_id: pipeline)
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: repository)

    app = FastAPI()
    app.include_router(pipeline_routes.router)
    app.dependency_overrides[get_profile_context] = lambda: ProfileContext(
        profile_id=profile_id,
        user_id="user-attention",
    )

    with TestClient(app) as client:
        appended = client.post(
            "/pipeline/pipeline-attention/attention-timeline/0/apply-template",
            json={
                "templateId": "system-tornado-stack",
                "assetUrls": ["a.png", "b.png", "c.png"],
                "durationMs": 15000,
                "subtitleBoundariesMs": [3000, 6000, 9000, 12000],
                "revision": 4,
                "mode": "append",
            },
        )
        assert appended.status_code == 200, appended.text
        document = appended.json()
        assert document["revision"] == 5
        assert document["cues"][0] == existing_cue
        assert len(document["cues"]) == 3
        assert all(len(cue["layers"]) == 3 for cue in document["cues"][1:])
        assert all(cue["templateId"] == "system-tornado-stack" for cue in document["cues"][1:])

        forbidden = client.post(
            "/pipeline/pipeline-attention/attention-timeline/0/apply-template",
            json={
                "templateId": "foreign-stack",
                "assetUrls": ["a.png"],
                "durationMs": 10000,
                "revision": 5,
            },
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["detail"] == "Access denied to this attention template"
