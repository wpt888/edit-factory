"""
Shared request validation helpers for Edit Factory API routes.
"""
import logging

from fastapi import HTTPException, UploadFile

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# MIME type allowlists
# ---------------------------------------------------------------------------

# Allowed MIME types for video uploads
ALLOWED_VIDEO_MIMES = {
    "video/mp4", "video/quicktime", "video/x-msvideo", "video/x-matroska",
    "video/webm", "video/mpeg", "video/3gpp", "video/x-flv",
    "video/x-ms-wmv", "video/ogg",
}

# Allowed MIME types for audio uploads
ALLOWED_AUDIO_MIMES = {
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg",
    "audio/flac", "audio/aac", "audio/mp4", "audio/x-m4a", "audio/webm",
}

# Allowed MIME types for SRT/subtitle uploads.
# SRT files are plain text; libmagic often detects them as "text/plain" or
# "application/octet-stream" depending on content, so we accept both.
ALLOWED_SUBTITLE_MIMES = {
    "text/plain", "application/x-subrip", "text/x-ssa",
    "application/octet-stream",
}

MAX_UPLOAD_SIZE_MB = 500  # 500 MB limit for video uploads
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024

MAX_TTS_CHARS = 5000  # Maximum TTS text length in characters


def validate_tts_text_length(text: str, field_name: str = "text") -> str:
    """Validate TTS text is non-empty and within character limit. Returns stripped text."""
    stripped = text.strip() if text else ""
    if not stripped:
        raise HTTPException(status_code=400, detail=f"{field_name} cannot be empty")
    if len(stripped) > MAX_TTS_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Text too long: {len(stripped)} characters (maximum {MAX_TTS_CHARS})"
        )
    return stripped


async def validate_upload_size(file: UploadFile, max_bytes: int = MAX_UPLOAD_SIZE_BYTES) -> None:
    """Validate file size before reading entire file into memory.

    Checks the file.size attribute first (fast path, set by Starlette from
    Content-Length), then falls back to seeking to the end of the spooled
    temporary file when the header is absent.

    Raises HTTPException 413 if the file exceeds max_bytes.
    """
    # Fast path: Starlette populates file.size from Content-Length header
    if hasattr(file, "size") and file.size is not None:
        if file.size > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"File too large. Maximum upload size is "
                    f"{max_bytes // (1024 * 1024)} MB."
                ),
            )
        return

    # Fallback: seek to end of spooled temporary file to measure size
    try:
        file.file.seek(0, 2)  # Seek to end
        size = file.file.tell()
        file.file.seek(0)  # Reset to beginning
        if size > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"File too large ({size // (1024 * 1024)} MB). "
                    f"Maximum upload size is {max_bytes // (1024 * 1024)} MB."
                ),
            )
    except HTTPException:
        raise
    except Exception as exc:
        # If we cannot determine size, allow the upload to proceed.
        # The underlying storage write will surface any real issues.
        logger.warning("Could not determine upload file size — skipping validation: %s", exc)


async def validate_file_mime_type(
    file: UploadFile,
    allowed_mimes: set,
    file_type_label: str = "file",
) -> None:
    """Validate actual file MIME type using libmagic (not the Content-Type header).

    Reads the first 8 KB of the file to detect its actual type via magic number
    inspection, then seeks back to the beginning so subsequent readers see the
    full file.  Raises HTTPException 400 if the detected MIME type is not in
    ``allowed_mimes``.

    Graceful degradation: if python-magic or libmagic is not installed, a
    warning is logged and the upload is allowed through.  This matches the
    project's degradation-hierarchy pattern — the validation is best-effort,
    not a hard gate when the dependency is absent.

    Args:
        file: The uploaded file (UploadFile).
        allowed_mimes: Set of allowed MIME type strings (e.g. ALLOWED_VIDEO_MIMES).
        file_type_label: Human-readable label used in error messages ("video", "audio", …).

    Raises:
        HTTPException 400: When the detected MIME type is not in ``allowed_mimes``.
    """
    try:
        import magic  # python-magic — requires libmagic system library

        # Read first 8 KB for magic-number detection; seek back afterwards
        header = await file.read(8192)
        await file.seek(0)

        detected_mime = magic.from_buffer(header, mime=True)

        if detected_mime not in allowed_mimes:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid {file_type_label} file type. "
                    f"Detected: {detected_mime}. "
                    f"Allowed types: {', '.join(sorted(allowed_mimes))}"
                ),
            )

    except HTTPException:
        # Re-raise validation failures unchanged
        raise
    except ImportError:
        # python-magic not installed — log warning and allow upload
        logger.warning(
            "python-magic not installed — MIME type validation skipped. "
            "Install with: pip install python-magic  "
            "(Linux also requires: apt-get install libmagic1)"
        )
    except Exception as exc:
        # libmagic not available or unexpected error — log and allow
        logger.warning("MIME validation error (allowing upload): %s", exc)
