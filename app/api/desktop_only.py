"""Guards for API operations that require the local desktop machine."""

from fastapi import HTTPException

from app.config import get_settings


DESKTOP_ONLY_LOCAL_FILESYSTEM_DETAIL = (
    "Local filesystem access is desktop-only and is available only in the "
    "BlipStudio desktop app."
)
DESKTOP_ONLY_LEGACY_AI_DETAIL = (
    "This legacy AI workflow is available only in the BlipStudio desktop app. "
    "Use the metered Pipeline, Product, TTS Library, or Video Generator workflow "
    "in the web app."
)


def require_desktop_local_filesystem() -> None:
    """Reject local-filesystem operations before they touch the server disk."""
    if not get_settings().desktop_mode:
        raise HTTPException(
            status_code=501,
            detail=DESKTOP_ONLY_LOCAL_FILESYSTEM_DETAIL,
        )


def require_desktop_legacy_ai_workflow() -> None:
    """Reject compatibility AI/render routes that have no metered web UI."""
    if not get_settings().desktop_mode:
        raise HTTPException(
            status_code=501,
            detail=DESKTOP_ONLY_LEGACY_AI_DETAIL,
        )
