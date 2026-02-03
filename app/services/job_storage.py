"""
Job Storage Service - Persistent job tracking with Supabase.
Replaces in-memory job_store from routes.py with persistent storage.
"""
import logging
from datetime import datetime
from typing import Optional, Dict, Any
from pathlib import Path

logger = logging.getLogger(__name__)


class JobStorage:
    """
    Persistent job storage using Supabase.
    Falls back to in-memory dict if Supabase unavailable (backward compatibility).
    """

    def __init__(self):
        self._supabase = None
        self._memory_store: Dict[str, dict] = {}
        self._init_supabase()

    def _init_supabase(self):
        """Initialize Supabase client."""
        try:
            from app.config import get_settings
            from supabase import create_client

            settings = get_settings()
            if settings.supabase_url and settings.supabase_key:
                self._supabase = create_client(settings.supabase_url, settings.supabase_key)
                logger.info("JobStorage: Supabase initialized")
            else:
                logger.warning("JobStorage: Supabase credentials missing, using in-memory fallback")
        except Exception as e:
            logger.error(f"JobStorage: Failed to initialize Supabase: {e}")
            self._supabase = None

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
        job_data["created_at"] = datetime.now().isoformat()
        job_data["updated_at"] = datetime.now().isoformat()

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
                return job_data
        else:
            # In-memory storage
            self._memory_store[job_id] = job_data
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
                result = self._supabase.table("jobs").select("*").eq("id", job_id).single().execute()
                if result.data:
                    # Extract job data from JSONB column
                    return result.data.get("data", {})
            except Exception as e:
                logger.warning(f"JobStorage: Failed to get job from Supabase: {e}, trying memory")

        # Fallback to memory
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
        # Get current job
        job = self.get_job(job_id)
        if not job:
            logger.warning(f"JobStorage: Job {job_id} not found for update")
            return None

        # Merge updates
        job.update(updates)
        job["updated_at"] = datetime.now().isoformat()

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
                return job
            except Exception as e:
                logger.error(f"JobStorage: Failed to update job in Supabase: {e}, using memory")
                # Fallback to memory
                self._memory_store[job_id] = job
                return job
        else:
            # In-memory storage
            self._memory_store[job_id] = job
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
                self._supabase.table("jobs").delete().eq("id", job_id).execute()
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

    def cleanup_old_jobs(self, days: int = 7) -> int:
        """
        Cleanup jobs older than N days.

        Args:
            days: Number of days to keep

        Returns:
            Number of jobs deleted
        """
        if not self._supabase:
            logger.warning("JobStorage: Cleanup only works with Supabase")
            return 0

        try:
            from datetime import timedelta
            cutoff = (datetime.now() - timedelta(days=days)).isoformat()

            result = self._supabase.table("jobs").delete().lt("created_at", cutoff).execute()
            count = len(result.data) if result.data else 0
            logger.info(f"JobStorage: Cleaned up {count} old jobs (older than {days} days)")
            return count
        except Exception as e:
            logger.error(f"JobStorage: Failed to cleanup old jobs: {e}")
            return 0


# Singleton instance
_job_storage: Optional[JobStorage] = None


def get_job_storage() -> JobStorage:
    """Get the singleton JobStorage instance."""
    global _job_storage
    if _job_storage is None:
        _job_storage = JobStorage()
    return _job_storage
