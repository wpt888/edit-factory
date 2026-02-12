# Full Platform Bug Audit
Date: 2026-02-12
Status: ALL BUGS RESOLVED (2026-02-13)

## Summary
**3 BUGS FOUND → ALL FIXED** | 2 Medium Severity | 1 Low Severity | 15 Areas Checked

## BUGS FOUND

### BUG 1: Assembly Page Type Mismatch (Frontend/Backend API Contract) ✅ RESOLVED
- **Severity**: Medium
- **Resolution Date**: 2026-02-13
- **Fix**: Updated frontend interface to match backend Pydantic model
- **Location**:
  - Frontend: `frontend/src/app/assembly/page.tsx:40`
  - Backend: `app/api/assembly_routes.py:61-62`
- **Description**: Frontend TypeScript interface defines wrong field name for matched segment
- **Evidence**:
  ```typescript
  // Frontend (assembly/page.tsx line 40):
  interface MatchPreview {
    matched_segment_id: string | null;  // ❌ WRONG field name
    matched_keyword: string | null;
    confidence: number;
  }

  // Backend (assembly_routes.py line 61-62):
  class MatchPreview(BaseModel):
    segment_id: Optional[str]           # ✅ Actual field name
    segment_keywords: List[str]         # ✅ Also missing in frontend
    matched_keyword: Optional[str]
    confidence: float
  ```
- **Impact**:
  - Frontend cannot access `segment_id` from preview response
  - Frontend missing `segment_keywords` field entirely
  - TypeScript won't catch this because response is cast as `any` after `res.json()`
  - UI will fail to display segment information in preview results
- **Fix**: Update frontend interface to match backend:
  ```typescript
  interface MatchPreview {
    srt_index: number;
    srt_text: string;
    srt_start: number;
    srt_end: number;
    segment_id: string | null;          // ✅ Correct field name
    segment_keywords: string[];         // ✅ Add missing field
    matched_keyword: string | null;
    confidence: number;
  }
  ```

### BUG 2: Pipeline Preview Endpoint Query Parameter Bug ✅ RESOLVED
- **Severity**: Medium
- **Resolution Date**: 2026-02-13
- **Fix**: Changed backend to accept elevenlabs_model from request body using Body(..., embed=True)
- **Location**:
  - Frontend: `frontend/src/app/pipeline/page.tsx:187-189`
  - Backend: `app/api/pipeline_routes.py:265-271`
- **Description**: Frontend sends `elevenlabs_model` as request body, but backend expects it as query parameter
- **Evidence**:
  ```typescript
  // Frontend (pipeline/page.tsx line 187-189):
  const res = await apiPost(`/pipeline/preview/${pipelineId}/${i}`, {
    elevenlabs_model: elevenlabsModel,  // ❌ Sending as JSON body
  });

  // Backend (pipeline_routes.py line 265-271):
  @router.post("/preview/{pipeline_id}/{variant_index}", response_model=PipelinePreviewResponse)
  async def preview_variant(
      pipeline_id: str,
      variant_index: int,
      profile: ProfileContext = Depends(get_profile_context),
      elevenlabs_model: str = "eleven_flash_v2_5"  # ✅ Expected as query param
  ):
  ```
- **Impact**:
  - Backend will always use default model `"eleven_flash_v2_5"`, ignoring user selection
  - No error will occur (param is optional with default)
  - Users cannot select different ElevenLabs models for preview
- **Fix Option 1** (Change Frontend - Recommended):
  ```typescript
  const res = await apiGet(
    `/pipeline/preview/${pipelineId}/${i}?elevenlabs_model=${elevenlabsModel}`
  );
  ```
- **Fix Option 2** (Change Backend):
  ```python
  # Add Pydantic model for request body
  class PipelinePreviewRequest(BaseModel):
      elevenlabs_model: str = "eleven_flash_v2_5"

  async def preview_variant(
      pipeline_id: str,
      variant_index: int,
      request: PipelinePreviewRequest,  # Accept as body
      profile: ProfileContext = Depends(get_profile_context)
  ):
  ```

### BUG 3: Pipeline Status Type Mismatch (Status Enum) ✅ RESOLVED
- **Severity**: Low
- **Resolution Date**: 2026-02-13
- **Fix**: Updated frontend VariantStatus interface to use "not_started" instead of "pending"
- **Location**:
  - Frontend: `frontend/src/app/pipeline/page.tsx:61`
  - Backend: `app/api/pipeline_routes.py:132`
- **Description**: Frontend expects status "pending" but backend returns "not_started"
- **Evidence**:
  ```typescript
  // Frontend (pipeline/page.tsx line 61):
  interface VariantStatus {
    status: "pending" | "processing" | "completed" | "failed";  // ❌ Expects "pending"
  }

  // Backend (pipeline_routes.py line 132, 549):
  class VariantStatus(BaseModel):
    status: str  # "not_started", "processing", "completed", "failed"

  variants.append(VariantStatus(
      variant_index=idx,
      status="not_started",  // ✅ Actually returns "not_started"
  ))
  ```
- **Impact**:
  - TypeScript type checking will fail if frontend code uses strict status matching
  - UI might not handle "not_started" status correctly
  - Currently no runtime error because TypeScript doesn't validate at runtime
- **Fix**: Align frontend and backend on same status value:
  ```typescript
  // Frontend - change to match backend:
  interface VariantStatus {
    status: "not_started" | "processing" | "completed" | "failed";
  }
  ```

## RESOLUTION SUMMARY

All 3 bugs have been fixed with minimal code changes:

**BUG 1 - Assembly Type Mismatch:**
- Changed: `frontend/src/app/assembly/page.tsx`
- Fixed: `matched_segment_id` → `segment_id`, added `segment_keywords: string[]`
- Verification: TypeScript compilation passes, types now match backend

**BUG 2 - Pipeline Preview Parameter:**
- Changed: `app/api/pipeline_routes.py`
- Fixed: Added `Body` import, changed parameter to `elevenlabs_model: str = Body("eleven_flash_v2_5", embed=True)`
- Verification: Backend now accepts model from JSON body as frontend sends it

**BUG 3 - Pipeline Status Enum:**
- Changed: `frontend/src/app/pipeline/page.tsx`
- Fixed: Changed status type from `"pending"` to `"not_started"`
- Verification: TypeScript compilation passes, frontend matches backend enum

## WARNINGS (Potential Issues)

### WARNING 1: In-Memory Job Storage Loss on Server Restart
- **Location**: `app/api/assembly_routes.py:46`, `app/api/pipeline_routes.py:50`
- **Description**: Both assembly jobs and pipeline state are stored in module-level dictionaries
- **Evidence**:
  ```python
  # assembly_routes.py line 46:
  _assembly_jobs = {}  # In-memory only

  # pipeline_routes.py line 50:
  _pipelines: Dict[str, dict] = {}  # In-memory only
  ```
- **Impact**: Server restart = lost job status for all active renders
- **Mitigation**: This is documented behavior (similar to library_routes `_generation_progress`). Consider Supabase persistence for production.

### WARNING 2: No Rate Limiting on AI API Calls
- **Location**: `app/services/script_generator.py`, `app/api/script_routes.py`
- **Description**: No rate limiting on Gemini/Claude script generation endpoints
- **Impact**: User could spam expensive AI calls
- **Mitigation**: Add rate limiting middleware in production

### WARNING 3: Missing Error Handling for Supabase Connection Failures
- **Location**: Multiple route files use lazy Supabase init with fallback to None
- **Description**: If Supabase fails to initialize, routes silently continue or return generic 503
- **Impact**: Unclear error messages when database is unavailable
- **Mitigation**: Already has graceful degradation, but logging could be improved

## AREAS CHECKED (Clean)

### Backend Routes ✅
- [x] `app/main.py` - All routers properly imported and mounted
- [x] `app/api/routes.py` - Video processing routes compile cleanly
- [x] `app/api/library_routes.py` - Library CRUD routes compile cleanly
- [x] `app/api/segments_routes.py` - Manual selection routes compile cleanly
- [x] `app/api/postiz_routes.py` - Publishing routes compile cleanly
- [x] `app/api/profile_routes.py` - Profile management routes compile cleanly
- [x] `app/api/tts_routes.py` - TTS routes compile cleanly
- [x] `app/api/script_routes.py` - Script generation routes compile cleanly (v4)
- [x] `app/api/assembly_routes.py` - Assembly routes compile cleanly (v4)
- [x] `app/api/pipeline_routes.py` - Pipeline routes compile cleanly (v4)

### Backend Services ✅
- [x] `app/services/assembly_service.py` - Compiles without errors
- [x] `app/services/script_generator.py` - Compiles without errors
- [x] `app/services/tts_subtitle_generator.py` - Compiles without errors
- [x] `app/services/tts/` - Multi-provider TTS module structure correct
- [x] All other services in `app/services/` - No import errors found

### Frontend Pages ✅
- [x] TypeScript compilation (`npx tsc --noEmit`) - No type errors
- [x] All page components import correctly
- [x] API client (`lib/api.ts`) - Clean implementation

### Database Schema ✅
- [x] Migration 008 adds `profile_id` to `editai_segments` and `editai_source_videos`
- [x] FK constraints properly defined with CASCADE
- [x] Indexes created for performance

### Authentication ✅
- [x] `app/api/auth.py` - ProfileContext and get_profile_context working correctly
- [x] Development mode bypass properly implemented
- [x] Auto-profile selection logic correct

## Test Recommendations

### Priority 1 - Test Bug #1 (Assembly Page)
```bash
# Start dev servers
cd frontend && npm run dev

# Manual test:
1. Go to http://localhost:3000/assembly
2. Paste a script and click "Preview Matching"
3. Check browser console for errors accessing segment_id
4. Verify segment info displays correctly in match preview cards
```

### Priority 2 - Test Bug #2 (Pipeline Preview)
```bash
# Manual test:
1. Go to http://localhost:3000/pipeline
2. Generate scripts with any idea
3. Change ElevenLabs model dropdown to different value
4. Click "Preview All Matches"
5. Check backend logs - should show default model being used, not selected one
```

### Priority 3 - Test Bug #3 (Pipeline Status)
```bash
# Manual test:
1. Go to http://localhost:3000/pipeline
2. Generate scripts and preview
3. Select variants to render
4. Check if "Not Started" status displays correctly in UI
5. Verify no console errors about invalid status values
```

## Automated Test Coverage

### Playwright Tests Status
- ✅ Library page CRUD operations
- ✅ Video filters UI
- ✅ Subtitle enhancement controls
- ✅ Multi-select functionality
- ❌ Assembly page preview (NOT TESTED - Bug #1 affects this)
- ❌ Pipeline multi-variant workflow (NOT TESTED - Bugs #2 and #3 affect this)
- ❌ Scripts page generation (NOT TESTED)

**Recommendation**: Add Playwright tests for v4 pages after fixing bugs.

## Risk Assessment

| Area | Risk Level | Notes |
|------|------------|-------|
| Assembly Page | **MEDIUM** | Bug #1 breaks segment preview display |
| Pipeline Preview | **MEDIUM** | Bug #2 prevents model selection |
| Pipeline Status | **LOW** | Bug #3 is type mismatch only, no runtime error |
| Backend Routes | **NONE** | All compile cleanly, properly mounted |
| Frontend TypeScript | **NONE** | No compilation errors |
| Database Schema | **NONE** | Migrations match code expectations |

## Conclusion

Platform is **mostly healthy** with 3 non-critical bugs found:
- 2 API contract mismatches (frontend/backend type inconsistencies)
- 1 status enum mismatch (won't cause runtime errors)

**All bugs are fixable with simple type alignment changes.**

No syntax errors, import errors, or database schema mismatches detected.

**Next Steps:**
1. Fix Bug #1 (Assembly type mismatch) - 5 minutes
2. Fix Bug #2 (Pipeline preview query param) - 5 minutes
3. Fix Bug #3 (Pipeline status enum) - 2 minutes
4. Add Playwright tests for v4 features
5. Consider Supabase persistence for job state in production
