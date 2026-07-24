from contextlib import contextmanager
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import attention_routes
from app.api.attention_routes import AttentionTemplateBody
from app.api.auth import ProfileContext, get_profile_context
from app.repositories.supabase_repo import SupabaseRepository
from app.services.attention_templates import SYSTEM_TEMPLATES


class _UnavailableAttentionTemplateRepository:
    def list_attention_templates(self, profile_id: str):
        raise RuntimeError('relation "public.editai_attention_templates" does not exist')

    def create_attention_template(self, data):
        raise RuntimeError('relation "public.editai_attention_templates" does not exist')


class _RecordingAttentionTemplateRepository:
    def __init__(self):
        self.created = None

    def create_attention_template(self, data):
        self.created = data
        return data

    def list_attention_templates(self, profile_id: str):
        return [{
            "id": "template-personal",
            "profile_id": profile_id,
            "name": "Test test",
            "config": {"tracks": [[{"id": "slot-1"}]]},
        }]


class _ScopedSupabaseRepository(SupabaseRepository):
    def __init__(self):
        super().__init__()
        self.access_token = None
        self.scoped = _RecordingAttentionTemplateRepository()

    @contextmanager
    def authenticated(self, access_token: str):
        self.access_token = access_token
        yield self.scoped


def _attention_client():
    app = FastAPI()
    app.include_router(attention_routes.router)
    app.dependency_overrides[get_profile_context] = lambda: ProfileContext(
        profile_id="profile-attention",
        user_id="user-attention",
    )
    return TestClient(app, raise_server_exceptions=False)


def test_list_templates_keeps_system_library_when_personal_storage_is_unavailable(monkeypatch):
    monkeypatch.setattr(
        attention_routes,
        "get_repository",
        lambda: _UnavailableAttentionTemplateRepository(),
    )

    app = FastAPI()
    app.include_router(attention_routes.router)
    app.dependency_overrides[get_profile_context] = lambda: ProfileContext(
        profile_id="profile-attention",
        user_id="user-attention",
    )

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/attention-templates")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "templates": SYSTEM_TEMPLATES,
        "personal_templates_available": False,
    }


def test_list_templates_includes_profile_personal_templates(monkeypatch):
    monkeypatch.setattr(
        attention_routes,
        "get_repository",
        lambda: _RecordingAttentionTemplateRepository(),
    )

    with _attention_client() as client:
        response = client.get("/attention-templates")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["personal_templates_available"] is True
    assert payload["templates"][-1] == {
        "id": "template-personal",
        "name": "Test test",
        "is_system": False,
        "tracks": [[{"id": "slot-1"}]],
    }


def test_create_template_with_empty_image_slots_persists(monkeypatch):
    repo = _RecordingAttentionTemplateRepository()
    monkeypatch.setattr(attention_routes, "get_repository", lambda: repo)

    with _attention_client() as client:
        response = client.post("/attention-templates", json={
            "name": "Slots only",
            "tracks": [[
                {"id": "slot-1", "startMs": 0, "durationMs": 1200},
                {"id": "slot-2", "startMs": 1500, "durationMs": 900},
            ]],
        })

    assert response.status_code == 201, response.text
    assert response.json()["name"] == "Slots only"
    assert repo.created["profile_id"] == "profile-attention"
    assert repo.created["config"]["animation"] == "static"
    assert repo.created["config"]["tracks"][0][0]["defaultAsset"] is None


def test_create_template_forwards_caller_token_when_backend_has_only_anon_key(monkeypatch):
    repo = _ScopedSupabaseRepository()
    monkeypatch.setattr(attention_routes, "get_repository", lambda: repo)
    monkeypatch.setattr(
        attention_routes,
        "get_settings",
        lambda: SimpleNamespace(supabase_service_role_key=""),
    )

    with _attention_client() as client:
        response = client.post(
            "/attention-templates",
            headers={"Authorization": "Bearer user-access-token"},
            json={"name": "RLS scoped", "tracks": [[{"id": "slot-1"}]]},
        )

    assert response.status_code == 201, response.text
    assert repo.access_token == "user-access-token"
    assert repo.scoped.created["profile_id"] == "profile-attention"


def test_create_template_returns_readable_503_when_storage_is_unavailable(monkeypatch):
    monkeypatch.setattr(
        attention_routes,
        "get_repository",
        lambda: _UnavailableAttentionTemplateRepository(),
    )

    with _attention_client() as client:
        response = client.post("/attention-templates", json={
            "name": "Slots only",
            "tracks": [[{"id": "slot-1"}]],
        })

    assert response.status_code == 503, response.text
    assert response.json() == {"detail": attention_routes._STORAGE_UNAVAILABLE_DETAIL}


def test_template_body_accepts_additive_audio_track_and_per_slot_sfx_fields():
    body = AttentionTemplateBody.model_validate({
        "name": "Audio paired",
        "audioTrackCount": 2,
        "tracks": [[{
            "id": "slot-1",
            "sfxUrl": "https://example.com/pop.wav",
            "sfxLabel": "Pop",
            "sfxVolumeDb": -4,
            "sfxTrack": 2,
        }]],
    })

    dumped = body.model_dump()
    assert dumped["audioTrackCount"] == 2
    assert dumped["tracks"][0][0]["sfxUrl"] == "https://example.com/pop.wav"
    assert dumped["tracks"][0][0]["sfxTrack"] == 2


def test_template_body_round_trips_default_and_per_slot_entrance_effects():
    body = AttentionTemplateBody.model_validate({
        "name": "Mixed entrances",
        "animation": "fade",
        "enterMs": 350,
        "tracks": [[
            {"id": "inherits"},
            {"id": "custom", "animation": "wipe-right", "enterMs": 625},
        ]],
    })

    dumped = body.model_dump()
    assert dumped["animation"] == "fade"
    assert dumped["enterMs"] == 350
    assert dumped["tracks"][0][0]["animation"] is None
    assert dumped["tracks"][0][1]["animation"] == "wipe-right"
    assert dumped["tracks"][0][1]["enterMs"] == 625


def test_template_body_round_trips_optional_per_slot_default_content():
    # A slot may carry optional default content (image or video); slots without
    # it round-trip as None so the two authoring modes coexist.
    body = AttentionTemplateBody.model_validate({
        "name": "With defaults",
        "tracks": [[
            {"id": "slot-1", "defaultAsset": {"url": "https://cdn.test/logo.png", "type": "image"}},
            {"id": "slot-2", "defaultAsset": {"url": "https://cdn.test/loop.mp4", "type": "video"}},
            {"id": "slot-3"},
        ]],
    })

    dumped = body.model_dump()
    slots = dumped["tracks"][0]
    assert slots[0]["defaultAsset"] == {"url": "https://cdn.test/logo.png", "type": "image"}
    assert slots[1]["defaultAsset"]["type"] == "video"
    assert slots[2]["defaultAsset"] is None
