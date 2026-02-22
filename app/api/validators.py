"""
Shared request validation helpers for Edit Factory API routes.
"""
from fastapi import HTTPException, UploadFile

MAX_UPLOAD_SIZE_MB = 500  # 500 MB limit for video uploads
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024


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
    except Exception:
        # If we cannot determine size, allow the upload to proceed.
        # The underlying storage write will surface any real issues.
        pass
