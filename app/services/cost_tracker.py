"""
Cost Tracker Service.
Tracks API costs for ElevenLabs TTS and Gemini Vision.
Saves to Supabase and local JSON backup.
"""
import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, List
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

# Pricing constants (approximate)
ELEVENLABS_COST_PER_CHAR = 0.00024  # ~$0.24 per 1000 chars (Scale plan pricing)
GEMINI_COST_PER_IMAGE = 0.02  # $0.02 per image
GEMINI_COST_PER_1K_INPUT_TOKENS = 0.000075
GEMINI_COST_PER_1K_OUTPUT_TOKENS = 0.0003


@dataclass
class CostEntry:
    """A single cost entry."""
    timestamp: str
    job_id: str
    service: str  # "elevenlabs" or "gemini"
    operation: str  # "tts", "video_analysis"
    input_units: int  # characters for TTS, frames for Gemini
    cost_usd: float
    details: Dict


class CostTracker:
    """Tracks and logs API costs to Supabase and local JSON."""

    def __init__(self, log_dir: Path):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.log_file = self.log_dir / "cost_log.json"
        self._ensure_log_file()
        self._repo = None
        self._log_lock = threading.Lock()
        self._init_supabase()

    def _init_supabase(self):
        """Initialize repository client."""
        try:
            from app.repositories.factory import get_repository
            self._repo = get_repository()
            if self._repo:
                logger.info("Repository initialized for cost tracking")
            else:
                logger.warning("Repository not available, using local storage only")
        except Exception as e:
            logger.error(f"Failed to initialize repository: {e}")
            self._repo = None

    def _ensure_log_file(self):
        """Create log file if it doesn't exist."""
        if not self.log_file.exists():
            with open(self.log_file, 'w', encoding='utf-8') as f:
                json.dump({"entries": [], "totals": {"elevenlabs": 0, "gemini": 0}}, f)

    def _load_log(self) -> Dict:
        """Load the cost log."""
        try:
            with open(self.log_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError:
            logger.warning("Cost log corrupted, backing up and resetting")
            try:
                backup = self.log_file.with_suffix('.json.bak')
                self.log_file.rename(backup)
            except Exception:
                pass
            return {"entries": [], "totals": {"elevenlabs": 0, "gemini": 0}}
        except Exception:
            return {"entries": [], "totals": {"elevenlabs": 0, "gemini": 0}}

    def _save_log(self, data: Dict):
        """Save the cost log with file-level locking. Writes to temp file then renames for atomicity."""
        try:
            tmp_file = self.log_file.with_suffix('.json.tmp')
            with open(tmp_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, default=str)
            tmp_file.replace(self.log_file)
        except Exception as e:
            logger.error(f"Failed to save cost log: {e}")
            # Clean up temp file on failure
            try:
                tmp_file.unlink(missing_ok=True)
            except Exception:
                pass

    def _save_to_supabase(self, entry: CostEntry, profile_id: Optional[str] = None) -> bool:
        """Save entry to repository (DB-09)."""
        if not self._repo:
            return False

        data = {
            "service": entry.service,
            "operation": entry.operation,
            "cost": entry.cost_usd,
            "profile_id": profile_id,
            "metadata": {
                "job_id": entry.job_id,
                "units": entry.input_units,
                "details": entry.details,
            },
        }

        try:
            self._repo.log_cost(data)
            if profile_id:
                logger.info(f"[Profile {profile_id}] Cost saved: {entry.service} - ${entry.cost_usd}")
            else:
                logger.info(f"Cost saved to repository: {entry.service} - ${entry.cost_usd}")
            return True
        except Exception as e:
            logger.error(f"Failed to save cost to repository: {e}")
            return False

    def log_elevenlabs_tts(
        self,
        job_id: str,
        characters: int,
        profile_id: Optional[str] = None,
        text_preview: str = ""
    ) -> CostEntry:
        """Log ElevenLabs TTS cost."""
        cost = characters * ELEVENLABS_COST_PER_CHAR

        entry = CostEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            job_id=job_id,
            service="elevenlabs",
            operation="tts",
            input_units=characters,
            cost_usd=round(cost, 6),
            details={
                "profile_id": profile_id,  # Include in details
                "text_preview": text_preview[:100] + "..." if len(text_preview) > 100 else text_preview,
                "rate": f"${ELEVENLABS_COST_PER_CHAR * 1000:.2f}/1000 chars"
            }
        )

        self._add_entry(entry)
        self._save_to_supabase(entry, profile_id=profile_id)  # Pass profile_id
        if profile_id:
            logger.info(f"[Profile {profile_id}] Cost logged: ElevenLabs TTS - {characters} chars = ${cost:.4f}")
        else:
            logger.info(f"Cost logged: ElevenLabs TTS - {characters} chars = ${cost:.4f}")
        return entry

    def log_gemini_analysis(
        self,
        job_id: str,
        frames_analyzed: int,
        profile_id: Optional[str] = None,
        video_duration: float = 0
    ) -> CostEntry:
        """Log Gemini video analysis cost."""
        # Cost = frames * image cost + estimated tokens
        image_cost = frames_analyzed * GEMINI_COST_PER_IMAGE
        # Rough estimate for prompt/response tokens
        token_cost = 0.01  # ~$0.01 for prompt + response
        total_cost = image_cost + token_cost

        entry = CostEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            job_id=job_id,
            service="gemini",
            operation="video_analysis",
            input_units=frames_analyzed,
            cost_usd=round(total_cost, 6),
            details={
                "profile_id": profile_id,  # Include in details
                "video_duration_sec": video_duration,
                "frames_analyzed": frames_analyzed,
                "image_cost": round(image_cost, 4),
                "token_cost_estimate": round(token_cost, 4),
                "rate": f"${GEMINI_COST_PER_IMAGE}/frame"
            }
        )

        self._add_entry(entry)
        self._save_to_supabase(entry, profile_id=profile_id)  # Pass profile_id
        if profile_id:
            logger.info(f"[Profile {profile_id}] Cost logged: Gemini Analysis - {frames_analyzed} frames = ${total_cost:.4f}")
        else:
            logger.info(f"Cost logged: Gemini Analysis - {frames_analyzed} frames = ${total_cost:.4f}")
        return entry

    def _add_entry(self, entry: CostEntry):
        """Add entry to local log and update totals. Rotates to keep last 10000 entries."""
        with self._log_lock:
            data = self._load_log()
            data["entries"].append(asdict(entry))
            # Log rotation: keep only last 10000 entries
            if len(data["entries"]) > 10000:
                data["entries"] = data["entries"][-10000:]
            data["totals"][entry.service] = round(
                data["totals"].get(entry.service, 0) + entry.cost_usd, 6
            )
            self._save_log(data)

    def get_summary(self, profile_id: Optional[str] = None) -> Dict:
        """Get cost summary from repository or local."""
        # Try repository first
        if self._repo:
            try:
                return self._get_summary_from_supabase(profile_id=profile_id)
            except Exception as e:
                logger.warning(f"Failed to get summary from repository: {e}, falling back to local")

        return self._get_summary_from_local(profile_id=profile_id)

    def _get_summary_from_supabase(self, profile_id: Optional[str] = None) -> Dict:
        """Get summary from repository.

        DB-10: Ideally this would use an RPC call.
        For now, we select needed columns and aggregate client-side.
        """
        from app.repositories.models import QueryFilters

        today = datetime.now(timezone.utc).date().isoformat()

        # Get totals - filter by profile if provided (DB-10: select only needed columns)
        filters = QueryFilters(select="service, cost")
        if profile_id:
            filters.eq["profile_id"] = profile_id
        all_costs = self._repo.table_query("api_costs", "select", filters=filters)

        totals = {"elevenlabs": 0, "gemini": 0}
        for row in all_costs.data:
            service = row["service"]
            if service in totals:
                totals[service] += float(row["cost"] or 0)

        # Get today's costs
        today_filters = QueryFilters(
            select="service, cost",
            gte={"created_at": f"{today}T00:00:00"},
        )
        if profile_id:
            today_filters.eq["profile_id"] = profile_id
        today_costs = self._repo.table_query("api_costs", "select", filters=today_filters)

        today_totals = {"elevenlabs": 0, "gemini": 0}
        for row in today_costs.data:
            service = row["service"]
            if service in today_totals:
                today_totals[service] += float(row["cost"] or 0)

        # Get last 10 entries
        last_filters = QueryFilters(
            order_by="created_at", order_desc=True, limit=10,
        )
        if profile_id:
            last_filters.eq["profile_id"] = profile_id
        last_entries = self._repo.table_query("api_costs", "select", filters=last_filters)

        # Count total entries
        count_filters = QueryFilters(select="id")
        if profile_id:
            count_filters.eq["profile_id"] = profile_id
        count_result = self._repo.table_query("api_costs", "select", filters=count_filters)

        return {
            "source": "supabase",
            "totals": {k: round(v, 4) for k, v in totals.items()},
            "total_all": round(sum(totals.values()), 4),
            "today": {k: round(v, 4) for k, v in today_totals.items()},
            "entry_count": count_result.count or len(all_costs.data),
            "last_entries": last_entries.data
        }

    def _get_summary_from_local(self, profile_id: Optional[str] = None) -> Dict:
        """Get summary from local JSON."""
        data = self._load_log()
        entries = data.get("entries", [])

        # Filter by profile_id if provided (check in details dict)
        if profile_id:
            entries = [e for e in entries if e.get("details", {}).get("profile_id") == profile_id]

        today = datetime.now(timezone.utc).date().isoformat()
        today_entries = [e for e in entries if e.get("timestamp", "").startswith(today)]

        # Recalculate totals from filtered entries
        totals = {"elevenlabs": 0, "gemini": 0}
        for e in entries:
            service = e.get("service")
            if service in totals:
                totals[service] += e.get("cost_usd", 0)

        return {
            "source": "local",
            "totals": {k: round(v, 4) for k, v in totals.items()},
            "total_all": round(sum(totals.values()), 4),
            "today": {
                "elevenlabs": round(sum(e.get("cost_usd", 0) for e in today_entries if e.get("service") == "elevenlabs"), 4),
                "gemini": round(sum(e.get("cost_usd", 0) for e in today_entries if e.get("service") == "gemini"), 4),
            },
            "entry_count": len(entries),
            "last_entries": entries[-10:][::-1]
        }

    def get_all_entries(self, profile_id: Optional[str] = None) -> List[Dict]:
        """Get all cost entries, optionally filtered by profile."""
        if self._repo:
            try:
                from app.repositories.models import QueryFilters
                filters = QueryFilters(
                    order_by="created_at", order_desc=True, limit=1000,
                )
                if profile_id:
                    filters.eq["profile_id"] = profile_id
                result = self._repo.table_query("api_costs", "select", filters=filters)
                return result.data
            except Exception as e:
                logger.warning(f"Failed to get entries from repository: {e}")

        data = self._load_log()
        entries = data.get("entries", [])
        # Filter by profile_id if provided (check in details dict)
        if profile_id:
            entries = [e for e in entries if e.get("details", {}).get("profile_id") == profile_id]
        return entries

    def get_monthly_costs(self, profile_id: str) -> float:
        """
        Get current calendar month's total costs for a profile.

        Args:
            profile_id: Profile UUID

        Returns:
            Total cost in USD for current month
        """
        # Get first day of current month
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        if self._repo:
            try:
                from app.repositories.models import QueryFilters
                filters = QueryFilters(
                    select="cost",
                    eq={"profile_id": profile_id},
                    gte={"created_at": month_start.isoformat()},
                )
                result = self._repo.table_query("api_costs", "select", filters=filters)

                total = sum(float(row.get("cost", 0) or 0) for row in result.data)
                return round(total, 4)
            except Exception as e:
                logger.warning(f"Failed to get monthly costs from repository: {e}")

        # Fallback to local log
        data = self._load_log()
        entries = data.get("entries", [])

        # Filter by profile and current month
        month_prefix = month_start.strftime("%Y-%m")
        monthly_entries = [
            e for e in entries
            if e.get("details", {}).get("profile_id") == profile_id
            and e.get("timestamp", "").startswith(month_prefix)
        ]

        total = sum(e.get("cost_usd", 0) for e in monthly_entries)
        return round(total, 4)

    def check_quota(self, profile_id: str, monthly_quota: float) -> tuple:
        """
        Check if profile has exceeded quota.

        Args:
            profile_id: Profile UUID
            monthly_quota: Monthly quota in USD (0 = unlimited)

        Returns:
            Tuple of (exceeded: bool, current_costs: float, quota: float)
        """
        if monthly_quota <= 0:
            # DB-24: Return real cost values even when quota is unlimited
            current = self.get_monthly_costs(profile_id)
            return False, current, 0.0  # Unlimited — never exceeded, but report actual costs

        current = self.get_monthly_costs(profile_id)
        exceeded = current >= monthly_quota
        return exceeded, current, monthly_quota


# Singleton instance
_tracker: Optional[CostTracker] = None
_tracker_lock = threading.Lock()


def get_cost_tracker() -> CostTracker:
    """Get the cost tracker instance."""
    global _tracker
    if _tracker is None:
        with _tracker_lock:
            if _tracker is None:
                from app.config import get_settings
                settings = get_settings()
                _tracker = CostTracker(settings.logs_dir)
    # DB-21: Protect re-initialization with lock to prevent concurrent _init_supabase calls
    elif _tracker._repo is None:
        with _tracker_lock:
            if _tracker._repo is None:
                _tracker._init_supabase()
    return _tracker


def reset_cost_tracker():
    """Reset the singleton (useful for testing/reloading)."""
    global _tracker
    _tracker = None
