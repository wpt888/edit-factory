import asyncio
import json
import logging

import httpx
import pytest

from app.services.studio_metering import (
    MeteringIdentity,
    StudioMeteringBlocked,
    StudioMeteringClient,
    new_metering_record,
    reserve_metering_record,
    settle_metering_record,
)


IDENTITY = MeteringIdentity(
    supabase_user_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email="User@Example.com",
)


def test_web_reserve_capture_and_refund_follow_contract():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        payload = json.loads(request.content)
        assert request.headers["authorization"] == "Bearer studio-secret"
        assert payload["supabase_user_id"] == IDENTITY.supabase_user_id
        assert payload["email"] == "user@example.com"

        if request.url.path.endswith("/reserve"):
            assert payload["operation"] == "studio.tts_variant"
            assert payload["units"] == 1
            return httpx.Response(
                201,
                json={
                    "reservation_id": "reservation-1",
                    "status": "reserved",
                    "credits": 9,
                    "remaining_credits": 91,
                    "replayed": False,
                    "executable": True,
                    "result_metadata": {},
                },
            )
        if request.url.path.endswith("/capture"):
            return httpx.Response(
                200,
                json={
                    "reservation_id": "reservation-1",
                    "status": "captured",
                    "changed": True,
                    "remaining_credits": 91,
                    "result_metadata": payload["result_metadata"],
                },
            )
        return httpx.Response(
            200,
            json={
                "reservation_id": "reservation-1",
                "status": "refunded",
                "changed": True,
                "remaining_credits": 100,
                "result_metadata": {},
            },
        )

    client = StudioMeteringClient(
        base_url="https://web.example",
        token="studio-secret",
        desktop_mode=False,
        transport=httpx.MockTransport(handler),
    )
    pending = new_metering_record("studio.tts_variant", 1, "pipeline:job:tts:0")
    reserved = asyncio.run(reserve_metering_record(IDENTITY, pending, client=client))
    assert reserved["state"] == "reserved"
    assert reserved["credits"] == 9

    captured = asyncio.run(
        settle_metering_record(
            IDENTITY,
            reserved,
            delivered=True,
            result_metadata={"studio_job_id": "job"},
            client=client,
        )
    )
    assert captured["state"] == "captured"
    assert captured["result_metadata"] == {"studio_job_id": "job"}

    refunded = asyncio.run(
        settle_metering_record(
            IDENTITY,
            captured,
            delivered=False,
            client=client,
        )
    )
    assert refunded["state"] == "refunded"
    assert [request.url.path.rsplit("/", 1)[-1] for request in requests] == [
        "reserve",
        "capture",
        "refund",
    ]


def test_insufficient_credits_becomes_friendly_fail_closed_detail():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            402,
            json={
                "error": {
                    "code": "insufficient_credits",
                    "message": "Insufficient Blipost credits",
                    "available_credits": 3,
                }
            },
        )

    client = StudioMeteringClient(
        base_url="https://web.example",
        token="studio-secret",
        desktop_mode=False,
        transport=httpx.MockTransport(handler),
    )
    record = new_metering_record("studio.script_pipeline", 1, "pipeline:job:script")

    with pytest.raises(StudioMeteringBlocked) as caught:
        asyncio.run(reserve_metering_record(IDENTITY, record, client=client))

    assert caught.value.code == "insufficient_credits"
    assert caught.value.available_credits == 3
    detail = caught.value.as_http_detail()
    assert detail["billing_url"] == "https://blipost.com/billing"
    assert "enough Blipost credits" in detail["message"]


def test_bridge_transport_failure_is_fail_closed_after_retries(monkeypatch):
    attempts = 0

    async def no_wait(_: float) -> None:
        return None

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise httpx.ConnectError("offline")

    monkeypatch.setattr("app.services.studio_metering.asyncio.sleep", no_wait)
    client = StudioMeteringClient(
        base_url="https://web.example",
        token="studio-secret",
        desktop_mode=False,
        transport=httpx.MockTransport(handler),
    )
    record = new_metering_record("studio.render_output_minute", 1, "render:job:0")

    with pytest.raises(StudioMeteringBlocked) as caught:
        asyncio.run(reserve_metering_record(IDENTITY, record, client=client))

    assert attempts == 3
    assert caught.value.code == "metering_unavailable"
    assert "not started" in caught.value.as_http_detail()["message"]


def test_reserved_replay_requires_durable_proof_provider_not_started():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "reservation_id": "reservation-replay",
                "status": "reserved",
                "credits": 2,
                "remaining_credits": 98,
                "replayed": True,
                "executable": False,
                "result_metadata": {},
            },
        )

    client = StudioMeteringClient(
        base_url="https://web.example",
        token="studio-secret",
        desktop_mode=False,
        transport=httpx.MockTransport(handler),
    )
    record = new_metering_record("studio.script_pipeline", 1, "pipeline:job:script")
    replay = asyncio.run(client.reserve(IDENTITY, record, provider_not_started=True))
    assert replay["state"] == "reserved"
    assert replay["replayed"] is True

    started = {**record, "provider_started": True}
    with pytest.raises(StudioMeteringBlocked) as caught:
        asyncio.run(client.reserve(IDENTITY, started, provider_not_started=False))
    assert caught.value.code == "reservation_not_executable"


def test_desktop_mode_logs_usage_without_network(caplog):
    def forbidden(_: httpx.Request) -> httpx.Response:
        raise AssertionError("desktop metering must not call the web bridge")

    client = StudioMeteringClient(
        base_url="https://web.example",
        token="",
        desktop_mode=True,
        transport=httpx.MockTransport(forbidden),
    )
    record = new_metering_record("studio.seedance_clip", 1, "video:job:seedance")

    with caplog.at_level(logging.INFO, logger="app.services.studio_metering"):
        reserved = asyncio.run(reserve_metering_record(IDENTITY, record, client=client))
        captured = asyncio.run(
            settle_metering_record(
                IDENTITY,
                reserved,
                delivered=True,
                client=client,
            )
        )
        released = asyncio.run(
            settle_metering_record(
                IDENTITY,
                reserved,
                delivered=False,
                client=client,
            )
        )

    assert reserved["mode"] == "desktop"
    assert captured["state"] == "captured"
    assert released["state"] == "released"
    assert "event=reserve" in caplog.text
    assert "event=capture" in caplog.text
    assert "event=refund" in caplog.text


def test_failed_settlement_remains_durable_and_retryable():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            503,
            json={"error": {"code": "metering_unavailable", "message": "offline"}},
        )

    client = StudioMeteringClient(
        base_url="https://web.example",
        token="studio-secret",
        desktop_mode=False,
        transport=httpx.MockTransport(handler),
    )
    reserved = {
        **new_metering_record("studio.tts_variant", 1, "pipeline:job:tts:0"),
        "reservation_id": "reservation-1",
        "state": "reserved",
        "mode": "web",
    }

    pending = asyncio.run(
        settle_metering_record(
            IDENTITY,
            reserved,
            delivered=False,
            client=client,
        )
    )
    assert pending["state"] == "refund_pending"
    assert pending["last_error"]["code"] == "metering_unavailable"
