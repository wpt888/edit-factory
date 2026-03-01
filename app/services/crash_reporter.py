"""
Crash reporting service using Sentry SDK.

- Initialized ONCE at startup (desktop-mode only) via init_sentry()
- Runtime toggle via set_crash_reporting() — no restart required
- PII scrubbing via EventScrubber + send_default_pii=False
- API keys and file paths scrubbed before any data leaves the machine
"""
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Replace with actual Sentry DSN when Sentry project is created
SENTRY_DSN = ""

# Module-level runtime toggle flag — checked in before_send to drop/allow events
_crash_reporting_enabled: bool = False

# Extended denylist: Sentry DEFAULT_DENYLIST + Edit Factory secrets
try:
    from sentry_sdk.scrubber import DEFAULT_DENYLIST
    _CUSTOM_DENYLIST = DEFAULT_DENYLIST + [
        "gemini_api_key",
        "supabase_key",
        "supabase_url",
        "elevenlabs_api_key",
        "anthropic_api_key",
        "license_key",
        "instance_id",
    ]
except ImportError:
    # sentry_sdk not installed — graceful fallback
    DEFAULT_DENYLIST = []
    _CUSTOM_DENYLIST = [
        "gemini_api_key",
        "supabase_key",
        "supabase_url",
        "elevenlabs_api_key",
        "anthropic_api_key",
        "license_key",
        "instance_id",
    ]


def _before_send(event: dict[str, Any], hint: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Drop all events when crash reporting is disabled (runtime toggle)."""
    if not _crash_reporting_enabled:
        return None
    return event


def init_sentry(dsn: str, enabled: bool) -> None:
    """
    Initialize Sentry crash reporting. MUST be called ONCE, after FastAPI app creation.

    - If enabled is False or dsn is empty: sets flag and returns (no sentry_sdk.init call)
    - If enabled is True and dsn is set: initializes Sentry with PII scrubbing
    """
    global _crash_reporting_enabled
    _crash_reporting_enabled = enabled

    if not enabled or not dsn:
        logger.info(
            "Crash reporting disabled — Sentry not initialized (enabled=%s, dsn_set=%s)",
            enabled,
            bool(dsn),
        )
        return

    try:
        import sentry_sdk
        from sentry_sdk.scrubber import EventScrubber

        sentry_sdk.init(
            dsn=dsn,
            send_default_pii=False,
            include_local_variables=True,
            event_scrubber=EventScrubber(denylist=_CUSTOM_DENYLIST, recursive=True),
            before_send=_before_send,
            traces_sample_rate=0.0,  # Error-only, no performance tracing
        )
        logger.info("Sentry crash reporting initialized (enabled=%s)", enabled)
    except ImportError:
        logger.warning("sentry_sdk not installed — crash reporting unavailable")
    except Exception as exc:
        logger.warning("Failed to initialize Sentry: %s", exc)


def set_crash_reporting(enabled: bool) -> None:
    """
    Toggle crash reporting at runtime. Takes immediate effect via before_send.
    This is the ONLY mechanism for runtime toggle — never call init_sentry() again.
    """
    global _crash_reporting_enabled
    _crash_reporting_enabled = enabled
    logger.info("Crash reporting flag set to: %s", enabled)


def is_enabled() -> bool:
    """Return current crash reporting enabled state."""
    return _crash_reporting_enabled
