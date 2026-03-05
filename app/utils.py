"""
Shared utility functions for Edit Factory.
"""
import re
from pathlib import Path


def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent path traversal and unsafe characters."""
    if not filename:
        return "unnamed"
    safe_name = Path(filename).name
    safe_name = re.sub(r'[^\w\-_\.]', '_', safe_name)
    if len(safe_name) > 100:
        # Preserve file extension when truncating
        p = Path(safe_name)
        ext = p.suffix  # e.g. ".mp4"
        stem = p.stem
        max_stem = 100 - len(ext)
        safe_name = (stem[:max_stem] + ext)[:100] if max_stem > 0 else safe_name[:100]
    return safe_name or "unnamed"
