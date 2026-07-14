import asyncio
import time
from types import SimpleNamespace

import jwt
from fastapi.security import HTTPAuthorizationCredentials

from app.api import auth
from app.api.auth import AuthUser, ensure_default_profile
from app.repositories.models import QueryResult


def test_fresh_supabase_token_allows_small_clock_skew(monkeypatch):
    secret = "test-secret-that-is-long-enough-for-hs256"
    now = int(time.time())
    token = jwt.encode(
        {
            "sub": "11111111-2222-3333-4444-555555555555",
            "email": "editor@example.com",
            "role": "authenticated",
            "aud": "authenticated",
            "iat": now + 1,
            "exp": now + 3600,
        },
        secret,
        algorithm="HS256",
    )
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: SimpleNamespace(supabase_jwt_secret=secret),
    )

    payload = auth.verify_jwt_token(token)

    assert payload["sub"] == "11111111-2222-3333-4444-555555555555"


def test_desktop_mode_requires_a_real_supabase_token(monkeypatch):
    settings = SimpleNamespace(
        auth_disabled=False,
        desktop_mode=True,
        supabase_jwt_secret="configured",
    )
    verified = []

    async def fake_verify(token: str):
        verified.append(token)
        return {
            "sub": "11111111-2222-3333-4444-555555555555",
            "email": "editor@example.com",
            "role": "authenticated",
        }

    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    monkeypatch.setattr(auth, "verify_access_token", fake_verify)

    user = asyncio.run(
        auth.get_current_user(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials="real-token"),
            None,
        )
    )

    assert verified == ["real-token"]
    assert user.id == "11111111-2222-3333-4444-555555555555"
    assert user.email == "editor@example.com"


def test_initial_profile_is_owned_by_authenticated_user():
    class FakeRepository:
        def __init__(self):
            self.rows = []

        def list_profiles(self, user_id: str):
            return QueryResult(data=[row for row in self.rows if row["user_id"] == user_id])

        def create_profile(self, data):
            self.rows.append(dict(data))
            return dict(data)

    repo = FakeRepository()
    user = AuthUser("user-123", "editor@example.com")

    first = ensure_default_profile(repo, user)
    second = ensure_default_profile(repo, user)

    assert first["id"] == second["id"]
    assert first["user_id"] == "user-123"
    assert first["is_default"] is True
    assert len(repo.rows) == 1
