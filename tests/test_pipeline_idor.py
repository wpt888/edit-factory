from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import pipeline_routes
from app.api.auth import ProfileContext, get_profile_context


PIPELINE_ID = "pipeline-owned-by-profile-a"


class _PipelineRepository:
    def __init__(self, pipeline: dict):
        self.pipeline = pipeline
        self.delete_called = False

    def get_pipeline(self, pipeline_id: str):
        return self.pipeline if pipeline_id == PIPELINE_ID else None

    def delete_pipeline(self, pipeline_id: str):
        self.delete_called = True


def test_profile_cannot_access_or_mutate_another_profiles_pipeline(monkeypatch):
    pipeline = {
        "pipeline_id": PIPELINE_ID,
        "profile_id": "profile-a",
        "scripts": ["private script"],
        "script_ids": ["script_private_001"],
        "render_jobs": {},
        "preview_renders": {},
    }
    repo = _PipelineRepository(pipeline)
    monkeypatch.setattr(pipeline_routes, "_pipelines", {PIPELINE_ID: pipeline})
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: repo)

    app = FastAPI()
    app.include_router(pipeline_routes.router)
    app.dependency_overrides[get_profile_context] = lambda: ProfileContext(
        profile_id="profile-b",
        user_id="user-b",
    )

    requests = [
        ("get", f"/pipeline/status/{PIPELINE_ID}", None),
        ("get", f"/pipeline/scripts/{PIPELINE_ID}", None),
        (
            "get",
            (
                f"/pipeline/preview-status/{PIPELINE_ID}/0"
                "?script_id=script_private_001"
                "&output_id=script_private_001%3Adefault"
            ),
            None,
        ),
        ("patch", f"/pipeline/{PIPELINE_ID}/name", {"name": "stolen"}),
        (
            "post",
            "/pipeline/selected-captions",
            {"pipeline_id": PIPELINE_ID, "selected_captions": {"0": "stolen"}},
        ),
        (
            "put",
            f"/pipeline/{PIPELINE_ID}/scripts",
            {
                "scripts": ["stolen script"],
                "script_ids": ["script_private_001"],
                "expected_script_ids": ["script_private_001"],
                "expected_revision": 0,
            },
        ),
        ("delete", f"/pipeline/{PIPELINE_ID}", None),
    ]

    with TestClient(app, raise_server_exceptions=False) as client:
        for method, url, body in requests:
            response = client.request(method, url, json=body)
            assert response.status_code in {403, 404}, (method, url, response.text)

    assert pipeline["scripts"] == ["private script"]
    assert pipeline.get("name") != "stolen"
    assert "selected_captions" not in pipeline
    assert repo.delete_called is False


def test_pipeline_routes_that_reference_pipeline_ids_require_profile_auth():
    unauthenticated = {
        route.name
        for route in pipeline_routes.router.routes
        if "pipeline_id" in route.path and not route.dependant.dependencies
    }

    assert unauthenticated == set()


def test_delete_fallback_does_not_remove_other_profiles_in_memory_pipeline(monkeypatch):
    pipeline = {"pipeline_id": PIPELINE_ID, "profile_id": "profile-a", "scripts": []}
    in_memory = {PIPELINE_ID: pipeline}
    monkeypatch.setattr(pipeline_routes, "_pipelines", in_memory)
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: None)

    app = FastAPI()
    app.include_router(pipeline_routes.router)
    app.dependency_overrides[get_profile_context] = lambda: ProfileContext(
        profile_id="profile-b",
        user_id="user-b",
    )

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.delete(f"/pipeline/{PIPELINE_ID}")

    assert response.status_code == 403
    assert in_memory[PIPELINE_ID] is pipeline
