"""
Cost Tracker Service.
Tracks API costs for ElevenLabs TTS and Gemini Vision.
Saves to Supabase and local JSON backup.
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

# Pricing constants (approximate)
ELEVENLABS_COST_PER_CHAR = 0.00022  # ~$0.22 per 1000 chars (Creator plan)
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
        self._supabase = None
        self._init_supabase()

    def _init_supabase(self):
        """Initialize Supabase client."""
        try:
            from app.config import get_settings
            settings = get_settings()

            if settings.supabase_url and settings.supabase_key:
                from supabase import create_client
                self._supabase = create_client(settings.supabase_url, settings.supabase_key)
                logger.info("Supabase client initialized for cost tracking")
            else:
                logger.warning("Supabase credentials not found, using local storage only")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase: {e}")
            self._supabase = None

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
        except Exception:
            return {"entries": [], "totals": {"elevenlabs": 0, "gemini": 0}}

    def _save_log(self, data: Dict):
        """Save the cost log."""
        with open(self.log_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _save_to_supabase(self, entry: CostEntry, profile_id: Optional[str] = None) -> bool:
        """Save entry to Supabase."""
        if not self._supabase:
            return False

        try:
            data = {
                "job_id": entry.job_id,
                "service": entry.service,
                "operation": entry.operation,
                "units": entry.input_units,
                "estimated_cost": entry.cost_usd,
                "profile_id": profile_id,  # Add profile_id column
                "details": entry.details
            }

            result = self._supabase.table("api_costs").insert(data).execute()
            if profile_id:
                logger.info(f"[Profile {profile_id}] Cost saved: {entry.service} - ${entry.cost_usd}")
            else:
                logger.info(f"Cost saved to Supabase: {entry.service} - ${entry.cost_usd}")
            return True
        except Exception as e:
            logger.error(f"Failed to save to Supabase: {e}")
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
            timestamp=datetime.now().isoformat(),
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
            timestamp=datetime.now().isoformat(),
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
        """Add entry to local log and update totals."""
        data = self._load_log()
        data["entries"].append(asdict(entry))
        data["totals"][entry.service] = round(
            data["totals"].get(entry.service, 0) + entry.cost_usd, 6
        )
        self._save_log(data)

    def get_summary(self, profile_id: Optional[str] = None) -> Dict:
        """Get cost summary from Supabase or local."""
        # Try Supabase first
        if self._supabase:
            try:
                return self._get_summary_from_supabase(profile_id=profile_id)
            except Exception as e:
                logger.warning(f"Failed to get summary from Supabase: {e}, falling back to local")

        return self._get_summary_from_local(profile_id=profile_id)

    def _get_summary_from_supabase(self, profile_id: Optional[str] = None) -> Dict:
        """Get summary from Supabase."""
        today = datetime.now().date().isoformat()

        # Get totals - filter by profile if provided
        query = self._supabase.table("api_costs").select("service, estimated_cost")
        if profile_id:
            query = query.eq("profile_id", profile_id)
        all_costs = query.execute()

        totals = {"elevenlabs": 0, "gemini": 0}
        for row in all_costs.data:
            service = row["service"]
            if service in totals:
                totals[service] += float(row["estimated_cost"] or 0)

        # Get today's costs
        today_query = self._supabase.table("api_costs")\
            .select("service, estimated_cost")\
            .gte("created_at", f"{today}T00:00:00")
        if profile_id:
            today_query = today_query.eq("profile_id", profile_id)
        today_costs = today_query.execute()

        today_totals = {"elevenlabs": 0, "gemini": 0}
        for row in today_costs.data:
            service = row["service"]
            if service in today_totals:
                today_totals[service] += float(row["estimated_cost"] or 0)

        # Get last 10 entries
        last_query = self._supabase.table("api_costs")\
            .select("*")\
            .order("created_at", desc=True)\
            .limit(10)
        if profile_id:
            last_query = last_query.eq("profile_id", profile_id)
        last_entries = last_query.execute()

        # Count total entries
        count_query = self._supabase.table("api_costs").select("id", count="exact")
        if profile_id:
            count_query = count_query.eq("profile_id", profile_id)
        count_result = count_query.execute()

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

        today = datetime.now().date().isoformat()
        today_entries = [e for e in entries if e["timestamp"].startswith(today)]

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
                "elevenlabs": round(sum(e["cost_usd"] for e in today_entries if e["service"] == "elevenlabs"), 4),
                "gemini": round(sum(e["cost_usd"] for e in today_entries if e["service"] == "gemini"), 4),
            },
            "entry_count": len(entries),
            "last_entries": entries[-10:][::-1]
        }

    def get_all_entries(self, profile_id: Optional[str] = None) -> List[Dict]:
        """Get all cost entries, optionally filtered by profile."""
        if self._supabase:
            try:
                query = self._supabase.table("api_costs")\
                    .select("*")\
                    .order("created_at", desc=True)
                if profile_id:
                    query = query.eq("profile_id", profile_id)
                result = query.execute()
                return result.data
            except Exception as e:
                logger.warning(f"Failed to get entries from Supabase: {e}")

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
        now = datetime.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        if self._supabase:
            try:
                result = self._supabase.table("api_costs")\
                    .select("estimated_cost")\
                    .eq("profile_id", profile_id)\
                    .gte("created_at", month_start.isoformat())\
                    .execute()

                total = sum(float(row.get("estimated_cost", 0) or 0) for row in result.data)
                return round(total, 4)
            except Exception as e:
                logger.warning(f"Failed to get monthly costs from Supabase: {e}")

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
            return False, 0.0, 0.0  # Unlimited

        current = self.get_monthly_costs(profile_id)
        exceeded = current >= monthly_quota
        return exceeded, current, monthly_quota


# Singleton instance
_tracker: Optional[CostTracker] = None


def get_cost_tracker() -> CostTracker:
    """Get the cost tracker instance."""
    global _tracker
    if _tracker is None:
        from app.config import get_settings
        settings = get_settings()
        _tracker = CostTracker(settings.logs_dir)
    # Reinitialize supabase if not connected
    elif _tracker._supabase is None:
        _tracker._init_supabase()
    return _tracker


def reset_cost_tracker():
    """Reset the singleton (useful for testing/reloading)."""
    global _tracker
    _tracker = None
