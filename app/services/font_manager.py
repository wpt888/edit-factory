"""Deterministic subtitle font discovery and per-render fontsdir preparation."""
from __future__ import annotations

import logging
import os
import shutil
import tempfile
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_SUBTITLE_FONT = "Montserrat"
FONT_EXTENSIONS = {".ttf", ".otf", ".ttc"}


def bundled_fonts_dir() -> Path:
    """Return the bundled font directory in development or packaged builds."""
    resources = os.getenv("RESOURCES_PATH")
    if resources:
        packaged = Path(resources) / "app" / "assets" / "fonts"
        if packaged.is_dir():
            return packaged
    return Path(__file__).resolve().parents[1] / "assets" / "fonts"


def _name_strings(font_path: Path) -> set[str]:
    """Read authoritative family/full names from a font name table."""
    fonts = []
    try:
        from fontTools.ttLib import TTCollection, TTFont

        if font_path.suffix.lower() == ".ttc":
            fonts = list(TTCollection(font_path, lazy=True).fonts)
        else:
            fonts = [TTFont(font_path, lazy=True)]
        result: set[str] = set()
        for font in fonts:
            for record in font["name"].names:
                if record.nameID in {1, 4, 6, 16}:
                    try:
                        result.add(record.toUnicode().strip())
                    except UnicodeDecodeError:
                        continue
        return result
    except Exception as exc:
        logger.debug("Could not inspect font %s: %s", font_path, exc)
        return set()
    finally:
        for font in fonts:
            try:
                font.close()
            except Exception:
                pass


def _font_roots() -> list[Path]:
    if os.name == "nt":
        return [Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"]
    return [Path.home() / ".fonts", Path("/usr/share/fonts"), Path("/usr/local/share/fonts")]


@lru_cache(maxsize=1)
def installed_font_index() -> dict[str, Path]:
    """Index installed fonts by name-table family/full name (case-insensitive)."""
    index: dict[str, Path] = {}
    for root in _font_roots():
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if path.is_file() and path.suffix.lower() in FONT_EXTENSIONS:
                for name in _name_strings(path):
                    index.setdefault(name.casefold(), path)
    return index


def _find_bundled_font(family: str) -> Path | None:
    root = bundled_fonts_dir()
    if not root.is_dir():
        return None
    for path in root.iterdir():
        if path.is_file() and path.suffix.lower() in FONT_EXTENSIONS:
            if family.casefold() in {name.casefold() for name in _name_strings(path)}:
                return path
    return None


def prepare_render_fonts(family: str) -> tuple[str, Path | None, str | None]:
    """Resolve *family* and copy only its files into a bounded temporary fontsdir.

    Returns ``(effective_family, fontsdir, warning)``. A missing family uses the
    curated default explicitly, never libass's unrelated silent fallback.
    """
    requested = family.strip().strip("'\"") or DEFAULT_SUBTITLE_FONT
    source = _find_bundled_font(requested) or installed_font_index().get(requested.casefold())
    effective = requested
    warning = None
    if source is None:
        effective = DEFAULT_SUBTITLE_FONT
        source = _find_bundled_font(effective) or installed_font_index().get(effective.casefold())
        warning = f"Font '{requested}' not found; using '{effective}'."
        logger.warning(warning)
    if source is None:
        warning = f"Font '{requested}' and fallback '{effective}' not found; no font file could be supplied to libass."
        logger.warning(warning)
        return effective, None, warning

    safe_family = "".join(char if char.isalnum() else "-" for char in effective).strip("-")
    target = Path(tempfile.gettempdir()) / "blipost-fonts" / (safe_family or "default")
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target / source.name)
    return effective, target, warning
