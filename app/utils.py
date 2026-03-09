"""
Shared utility functions for Edit Factory.
"""
import platform
import re
from pathlib import Path


def normalize_path(path_str: str) -> str:
    """Convert WSL /mnt/X/... paths to Windows X:\\... paths on Windows."""
    if not path_str:
        return path_str
    if platform.system() == "Windows" and path_str.startswith("/mnt/"):
        # /mnt/c/foo/bar → C:\foo\bar
        parts = path_str.split("/")  # ['', 'mnt', 'c', 'foo', 'bar']
        if len(parts) >= 3:
            drive = parts[2].upper()
            rest = "\\".join(parts[3:])
            return f"{drive}:\\{rest}"
    return path_str


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
