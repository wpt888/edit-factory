"""
Job Storage Service - Persistent job tracking with Supabase.
Replaces in-memory job_store from routes.py with persistent storage.
"""
import logging
import threading
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from pathlib import Path

logger = logging.getLogger(__name__)


class JobStorage:
    """
    Persistent job storage using Supabase.
    Falls back to in-memory dict if Supabase unavailable (backward compatibility).
    """

    _MAX_MEMORY_JOBS = 500  # Evict oldest when exceeded

    def __init__(self):
        self._supabase = None
        self._memory_store: Dict[str, dict] = {}
        self._update_lock = threading.Lock()
        self._cancelled_jobs: Dict[str, float] = {}  # job_id -> monotonic timestamp
        self._cancelled_lock = threading.Lock()
        self._MAX_CANCELLED = 500
        self._init_supabase()

    @property
    def supabase(self):
        return self._supabase

    @property
    def update_lock(self):
        return self._update_lock

    @property
    def memory_store(self):
        return self._memory_store

    def _init_supabase(self):
        """Initialize Supabase client."""
        try:
            from app.db import get_supabase
            self._supabase = get_supabase()
            if self._supabase:
                logger.info("JobStorage: Supabase initialized")
            else:
                logger.warning("JobStorage: Supabase credentials missing, using in-memory fallback")
        except Exception as e:
            logger.error(f"JobStorage: Failed to initialize Supabase: {e}")
            self._supabase = None

    def _evict_oldest_memory_jobs(self):
        """Evict oldest completed/failed jobs from memory when over limit."""
        if len(self._memory_store) <= self._MAX_MEMORY_JOBS:
            return
        # Sort by created_at, evict oldest terminal jobs first
        terminal = sorted(
            [(k, v) for k, v in self._memory_store.items()
             if v.get("status") in ("completed", "failed", "cancelled")],
            key=lambda kv: kv[1].get("created_at", "")
        )
        to_remove = len(self._memory_store) - self._MAX_MEMORY_JOBS
        for k, _ in terminal[:to_remove]:
            self._memory_store.pop(k, None)
        if to_remove > 0 and terminal:
            logger.info(f"JobStorage: Evicted {min(to_remove, len(terminal))} old jobs from memory (cap={self._MAX_MEMORY_JOBS})")

    def create_job(self, job_data: dict, profile_id: Optional[str] = None) -> dict:
        """
        Create a new job.

        Args:
            job_data: Dict with job fields (job_id, job_type, status, etc.)
            profile_id: Optional profile ID for multi-tenant isolation

        Returns:
            Created job data
        """
        job_id = job_data.get("job_id")
        if not job_id:
            raise ValueError("job_id is required")

        # Add timestamps
        job_data["created_at"] = datetime.now(timezone.utc).isoformat()
        job_data["updated_at"] = datetime.now(timezone.utc).isoformat()

        # Store profile_id in job_data for memory fallback
        if profile_id:
            job_data["profile_id"] = profile_id

        if self._supabase:
            try:
                # Insert into Supabase
                result = self._supabase.table("jobs").insert({
                    "id": job_id,
                    "job_type": job_data.get("job_type", "video_processing"),
                    "status": job_data.get("status", "pending"),
                    "progress": job_data.get("progress", "Queued"),
                    "profile_id": profile_id,  # Add profile_id for multi-tenant tracking
                    "data": job_data,  # Store full job data as JSON
                    "created_at": job_data["created_at"],
                    "updated_at": job_data["updated_at"]
                }).execute()

                if profile_id:
                    logger.info(f"[Profile {profile_id}] JobStorage: Created job {job_id} in Supabase")
                else:
                    logger.info(f"JobStorage: Created job {job_id} in Supabase (no profile)")
                return job_data
            except Exception as e:
                logger.error(f"JobStorage: Failed to create job in Supabase: {e}, using memory")
                # Fallback to memory
                self._memory_store[job_id] = job_data
                self._evict_oldest_memory_jobs()
                return job_data
        else:
            # In-memory storage
            self._memory_store[job_id] = job_data
            self._evict_oldest_memory_jobs()
            if profile_id:
                logger.debug(f"[Profile {profile_id}] JobStorage: Created job {job_id} in memory")
            else:
                logger.debug(f"JobStorage: Created job {job_id} in memory (no profile)")
            return job_data

    def get_job(self, job_id: str) -> Optional[dict]:
        """
        Get job by ID.

        Args:
            job_id: Job ID

        Returns:
            Job data or None if not found
        """
        if self._supabase:
            try:
                result = self._supabase.table("jobs").select("*").eq("id", job_id).limit(1).execute()
                if not result.data:
                    return None
                # DB-02: Normalize return format — merge top-level fields into data dict
                row = result.data[0]
                job_data = row.get("data", {})
                # Merge top-level DB fields so callers always see a consistent shape
                for key in ("id", "status", "progress", "profile_id", "created_at", "updated_at"):
                    if key in row and key not in job_data:
                        job_data[key] = row[key]
                # Ensure status from DB row overrides stale data-blob status
                if "status" in row:
                    job_data["status"] = row["status"]
                return job_data
            except Exception as e:
                logger.error(f"JobStorage: Supabase error fetching job {job_id}: {e}")
                # Only fall through to memory if job might exist there (created during Supabase outage)
                if job_id in self._memory_store:
                    logger.warning(f"JobStorage: Found job {job_id} in memory fallback after Supabase error")
                    return self._memory_store.get(job_id)
                return None

        # In-memory only mode (no Supabase configured)
        return self._memory_store.get(job_id)

    def update_job(self, job_id: str, updates: dict, profile_id: Optional[str] = None) -> Optional[dict]:
        """
        Update job fields.

        Args:
            job_id: Job ID
            updates: Dict with fields to update
            profile_id: Optional profile ID for logging context

        Returns:
            Updated job data or None if not found
        """
        # DB-04: Do in-memory update inside lock, Supabase I/O outside lock
        with self._update_lock:
            # Read from in-memory store first (no network call while holding lock)
            job = self._memory_store.get(job_id)
            if job is None:
                # Not in memory — will try Supabase outside lock below
                pass
            else:
                # Merge updates into in-memory copy
                job = job.copy()
                job.update(updates)
                job["updated_at"] = datetime.now(timezone.utc).isoformat()
                self._memory_store[job_id] = job.copy()

        # If not found in memory, try Supabase (outside lock)
        if job is None:
            job = self.get_job(job_id)
            if not job:
                logger.warning(f"JobStorage: Job {job_id} not found for update")
                return None
            job.update(updates)
            job["updated_at"] = datetime.now(timezone.utc).isoformat()
            with self._update_lock:
                self._memory_store[job_id] = job.copy()

        # Supabase I/O outside lock to avoid holding lock during network calls
        if self._supabase:
            try:
                # Build update data
                update_data = {
                    "status": job.get("status"),
                    "progress": job.get("progress"),
                    "data": job,
                    "updated_at": job["updated_at"]
                }
                # Include profile_id if provided
                if profile_id:
                    update_data["profile_id"] = profile_id

                # Update in Supabase
                self._supabase.table("jobs").update(update_data).eq("id", job_id).execute()

                if profile_id:
                    logger.debug(f"[Profile {profile_id}] JobStorage: Updated job {job_id} in Supabase")
                else:
                    logger.debug(f"JobStorage: Updated job {job_id} in Supabase")
            except Exception as e:
                logger.error(f"JobStorage: Failed to update job in Supabase: {e}, memory copy preserved")

        return job

    def list_jobs(self, status: Optional[str] = None, profile_id: Optional[str] = None, limit: int = 100) -> list:
        """
        List jobs.

        Args:
            status: Filter by status (optional)
            profile_id: Filter by profile ID (optional)
            limit: Max number of jobs to return

        Returns:
            List of job data dicts
        """
        if self._supabase:
            try:
                query = self._supabase.table("jobs").select("*").order("created_at", desc=True).limit(limit)
                if status:
                    query = query.eq("status", status)
                if profile_id:
                    query = query.eq("profile_id", profile_id)

                result = query.execute()
                # Extract job data from JSONB
                return [row.get("data", {}) for row in result.data]
            except Exception as e:
                logger.warning(f"JobStorage: Failed to list jobs from Supabase: {e}, using memory")

        # Fallback to memory
        jobs = list(self._memory_store.values())
        if status:
            jobs = [j for j in jobs if j.get("status") == status]
        if profile_id:
            jobs = [j for j in jobs if j.get("profile_id") == profile_id]

        # Sort by created_at desc
        jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
        return jobs[:limit]

    def delete_job(self, job_id: str) -> bool:
        """
        Delete job.

        Args:
            job_id: Job ID

        Returns:
            True if deleted, False if not found
        """
        if self._supabase:
            try:
                # DB-16: Check result.data before returning True
                result = self._supabase.table("jobs").delete().eq("id", job_id).execute()
                if not result.data:
                    logger.warning(f"JobStorage: Delete returned no data for job {job_id}")
                    return False
                logger.info(f"JobStorage: Deleted job {job_id} from Supabase")
                return True
            except Exception as e:
                logger.error(f"JobStorage: Failed to delete job from Supabase: {e}")

        # Fallback to memory
        if job_id in self._memory_store:
            del self._memory_store[job_id]
            logger.debug(f"JobStorage: Deleted job {job_id} from memory")
            return True

        return False

    def cancel_job(self, job_id: str) -> bool:
        """
        Mark a job as cancelled. Sets in-memory flag for fast checking
        and updates persistent status.

        Returns:
            True if job was found and cancelled, False otherwise.
        """
        with self._cancelled_lock:
            self._cancelled_jobs[job_id] = __import__('time').monotonic()
            # Evict oldest if over limit
            if len(self._cancelled_jobs) > self._MAX_CANCELLED:
                sorted_ids = sorted(self._cancelled_jobs, key=self._cancelled_jobs.get)
                for pid in sorted_ids[:len(self._cancelled_jobs) - self._MAX_CANCELLED]:
                    self._cancelled_jobs.pop(pid, None)

        # Update persistent storage
        result = self.update_job(job_id, {"status": "cancelled", "progress": "Cancelled"})
        if result:
            logger.info(f"JobStorage: Cancelled job {job_id}")
            return True

        logger.warning(f"JobStorage: Job {job_id} not found for cancellation")
        return False

    def is_job_cancelled(self, job_id: str) -> bool:
        """
        Fast check if a job has been flagged for cancellation.
        Uses in-memory dict for speed (no DB roundtrip).
        """
        with self._cancelled_lock:
            return job_id in self._cancelled_jobs

    def clear_job_cancelled(self, job_id: str):
        """Clear the cancellation flag for a job."""
        with self._cancelled_lock:
            self._cancelled_jobs.pop(job_id, None)

    def get_jobs_by_project(self, project_id: str, status: Optional[str] = None) -> list:
        """Get jobs for a specific project_id stored in job data.
        Avoids O(N) scan of list_jobs by querying directly by project_id.
        """
        results = []
        # Try Supabase first
        if self._supabase:
            try:
                query = self._supabase.table("jobs").select("*").eq("data->>project_id", project_id)
                if status:
                    query = query.eq("status", status)
                result = query.order("created_at", desc=True).limit(10).execute()
                if result.data:
                    return [row.get("data", row) for row in result.data]
            except Exception as e:
                logger.warning(f"Supabase query by project_id failed: {e}")
        # Fallback: scan in-memory jobs
        with self._update_lock:
            snapshot = list(self._memory_store.items())
        for job_id, job in snapshot:
            data = job if isinstance(job, dict) else {}
            if data.get("project_id") == project_id:
                if status is None or data.get("status") == status:
                    results.append(data)
        return results

    def cleanup_stale_jobs(self, max_age_minutes: int = 10) -> int:
        """Mark jobs stuck in 'processing' for too long as 'failed'.
        Called on server startup to recover from crashes.
        Returns count of jobs marked failed.
        """
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
        cutoff_iso = cutoff.isoformat()
        cleaned = 0

        # DB-05: Update status columns without overwriting the data JSONB blob.
        # The data column contains project_id, profile_id, input_path, etc. that
        # must be preserved for post-mortem debugging.
        if self._supabase:
            try:
                result = self._supabase.table("jobs").update({
                    "status": "failed",
                    "progress": "Server restarted — job did not complete",
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }).eq("status", "processing").lt("updated_at", cutoff_iso).execute()
                if result.data:
                    cleaned = len(result.data)
                    logger.info(f"Cleaned up {cleaned} stale processing jobs (bulk UPDATE)")
            except Exception as e:
                logger.warning(f"Supabase stale job cleanup failed: {e}")

        # DB-14: Also clean in-memory jobs and sync to Supabase
        # Keep snapshot AND mutation inside the lock to prevent races
        supabase_updates = []
        with self._update_lock:
            for job_id, job in list(self._memory_store.items()):
                if isinstance(job, dict) and job.get("status") == "processing":
                    updated = job.get("updated_at", "")
                    if updated and updated < cutoff_iso:
                        job["status"] = "failed"
                        job["progress"] = "Server restarted — job did not complete"
                        job["error"] = "Job was still processing when server restarted"
                        job["updated_at"] = datetime.now(timezone.utc).isoformat()
                        cleaned += 1
                        # Collect Supabase sync data (do I/O outside lock)
                        if self._supabase:
                            supabase_updates.append((job_id, {
                                "status": "failed",
                                "progress": job["progress"],
                                "data": dict(job),
                                "updated_at": job["updated_at"]
                            }))
        # Sync stale in-memory job status to Supabase (outside lock)
        for job_id, update_data in supabase_updates:
            try:
                self._supabase.table("jobs").update(update_data).eq("id", job_id).execute()
            except Exception as e:
                logger.warning(f"Failed to sync stale in-memory job {job_id} to Supabase: {e}")

        return cleaned

    def cleanup_old_jobs(self, days: int = 7) -> int:
        """
        Cleanup jobs older than N days from both Supabase and in-memory store.

        Args:
            days: Number of days to keep

        Returns:
            Number of jobs deleted
        """
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        count = 0

        # DB-15: Do Supabase cleanup first, then in-memory cleanup
        if self._supabase:
            try:
                result = self._supabase.table("jobs").delete().in_("status", ["failed", "completed", "cancelled"]).lt("created_at", cutoff).execute()
                db_count = len(result.data) if result.data else 0
                logger.info(f"JobStorage: Cleaned up {db_count} old jobs from Supabase (older than {days} days)")
                count += db_count
            except Exception as e:
                logger.error(f"JobStorage: Failed to cleanup old jobs from Supabase: {e}")

        # Clean up in-memory store — snapshot under lock
        with self._update_lock:
            snapshot = dict(self._memory_store)
        expired_keys = [
            job_id for job_id, job in snapshot.items()
            if job.get("created_at", "") < cutoff
        ]
        with self._update_lock:
            for job_id in expired_keys:
                self._memory_store.pop(job_id, None)
        if expired_keys:
            logger.info(f"JobStorage: Cleaned up {len(expired_keys)} old jobs from memory")
        count += len(expired_keys)

        return count


# Singleton instance
_job_storage: Optional[JobStorage] = None
_job_storage_lock = threading.Lock()


def get_job_storage() -> JobStorage:
    """Get the singleton JobStorage instance."""
    global _job_storage
    if _job_storage is None:
        with _job_storage_lock:
            if _job_storage is None:
                _job_storage = JobStorage()
    return _job_storage
