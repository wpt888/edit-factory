"""
Self-check for the Blipost Platform client (phase U1).

Runs fully offline via an httpx MockTransport that emulates the web app's
Platform API contract (social-scheduler/docs/platform-api.md). Exercises the
full flow (me → accounts → media → post → get post) plus error mapping.

Run: pytest tests/test_blipost_platform_client.py   (or: python tests/test_blipost_platform_client.py)
"""
import asyncio

import httpx

from app.services.blipost_platform_client import (
    BlipostAuthError,
    BlipostCreditsError,
    BlipostPlatformClient,
    BlipostRateLimitError,
)

TOKEN = "blp_deadbeefcafe0000deadbeefcafe0000deadbeefcafe0000"
BASE = "https://web.example"

# Captures headers seen by the mock so we can assert the token is sent (and only
# ever via the Authorization header — never anywhere it could leak to logs).
_seen_auth = []


def _handler(request: httpx.Request) -> httpx.Response:
    _seen_auth.append(request.headers.get("authorization"))
    path = request.url.path

    if path.endswith("/me"):
        return httpx.Response(200, json={"email": "a@ex.com", "plan": "starter",
                                         "credits": {"balance": 1250}})
    if path.endswith("/accounts"):
        return httpx.Response(200, json={"accounts": [
            {"id": "acc-1", "platform": "tiktok", "handle": "@x",
             "displayName": "X", "status": "active"}]})
    if path.endswith("/media"):
        return httpx.Response(201, json={"mediaId": "media-1",
                                         "uploadUrl": "https://r2.example/put/media-1"})
    if "/put/" in path:  # presigned PUT target
        return httpx.Response(200)
    if path.endswith("/posts"):
        return httpx.Response(201, json={"id": "post-1", "status": "scheduled",
                                         "scheduledAt": "2026-07-08T09:00:00.000Z"})
    if "/posts/" in path:
        return httpx.Response(200, json={"id": "post-1", "status": "published",
                                         "targets": []})
    return httpx.Response(404, json={"error": "not found"})


def _client(handler=_handler) -> BlipostPlatformClient:
    return BlipostPlatformClient(BASE, TOKEN, transport=httpx.MockTransport(handler))


def test_full_flow():
    async def run():
        c = _client()
        me = await c.get_me()
        assert me["email"] == "a@ex.com"
        assert me["credits"]["balance"] == 1250

        accounts = await c.get_accounts()
        assert accounts[0]["id"] == "acc-1"

        slot = await c.request_media_upload("reel.mp4", "video/mp4", 1000)
        assert slot["mediaId"] == "media-1"
        await c.upload_media_bytes(slot["uploadUrl"], b"x" * 10, "video/mp4")

        post = await c.create_post("hi", ["acc-1"], media_ids=["media-1"],
                                   scheduled_at="2026-07-08T09:00:00Z")
        assert post["id"] == "post-1"

        got = await c.get_post("post-1")
        assert got["status"] == "published"

        # Token travels only as `Bearer <token>` on API calls. The presigned R2
        # PUT must carry NO auth header (None) — it would leak the token to R2.
        assert f"Bearer {TOKEN}" in _seen_auth
        assert all(h in (None, f"Bearer {TOKEN}") for h in _seen_auth)
        assert None in _seen_auth  # the presigned PUT was unauthenticated, as required

    asyncio.run(run())


def test_error_mapping():
    async def run():
        def auth_fail(_req):
            return httpx.Response(401, json={"error": "revoked"})

        def credits_fail(_req):
            return httpx.Response(402, json={"error": "Insufficient credits", "balance": 3})

        try:
            await _client(auth_fail).get_me()
            assert False, "expected BlipostAuthError"
        except BlipostAuthError:
            pass

        try:
            await _client(credits_fail).create_post("x", ["a"])
            assert False, "expected BlipostCreditsError"
        except BlipostCreditsError as e:
            assert e.balance == 3

    asyncio.run(run())


def test_rate_limit_retries_then_raises():
    calls = {"n": 0}

    def always_429(_req):
        calls["n"] += 1
        return httpx.Response(429, json={"error": "rate limited"})

    async def run():
        # Patch backoff to ~0 so the test is instant.
        import app.services.blipost_platform_client as mod
        original = mod._RATE_LIMIT_BACKOFF_S
        mod._RATE_LIMIT_BACKOFF_S = 0.0
        try:
            try:
                await _client(always_429).get_me()
                assert False, "expected BlipostRateLimitError"
            except BlipostRateLimitError:
                pass
            assert calls["n"] == mod._RATE_LIMIT_RETRIES  # retried the full budget
        finally:
            mod._RATE_LIMIT_BACKOFF_S = original

    asyncio.run(run())


def test_video_flow():
    """submit → poll (generating → done) → download the presigned mp4 (D2)."""
    calls = {"polls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "POST" and path.endswith("/videos"):
            return httpx.Response(201, json={"jobId": "job-1", "creditCost": 35, "remaining": 1210})
        if "/videos/" in path:
            calls["polls"] += 1
            if calls["polls"] < 2:
                return httpx.Response(200, json={"id": "job-1", "status": "generating"})
            return httpx.Response(200, json={"id": "job-1", "status": "done",
                                             "outputMediaId": "m1",
                                             "downloadUrl": "https://r2.example/get/job-1.mp4"})
        if "/get/" in path:  # presigned download target — must carry no auth
            return httpx.Response(200, content=b"FAKEMP4")
        return httpx.Response(404, json={"error": "not found"})

    async def run():
        c = _client(handler)
        sub = await c.submit_video("a lime bottle spinning on ice", "wan-2.5", 5, "9:16")
        assert sub["jobId"] == "job-1"
        assert sub["creditCost"] == 35

        first = await c.get_video("job-1")
        assert first["status"] == "generating"
        second = await c.get_video("job-1")
        assert second["status"] == "done"
        assert second["downloadUrl"].endswith(".mp4")

        raw = await c.download_bytes(second["downloadUrl"])
        assert raw == b"FAKEMP4"

    asyncio.run(run())


def test_video_insufficient_credits():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST" and request.url.path.endswith("/videos"):
            return httpx.Response(402, json={"error": "Insufficient credits", "balance": 3})
        return httpx.Response(404, json={"error": "not found"})

    async def run():
        try:
            await _client(handler).submit_video("x", "wan-2.5", 5)
            assert False, "expected BlipostCreditsError"
        except BlipostCreditsError as e:
            assert e.balance == 3

    asyncio.run(run())


def test_video_failed_status():
    def handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "job-x", "status": "failed"})

    async def run():
        got = await _client(handler).get_video("job-x")
        assert got["status"] == "failed"

    asyncio.run(run())


def test_shared_media_and_clipping_contract():
    """Desktop and web operate on the same media ids and clipping jobs."""
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and path.endswith("/media"):
            assert request.url.params["origin"] == "clipping"
            return httpx.Response(200, json={"media": [{
                "id": "media-source", "origin": "clipping", "mimeType": "video/mp4",
                "previewUrl": "https://r2.example/get/source.mp4",
            }]})
        if request.method == "POST" and path.endswith("/clipping"):
            body = request.read()
            assert b'"durationMode":"exact"' in body
            return httpx.Response(201, json={"jobId": "clip-job", "status": "pending"})
        if request.method == "GET" and path.endswith("/clipping"):
            return httpx.Response(200, json={"jobs": [{"id": "clip-job", "status": "rendering"}]})
        if request.method == "GET" and path.endswith("/clipping/clip-job"):
            return httpx.Response(200, json={"id": "clip-job", "highlights": [{"start": 1, "end": 11}]})
        if request.method == "PATCH" and path.endswith("/clipping/clip-job"):
            return httpx.Response(200, json={"count": 1, "status": "queued"})
        return httpx.Response(404, json={"error": "not found"})

    async def run():
        client = _client(handler)
        media = await client.get_media(origin="clipping", kind="video")
        assert media[0]["id"] == "media-source"
        created = await client.create_clipping_job("media-source", {
            "durationMode": "exact", "targetDurationSec": 10, "captions": False,
        })
        assert created["jobId"] == "clip-job"
        assert (await client.list_clipping_jobs())[0]["status"] == "rendering"
        assert (await client.get_clipping_job("clip-job"))["highlights"][0]["end"] == 11
        confirmed = await client.confirm_clipping_highlights(
            "clip-job", [{"start": 1, "end": 11, "enabled": True}]
        )
        assert confirmed["count"] == 1

    asyncio.run(run())


if __name__ == "__main__":
    test_full_flow()
    test_error_mapping()
    test_rate_limit_retries_then_raises()
    test_video_flow()
    test_video_insufficient_credits()
    test_video_failed_status()
    print("blipost platform client self-check: PASS")
