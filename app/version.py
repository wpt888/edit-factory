"""Application version derived from git tags.

Usage:
    from app.version import get_version
    version = get_version()  # e.g., "1.2.3" or "0.0.0-dev"

Versioning convention:
    - Tagged commits: version = tag (e.g., v1.2.3 -> "1.2.3")
    - Untagged commits: version = "{last_tag}.dev{commits_since}" or "0.0.0-dev"
    - No git: version = "0.0.0-dev"
"""
import subprocess
import functools


@functools.lru_cache(maxsize=1)
def get_version() -> str:
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--always"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            tag = result.stdout.strip()
            # Strip leading 'v' if present (v1.2.3 -> 1.2.3)
            if tag.startswith("v"):
                tag = tag[1:]
            return tag
        return "0.0.0-dev"
    except Exception:
        return "0.0.0-dev"
