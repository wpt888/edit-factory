import asyncio
from http.cookies import SimpleCookie
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request, Response

from app.api import media_session
from app.api.auth import ProfileContext


TEST_KEY = b"source-media-test-key-32-bytes!!"


def _request(client_host: str = "127.0.0.1", scheme: str = "http") -> Request:
    return Request({
        "type": "http",
        "method": "GET",
        "scheme": scheme,
        "path": "/api/v1/segments/source-videos/video-id/stream",
        "query_string": b"",
        "headers": [],
        "client": (client_host, 50000),
        "server": ("127.0.0.1", 8000),
    })


def test_media_session_round_trip():
    profile = ProfileContext(profile_id="profile-id", user_id="user-id")
    token = media_session._encode_media_session(profile, now=1000, key=TEST_KEY)

    decoded = media_session._decode_media_session(token, now=1001, key=TEST_KEY)

    assert decoded == profile


def test_media_session_rejects_tampering_and_expiry():
    profile = ProfileContext(profile_id="profile-id", user_id="user-id")
    token = media_session._encode_media_session(profile, now=1000, key=TEST_KEY)

    with pytest.raises(HTTPException) as tampered:
        media_session._decode_media_session(f"{token}x", now=1001, key=TEST_KEY)
    assert tampered.value.status_code == 401

    with pytest.raises(HTTPException) as expired:
        media_session._decode_media_session(
            token,
            now=1000 + media_session.SOURCE_MEDIA_TTL_SECONDS + 1,
            key=TEST_KEY,
        )
    assert expired.value.status_code == 401


def test_desktop_media_cookie_authenticates_matching_profile(tmp_path, monkeypatch):
    settings = SimpleNamespace(desktop_mode=True, base_dir=tmp_path, auth_disabled=False)
    monkeypatch.setattr(media_session, "get_settings", lambda: settings)
    monkeypatch.setattr(media_session, "_signing_key", TEST_KEY)

    expected = ProfileContext(profile_id="profile-id", user_id="user-id")
    response = Response()
    issued = asyncio.run(media_session.get_profile_context_with_media_session(
        _request(), response, expected
    ))
    assert issued == expected

    cookies = SimpleCookie()
    cookies.load(response.headers["set-cookie"])
    token = cookies[media_session.SOURCE_MEDIA_COOKIE].value

    resolved = asyncio.run(media_session.get_source_media_profile_context(
        request=_request(),
        profile_id="profile-id",
        media_session=token,
        credentials=None,
        authorization=None,
        x_profile_id=None,
    ))
    assert resolved == expected

    with pytest.raises(HTTPException) as mismatch:
        asyncio.run(media_session.get_source_media_profile_context(
            request=_request(),
            profile_id="another-profile",
            media_session=token,
            credentials=None,
            authorization=None,
            x_profile_id=None,
        ))
    assert mismatch.value.status_code == 403

    with pytest.raises(HTTPException) as remote:
        asyncio.run(media_session.get_source_media_profile_context(
            request=_request(client_host="10.0.0.10"),
            profile_id="profile-id",
            media_session=token,
            credentials=None,
            authorization=None,
            x_profile_id=None,
        ))
    assert remote.value.status_code == 403


def test_hosted_media_cookie_is_secure_and_authenticates_remote_request(tmp_path, monkeypatch):
    settings = SimpleNamespace(desktop_mode=False, base_dir=tmp_path, auth_disabled=False)
    monkeypatch.setattr(media_session, "get_settings", lambda: settings)
    monkeypatch.setattr(media_session, "_signing_key", TEST_KEY)

    expected = ProfileContext(profile_id="profile-id", user_id="user-id")
    response = Response()
    issued = asyncio.run(media_session.get_profile_context_with_media_session(
        _request(client_host="10.0.0.10", scheme="https"), response, expected
    ))
    assert issued == expected

    cookies = SimpleCookie()
    cookies.load(response.headers["set-cookie"])
    cookie = cookies[media_session.SOURCE_MEDIA_COOKIE]
    assert cookie["secure"]
    assert cookie["httponly"]
    assert cookie["samesite"].lower() == "lax"
    # Segment and library media live under different namespaces. The cookie is
    # delivered to both, but only explicitly opted-in endpoints accept it.
    assert cookie["path"] == "/api/v1"

    resolved = asyncio.run(media_session.get_source_media_profile_context(
        request=_request(client_host="10.0.0.10", scheme="https"),
        profile_id="profile-id",
        media_session=cookie.value,
        credentials=None,
        authorization=None,
        x_profile_id=None,
    ))
    assert resolved == expected


def test_library_file_route_accepts_media_session_dependency():
    from app.api import library_routes

    route = next(
        route
        for route in library_routes.router.routes
        if getattr(route, "path", None) == "/library/files/{file_path:path}"
    )
    dependency_calls = {dependency.call for dependency in route.dependant.dependencies}

    assert media_session.get_source_media_profile_context in dependency_calls


def test_pipeline_status_refreshes_media_session():
    from app.api import pipeline_routes

    route = next(
        route
        for route in pipeline_routes.router.routes
        if getattr(route, "path", None) == "/pipeline/status/{pipeline_id}"
    )
    dependency_calls = {dependency.call for dependency in route.dependant.dependencies}

    assert media_session.get_profile_context_with_media_session in dependency_calls


def test_desktop_signing_key_is_reused(tmp_path, monkeypatch):
    key_path = tmp_path / "cache" / ".source_media_session.key"
    expected_key = bytes(range(32))
    monkeypatch.setattr(media_session.secrets, "token_bytes", lambda size: expected_key)

    first = media_session._read_or_create_desktop_key(key_path)
    second = media_session._read_or_create_desktop_key(key_path)

    assert first == expected_key
    assert second == first
    assert key_path.read_bytes() == expected_key
