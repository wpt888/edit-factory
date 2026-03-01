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
        safe_name = safe_name[:100]
    return safe_name or "unnamed"
