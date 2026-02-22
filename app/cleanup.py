"""
Data retention cleanup CLI for Edit Factory.

Removes temp files, output files, and failed job records older than
the retention window. Run periodically (e.g. cron) to prevent unbounded
growth of transient data.

Usage:
    python -m app.cleanup [--days N] [--dry-run] [--temp-only] [--jobs-only]

Examples:
    python -m app.cleanup --dry-run --days 7   # Preview what would be deleted
    python -m app.cleanup --days 7             # Delete files/jobs older than 7 days
    python -m app.cleanup --days 0 --temp-only # Delete all temp files (no age filter)
"""
import argparse
import logging
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Bootstrap JSON logging before any other app imports so cleanup output is
# also structured JSON (importable even when run as __main__).
try:
    from app.logging_config import setup_logging
    setup_logging()
except ImportError:
    # Fallback: plain logging if invoked outside the package context
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

logger = logging.getLogger(__name__)

# Base directory is the project root (parent of app/)
_PROJECT_ROOT = Path(__file__).parent.parent


def _delete_old_files(directory: Path, cutoff: datetime, dry_run: bool) -> int:
    """
    Walk *directory* and delete files older than *cutoff*.

    Empty sub-directories are removed after their files are deleted.
    Returns the number of files deleted (or that would be deleted in dry-run).
    """
    if not directory.exists():
        logger.info("Directory does not exist, skipping", extra={"directory": str(directory)})
        return 0

    deleted = 0
    dirs_to_check = []

    for root, dirs, files in os.walk(str(directory), topdown=False):
        root_path = Path(root)
        for filename in files:
            file_path = root_path / filename
            try:
                mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                if mtime < cutoff:
                    if dry_run:
                        logger.info(
                            "Would delete file",
                            extra={"file": str(file_path), "mtime": mtime.isoformat()}
                        )
                    else:
                        file_path.unlink()
                        logger.info(
                            "Deleted file",
                            extra={"file": str(file_path), "mtime": mtime.isoformat()}
                        )
                    deleted += 1
            except OSError as exc:
                logger.warning("Could not process file", extra={"file": str(file_path), "error": str(exc)})

        # Track directories for possible empty-dir cleanup
        if root_path != directory:
            dirs_to_check.append(root_path)

    # Remove empty directories (bottom-up, already topdown=False)
    if not dry_run:
        for dir_path in sorted(dirs_to_check, key=lambda p: len(p.parts), reverse=True):
            try:
                if dir_path.exists() and not any(dir_path.iterdir()):
                    dir_path.rmdir()
                    logger.info("Removed empty directory", extra={"directory": str(dir_path)})
            except OSError:
                pass  # Non-fatal — directory may have been removed already

    return deleted


def cleanup_temp_files(days: int, dry_run: bool) -> int:
    """Remove files from the temp/ directory older than *days* days."""
    temp_dir = _PROJECT_ROOT / "temp"
    cutoff = datetime.now() - timedelta(days=days)
    count = _delete_old_files(temp_dir, cutoff, dry_run)
    logger.info(
        "Temp file cleanup complete",
        extra={"directory": str(temp_dir), "days": days, "files_affected": count, "dry_run": dry_run}
    )
    return count


def cleanup_output_files(days: int, dry_run: bool) -> int:
    """Remove files from the output/ directory older than *days* days."""
    output_dir = _PROJECT_ROOT / "output"
    cutoff = datetime.now() - timedelta(days=days)
    count = _delete_old_files(output_dir, cutoff, dry_run)
    logger.info(
        "Output file cleanup complete",
        extra={"directory": str(output_dir), "days": days, "files_affected": count, "dry_run": dry_run}
    )
    return count


def cleanup_old_jobs(days: int, dry_run: bool) -> int:
    """
    Remove failed/completed job records older than *days* days.

    Uses JobStorage.cleanup_old_jobs() for Supabase-backed storage.
    For in-memory fallback mode, iterates _memory_store directly.
    """
    try:
        from app.services.job_storage import get_job_storage
    except ImportError as exc:
        logger.error("Cannot import JobStorage", extra={"error": str(exc)})
        return 0

    storage = get_job_storage()
    cutoff = datetime.now() - timedelta(days=days)

    if dry_run:
        # Preview: count matching jobs without deleting
        terminal_statuses = {"failed", "completed", "cancelled"}
        count = 0
        if storage._supabase:
            try:
                result = storage._supabase.table("jobs").select("id,status,created_at")\
                    .lt("created_at", cutoff.isoformat()).execute()
                matching = [r for r in (result.data or []) if r.get("status") in terminal_statuses]
                count = len(matching)
                for row in matching:
                    logger.info(
                        "Would delete job",
                        extra={"job_id": row.get("id"), "status": row.get("status"),
                               "created_at": row.get("created_at")}
                    )
            except Exception as exc:
                logger.warning("Could not query jobs for dry-run", extra={"error": str(exc)})
        else:
            # In-memory fallback
            for job_id, job in list(storage._memory_store.items()):
                if job.get("status") in terminal_statuses:
                    created_str = job.get("created_at", "")
                    try:
                        created = datetime.fromisoformat(created_str)
                        if created < cutoff:
                            logger.info(
                                "Would delete job",
                                extra={"job_id": job_id, "status": job.get("status"),
                                       "created_at": created_str}
                            )
                            count += 1
                    except ValueError:
                        pass

        logger.info("Job cleanup dry-run complete", extra={"jobs_would_delete": count, "days": days})
        return count

    # Actual deletion via Supabase
    if storage._supabase:
        count = storage.cleanup_old_jobs(days)
    else:
        # In-memory fallback: manually remove old failed/completed jobs
        terminal_statuses = {"failed", "completed", "cancelled"}
        to_delete = []
        for job_id, job in list(storage._memory_store.items()):
            if job.get("status") in terminal_statuses:
                created_str = job.get("created_at", "")
                try:
                    created = datetime.fromisoformat(created_str)
                    if created < cutoff:
                        to_delete.append(job_id)
                except ValueError:
                    pass
        for job_id in to_delete:
            del storage._memory_store[job_id]
        count = len(to_delete)
        logger.info("Removed in-memory jobs", extra={"count": count})

    logger.info(
        "Job cleanup complete",
        extra={"jobs_deleted": count, "days": days, "dry_run": dry_run}
    )
    return count


def main():
    parser = argparse.ArgumentParser(
        description="Edit Factory data retention cleanup — remove temp files and stale job records."
    )
    parser.add_argument(
        "--days", type=int, default=7,
        help="Retention window in days. Files/jobs older than this are eligible for deletion (default: 7)."
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview what would be deleted without actually deleting anything."
    )
    parser.add_argument(
        "--temp-only", action="store_true",
        help="Only clean temp/ and output/ directories; skip job records."
    )
    parser.add_argument(
        "--jobs-only", action="store_true",
        help="Only clean old job records; skip temp/ and output/ directories."
    )

    args = parser.parse_args()

    if args.dry_run:
        logger.info("Running in dry-run mode — nothing will be deleted")

    totals = {"temp": 0, "output": 0, "jobs": 0}

    if not args.jobs_only:
        totals["temp"] = cleanup_temp_files(args.days, args.dry_run)
        totals["output"] = cleanup_output_files(args.days, args.dry_run)

    if not args.temp_only:
        totals["jobs"] = cleanup_old_jobs(args.days, args.dry_run)

    action = "Would remove" if args.dry_run else "Removed"
    logger.info(
        "Cleanup finished",
        extra={
            "dry_run": args.dry_run,
            "days": args.days,
            "temp_files": totals["temp"],
            "output_files": totals["output"],
            "jobs": totals["jobs"],
            "summary": (
                f"{action} {totals['temp']} temp file(s), "
                f"{totals['output']} output file(s), "
                f"{totals['jobs']} job record(s)"
            )
        }
    )


if __name__ == "__main__":
    main()
