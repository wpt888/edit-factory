"""
Integration tests for /api/v1 core routes.

Tests verify response status codes and response structure (required fields, error shape).
No live Supabase, FFmpeg, or ElevenLabs required — all external services are mocked.

Endpoints covered:
  GET  /api/v1/health
  POST /api/v1/jobs  (upload)
  GET  /api/v1/jobs/{job_id}
  GET  /api/v1/jobs
  POST /api/v1/jobs/{job_id}/cancel
  DELETE /api/v1/jobs/{job_id}
  POST /api/v1/tts/generate
  GET  /api/v1/costs
"""
import io
import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------

class TestHealthEndpoint:
    """GET /api/v1/health"""

    def test_health_returns_200(self, client):
        """Health endpoint returns HTTP 200."""
        response = client.get("/api/v1/health")
        assert response.status_code == 200

    def test_health_response_structure(self, client):
        """Health response contains required fields: status, version, ffmpeg_available, redis_available."""
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        body = response.json()
        assert "status" in body, f"Missing 'status' in health response: {body}"
        assert "version" in body, f"Missing 'version' in health response: {body}"
        assert "ffmpeg_available" in body, f"Missing 'ffmpeg_available' in health response: {body}"
        assert "redis_available" in body, f"Missing 'redis_available' in health response: {body}"

    def test_health_status_is_string(self, client):
        """Health status field is a string (healthy or degraded)."""
        response = client.get("/api/v1/health")
        body = response.json()
        assert isinstance(body["status"], str)
        assert body["status"] in ("healthy", "degraded")

    def test_health_ffmpeg_available_is_bool(self, client):
        """ffmpeg_available field is a boolean."""
        response = client.get("/api/v1/health")
        body = response.json()
        assert isinstance(body["ffmpeg_available"], bool)


# ---------------------------------------------------------------------------
# Jobs list endpoint
# ---------------------------------------------------------------------------

class TestListJobs:
    """GET /api/v1/jobs"""

    def test_list_jobs_returns_200(self, client):
        """List jobs endpoint returns HTTP 200."""
        response = client.get("/api/v1/jobs")
        assert response.status_code == 200

    def test_list_jobs_returns_dict_with_jobs_key(self, client):
        """List jobs response contains a 'jobs' key with a list."""
        response = client.get("/api/v1/jobs")
        body = response.json()
        assert "jobs" in body, f"Missing 'jobs' key in response: {body}"
        assert isinstance(body["jobs"], list)

    def test_list_jobs_empty_initially(self, client):
        """List jobs returns empty list when no jobs exist."""
        response = client.get("/api/v1/jobs")
        body = response.json()
        assert body["jobs"] == []


# ---------------------------------------------------------------------------
# Job status endpoint
# ---------------------------------------------------------------------------

class TestGetJobStatus:
    """GET /api/v1/jobs/{job_id}"""

    def test_get_job_not_found_returns_404(self, client):
        """Getting a nonexistent job returns 404."""
        response = client.get("/api/v1/jobs/nonexistent-job-id")
        assert response.status_code == 404

    def test_get_job_not_found_has_detail(self, client):
        """404 response for missing job contains 'detail' field."""
        response = client.get("/api/v1/jobs/nonexistent-job-id")
        body = response.json()
        assert "detail" in body, f"Missing 'detail' in 404 response: {body}"

    def test_get_job_not_found_detail_is_string(self, client):
        """detail field is a non-empty string for 404 responses."""
        response = client.get("/api/v1/jobs/nonexistent-job-id")
        body = response.json()
        assert isinstance(body["detail"], str)
        assert len(body["detail"]) > 0


# ---------------------------------------------------------------------------
# Job cancel endpoint
# ---------------------------------------------------------------------------

class TestCancelJob:
    """POST /api/v1/jobs/{job_id}/cancel"""

    def test_cancel_nonexistent_job_returns_404(self, client):
        """Cancelling a nonexistent job returns 404."""
        response = client.post("/api/v1/jobs/fake-job-id/cancel")
        assert response.status_code == 404

    def test_cancel_nonexistent_job_has_detail(self, client):
        """Cancel 404 response contains 'detail' field."""
        response = client.post("/api/v1/jobs/fake-job-id/cancel")
        body = response.json()
        assert "detail" in body, f"Missing 'detail' in cancel 404 response: {body}"


# ---------------------------------------------------------------------------
# Job delete endpoint
# ---------------------------------------------------------------------------

class TestDeleteJob:
    """DELETE /api/v1/jobs/{job_id}"""

    def test_delete_nonexistent_job_returns_404(self, client):
        """Deleting a nonexistent job returns 404."""
        response = client.delete("/api/v1/jobs/fake-job-id")
        assert response.status_code == 404

    def test_delete_nonexistent_job_has_detail(self, client):
        """Delete 404 response contains 'detail' field."""
        response = client.delete("/api/v1/jobs/fake-job-id")
        body = response.json()
        assert "detail" in body, f"Missing 'detail' in delete 404 response: {body}"


# ---------------------------------------------------------------------------
# Upload (create job) endpoint
# ---------------------------------------------------------------------------

class TestUploadEndpoint:
    """POST /api/v1/jobs"""

    def test_upload_no_file_returns_422(self, client):
        """Uploading without a video file returns 422 Unprocessable Entity."""
        response = client.post("/api/v1/jobs")
        assert response.status_code == 422

    def test_upload_no_file_has_detail(self, client):
        """422 response from missing file contains 'detail' field."""
        response = client.post("/api/v1/jobs")
        body = response.json()
        assert "detail" in body, f"Missing 'detail' in 422 response: {body}"

    def test_upload_invalid_mime_returns_400(self, client):
        """Uploading a text file (invalid MIME) returns 400 when python-magic is available."""
        fake_text_content = b"This is not a video file, just plain text content for testing."
        files = {"video": ("test.txt", io.BytesIO(fake_text_content), "text/plain")}
        # Mock validate_file_mime_type to simulate MIME rejection (testing the validation pathway)
        from fastapi import HTTPException

        async def mock_mime_validator(file, allowed_mimes, label):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid {label} file type. Detected: text/plain. Allowed types: video/mp4"
            )

        with patch("app.api.routes.validate_file_mime_type", side_effect=mock_mime_validator):
            response = client.post("/api/v1/jobs", files=files)

        assert response.status_code == 400
        body = response.json()
        assert "detail" in body, f"Missing 'detail' in 400 MIME response: {body}"

    def test_upload_video_returns_job_or_4xx(self, client):
        """Uploading a minimal binary file returns either a job response or a 4xx (MIME rejection).

        We do not require a real video — just verify the response shape.
        Valid video: job_id in response. Invalid MIME: detail in response.
        """
        # Use bytes that look like a minimal MP4 ftyp box (magic number: 0x66 0x74 0x79 0x70)
        # This helps pass MIME validation if python-magic is available
        fake_mp4_header = (
            b"\x00\x00\x00\x1c" +  # box size
            b"ftyp" +               # box type: ftyp
            b"mp42" +               # major brand
            b"\x00\x00\x00\x00" +  # minor version
            b"mp42mp41isomiso2"     # compatible brands
        )
        files = {"video": ("test.mp4", io.BytesIO(fake_mp4_header), "video/mp4")}
        response = client.post("/api/v1/jobs", files=files)

        # The endpoint will accept (200 with job_id) or reject for MIME (400)
        # or reject as bad request (422). Any of these is valid; test the SHAPE.
        assert response.status_code in (200, 400, 422), (
            f"Unexpected status {response.status_code}: {response.text}"
        )
        body = response.json()
        if response.status_code == 200:
            assert "job_id" in body, f"200 response missing 'job_id': {body}"
            assert "status" in body, f"200 response missing 'status': {body}"
        else:
            assert "detail" in body, f"Error response missing 'detail': {body}"


# ---------------------------------------------------------------------------
# TTS generate endpoint
# ---------------------------------------------------------------------------

class TestTTSGenerate:
    """POST /api/v1/tts/generate"""

    def test_tts_missing_text_returns_422(self, client):
        """TTS generate without required 'text' field returns 422."""
        response = client.post("/api/v1/tts/generate")
        assert response.status_code == 422

    def test_tts_missing_text_has_detail(self, client):
        """422 response from missing text field contains 'detail' key."""
        response = client.post("/api/v1/tts/generate")
        body = response.json()
        assert "detail" in body, f"Missing 'detail' in TTS 422 response: {body}"

    def test_tts_generate_returns_job_id(self, client):
        """TTS generate with valid text returns a job_id in the response."""
        data = {"text": "Hello world, this is a test."}
        response = client.post("/api/v1/tts/generate", data=data)
        # Should be 200 (job created) — background task may fail later without ElevenLabs
        assert response.status_code == 200, (
            f"Expected 200, got {response.status_code}: {response.text}"
        )
        body = response.json()
        assert "job_id" in body, f"Missing 'job_id' in TTS response: {body}"

    def test_tts_generate_response_structure(self, client):
        """TTS generate response contains required JobResponse fields."""
        data = {"text": "Test text for TTS generation."}
        response = client.post("/api/v1/tts/generate", data=data)
        assert response.status_code == 200
        body = response.json()
        assert "job_id" in body
        assert "status" in body
        assert body["status"] == "pending"

    def test_tts_empty_text_returns_400(self, client):
        """TTS generate with empty text string returns 400 (text validation)."""
        data = {"text": "   "}
        response = client.post("/api/v1/tts/generate", data=data)
        assert response.status_code == 400
        body = response.json()
        assert "detail" in body


# ---------------------------------------------------------------------------
# Costs endpoint
# ---------------------------------------------------------------------------

class TestCostsEndpoint:
    """GET /api/v1/costs"""

    def test_costs_returns_200(self, client):
        """Costs endpoint returns HTTP 200."""
        response = client.get("/api/v1/costs")
        assert response.status_code == 200

    def test_costs_response_has_required_fields(self, client):
        """Costs response contains source, entry_count, totals, and total_all fields."""
        response = client.get("/api/v1/costs")
        assert response.status_code == 200
        body = response.json()
        assert "source" in body, f"Missing 'source' in costs response: {body}"
        assert "entry_count" in body, f"Missing 'entry_count' in costs response: {body}"
        assert "totals" in body, f"Missing 'totals' in costs response: {body}"
        assert "total_all" in body, f"Missing 'total_all' in costs response: {body}"

    def test_costs_entry_count_is_int(self, client):
        """entry_count field is a non-negative integer."""
        response = client.get("/api/v1/costs")
        body = response.json()
        assert isinstance(body["entry_count"], int)
        assert body["entry_count"] >= 0

    def test_costs_total_all_is_numeric(self, client):
        """total_all field is a numeric value."""
        response = client.get("/api/v1/costs")
        body = response.json()
        assert isinstance(body["total_all"], (int, float))


# ---------------------------------------------------------------------------
# Error shape consistency
# ---------------------------------------------------------------------------

class TestErrorShapeConsistency:
    """Verify all 4xx error responses use the 'detail' key (FastAPI standard)."""

    def test_404_uses_detail_key(self, client):
        """Job not-found 404 uses 'detail' not 'error' or 'message'."""
        response = client.get("/api/v1/jobs/does-not-exist")
        body = response.json()
        assert "detail" in body
        assert "error" not in body, "Error responses should use 'detail', not 'error'"
        assert "message" not in body, "Error responses should use 'detail', not 'message'"

    def test_422_uses_detail_key(self, client):
        """Missing required field 422 uses 'detail'."""
        response = client.post("/api/v1/jobs")
        body = response.json()
        assert "detail" in body

    def test_cancel_404_uses_detail_key(self, client):
        """Cancel 404 uses 'detail'."""
        response = client.post("/api/v1/jobs/nonexistent/cancel")
        body = response.json()
        assert "detail" in body

    def test_delete_404_uses_detail_key(self, client):
        """Delete 404 uses 'detail'."""
        response = client.delete("/api/v1/jobs/nonexistent")
        body = response.json()
        assert "detail" in body
