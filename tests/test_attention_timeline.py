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
