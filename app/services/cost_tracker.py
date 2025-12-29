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
        except:
            return {"entries": [], "totals": {"elevenlabs": 0, "gemini": 0}}

    def _save_log(self, data: Dict):
        """Save the cost log."""
        with open(self.log_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _save_to_supabase(self, entry: CostEntry) -> bool:
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
                "details": entry.details
            }

            result = self._supabase.table("api_costs").insert(data).execute()
            logger.info(f"Cost saved to Supabase: {entry.service} - ${entry.cost_usd}")
            return True
        except Exception as e:
            logger.error(f"Failed to save to Supabase: {e}")
            return False

    def log_elevenlabs_tts(
        self,
        job_id: str,
        characters: int,
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
                "text_preview": text_preview[:100] + "..." if len(text_preview) > 100 else text_preview,
                "rate": f"${ELEVENLABS_COST_PER_CHAR * 1000:.2f}/1000 chars"
            }
        )

        self._add_entry(entry)
        self._save_to_supabase(entry)
        logger.info(f"Cost logged: ElevenLabs TTS - {characters} chars = ${cost:.4f}")
        return entry

    def log_gemini_analysis(
        self,
        job_id: str,
        frames_analyzed: int,
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
                "video_duration_sec": video_duration,
                "frames_analyzed": frames_analyzed,
                "image_cost": round(image_cost, 4),
                "token_cost_estimate": round(token_cost, 4),
                "rate": f"${GEMINI_COST_PER_IMAGE}/frame"
            }
        )

        self._add_entry(entry)
        self._save_to_supabase(entry)
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

    def get_summary(self) -> Dict:
        """Get cost summary from Supabase or local."""
        # Try Supabase first
        if self._supabase:
            try:
                return self._get_summary_from_supabase()
            except Exception as e:
                logger.warning(f"Failed to get summary from Supabase: {e}, falling back to local")

        return self._get_summary_from_local()

    def _get_summary_from_supabase(self) -> Dict:
        """Get summary from Supabase."""
        today = datetime.now().date().isoformat()

        # Get totals
        all_costs = self._supabase.table("api_costs").select("service, estimated_cost").execute()

        totals = {"elevenlabs": 0, "gemini": 0}
        for row in all_costs.data:
            service = row["service"]
            if service in totals:
                totals[service] += float(row["estimated_cost"] or 0)

        # Get today's costs
        today_costs = self._supabase.table("api_costs")\
            .select("service, estimated_cost")\
            .gte("created_at", f"{today}T00:00:00")\
            .execute()

        today_totals = {"elevenlabs": 0, "gemini": 0}
        for row in today_costs.data:
            service = row["service"]
            if service in today_totals:
                today_totals[service] += float(row["estimated_cost"] or 0)

        # Get last 10 entries
        last_entries = self._supabase.table("api_costs")\
            .select("*")\
            .order("created_at", desc=True)\
            .limit(10)\
            .execute()

        # Count total entries
        count_result = self._supabase.table("api_costs").select("id", count="exact").execute()

        return {
            "source": "supabase",
            "totals": {k: round(v, 4) for k, v in totals.items()},
            "total_all": round(sum(totals.values()), 4),
            "today": {k: round(v, 4) for k, v in today_totals.items()},
            "entry_count": count_result.count or len(all_costs.data),
            "last_entries": last_entries.data
        }

    def _get_summary_from_local(self) -> Dict:
        """Get summary from local JSON."""
        data = self._load_log()
        entries = data.get("entries", [])

        today = datetime.now().date().isoformat()
        today_entries = [e for e in entries if e["timestamp"].startswith(today)]

        return {
            "source": "local",
            "totals": data.get("totals", {}),
            "total_all": round(sum(data.get("totals", {}).values()), 4),
            "today": {
                "elevenlabs": round(sum(e["cost_usd"] for e in today_entries if e["service"] == "elevenlabs"), 4),
                "gemini": round(sum(e["cost_usd"] for e in today_entries if e["service"] == "gemini"), 4),
            },
            "entry_count": len(entries),
            "last_entries": entries[-10:][::-1]
        }

    def get_all_entries(self) -> List[Dict]:
        """Get all cost entries."""
        if self._supabase:
            try:
                result = self._supabase.table("api_costs")\
                    .select("*")\
                    .order("created_at", desc=True)\
                    .execute()
                return result.data
            except Exception as e:
                logger.warning(f"Failed to get entries from Supabase: {e}")

        data = self._load_log()
        return data.get("entries", [])


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
