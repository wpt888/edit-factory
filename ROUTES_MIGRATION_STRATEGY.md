# Routes Migration Strategy: routes.py → library_routes.py

## Executive Summary

**Current State**: Codul video processing este duplicat între:
- `routes.py` (1412 linii) - Legacy endpoints, in-memory jobs
- `library_routes.py` (1773 linii) - New workflow, Supabase-backed

**Goal**: Consolidare completă în `library_routes.py`, deprecare `routes.py`.

---

## Phase 1: Conflict Analysis ✅ COMPLETED

### 1.1 File Serving (Duplicat)

**routes.py** (linii 1345-1389):
```python
@router.get("/files/{file_path:path}")
# Verificare simplă: doar output_dir
```

**library_routes.py** (linii 156-196):
```python
@router.get("/library/files/{file_path:path}")
# Verificare robustă: allowed_dirs = [output_dir, processed_dir, input_dir, temp_dir]
```

**Recommendation**: ✅ Păstrăm versiunea din `library_routes.py` (mai sigură).

### 1.2 Job Storage Pattern

**routes.py**: `jobs_store: dict = {}` (in-memory, volatil)
**library_routes.py**: `_progress_store: Dict[str, dict] = {}` (similar, in-memory)

**Solution**: ✅ Creat `app/services/job_storage.py` cu Supabase backend + fallback.

### 1.3 Voice Muting Logic

**Locații**:
1. `routes.py` (linii 297-415): Endpoint `/mute-voice` + `process_voice_mute_job()`
2. `video_processor.py` (linii 434-495): `VideoEditor.mute_voice_in_video()`
3. `video_processor.py` (linii 558-665): Inline în `extract_segments()`

**Analysis**: ✅ NU există duplicare reală:
- Core logic în `voice_detector.py::mute_voice_segments()`
- `video_processor.py` folosește funcția centrală
- `extract_segments()` are logică specifică pentru segmente (timpi relativi)

**Recommendation**: Arhitectura e corectă, nu necesită refactoring.

### 1.4 Video Info Extraction

**routes.py** (linii 446-532): Endpoint `/video-info`
**library_routes.py** (linii 1547-1587): Helper `_get_video_info()`

**Recommendation**: Extrage în `app/services/video_utils.py` pentru reusability.

---

## Phase 2: Migration Roadmap

### 2.1 Priority Matrix

| Endpoint | routes.py | library_routes.py | Action |
|----------|-----------|-------------------|---------|
| `/files/{path}` | ✅ | ✅ (better) | **Deprecate** routes.py |
| `/video-info` | ✅ | Inline helper | **Extract** to video_utils.py |
| `/mute-voice` | ✅ | ❌ | **Migrate** endpoint |
| `/analyze` | ✅ | ❌ | **Migrate** endpoint |
| `/generate-tts` | ✅ | ❌ | **Migrate** endpoint |
| `/library/*` | ❌ | ✅ | **Keep** as-is |

### 2.2 Migration Steps

#### Step 1: Extract Shared Utilities ⏱️ TODO

Create `app/services/video_utils.py`:
```python
def get_video_info(video_path: Path) -> dict:
    """Extract video metadata (duration, fps, resolution, rotation)."""
    # Move logic from routes.py:446-532 and library_routes.py:1547-1587
    pass

def get_video_rotation(video_path: Path) -> int:
    """Detect video rotation (0, 90, 180, 270)."""
    pass
```

#### Step 2: Migrate Legacy Endpoints ⏱️ TODO

**Voice Muting**:
```python
# In library_routes.py
@router.post("/library/videos/mute-voice")
async def mute_voice_in_video(...):
    # Move logic from routes.py:297-415
    # Use JobStorage instead of jobs_store
    pass
```

**Video Analysis**:
```python
# In library_routes.py
@router.post("/library/videos/analyze")
async def analyze_video(...):
    # Move logic from routes.py:427-619
    # Use JobStorage instead of jobs_store
    pass
```

**TTS Generation**:
```python
# In library_routes.py
@router.post("/library/audio/tts")
async def generate_tts(...):
    # Move logic from routes.py:918-1125
    # Use JobStorage instead of jobs_store
    pass
```

#### Step 3: Add Deprecation Warnings ⏱️ TODO

In `routes.py` header:
```python
"""
DEPRECATED: Legacy routes - Use /library/* endpoints instead.

This module will be removed in v2.0.
All new development should use library_routes.py.

Migration guide: /docs/ROUTES_MIGRATION_STRATEGY.md
"""

import warnings
warnings.warn(
    "routes.py is deprecated. Use library_routes.py",
    DeprecationWarning,
    stacklevel=2
)
```

#### Step 4: Update Frontend ⏱️ TODO

In `frontend/src/app/library/page.tsx`:
- Already using `/library/*` endpoints ✅
- No changes needed

In other pages (if any):
- Replace `/api/v1/analyze` → `/api/v1/library/videos/analyze`
- Replace `/api/v1/mute-voice` → `/api/v1/library/videos/mute-voice`
- Replace `/api/v1/generate-tts` → `/api/v1/library/audio/tts`

#### Step 5: Remove routes.py 🗑️ Future

After 2-3 releases with deprecation warnings:
1. Remove `app/api/routes.py`
2. Update `app/main.py` to only include `library_routes.router`

---

## Phase 3: API Contract Standardization

### 3.1 Endpoint Naming Convention

**Pattern**: `/library/{resource}/{action}`

Examples:
- `/library/projects` - List/create projects
- `/library/projects/{id}` - Get/update/delete project
- `/library/projects/{id}/generate` - Generate clips
- `/library/clips/{id}/render` - Render final clip
- `/library/videos/analyze` - Analyze video (new)
- `/library/videos/mute-voice` - Mute voice (new)
- `/library/audio/tts` - Generate TTS (new)

### 3.2 Response Format Standardization

All endpoints return:
```json
{
  "status": "success|error|processing",
  "data": {...},
  "error": "Error message if any",
  "metadata": {
    "timestamp": "ISO8601",
    "request_id": "uuid"
  }
}
```

---

## Phase 4: Workflow Comparison

### Legacy Workflow (routes.py)

```
1. Upload video → POST /analyze
2. Get job status → GET /jobs/{id}
3. Download result → GET /download/{job_id}
```

**Issues**:
- In-memory jobs (lost on restart)
- No project organization
- No clip library
- No variant management

### New Workflow (library_routes.py)

```
1. Create project → POST /library/projects
2. Generate clips → POST /library/projects/{id}/generate
3. Select variants → PATCH /library/clips/{id}/select
4. Add content → PUT /library/clips/{id}/content
5. Render finals → POST /library/clips/{id}/render
```

**Benefits**:
- Persistent storage (Supabase)
- Project organization
- Multi-variant support
- Content management (TTS + SRT)
- Export presets

---

## Phase 5: Implementation Status

### Completed ✅

1. **Job Storage Migration**: Created `app/services/job_storage.py` with Supabase backend
2. **Voice Muting Architecture**: Documented in `VOICE_MUTING_ARCHITECTURE.md` - no refactoring needed
3. **SRT Validation**: Created `app/services/srt_validator.py` + integrated in render pipeline
4. **Cost Tracking**: Gemini tracking already implemented in `gemini_analyzer.py`

### In Progress 🚧

1. Complete migration of all `jobs_store` references in `routes.py` (15 locations remaining)
2. Add database migration script for `jobs` table

### TODO 📋

1. Extract video utilities to `video_utils.py`
2. Migrate legacy endpoints to `library_routes.py`
3. Add deprecation warnings to `routes.py`
4. Update API documentation
5. Update frontend to use new endpoints (if needed)
6. Add integration tests for migration
7. Schedule `routes.py` removal (v2.0)

---

## Phase 6: Database Schema

### Required Tables (Already Exist)

```sql
-- Projects
editai_projects (id, name, description, status, target_duration, context_text, ...)

-- Clips
editai_clips (id, project_id, variant_index, raw_video_path, final_video_path, final_status, ...)

-- Clip Content
editai_clip_content (clip_id, tts_text, srt_content, subtitle_settings, ...)

-- Export Presets
editai_export_presets (id, name, width, height, fps, video_bitrate, ...)

-- API Costs
api_costs (id, service, operation, cost, metadata, ...)
```

### New Table Required

```sql
-- Jobs (for persistent job storage)
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL DEFAULT 'video_processing',
    status TEXT NOT NULL DEFAULT 'pending',
    progress TEXT,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
```

---

## Phase 7: Testing Strategy

### Unit Tests

- ✅ `test_srt_validator.py` - SRT validation logic
- ✅ `test_job_storage.py` - Job storage with Supabase mock
- TODO: `test_video_utils.py` - Video info extraction

### Integration Tests

- TODO: `test_migration_endpoints.py` - Verify old and new endpoints compatibility
- TODO: `test_workflow_complete.py` - End-to-end workflow

### Performance Tests

- TODO: `test_supabase_latency.py` - Job storage performance vs in-memory
- TODO: `test_render_pipeline.py` - Full render with SRT validation

---

## Rollback Plan

If issues arise during migration:

1. **Immediate**: Toggle feature flag to disable new endpoints
2. **Short-term**: Revert to in-memory `jobs_store` fallback
3. **Data Recovery**: Export jobs from Supabase to JSON backup

---

## Success Metrics

- [ ] All legacy endpoints migrated to `/library/*`
- [ ] Zero in-memory state (all persisted to Supabase)
- [ ] API response time < 200ms (p95)
- [ ] Zero job loss during server restart
- [ ] 100% code coverage for new services
- [ ] Documentation updated (Swagger/OpenAPI)

---

## Timeline

- **Week 1**: Complete job storage migration (remaining 15 locations)
- **Week 2**: Extract video utilities, migrate endpoints
- **Week 3**: Add deprecation warnings, update docs
- **Week 4**: Testing and bug fixes
- **v2.0 (Future)**: Remove `routes.py` completely

---

## Contact & Questions

For questions about this migration:
- Check `MIGRATION_NOTES.md` for job storage details
- Check `VOICE_MUTING_ARCHITECTURE.md` for voice processing
- Check `app/services/srt_validator.py` for SRT validation examples

---

**Last Updated**: 2026-01-02
**Author**: Claude Code Analysis
**Status**: In Progress (Phase 1 ✅, Phase 2 🚧)
