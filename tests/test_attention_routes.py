from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import attention_routes
from app.api.attention_routes import AttentionTemplateBody
from app.api.auth import ProfileContext, get_profile_context
from app.services.attention_templates import SYSTEM_TEMPLATES


class _UnavailableAttentionTemplateRepository:
    def list_attention_templates(self, profile_id: str):
        raise RuntimeError('relation "public.editai_attention_templates" does not exist')


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
    assert response.json() == {"templates": SYSTEM_TEMPLATES}


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
