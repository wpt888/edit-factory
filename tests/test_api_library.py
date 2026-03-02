"""
Integration tests for /api/v1/library routes.

Tests verify response status codes and response structure (required fields, error shape).
Library routes require Supabase for data storage. When Supabase is mocked to None,
routes return 503 — this is documented behavior (graceful degradation). We test:

1. Routes that return 503 (no Supabase) verify the error shape has 'detail'.
2. Routes that can be mocked with a fake Supabase object verify full happy-path shapes.
3. Routes that validate inputs (422) before hitting Supabase verify validation shape.

No live Supabase, FFmpeg, or ElevenLabs required.
"""
import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_supabase(project_data=None, clips_data=None):
    """Build a MagicMock Supabase client with chained table/select/execute calls.

    Returns a mock where:
      supabase.table(...).select(...).eq(...).eq(...).single().execute().data = project_data
      supabase.table(...).select(...).execute().data = list_data
      supabase.table(...).insert(...).execute().data = [project_data]
    """
    mock = MagicMock()

    # Default: project_data for single-item queries, [] for list queries
    if project_data is None:
        project_data = {
            "id": "test-proj-uuid-001",
            "name": "Test Project",
            "description": "A test project",
            "status": "draft",
            "target_duration": 20,
            "context_text": None,
            "variants_count": 0,
            "selected_count": 0,
            "exported_count": 0,
            "created_at": "2026-03-02T10:00:00Z",
            "profile_id": "00000000-0000-0000-0000-000000000000",
        }

    if clips_data is None:
        clips_data = []

    # For .insert().execute()
    mock.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[project_data]
    )

    # For .select(...).eq(...).order(...).limit(...).offset(...).execute()
    list_mock = MagicMock(data=[project_data], count=1)
    mock.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.offset.return_value.execute.return_value = list_mock
    mock.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value = list_mock

    # For .select().execute() (flat queries used in all-clips)
    mock.table.return_value.select.return_value.execute.return_value = MagicMock(
        data=clips_data
    )

    # For .single().execute() pattern
    single_mock = MagicMock(data=project_data)
    mock.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = single_mock
    mock.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = single_mock

    # For .update().eq().execute()
    mock.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[project_data]
    )
    mock.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[project_data]
    )

    # For .delete().eq().execute()
    mock.table.return_value.delete.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "test-proj-uuid-001"}]
    )
    mock.table.return_value.delete.return_value.eq.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "test-proj-uuid-001"}]
    )

    # Also wire profiles table for auth (get_profile_context in dev mode calls profiles table)
    return mock


# ---------------------------------------------------------------------------
# Projects — No-Supabase behavior (degraded mode)
# ---------------------------------------------------------------------------

class TestProjectsNoSupabase:
    """Verify that library routes return proper error shape when Supabase is unavailable.

    In degraded mode (Supabase = None), routes that require DB return 503 with 'detail'.
    """

    def test_create_project_no_supabase_returns_503(self, client):
        """POST /library/projects without Supabase returns 503 with detail."""
        payload = {"name": "Test Project", "description": "A test"}
        response = client.post("/api/v1/library/projects", json=payload)
        assert response.status_code == 503
        body = response.json()
        assert "detail" in body, f"Missing 'detail' in 503 response: {body}"

    def test_list_projects_no_supabase_returns_503(self, client):
        """GET /library/projects without Supabase returns 503 with detail."""
        response = client.get("/api/v1/library/projects")
        assert response.status_code == 503
        body = response.json()
        assert "detail" in body, f"Missing 'detail' in 503 response: {body}"

    def test_get_project_no_supabase_returns_503(self, client):
        """GET /library/projects/{id} without Supabase returns 503 with detail."""
        response = client.get("/api/v1/library/projects/some-fake-uuid")
        assert response.status_code == 503
        body = response.json()
        assert "detail" in body

    def test_delete_project_no_supabase_returns_503(self, client):
        """DELETE /library/projects/{id} without Supabase returns 503 with detail."""
        response = client.delete("/api/v1/library/projects/some-fake-uuid")
        assert response.status_code == 503
        body = response.json()
        assert "detail" in body


# ---------------------------------------------------------------------------
# Projects — with mocked Supabase
# ---------------------------------------------------------------------------

class TestProjectsWithMockedSupabase:
    """Test happy-path project CRUD with a mocked Supabase client."""

    def test_create_project_returns_200_with_id(self, client):
        """POST /library/projects with valid data and mocked Supabase returns 200 with id and name."""
        mock_sb = _make_mock_supabase()
        with patch("app.api.library_routes.get_supabase", return_value=mock_sb):
            payload = {"name": "Test Project", "description": "A test"}
            response = client.post("/api/v1/library/projects", json=payload)

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        body = response.json()
        assert "id" in body, f"Missing 'id' in create project response: {body}"
        assert "name" in body, f"Missing 'name' in create project response: {body}"
        assert "status" in body, f"Missing 'status' in create project response: {body}"

    def test_create_project_response_structure(self, client):
        """Create project response contains all required ProjectResponse fields."""
        mock_sb = _make_mock_supabase()
        with patch("app.api.library_routes.get_supabase", return_value=mock_sb):
            payload = {"name": "My Project", "target_duration": 30}
            response = client.post("/api/v1/library/projects", json=payload)

        assert response.status_code == 200
        body = response.json()
        required_fields = ["id", "name", "status", "target_duration", "created_at"]
        for field in required_fields:
            assert field in body, f"Missing required field '{field}' in project response: {body}"

    def test_list_projects_returns_200_with_list(self, client):
        """GET /library/projects with mocked Supabase returns 200 with 'projects' list."""
        mock_sb = _make_mock_supabase()
        with patch("app.api.library_routes.get_supabase", return_value=mock_sb):
            response = client.get("/api/v1/library/projects")

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        body = response.json()
        assert "projects" in body, f"Missing 'projects' key in list response: {body}"
        assert isinstance(body["projects"], list)

    def test_list_projects_has_total(self, client):
        """List projects response includes 'total' count."""
        mock_sb = _make_mock_supabase()
        with patch("app.api.library_routes.get_supabase", return_value=mock_sb):
            response = client.get("/api/v1/library/projects")

        body = response.json()
        assert "total" in body, f"Missing 'total' in list response: {body}"


# ---------------------------------------------------------------------------
# Projects — validation errors (before Supabase)
# ---------------------------------------------------------------------------

class TestProjectsValidation:
    """Test input validation for project endpoints."""

    def test_create_project_missing_name_returns_422(self, client):
        """POST /library/projects without 'name' returns 422 (Pydantic validation)."""
        payload = {"description": "Missing name"}
        response = client.post("/api/v1/library/projects", json=payload)
        assert response.status_code == 422

    def test_create_project_missing_name_has_detail(self, client):
        """422 response for missing name contains 'detail' field."""
        payload = {"description": "Missing name"}
        response = client.post("/api/v1/library/projects", json=payload)
        body = response.json()
        assert "detail" in body, f"Missing 'detail' in 422 validation response: {body}"


# ---------------------------------------------------------------------------
# Clips — No-Supabase behavior
# ---------------------------------------------------------------------------

class TestClipsNoSupabase:
    """Verify clip endpoints return proper error shape when Supabase unavailable."""

    def test_get_clip_not_found_returns_503(self, client):
        """GET /library/clips/{id} without Supabase returns 503 with detail."""
        response = client.get("/api/v1/library/clips/fake-clip-uuid")
        assert response.status_code == 503
        body = response.json()
        assert "detail" in body

    def test_delete_clip_not_found_returns_503(self, client):
        """DELETE /library/clips/{id} without Supabase returns 503 with detail."""
        response = client.delete("/api/v1/library/clips/fake-clip-uuid")
        assert response.status_code == 503
        body = response.json()
        assert "detail" in body

    def test_list_all_clips_no_supabase_returns_503(self, client):
        """GET /library/all-clips without Supabase returns 503 with detail."""
        response = client.get("/api/v1/library/all-clips")
        assert response.status_code == 503
        body = response.json()
        assert "detail" in body


# ---------------------------------------------------------------------------
# Error shape consistency
# ---------------------------------------------------------------------------

class TestLibraryErrorShapeConsistency:
    """All library error responses must use 'detail' key (not 'error' or 'message')."""

    def test_503_responses_use_detail_key(self, client):
        """503 database unavailable errors use 'detail'."""
        response = client.post("/api/v1/library/projects", json={"name": "Test"})
        body = response.json()
        assert "detail" in body
        assert "error" not in body
        assert "message" not in body

    def test_422_validation_errors_use_detail_key(self, client):
        """422 validation errors use 'detail' key."""
        response = client.post("/api/v1/library/projects", json={"description": "no name"})
        body = response.json()
        assert "detail" in body

    def test_list_clips_503_uses_detail(self, client):
        """All-clips 503 uses 'detail' key."""
        response = client.get("/api/v1/library/all-clips")
        body = response.json()
        assert "detail" in body
        assert "error" not in body
