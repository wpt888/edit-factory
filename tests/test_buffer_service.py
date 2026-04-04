from httpx import Request, Response

from app.services.buffer_service import _validate_public_video_response


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
