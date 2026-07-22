"""Phase 87 — ML feature flag + subscription tier gating tests.

Verifies:
  - 412 ml_not_installed when <base_dir>/ml/.installed is absent (ML-04)
  - 402 tier_insufficient when JWT subscription_tier < pro (ML-05)
  - Inline conditional gate on /generate-from-segments respects mute_source_voice=False
  - Dev/desktop bypass for tier check (matches existing pattern in auth.py)

Reuses Phase 86 LD-12 pattern: httpx.ASGITransport + asyncio.run() + monkeypatching.
"""
import asyncio
import io

import httpx
import pytest
from httpx import ASGITransport

from app.main import app as fastapi_app
from app.api import ml_gating, auth as auth_module
from app.api.auth import get_profile_context, ProfileContext
from app.api import ml_gating as ml_gating_module
from app.config import get_settings


# ============== Fixtures ==============

@pytest.fixture(autouse=True)
def _override_profile_context():
    """Short-circuit get_profile_context so tests don't hit the profile DB lookup.

    Without this override:
      - With auth_disabled=True, get_profile_context (auth.py:244-293) queries the
        profiles table and raises HTTPException(422) "No profile available..." when
        no rows exist. Tests would observe 422, not the gate's intended 412/402.
      - In production mode, get_profile_context → get_current_user calls the REAL
        app.api.auth.verify_jwt_token on "fake-token", which fails jwt.decode() and
        raises HTTPException(401). Tests would observe 401, not 402.

    Solution: override the FastAPI dependency entirely. The returned ProfileContext
    satisfies the route signature with a stable profile_id/user_id pair (mirrors the
    sqlite_backend fixture's seeded profile in tests/conftest.py for consistency).
    """
    fastapi_app.dependency_overrides[get_profile_context] = lambda: ProfileContext(
        profile_id="test-profile-001",
        user_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    )
    yield
    # Teardown — leave no lingering override that could affect later test files
    fastapi_app.dependency_overrides.pop(get_profile_context, None)


@pytest.fixture
def fake_base_dir(tmp_path, monkeypatch):
    """Point get_base_dir() (as imported by ml_gating) to a tmp_path. Returns the tmp path."""
    monkeypatch.setattr(ml_gating, "get_base_dir", lambda: tmp_path)
    (tmp_path / "ml").mkdir(parents=True, exist_ok=True)
    return tmp_path


@pytest.fixture
def marker_present(fake_base_dir):
    """Create the .installed marker. Returns the tmp path with marker."""
    (fake_base_dir / "ml" / ".installed").write_text("0.1.0\n", encoding="utf-8")
    return fake_base_dir


@pytest.fixture
def force_production_mode(monkeypatch):
    """Disable both auth_disabled and desktop_mode so tier check is NOT bypassed.
    Default settings have both False, but pin them explicitly so tests don't drift
    when other tests leave settings in dev-bypass state.
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_disabled", False)
    monkeypatch.setattr(settings, "desktop_mode", False)
    # Provide a non-empty jwt_secret so verify_jwt_token would not 500 on missing
    # config if a code path bypassed our monkeypatches (defense in depth).
    monkeypatch.setattr(settings, "supabase_jwt_secret", "test-secret-not-real")
    return settings


def _mock_jwt_with_tier(monkeypatch, tier):
    """Replace verify_jwt_token on BOTH bound references so neither call path hits the real decoder.

    Why both bindings:
      - ml_gating.verify_jwt_token is the local copy `require_tier` uses.
      - auth_module.verify_jwt_token is the original — get_current_user (called via
        the un-overridden auth chain) would reach for it if our dependency_overrides
        ever stopped short-circuiting get_profile_context. Belt-and-suspenders.
    """
    def _fake(token):
        payload = {
            "sub": "user-001",
            "email": "test@example.com",
            "role": "authenticated",
        }
        if tier is not None:
            payload["subscription_tier"] = tier
        return payload

    monkeypatch.setattr(ml_gating_module, "verify_jwt_token", _fake)
    monkeypatch.setattr(auth_module, "verify_jwt_token", _fake)


async def _post(client, url, **kwargs):
    return await client.post(url, **kwargs)


# ============== ML-04: 412 ml_not_installed ==============

def test_clone_voice_412_when_marker_missing(fake_base_dir, monkeypatch):
    """POST /api/v1/tts/clone-voice without <base_dir>/ml/.installed → 412 + feature=voice_clone."""
    # marker is ABSENT (fake_base_dir does not create it).
    # We need the tier check bypassed so the ML check runs first. Setting
    # auth_disabled=True does that AND, combined with the autouse
    # dependency_overrides fixture, prevents the 422 "No profile available" trap.
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_disabled", True)

    async def _run():
        async with httpx.AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as client:
            files = {"audio_file": ("sample.wav", io.BytesIO(b"fake-bytes"), "audio/wav")}
            data = {"voice_name": "test"}
            return await _post(client, "/api/v1/tts/clone-voice", files=files, data=data)

    response = asyncio.run(_run())
    assert response.status_code == 412, f"expected 412 got {response.status_code} body={response.text}"
    body = response.json()
    # FastAPI wraps custom detail dicts under "detail" key
    detail = body.get("detail", body)
    assert detail == {"error": "ml_not_installed", "feature": "voice_clone"}, \
        f"unexpected body: {body}"


def test_generate_from_segments_412_when_mute_true_and_marker_missing(fake_base_dir, monkeypatch):
    """POST .../generate-from-segments with mute_source_voice=true and no marker → 412 feature=voice_mute.

    ORDERING INVARIANT: the ML gate fires BEFORE verify_project_ownership (Task 2 places
    the inline _enforce_ml_installed call after settings.ensure_dirs() but BEFORE
    verify_project_ownership). That ordering is what allows this test to pass a bogus
    project_id and still observe 412 from the gate rather than 404 from ownership check.

    If a future refactor moves the gate AFTER verify_project_ownership, this test will
    start returning 404 (bogus UUID has no matching row) instead of 412 — that is the
    regression signal. Seed a real project_id then, or restore the original ordering.
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_disabled", True)

    async def _run():
        async with httpx.AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as client:
            return await _post(
                client,
                "/api/v1/library/projects/00000000-0000-0000-0000-000000000000/generate-from-segments",
                json={"variant_count": 1, "mute_source_voice": True, "selection_mode": "random", "target_duration": 30},
            )

    response = asyncio.run(_run())
    assert response.status_code == 412, f"expected 412 got {response.status_code} body={response.text}"
    body = response.json()
    detail = body.get("detail", body)
    assert detail == {"error": "ml_not_installed", "feature": "voice_mute"}, \
        f"unexpected body: {body}"


def test_generate_from_segments_skips_ml_when_mute_false(fake_base_dir, monkeypatch):
    """Positive control — mute_source_voice=False MUST NOT hit ml_not_installed.

    The route may return other errors (404 project-not-found, 422 validation) but
    MUST NOT return 412 with ml_not_installed. This protects against the anti-pattern
    of using Depends() for a body-field gate.
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_disabled", True)

    async def _run():
        async with httpx.AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as client:
            return await _post(
                client,
                "/api/v1/library/projects/00000000-0000-0000-0000-000000000000/generate-from-segments",
                json={"variant_count": 1, "mute_source_voice": False, "selection_mode": "random", "target_duration": 30},
            )

    response = asyncio.run(_run())
    # We don't care which error — only that it's NOT a 412 ml_not_installed.
    if response.status_code == 412:
        body = response.json()
        detail = body.get("detail", body)
        assert detail != {"error": "ml_not_installed", "feature": "voice_mute"}, \
            "mute_source_voice=False MUST NOT trigger ml_not_installed gate"


# ============== ML-05: 402 tier_insufficient ==============

def test_clone_voice_402_when_tier_below_pro(marker_present, force_production_mode, monkeypatch):
    """JWT carries subscription_tier=starter → 402 tier_insufficient requires_tier=pro.

    Production mode is pinned by force_production_mode (auth_disabled=False AND
    desktop_mode=False). The autouse dependency_overrides fixture keeps the profile
    lookup from short-circuiting to 422. Both verify_jwt_token bindings are patched
    so neither call path attempts to decode "fake-token".
    """
    _mock_jwt_with_tier(monkeypatch, "starter")

    async def _run():
        async with httpx.AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as client:
            files = {"audio_file": ("sample.wav", io.BytesIO(b"fake-bytes"), "audio/wav")}
            data = {"voice_name": "test"}
            return await _post(
                client,
                "/api/v1/tts/clone-voice",
                files=files,
                data=data,
                headers={"Authorization": "Bearer fake-token"},
            )

    response = asyncio.run(_run())
    assert response.status_code == 402, f"expected 402 got {response.status_code} body={response.text}"
    body = response.json()
    detail = body.get("detail", body)
    assert detail == {"error": "tier_insufficient", "requires_tier": "pro"}, \
        f"unexpected body: {body}"


def test_tier_bypass_when_auth_disabled(marker_present, monkeypatch):
    """auth_disabled=True → tier check bypassed (must NOT return 402)."""
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_disabled", True)

    async def _run():
        async with httpx.AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as client:
            files = {"audio_file": ("sample.wav", io.BytesIO(b"fake-bytes"), "audio/wav")}
            data = {"voice_name": "test"}
            return await _post(client, "/api/v1/tts/clone-voice", files=files, data=data)

    response = asyncio.run(_run())
    # Gate must NOT be 402. Other errors (400/422 from multipart/duration validation) acceptable.
    assert response.status_code != 402, \
        f"tier check should be bypassed but got 402: {response.text}"


def test_tier_bypass_when_desktop_mode(marker_present, monkeypatch):
    """desktop_mode=True → tier check bypassed (must NOT return 402)."""
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_disabled", False)
    monkeypatch.setattr(settings, "desktop_mode", True)

    async def _run():
        async with httpx.AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as client:
            files = {"audio_file": ("sample.wav", io.BytesIO(b"fake-bytes"), "audio/wav")}
            data = {"voice_name": "test"}
            return await _post(client, "/api/v1/tts/clone-voice", files=files, data=data)

    response = asyncio.run(_run())
    assert response.status_code != 402, \
        f"tier check should be bypassed but got 402: {response.text}"


# ============== Combined: gates pass when marker + tier OK ==============

def test_clone_voice_passes_gates_with_marker_and_pro(marker_present, force_production_mode, monkeypatch):
    """Positive E2E: marker present + JWT pro-tier → BOTH gates pass.

    Production mode + autouse dependency_overrides for profile + BOTH JWT bindings
    patched. The downstream multipart/duration validation may still fail (we send
    fake bytes, not a real audio file), but neither 412 nor 402 may appear.
    """
    _mock_jwt_with_tier(monkeypatch, "pro")

    async def _run():
        async with httpx.AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as client:
            files = {"audio_file": ("sample.wav", io.BytesIO(b"fake-bytes"), "audio/wav")}
            data = {"voice_name": "test"}
            return await _post(
                client,
                "/api/v1/tts/clone-voice",
                files=files,
                data=data,
                headers={"Authorization": "Bearer fake-token"},
            )

    response = asyncio.run(_run())
    assert response.status_code not in (412, 402), \
        f"gates should pass but got {response.status_code}: {response.text}"
