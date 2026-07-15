"""Guards for API operations that require the local desktop machine."""

from fastapi import HTTPException

from app.config import get_settings


DESKTOP_ONLY_LOCAL_FILESYSTEM_DETAIL = (
    "Local filesystem access is desktop-only and is available only in the "
    "BlipStudio desktop app."
)


def require_desktop_local_filesystem() -> None:
    """Reject local-filesystem operations before they touch the server disk."""
    if not get_settings().desktop_mode:
        raise HTTPException(
            status_code=501,
            detail=DESKTOP_ONLY_LOCAL_FILESYSTEM_DETAIL,
        )
