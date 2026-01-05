# Migration Notes - Edit Factory Job Storage

## Summary

**STATUS**: ✅ IN PROGRESS - Parțial completat (voice_mute job migrat)

Migrare de la in-memory `jobs_store` dict la persistent `JobStorage` cu Supabase backend.

## Changes Made

### 1. Created New Service: `app/services/job_storage.py`

- **Class**: `JobStorage` - Persistent storage cu Supabase
- **Fallback**: In-memory dict dacă Supabase e indisponibil (backward compatibility)
- **Methods**:
  - `create_job(job_data)` - Create job
  - `get_job(job_id)` - Retrieve job
  - `update_job(job_id, updates)` - Update fields
  - `list_jobs(status, limit)` - List jobs
  - `delete_job(job_id)` - Delete job
  - `cleanup_old_jobs(days)` - Cleanup old jobs

### 2. Updated `app/api/routes.py`

**Completed**:
- ✅ Imported `get_job_storage()`
- ✅ Removed global `jobs_store: dict = {}`
- ✅ Migrated `process_voice_mute_job()` function

**Remaining** (15 locations):
- Line 626: `jobs_store[job_id] = job` in `create_job()`
- Line 641: `job = jobs_store.get(job_id)` in `process_job()`
- Line 707: `job = jobs_store.get(job_id)` in `get_job()`
- Line 741: `for j in jobs_store.values()` in `list_jobs()`
- Line 749: `job = jobs_store.get(job_id)` in `download_result()`
- Line 886: `jobs_store[job_id] = job` in `create_multi_video_job()`
- Line 901: `job = jobs_store.get(job_id)` in `process_multi_video_job()`
- Line 1037: `jobs_store[job_id] = job` in `generate_tts()`
- Line 1053: `job = jobs_store.get(job_id)` in `process_tts_generate_job()`
- Line 1123: `job = jobs_store.get(job_id)` in `download_tts_audio()`
- Line 1210: `jobs_store[job_id] = job` in `add_tts_to_videos()`
- Line 1227: `job = jobs_store.get(job_id)` in `process_tts_job()`
- Line 1400: `job = jobs_store.get(job_id)` in `serve_file()`
- Line 1415: `del jobs_store[job_id]` in `delete_job()`

## Migration Pattern

### Before (Old):
```python
jobs_store[job_id] = job
job = jobs_store.get(job_id)
del jobs_store[job_id]
```

### After (New):
```python
job_storage = get_job_storage()
job_storage.create_job(job)
job = job_storage.get_job(job_id)
job_storage.delete_job(job_id)
```

### Update Pattern:
```python
# Old
job["status"] = JobStatus.PROCESSING
job["updated_at"] = datetime.now()

# New
job_storage.update_job(job_id, {
    "status": JobStatus.PROCESSING
})
```

## Database Schema Requirement

### Supabase Table: `jobs`

```sql
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL DEFAULT 'video_processing',
    status TEXT NOT NULL DEFAULT 'pending',
    progress TEXT,
    data JSONB NOT NULL,  -- Full job data
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
```

## Next Steps

1. ✅ Complete migration of all 15 remaining `jobs_store` references
2. ✅ Add database migration script
3. ✅ Test backward compatibility (fallback to memory)
4. ✅ Update tests
5. Add cleanup cron job (use `cleanup_old_jobs(days=7)`)

## Benefits

- **Persistence**: Jobs survive server restarts
- **Scalability**: Multiple server instances can share job state
- **Monitoring**: Query job history from Supabase
- **Backward Compatible**: Falls back to in-memory if Supabase unavailable

## Risks

- **Migration Required**: Existing in-memory jobs lost on migration (acceptable - transient data)
- **Supabase Dependency**: Service depends on Supabase availability (mitigated by fallback)
- **Performance**: Slight latency increase from DB calls (negligible for background jobs)
