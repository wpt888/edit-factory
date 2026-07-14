import asyncio

import httpx
import pytest

from app.api import blipost_platform_routes as routes


class _Settings:
    blipost_platform_base_url = "https://blipost.example"


class _FakeAsyncClient:
    response = httpx.Response(
        200,
        json={
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "expires_in": 3600,
            "token_type": "bearer",
        },
    )
    request_json = None
    request_url = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, json):
        type(self).request_url = url
        type(self).request_json = json
        return type(self).response


def test_blipost_credentials_are_exchanged_without_local_persistence(monkeypatch):
    monkeypatch.setattr(routes, "get_settings", lambda: _Settings())
    monkeypatch.setattr(routes.httpx, "AsyncClient", _FakeAsyncClient)

    result = asyncio.run(
        routes.create_blipost_session(
            routes.BlipostSessionRequest(email=" Owner@Example.com ", password="secret")
        )
    )

    assert result.access_token == "access-token"
    assert result.refresh_token == "refresh-token"
    assert _FakeAsyncClient.request_url == "https://blipost.example/api/desktop/v1/session"
    assert _FakeAsyncClient.request_json == {
        "email": "owner@example.com",
        "password": "secret",
    }


def test_invalid_blipost_credentials_map_to_401(monkeypatch):
    monkeypatch.setattr(routes, "get_settings", lambda: _Settings())
    monkeypatch.setattr(routes.httpx, "AsyncClient", _FakeAsyncClient)
    _FakeAsyncClient.response = httpx.Response(401, json={"error": "invalid"})

    with pytest.raises(routes.HTTPException) as exc_info:
        asyncio.run(
            routes.create_blipost_session(
                routes.BlipostSessionRequest(email="owner@example.com", password="wrong")
            )
        )

    assert exc_info.value.status_code == 401
    assert "password" in exc_info.value.detail.lower()
