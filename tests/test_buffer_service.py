import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock, patch

from httpx import Request, Response

from app.services.buffer_service import BufferPublisher, _validate_public_video_response


def test_create_post_uses_current_buffer_video_asset_schema():
    publisher = BufferPublisher("api-key", "organization-id")
    captured = {}

    async def fake_graphql(query, variables=None, timeout=30.0):
        captured.update(query=query, variables=variables, timeout=timeout)
        return {
            "createPost": {
                "post": {
                    "id": "post-1",
                    "status": "scheduled",
                    "dueAt": "2026-07-25T06:00:00.000Z",
                }
            }
        }

    publisher._graphql = fake_graphql
    schedule_date = datetime(
        2026,
        7,
        25,
        9,
        0,
        tzinfo=timezone(timedelta(hours=3)),
    )

    result = asyncio.run(
        publisher.create_post(
            video_url="https://media.example/video.mp4",
            channel_id="tiktok-channel",
            caption='Caption with "quotes"',
            schedule_date=schedule_date,
            tiktok_title="Video title",
        )
    )

    assert result.success is True
    assert captured["timeout"] == 60.0
    assert "$input: CreatePostInput!" in captured["query"]
    assert "MutationError" in captured["query"]
    assert captured["variables"] == {
        "input": {
            "text": 'Caption with "quotes"',
            "channelId": "tiktok-channel",
            "schedulingType": "automatic",
            "mode": "customScheduled",
            "assets": [
                {
                    "video": {
                        "url": "https://media.example/video.mp4",
                        "metadata": {"title": "Video title"},
                    }
                }
            ],
            "dueAt": "2026-07-25T06:00:00.000Z",
        }
    }


def test_scheduled_post_does_not_start_early_cleanup_monitor():
    publisher = BufferPublisher("api-key", "organization-id")
    scheduled_for = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)

    with patch("app.services.buffer_service.threading.Thread") as thread:
        publisher.schedule_cleanup_monitor(
            post_id="post-1",
            storage_path="video.mp4",
            schedule_date=scheduled_for,
        )

    thread.assert_not_called()


def test_cleanup_does_not_delete_media_for_scheduled_status():
    publisher = BufferPublisher("api-key", "organization-id")
    publisher.get_post_status = AsyncMock(
        return_value={"status": "scheduled", "is_processing": False}
    )
    publisher.delete_from_storage = Mock(return_value=True)

    with patch(
        "app.services.buffer_service._async_sleep",
        new=AsyncMock(),
    ):
        asyncio.run(
            publisher.wait_and_cleanup(
                post_id="post-1",
                storage_path="video.mp4",
                max_wait=181,
                poll_interval=1,
            )
        )

    publisher.delete_from_storage.assert_not_called()


def test_cleanup_deletes_media_after_final_status():
    publisher = BufferPublisher("api-key", "organization-id")
    publisher.get_post_status = AsyncMock(
        return_value={"status": "sent", "is_processing": False}
    )
    publisher.delete_from_storage = Mock(return_value=True)

    with patch(
        "app.services.buffer_service._async_sleep",
        new=AsyncMock(),
    ):
        asyncio.run(
            publisher.wait_and_cleanup(
                post_id="post-1",
                storage_path="video.mp4",
                max_wait=181,
                poll_interval=1,
            )
        )

    publisher.delete_from_storage.assert_called_once_with("video.mp4")


def test_validate_public_video_response_accepts_video_headers():
    response = Response(
        200,
        headers={
            "content-type": "video/mp4",
            "content-length": "1234",
            "accept-ranges": "bytes",
        },
        request=Request("GET", "https://example.com/video.mp4"),
    )

    result = _validate_public_video_response(response, expected_size=1234)

    assert result["status_code"] == 200
    assert result["content_type"] == "video/mp4"
    assert result["content_length"] == "1234"
    assert result["accept_ranges"] == "bytes"


def test_validate_public_video_response_accepts_octet_stream():
    response = Response(
        206,
        headers={
            "content-type": "application/octet-stream",
            "content-length": "1",
        },
        request=Request("GET", "https://example.com/video.mp4"),
    )

    result = _validate_public_video_response(response, expected_size=999)

    assert result["status_code"] == 206
    assert result["content_type"] == "application/octet-stream"


def test_validate_public_video_response_rejects_non_video_content_type():
    response = Response(
        200,
        headers={"content-type": "text/html"},
        request=Request("GET", "https://example.com/video.mp4"),
    )

    try:
        _validate_public_video_response(response)
    except Exception as exc:
        assert "Unexpected Content-Type" in str(exc)
    else:
        raise AssertionError("Expected validation to fail for non-video content type")
