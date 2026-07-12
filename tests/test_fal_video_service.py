from unittest.mock import MagicMock, patch

from app.services.fal_video_service import FalVideoGenerator


def test_seedance_queue_result_is_returned_after_completion():
    generator = FalVideoGenerator("test-key")
    generator._client = MagicMock()
    generator._client.post.return_value.json.return_value = {
        "status_url": "https://queue.test/status",
        "response_url": "https://queue.test/response",
    }
    generator._client.get.side_effect = [
        MagicMock(json=lambda: {"status": "IN_QUEUE"}),
        MagicMock(json=lambda: {"status": "COMPLETED"}),
        MagicMock(json=lambda: {"video": {"url": "https://cdn.test/video.mp4"}}),
    ]

    with patch("app.services.fal_video_service.time.sleep"):
        result = generator.generate(
            prompt="A product reveal", duration="8", aspect_ratio="9:16",
            resolution="720p", generate_audio=True, bitrate_mode="standard",
            end_user_id="profile-id",
        )

    assert result["video"]["url"] == "https://cdn.test/video.mp4"
    submit_payload = generator._client.post.call_args.kwargs["json"]
    assert submit_payload["duration"] == "8"
    assert submit_payload["generate_audio"] is True


def test_seedance_queue_failure_becomes_clear_error():
    generator = FalVideoGenerator("test-key")
    generator._client = MagicMock()
    generator._client.post.return_value.json.return_value = {
        "status_url": "https://queue.test/status",
        "response_url": "https://queue.test/response",
    }
    generator._client.get.return_value.json.return_value = {"status": "FAILED", "error": "unsafe prompt"}

    try:
        generator.generate(
            prompt="A product reveal", duration="8", aspect_ratio="9:16",
            resolution="720p", generate_audio=True, bitrate_mode="standard",
            end_user_id="profile-id",
        )
    except RuntimeError as error:
        assert "unsafe prompt" in str(error)
    else:
        raise AssertionError("Expected a failed FAL queue response to raise")
