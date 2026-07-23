import base64
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import segments_routes
from app.api.auth import ProfileContext
from app.api.media_session import (
    get_profile_context_with_media_session,
    get_source_media_profile_context,
)


PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlDkAAAAASUVORK5CYII="
)


def _client(tmp_path, monkeypatch):
    settings = SimpleNamespace(base_dir=tmp_path)
    monkeypatch.setattr(segments_routes, "get_settings", lambda: settings)

    current_profile = {"id": "profile-a"}

    def profile_context():
        return ProfileContext(profile_id=current_profile["id"], user_id="user-a")

    app = FastAPI()
    app.include_router(segments_routes.router)
    app.dependency_overrides[get_profile_context_with_media_session] = profile_context
    app.dependency_overrides[get_source_media_profile_context] = profile_context
    return TestClient(app, raise_server_exceptions=False), current_profile


def test_attention_media_upload_is_local_and_profile_scoped(tmp_path, monkeypatch):
    client, current_profile = _client(tmp_path, monkeypatch)

    response = client.post(
        "/segments/attention-media",
        files={"file": ("attention.png", PNG_1X1, "image/png")},
    )

    assert response.status_code == 200, response.text
    asset = response.json()["asset"]
    assert asset["type"] == "image"
    assert asset["url"].startswith("media/attention/")
    asset_id = asset["url"].rsplit("/", 1)[-1]
    stored_path = tmp_path / asset["url"]
    assert stored_path.read_bytes() == PNG_1X1

    served = client.get(f"/segments/attention-media/{asset_id}")
    assert served.status_code == 200
    assert served.content == PNG_1X1
    assert served.headers["content-type"] == "image/png"

    current_profile["id"] = "profile-b"
    hidden_from_other_profile = client.get(f"/segments/attention-media/{asset_id}")
    assert hidden_from_other_profile.status_code == 404


def test_attention_media_rejects_unsupported_files(tmp_path, monkeypatch):
    client, _current_profile = _client(tmp_path, monkeypatch)

    response = client.post(
        "/segments/attention-media",
        files={"file": ("notes.txt", b"not media", "text/plain")},
    )

    assert response.status_code == 400
    assert "PNG, JPEG" in response.json()["detail"]
