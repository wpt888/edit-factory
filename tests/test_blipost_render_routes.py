import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import blipost_render_routes as routes
from app.api.auth import ProfileContext


class _Response:
    def __init__(self, status_code: int, body: dict):
        self.status_code = status_code
        self._body = body

    def json(self) -> dict:
        return self._body


class _Client:
    response = _Response(200, {"revoked": True})
    error = None
    calls = []

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def delete(self, url: str, **kwargs):
        type(self).calls.append((url, kwargs))
        if type(self).error:
            raise type(self).error
        return type(self).response


class _Runner:
    def __init__(self):
        self.stopped = False

    async def stop(self):
        self.stopped = True


@pytest.fixture(autouse=True)
def _reset_client():
    _Client.response = _Response(200, {"revoked": True})
    _Client.error = None
    _Client.calls = []


@pytest.fixture
def unpair_dependencies(monkeypatch):
    runner = _Runner()
    deleted = []
    monkeypatch.setattr(routes.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(routes, "_get_render_token", lambda _profile_id: "blp_dsk_secret")
    monkeypatch.setattr(routes, "_delete_render_token", deleted.append)
    monkeypatch.setattr(
        routes,
        "get_settings",
        lambda: SimpleNamespace(blipost_platform_base_url="https://blipost.test/"),
    )
    monkeypatch.setattr("app.services.blipost_runner.get_render_runner", lambda: runner)
    return runner, deleted


def test_unpair_revokes_web_runner_before_deleting_local_token(unpair_dependencies):
    runner, deleted = unpair_dependencies

    result = asyncio.run(routes.unpair(ProfileContext(profile_id="profile-1", user_id="user-1")))

    assert result == {"status": "unpaired"}
    assert runner.stopped is True
    assert deleted == ["profile-1"]
    assert _Client.calls == [
        (
            "https://blipost.test/api/render/v1/pair",
            {"headers": {"Authorization": "Bearer blp_dsk_secret"}},
        )
    ]


def test_unpair_keeps_local_token_when_web_is_unavailable(unpair_dependencies):
    runner, deleted = unpair_dependencies
    _Client.error = OSError("offline")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(routes.unpair(ProfileContext(profile_id="profile-1", user_id="user-1")))

    assert exc_info.value.status_code == 502
    assert "remains paired locally" in exc_info.value.detail
    assert runner.stopped is True
    assert deleted == []


def test_unpair_keeps_local_token_on_invalid_success_response(unpair_dependencies):
    _runner, deleted = unpair_dependencies
    _Client.response = _Response(200, {"revoked": False})

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(routes.unpair(ProfileContext(profile_id="profile-1", user_id="user-1")))

    assert exc_info.value.status_code == 502
    assert deleted == []


def test_unpair_discards_local_token_when_web_already_revoked_it(unpair_dependencies):
    _runner, deleted = unpair_dependencies
    _Client.response = _Response(401, {"error": "invalid token"})

    result = asyncio.run(routes.unpair(ProfileContext(profile_id="profile-1", user_id="user-1")))

    assert result == {"status": "unpaired"}
    assert deleted == ["profile-1"]
