# Phase 2: Backend Profile Context - Research

**Researched:** 2026-02-03
**Confidence:** HIGH (based on direct codebase analysis)

---

## Executive Summary

Phase 2 retrofits the FastAPI backend to inject profile context into all library/segments/postiz operations. This research examines the existing architecture to recommend patterns that align with current conventions.

**Key findings:**

1. **Auth is opt-in dependency-based** — Routes use `Depends(get_current_user)` to require auth. Profile validation should follow this pattern.
2. **Services use singleton factories** — All services instantiated via `get_x()` functions (not FastAPI Depends). Profile context must be passed as method parameters.
3. **Background tasks lose request context** — FastAPI BackgroundTasks don't preserve profile_id. Must explicitly pass to task functions.
4. **Supabase clients are global singletons** — Using service role key (bypasses RLS). Profile filtering must be explicit in queries.
5. **FFmpeg uses shared temp directory** — `settings.base_dir / "temp"` shared across all operations. Needs project-scoped subdirectories.

---

## 1. Current Route Structure & Auth Patterns

### Auth Implementation (app/api/auth.py)

**Pattern:** Opt-in authentication via FastAPI dependency injection.

```python
# Routes WITHOUT auth (public)
@router.get("/health")
async def health_check():
    ...

# Routes WITH auth
@router.post("/library/projects")
async def create_project(
    project: ProjectCreate,
    current_user: AuthUser = Depends(get_current_user)  # ← Opt-in
):
    ...
```

**Auth flow:**
1. `get_current_user()` extracts JWT from `Authorization: Bearer <token>` header
2. Verifies token with `SUPABASE_JWT_SECRET`
3. Returns `AuthUser(id, email, role)` object
4. **Development bypass:** If `AUTH_DISABLED=true`, returns hardcoded dev user

**Recommendation for Profile Validation:**

Follow the same dependency pattern:

```python
# New dependency in auth.py
async def get_profile_context(
    current_user: AuthUser = Depends(get_current_user),
    x_profile_id: Optional[str] = Header(None, alias="X-Profile-Id")
) -> ProfileContext:
    """
    Extract and validate profile context from request.

    - If X-Profile-Id missing → fetch user's default profile
    - If X-Profile-Id invalid → raise 404 "Profile not found"
    - If profile belongs to different user → raise 403 "Access denied"
    """
    ...
    return ProfileContext(profile_id=profile_id, user_id=current_user.id)
```

**Usage in routes:**

```python
@router.post("/library/projects")
async def create_project(
    project: ProjectCreate,
    profile: ProfileContext = Depends(get_profile_context)  # ← Profile validation
):
    # profile.profile_id is guaranteed valid and owned by user
    ...
```

**Confidence:** HIGH — This aligns perfectly with existing auth patterns.

---

## 2. Service Layer Architecture

### Current Pattern: Singleton Factories

All services use the singleton factory pattern (NOT FastAPI Depends):

```python
# app/services/job_storage.py
_job_storage: Optional[JobStorage] = None

def get_job_storage() -> JobStorage:
    """Get the singleton JobStorage instance."""
    global _job_storage
    if _job_storage is None:
        _job_storage = JobStorage()
    return _job_storage
```

**Services following this pattern:**
- `get_job_storage()` → JobStorage
- `get_cost_tracker()` → CostTracker
- `get_postiz_publisher()` → PostizPublisher
- `get_elevenlabs_tts()` → ElevenLabsTTS
- `get_processor()` → VideoProcessorService (factory, not singleton)

**Service instantiation example (routes.py):**

```python
def get_processor() -> VideoProcessorService:
    """Get video processor service instance."""
    settings = get_settings()
    return VideoProcessorService(
        input_dir=settings.input_dir,
        output_dir=settings.output_dir,
        temp_dir=settings.base_dir / "temp"
    )
```

### Profile Context Injection Recommendation

**Method parameter injection** (not constructor/context object):

```python
# ❌ BAD: Constructor injection (breaks singleton pattern)
class CostTracker:
    def __init__(self, profile_id: str):
        self.profile_id = profile_id  # WRONG: only works for first profile

# ✅ GOOD: Method parameter injection
class CostTracker:
    def log_elevenlabs_tts(
        self,
        job_id: str,
        characters: int,
        profile_id: str,  # ← Inject here
        text_preview: str = ""
    ) -> CostEntry:
        ...
```

**Rationale:**
- Services are singletons → can't store profile state
- Method parameters preserve multi-tenancy
- Aligns with existing patterns (services already accept job_id, settings, etc.)

**Example refactoring:**

```python
# BEFORE
tracker = get_cost_tracker()
tracker.log_elevenlabs_tts(job_id="abc", characters=100)

# AFTER
tracker = get_cost_tracker()
tracker.log_elevenlabs_tts(
    job_id="abc",
    characters=100,
    profile_id=profile.profile_id  # ← Route injects this
)
```

**Confidence:** HIGH — Method injection is standard practice for multi-tenant singleton services.

---

## 3. Background Task Patterns

### Current Implementation

Background tasks use `BackgroundTasks.add_task()` with closure over request scope:

```python
# routes.py line 634
@router.post("/jobs")
async def create_job(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    ...
):
    job_id = uuid.uuid4().hex[:12]
    job = {"job_id": job_id, ...}
    get_job_storage().create_job(job)

    # ⚠️ Closure: job_id captured, but NO profile context
    background_tasks.add_task(process_job, job_id)
    return JobResponse(...)

async def process_job(job_id: str):
    """Background task - NO access to request headers."""
    job = get_job_storage().get_job(job_id)
    processor = get_processor()
    result = processor.process_video(...)
    ...
```

**Background task locations:**
- `routes.py`: 5 tasks (process_job, process_tts_job, process_voice_mute_job, etc.)
- `library_routes.py`: 4 tasks (_generate_raw_clips_task, _export_clips_task, etc.)
- `segments_routes.py`: 1 task (extract_segments_task)
- `postiz_routes.py`: 2 tasks (publish_task, bulk_publish_task)

### Profile Context Preservation Strategy

**Option 1: Pass profile_id explicitly** (RECOMMENDED)

```python
# Route handler
@router.post("/library/projects/{project_id}/generate")
async def generate_raw_clips(
    background_tasks: BackgroundTasks,
    project_id: str,
    profile: ProfileContext = Depends(get_profile_context),
    ...
):
    background_tasks.add_task(
        _generate_raw_clips_task,
        project_id=project_id,
        profile_id=profile.profile_id,  # ← Explicit
        video_path=str(video_path),
        variant_count=variant_count
    )

# Background task
async def _generate_raw_clips_task(
    project_id: str,
    profile_id: str,  # ← Receives as parameter
    video_path: str,
    variant_count: int
):
    # profile_id available for service calls
    tracker = get_cost_tracker()
    tracker.log_gemini_analysis(job_id, frames, profile_id=profile_id)
    ...
```

**Option 2: Store in job data (alternative for complex tasks)**

```python
# For jobs tracked in job_storage
job = {
    "job_id": job_id,
    "profile_id": profile.profile_id,  # ← Store in job data
    ...
}
get_job_storage().create_job(job)

async def process_job(job_id: str):
    job = get_job_storage().get_job(job_id)
    profile_id = job["profile_id"]  # ← Extract from job
    ...
```

**Recommendation:** Use Option 1 (explicit parameters) for consistency. Only use Option 2 for legacy job types that already use job_storage extensively.

**Confidence:** HIGH — This is the standard pattern for preserving request context in background tasks.

---

## 4. Supabase Client Usage

### Current Pattern: Global Service Role Client

```python
# library_routes.py
_supabase_client = None

def get_supabase():
    """Get Supabase client with lazy initialization."""
    global _supabase_client
    if _supabase_client is None:
        from supabase import create_client
        settings = get_settings()
        _supabase_client = create_client(
            settings.supabase_url,
            settings.supabase_key  # ← Service role key (bypasses RLS)
        )
    return _supabase_client
```

**Implication:** Backend uses service role → **bypasses Row-Level Security** → must explicitly filter by user/profile.

**Current queries (library_routes.py):**

```python
# Project creation - NO user_id filter (relies on auth in frontend)
result = supabase.table("editai_projects").insert({
    "name": project.name,
    "description": project.description,
    ...
}).execute()

# Project listing - NO user_id filter
result = supabase.table("editai_projects").select("*").order("created_at", desc=True).execute()
```

**⚠️ Security gap:** Current code doesn't filter by user_id. Anyone with API access could query all projects.

### Profile-Aware Query Pattern

**For INSERT operations:**

```python
# Add profile_id to all inserts
result = supabase.table("editai_projects").insert({
    "profile_id": profile.profile_id,  # ← NOT NULL constraint enforces this
    "name": project.name,
    ...
}).execute()
```

**For SELECT operations:**

```python
# Filter by profile_id
result = supabase.table("editai_projects")\
    .select("*")\
    .eq("profile_id", profile.profile_id)\  # ← Profile isolation
    .order("created_at", desc=True)\
    .execute()
```

**For UPDATE/DELETE operations:**

```python
# Always filter by profile_id to prevent cross-profile modification
result = supabase.table("editai_projects")\
    .update({"status": "archived"})\
    .eq("id", project_id)\
    .eq("profile_id", profile.profile_id)\  # ← Double-check ownership
    .execute()
```

**Recommendation:** Create helper functions for common patterns:

```python
def verify_profile_owns_project(supabase, project_id: str, profile_id: str) -> bool:
    """Verify project belongs to profile."""
    result = supabase.table("editai_projects")\
        .select("id")\
        .eq("id", project_id)\
        .eq("profile_id", profile_id)\
        .single()\
        .execute()
    return result.data is not None
```

**Confidence:** HIGH — This is standard practice for multi-tenant applications using service role keys.

---

## 5. FFmpeg Directory Structure

### Current Pattern: Shared Temp Directory

```python
# config.py
class Settings(BaseSettings):
    base_dir: Path = Path(__file__).parent.parent
    temp_dir: Path = Path("./temp")  # ← Shared globally

# video_processor.py
def __init__(self, input_dir: Path, output_dir: Path, temp_dir: Path):
    self.temp_dir = Path(temp_dir)
    self.temp_dir.mkdir(parents=True, exist_ok=True)
    ...

# Usage in VideoEditor
temp_file = self.temp_dir / f"segment_{output_name}_{i:03d}.mp4"
```

**Current structure:**
```
./temp/
  segment_project_abc123_001.mp4
  segment_project_abc123_002.mp4
  concat_project_xyz456.txt
  timeline_variant_1_000.mp4
  ...
```

**Problem:** If two profiles process projects simultaneously, temp files could collide if output_name overlaps.

### Profile-Scoped Directory Recommendation

**Option 1: Project-scoped subdirectories** (RECOMMENDED)

```python
# In background tasks
async def _generate_raw_clips_task(
    project_id: str,
    profile_id: str,
    ...
):
    settings = get_settings()

    # Project-specific temp dir (includes profile isolation)
    project_temp = settings.base_dir / "temp" / project_id
    project_temp.mkdir(parents=True, exist_ok=True)

    processor = VideoProcessorService(
        input_dir=settings.input_dir,
        output_dir=settings.output_dir,
        temp_dir=project_temp  # ← Project-scoped
    )

    try:
        result = processor.process_video(...)
    finally:
        # Cleanup project temp dir
        shutil.rmtree(project_temp, ignore_errors=True)
```

**Option 2: Profile-scoped subdirectories** (alternative)

```python
# Profile-level temp dir
profile_temp = settings.base_dir / "temp" / profile_id
profile_temp.mkdir(parents=True, exist_ok=True)

# Project-specific within profile
project_temp = profile_temp / project_id
```

**Recommendation:** Use **Option 1** (project-scoped). Benefits:
- Project IDs are already unique (UUID)
- Easier cleanup (delete entire project temp on completion)
- Profile isolation is implicit (projects belong to profiles)
- No additional profile_id path traversal needed

**Cleanup strategy:**

```python
# In background task finally block
try:
    if project_temp.exists():
        shutil.rmtree(project_temp)
        logger.info(f"Cleaned up temp dir: {project_temp}")
except Exception as e:
    logger.warning(f"Failed to cleanup temp dir: {e}")
```

**Confidence:** HIGH — Project-scoped temp directories are standard practice and prevent collisions.

---

## 6. Header Validation Strategy

### Missing Header Behavior

**User decision:** Auto-select user's default profile (no 400 error)

**Implementation:**

```python
async def get_profile_context(
    current_user: AuthUser = Depends(get_current_user),
    x_profile_id: Optional[str] = Header(None, alias="X-Profile-Id")
) -> ProfileContext:
    supabase = get_supabase()

    if not x_profile_id:
        # Missing header → fetch default profile
        result = supabase.table("profiles")\
            .select("id")\
            .eq("user_id", current_user.id)\
            .eq("is_default", True)\
            .single()\
            .execute()

        if not result.data:
            # Edge case: user has no default profile (shouldn't happen after migration)
            raise HTTPException(
                status_code=500,
                detail="No default profile found. Contact support."
            )

        profile_id = result.data["id"]
        logger.info(f"Auto-selected default profile {profile_id} for user {current_user.id}")
    else:
        profile_id = x_profile_id

    # Validate ownership
    ...
```

### Invalid/Foreign Profile Behavior

**Recommendation:** **403 Forbidden** for foreign profiles, **404 Not Found** for invalid UUIDs.

**Rationale:**
- **403** if profile exists but belongs to another user → "You don't have access to this resource"
- **404** if profile doesn't exist at all → "Resource not found"

**Implementation:**

```python
    # Validate profile exists and belongs to user
    result = supabase.table("profiles")\
        .select("id")\
        .eq("id", profile_id)\
        .single()\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    # Check ownership
    ownership = supabase.table("profiles")\
        .select("user_id")\
        .eq("id", profile_id)\
        .single()\
        .execute()

    if ownership.data["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied to this profile")

    return ProfileContext(profile_id=profile_id, user_id=current_user.id)
```

### Validation Layer Architecture

**Recommendation:** **FastAPI dependency** (not middleware)

**Rationale:**
- **Middleware** runs on EVERY request (including health checks, static files)
- **Dependency** runs only on routes that declare it (opt-in, like auth)
- Aligns with existing auth pattern
- Better error messages (tied to route context)

**Implementation location:** Add to `app/api/auth.py` alongside `get_current_user()`.

**Confidence:** HIGH — Dependency pattern is idiomatic FastAPI and matches existing auth.

---

## 7. Profile CRUD Behavior

### Delete Behavior

**User decision:** CASCADE delete (sterge tot), but protect default profile.

**Implementation:**

```python
@router.delete("/profiles/{profile_id}")
async def delete_profile(
    profile_id: str,
    current_user: AuthUser = Depends(get_current_user)
):
    supabase = get_supabase()

    # Verify ownership
    profile = supabase.table("profiles")\
        .select("*")\
        .eq("id", profile_id)\
        .eq("user_id", current_user.id)\
        .single()\
        .execute()

    if not profile.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    # Protect default profile
    if profile.data["is_default"]:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete default profile. Set another profile as default first."
        )

    # CASCADE delete handled by database FK constraints
    # No need to manually delete projects/clips/jobs
    result = supabase.table("profiles").delete().eq("id", profile_id).execute()

    return {"status": "deleted", "profile_id": profile_id}
```

**Database CASCADE constraints (from Phase 1 migration):**
```sql
ALTER TABLE editai_projects
  ADD CONSTRAINT fk_profile
  FOREIGN KEY (profile_id)
  REFERENCES profiles(id)
  ON DELETE CASCADE;  -- ← Deletes projects automatically

ALTER TABLE editai_clips
  ADD CONSTRAINT fk_project
  FOREIGN KEY (project_id)
  REFERENCES editai_projects(id)
  ON DELETE CASCADE;  -- ← Deletes clips when project deleted
```

**Cleanup physical files:**

```python
# After database delete, cleanup files asynchronously
background_tasks.add_task(_cleanup_profile_files, profile_id)

async def _cleanup_profile_files(profile_id: str):
    """Delete all files associated with deleted profile."""
    settings = get_settings()

    # Cleanup profile-specific temp dirs (if using profile-scoped)
    profile_temp = settings.base_dir / "temp" / profile_id
    if profile_temp.exists():
        shutil.rmtree(profile_temp)

    # Note: Output files referenced by clips are already deleted by CASCADE
    # (clips table stores paths, deletion should trigger file cleanup)
    logger.info(f"Cleaned up files for deleted profile {profile_id}")
```

### Required Fields

**Recommendation:** `name` required, `description` optional.

```python
class ProfileCreate(BaseModel):
    name: str  # Required (max 100 chars)
    description: Optional[str] = None  # Optional

    # TTS/Postiz settings optional (defaults to global .env values)
    tts_provider: Optional[str] = None
    tts_voice_id: Optional[str] = None
    postiz_api_url: Optional[str] = None
    postiz_api_key: Optional[str] = None
```

**Confidence:** HIGH — Minimal required fields align with user flexibility.

---

## 8. Public Routes & Profile Context

### Routes Without Profile Context

**Question:** Do public routes need profile context?

**Current public routes:**
- `/health` — Health check
- `/costs` — API cost summary (NOT profile-scoped currently)
- `/usage` — ElevenLabs/Gemini usage (NOT profile-scoped currently)
- `/gemini/status` — Gemini connectivity check

**Recommendation:**

**Public/utility routes → NO profile context:**
- `/health` — Global system status
- `/gemini/status` — Global API connectivity

**User-specific routes → REQUIRE profile context (even if not obvious):**
- `/costs` → Should filter by profile (each profile tracks own costs)
- `/usage` → Should filter by profile (each profile has own TTS/API usage)

**Implementation:**

```python
# Make costs profile-aware
@router.get("/costs")
async def get_costs(
    profile: ProfileContext = Depends(get_profile_context)
):
    tracker = get_cost_tracker()
    # Filter summary by profile_id
    return tracker.get_summary(profile_id=profile.profile_id)
```

**Confidence:** MEDIUM — Depends on whether costs/usage should be global or per-profile. Recommend per-profile for accurate tracking.

---

## 9. Service Refactoring Scope

### Services Requiring Profile Context

**High priority (Phase 2):**

| Service | Profile Parameter | Reason |
|---------|------------------|---------|
| `JobStorage` | `create_job(job_data, profile_id)` | Track which profile owns job |
| `CostTracker` | `log_*(..., profile_id)` | Per-profile cost tracking |
| `PostizPublisher` | `create_post(..., profile_id)` | Per-profile Postiz credentials |
| `VideoProcessorService` | Constructor or temp_dir param | Scoped temp directories |

**Low priority (Phase 4/5):**

| Service | When to Refactor | Reason |
|---------|-----------------|---------|
| `ElevenLabsTTS` | Phase 4 (TTS provider selection) | Per-profile voice settings |
| `EdgeTTSService` | Phase 4 | Alternative TTS provider |
| `GeminiAnalyzer` | Future (if per-profile API keys) | Currently global Gemini key |

### Minimal vs Complete Refactoring

**Recommendation:** **Minimal refactoring** in Phase 2.

**Minimal approach:**
1. Add `profile_id` parameter to service methods (not constructors)
2. Update Supabase queries to filter/insert profile_id
3. Pass profile_id explicitly in background tasks
4. Defer TTS/Postiz per-profile config to Phase 4/5

**Complete approach would include:**
- Per-profile service instances (breaks singleton pattern)
- Per-profile API key management
- Profile-scoped configuration objects

**Rationale for minimal:**
- Preserves existing singleton pattern
- Faster implementation
- Can be extended later without breaking changes
- Method parameters are more flexible than constructor injection

**Confidence:** HIGH — Minimal refactoring aligns with incremental delivery.

---

## 10. Logging Recommendations

### Profile Context in Logs

**User decision:** Include profile_id in all logs for easy filtering.

**Implementation:**

```python
# Standard logging pattern
logger.info(f"[Profile {profile_id}] Generating {variant_count} clips for project {project_id}")
logger.error(f"[Profile {profile_id}] Failed to export clip {clip_id}: {error}")
```

**Structured logging (future enhancement):**

```python
# Use extra context for structured logs
logger.info(
    "Generating clips",
    extra={
        "profile_id": profile_id,
        "project_id": project_id,
        "variant_count": variant_count
    }
)
```

**Grep-friendly format:**

```bash
# Easy filtering by profile
grep "[Profile profile_abc123]" logs/app.log

# Or structured
grep "profile_id.*profile_abc123" logs/app.log
```

**Confidence:** HIGH — Standard practice for multi-tenant logging.

---

## 11. Legacy Jobs Migration

### Handling Nullable profile_id

**Database schema (from Phase 1):**
```sql
ALTER TABLE jobs ADD COLUMN profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE api_costs ADD COLUMN profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
```

**Problem:** Existing jobs/costs have `profile_id = NULL`.

**User decision:** Migrate to default profile (not ignore).

**Implementation:**

```python
# One-time migration script (run after Phase 1 complete)
def migrate_legacy_jobs_to_default_profile():
    """Assign all NULL profile_id records to user's default profile."""
    supabase = get_supabase()

    # Get all users
    users = supabase.table("profiles").select("user_id, id").eq("is_default", True).execute()

    for user_profile in users.data:
        user_id = user_profile["user_id"]
        default_profile_id = user_profile["id"]

        # Update jobs (if jobs table has user_id — it doesn't currently)
        # Need to infer user from job data or skip

        # Update api_costs (if has user context)
        # This is tricky without user_id on these tables

        logger.info(f"Migrated legacy records for user {user_id} to profile {default_profile_id}")
```

**Recommendation:** Since `jobs` and `api_costs` don't have `user_id`, and they're ephemeral data:

1. **Keep NULL profile_id for old records** (they're historical)
2. **New records MUST have profile_id** (enforce in code)
3. **Display logic:** Filter out NULL profile_id in cost summaries (or attribute to "Legacy")

**Alternative:** Add `user_id` to jobs/api_costs in Phase 1 migration to enable proper legacy migration.

**Confidence:** MEDIUM — Depends on whether historical cost tracking is important. Recommend keeping NULL as "Legacy" category.

---

## 12. Retry Mechanism Design

### Existing Job System

**Current pattern:** Jobs use JobStorage with status tracking, no built-in retry.

```python
# job_storage.py
class JobStorage:
    def create_job(self, job_data: dict) -> dict:
        job_data["status"] = job_data.get("status", "pending")
        ...

    def update_job(self, job_id: str, updates: dict):
        job.update(updates)
        job["updated_at"] = datetime.now().isoformat()
        ...
```

**Job statuses:** `pending`, `processing`, `completed`, `failed`

**No retry mechanism currently implemented.**

### Retry Strategy Recommendation

**For Phase 2:** Do NOT implement retry (out of scope).

**Rationale:**
- Phase 2 focuses on profile context injection
- Retry mechanism is a separate feature
- Current system works without it (users can re-submit)

**Future implementation (if needed):**

```python
# Add retry fields to job data
job = {
    "job_id": job_id,
    "profile_id": profile_id,
    "status": "pending",
    "retry_count": 0,
    "max_retries": 3,
    ...
}

async def process_job_with_retry(job_id: str):
    job = get_job_storage().get_job(job_id)

    try:
        # Process job
        ...
    except Exception as e:
        if job["retry_count"] < job["max_retries"]:
            # Retry
            job["retry_count"] += 1
            job["status"] = "pending"
            get_job_storage().update_job(job_id, job)

            # Re-queue (this requires background task system redesign)
            background_tasks.add_task(process_job_with_retry, job_id)
        else:
            # Failed permanently
            job["status"] = "failed"
            job["error"] = str(e)
            get_job_storage().update_job(job_id, job)
```

**Confidence:** HIGH — Defer retry to future phase.

---

## Recommendations Summary

### 1. Header Validation
- **Pattern:** FastAPI dependency (like auth)
- **Missing header:** Auto-select default profile
- **Invalid profile:** 404 if doesn't exist, 403 if not owned
- **Location:** `app/api/auth.py`

### 2. Service Injection
- **Pattern:** Method parameter injection (not constructor)
- **Refactoring scope:** Minimal (add profile_id params)
- **Services:** JobStorage, CostTracker, PostizPublisher, VideoProcessorService

### 3. Background Tasks
- **Pattern:** Explicit profile_id parameter
- **Preservation:** Pass profile_id to task function
- **Logging:** Include `[Profile {profile_id}]` in all log messages

### 4. Supabase Queries
- **INSERT:** Always include profile_id
- **SELECT:** Always filter by profile_id
- **UPDATE/DELETE:** Double-check profile_id ownership

### 5. FFmpeg Temp Directories
- **Pattern:** Project-scoped subdirectories
- **Structure:** `temp/{project_id}/`
- **Cleanup:** Delete entire project temp on completion

### 6. Profile CRUD
- **Required fields:** name only
- **Delete protection:** Cannot delete default profile
- **Cascade:** Database FK handles cascading deletes
- **File cleanup:** Background task for physical file deletion

### 7. Public Routes
- **System routes:** No profile context (health, gemini/status)
- **User routes:** Require profile context (costs, usage)

### 8. Legacy Data
- **Strategy:** Keep NULL profile_id as "Legacy"
- **New records:** Enforce profile_id NOT NULL in code
- **Display:** Filter or categorize NULL separately

### 9. Retry Mechanism
- **Phase 2:** Do NOT implement
- **Future:** Add retry_count to job data if needed

---

## Phase 2 Implementation Checklist

Based on this research, Phase 2 should:

- [ ] Create `get_profile_context()` dependency in auth.py
- [ ] Add Profile CRUD routes (`/api/v1/profiles`)
- [ ] Refactor library_routes to inject profile context
- [ ] Refactor segments_routes to inject profile context
- [ ] Refactor postiz_routes to inject profile context
- [ ] Update JobStorage methods to accept profile_id
- [ ] Update CostTracker methods to accept profile_id
- [ ] Update PostizPublisher methods to accept profile_id (Phase 5 may expand)
- [ ] Update all background tasks to pass profile_id
- [ ] Update VideoProcessorService to use project-scoped temp dirs
- [ ] Add profile_id to all Supabase INSERT queries
- [ ] Add profile_id filters to all Supabase SELECT queries
- [ ] Add profile_id logging to all background tasks
- [ ] Add profile delete protection logic

**Not in scope for Phase 2:**
- Frontend profile UI (Phase 3)
- Per-profile TTS settings (Phase 4)
- Per-profile Postiz config (Phase 5)
- Retry mechanism
- Legacy data migration (keep as-is)

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Auth patterns | HIGH | Direct code analysis of auth.py |
| Service architecture | HIGH | Examined all service files |
| Background tasks | HIGH | Found all add_task calls |
| Supabase usage | HIGH | Analyzed library_routes queries |
| FFmpeg directories | HIGH | Examined video_processor.py |
| Header validation | HIGH | Aligns with FastAPI best practices |
| Profile CRUD | HIGH | Standard REST patterns |
| Service injection | HIGH | Method params preserve singleton pattern |

**Overall confidence:** HIGH — All recommendations based on existing codebase patterns and FastAPI conventions.
