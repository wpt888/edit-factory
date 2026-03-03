"""
SRT Validator Service.
Validează fișiere SRT înainte de a le folosi în FFmpeg pentru a evita erorile.
"""
import re
import logging
from typing import List, Tuple, Optional
from dataclasses import dataclass


def sanitize_srt_text(srt_content: str) -> str:
    """Strip HTML/script tags from SRT content to prevent XSS.

    Preserves SRT structure (timestamps, sequence numbers, blank lines)
    but removes any HTML tags from subtitle text lines.
    """
    if not srt_content:
        return srt_content
    # Remove HTML tags (including <script>...</script> with content)
    cleaned = re.sub(r'<script[^>]*>.*?</script>', '', srt_content, flags=re.DOTALL | re.IGNORECASE)
    # Remove non-SRT HTML tags but preserve standard SRT formatting tags (i, b, u, font)
    # and the SRT arrow (-->)
    cleaned = re.sub(r'<(?!/?(?:i|b|u|font)\b)[^>]+>', '', cleaned)
    return cleaned


def sanitize_srt_for_ffmpeg(srt_content: str) -> str:
    """Escape special characters in SRT text content for safe FFmpeg/libass rendering.

    Prevents ASS override tag injection and control sequence interpretation
    in subtitle text. Only processes text lines — SRT structure (timestamps,
    sequence numbers, blank lines) is preserved.

    Characters escaped:
    - Backslashes: \\ -> \\\\ (prevents \\N, \\n, \\h interpretation as ASS control sequences)
    - Curly braces: { -> \\{, } -> \\} (prevents ASS override tags like {\\b1})

    Apostrophes, colons, and square brackets are safe inside SRT file content
    and do NOT need escaping (the path escaping in video_processor.py handles
    the FFmpeg filter string, not the SRT file content).

    Args:
        srt_content: Raw SRT file content

    Returns:
        SRT content with text lines escaped for FFmpeg/libass
    """
    if not srt_content:
        return srt_content

    lines = srt_content.split('\n')
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Sequence number (digit-only line)
        if stripped.isdigit():
            result.append(line)
            i += 1
            continue

        # Timestamp line (contains " --> ")
        if ' --> ' in stripped:
            result.append(line)
            i += 1
            continue

        # Empty line (SRT entry separator)
        if not stripped:
            result.append(line)
            i += 1
            continue

        # Text line — sanitize it
        # Order matters: escape backslashes FIRST, then braces
        sanitized = line.replace('\\', '\\\\')
        sanitized = sanitized.replace('{', '\\{')
        sanitized = sanitized.replace('}', '\\}')
        result.append(sanitized)
        i += 1

    return '\n'.join(result)


def normalize_srt_newlines(srt_content: str) -> str:
    """Join multiline subtitle text within each SRT entry into single lines.

    HTML previews collapse newlines to spaces, but FFmpeg/libass renders them
    as literal line breaks. This normalizer ensures render matches preview by
    joining text lines within each entry with a space.

    SRT structure (sequence numbers, timestamps, blank separators) is preserved.

    Args:
        srt_content: SRT file content (may have multiline text entries)

    Returns:
        SRT content with each entry's text on a single line
    """
    if not srt_content:
        return srt_content

    lines = srt_content.split('\n')
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Empty line (SRT entry separator) — preserve
        if not stripped:
            result.append(line)
            i += 1
            continue

        # Sequence number (digit-only line) — preserve
        if stripped.isdigit():
            result.append(line)
            i += 1
            continue

        # Timestamp line (contains " --> ") — preserve
        if ' --> ' in stripped:
            result.append(line)
            i += 1
            # Collect all text lines until next blank or end
            text_parts = []
            while i < len(lines) and lines[i].strip():
                text_parts.append(lines[i].strip())
                i += 1
            # Join multiline text into single line
            if text_parts:
                result.append(' '.join(text_parts))
            continue

        # Fallback: preserve line as-is
        result.append(line)
        i += 1

    return '\n'.join(result)


def sanitize_srt_full(srt_content: str) -> str:
    """Apply all SRT sanitizations: HTML stripping + newline normalization + FFmpeg/libass escaping.

    Convenience function that chains:
    1. sanitize_srt_text (XSS prevention)
    2. normalize_srt_newlines (align render with preview)
    3. sanitize_srt_for_ffmpeg (ASS control sequence escaping)

    Args:
        srt_content: Raw SRT file content

    Returns:
        Fully sanitized SRT content safe for FFmpeg subtitle rendering
    """
    content = sanitize_srt_text(srt_content)      # Strip HTML/XSS
    content = normalize_srt_newlines(content)      # Join multiline text entries
    content = sanitize_srt_for_ffmpeg(content)     # Escape for FFmpeg/libass
    return content


logger = logging.getLogger(__name__)


@dataclass
class SRTEntry:
    """O intrare SRT validată."""
    index: int
    start_time: str
    end_time: str
    text: str


class SRTValidationError(Exception):
    """Eroare de validare SRT."""
    pass


class SRTValidator:
    """Validează și repară fișiere SRT."""

    # Regex pentru timestamp SRT: HH:MM:SS,mmm
    TIMESTAMP_PATTERN = re.compile(r'^(\d{2}):(\d{2}):(\d{2}),(\d{3})$')

    # Regex pentru linie arrow: start --> end
    ARROW_PATTERN = re.compile(r'^(.+?)\s+-->\s+(.+?)$')

    def __init__(self):
        pass

    def validate_timestamp(self, timestamp: str) -> bool:
        """
        Validează un timestamp SRT.

        Args:
            timestamp: String format "HH:MM:SS,mmm"

        Returns:
            True dacă valid
        """
        match = self.TIMESTAMP_PATTERN.match(timestamp.strip())
        if not match:
            return False

        hours, minutes, seconds, milliseconds = match.groups()

        # Verificăm limitele
        if int(minutes) >= 60:
            return False
        if int(seconds) >= 60:
            return False
        if int(milliseconds) >= 1000:
            return False

        return True

    def timestamp_to_seconds(self, timestamp: str) -> float:
        """Convertește timestamp SRT în secunde."""
        match = self.TIMESTAMP_PATTERN.match(timestamp.strip())
        if not match:
            raise ValueError(f"Invalid timestamp: {timestamp}")

        hours, minutes, seconds, milliseconds = match.groups()
        total_seconds = (
            int(hours) * 3600 +
            int(minutes) * 60 +
            int(seconds) +
            int(milliseconds) / 1000.0
        )
        return total_seconds

    def validate_content(self, srt_content: str) -> Tuple[bool, List[str]]:
        """
        Validează conținutul SRT.

        Args:
            srt_content: Conținut SRT ca string

        Returns:
            Tuple (is_valid, error_messages)
        """
        if not srt_content or not srt_content.strip():
            return False, ["SRT content is empty"]

        # Strip BOM if present
        if srt_content.startswith('\ufeff'):
            srt_content = srt_content[1:]

        errors = []
        lines = srt_content.strip().split('\n')

        # Parse entries
        i = 0
        entry_count = 0
        expected_index = 1

        while i < len(lines):
            line = lines[i].strip()

            # Skip empty lines
            if not line:
                i += 1
                continue

            # Expect index
            if not line.isdigit():
                errors.append(f"Line {i+1}: Expected entry index (number), got '{line}'")
                i += 1
                continue

            index = int(line)
            if index != expected_index:
                errors.append(f"Line {i+1}: Expected index {expected_index}, got {index}")

            i += 1
            if i >= len(lines):
                errors.append(f"Entry {index}: Missing timestamp line")
                break

            # Expect timestamp line
            timestamp_line = lines[i].strip()
            arrow_match = self.ARROW_PATTERN.match(timestamp_line)

            if not arrow_match:
                errors.append(f"Line {i+1}: Invalid timestamp format '{timestamp_line}'")
                i += 1
                continue

            start_ts, end_ts = arrow_match.groups()

            # Validate timestamps
            if not self.validate_timestamp(start_ts):
                errors.append(f"Entry {index}: Invalid start timestamp '{start_ts}'")
            if not self.validate_timestamp(end_ts):
                errors.append(f"Entry {index}: Invalid end timestamp '{end_ts}'")

            # Check that end > start
            try:
                start_sec = self.timestamp_to_seconds(start_ts)
                end_sec = self.timestamp_to_seconds(end_ts)

                if end_sec <= start_sec:
                    errors.append(f"Entry {index}: End time ({end_ts}) must be after start time ({start_ts})")
            except ValueError as e:
                errors.append(f"Entry {index}: {e}")

            i += 1

            # Expect text (at least one line)
            text_lines = []
            while i < len(lines) and lines[i].strip():
                text_lines.append(lines[i])
                i += 1

            if not text_lines:
                errors.append(f"Entry {index}: Missing subtitle text")

            entry_count += 1
            expected_index += 1

        if entry_count == 0:
            errors.append("No valid SRT entries found")

        is_valid = len(errors) == 0
        return is_valid, errors

    def parse_entries(self, srt_content: str) -> List[SRTEntry]:
        """
        Parse SRT content în listă de entries.

        Args:
            srt_content: Conținut SRT

        Returns:
            Lista de SRTEntry

        Raises:
            SRTValidationError: Dacă conținutul e invalid
        """
        is_valid, errors = self.validate_content(srt_content)
        if not is_valid:
            error_msg = "SRT validation failed:\n" + "\n".join(errors[:10])  # First 10 errors
            raise SRTValidationError(error_msg)

        entries = []
        lines = srt_content.strip().split('\n')

        i = 0
        while i < len(lines):
            line = lines[i].strip()

            # Skip empty lines
            if not line:
                i += 1
                continue

            # Index
            if not line.isdigit():
                i += 1
                continue

            index = int(line)
            i += 1

            if i >= len(lines):
                break

            # Timestamp
            timestamp_line = lines[i].strip()
            arrow_match = self.ARROW_PATTERN.match(timestamp_line)

            if not arrow_match:
                i += 1
                continue

            start_ts, end_ts = arrow_match.groups()
            i += 1

            # Text
            text_lines = []
            while i < len(lines) and lines[i].strip():
                text_lines.append(lines[i])
                i += 1

            text = '\n'.join(text_lines)

            entries.append(SRTEntry(
                index=index,
                start_time=start_ts.strip(),
                end_time=end_ts.strip(),
                text=text
            ))

        return entries

    def fix_common_issues(self, srt_content: str) -> str:
        """
        Încearcă să repare probleme comune în SRT.

        Args:
            srt_content: Conținut SRT original

        Returns:
            Conținut SRT reparat
        """
        if not srt_content:
            return srt_content

        lines = srt_content.split('\n')
        fixed_lines = []

        for line in lines:
            # Fix comma vs dot in timestamps
            # Some systems use . instead of ,
            if '-->' in line:
                line = re.sub(r'(\d{2}:\d{2}:\d{2})\.(\d{3})', r'\1,\2', line)

            fixed_lines.append(line)

        return '\n'.join(fixed_lines)

    def validate_and_fix(self, srt_content: str) -> Tuple[bool, str, List[str]]:
        """
        Validează și repară SRT dacă e posibil.

        Args:
            srt_content: Conținut SRT original

        Returns:
            Tuple (is_valid, fixed_content, errors)
        """
        if not srt_content or not srt_content.strip():
            return False, srt_content, ["SRT content is empty"]

        # Try to fix common issues
        fixed_content = self.fix_common_issues(srt_content)

        # Validate
        is_valid, errors = self.validate_content(fixed_content)

        return is_valid, fixed_content, errors


# Singleton instance
_validator: Optional[SRTValidator] = None


def get_srt_validator() -> SRTValidator:
    """Get the singleton SRTValidator instance."""
    global _validator
    if _validator is None:
        _validator = SRTValidator()
    return _validator


def validate_srt(srt_content: str) -> Tuple[bool, List[str]]:
    """
    Helper: Validează conținut SRT.

    Args:
        srt_content: Conținut SRT

    Returns:
        Tuple (is_valid, error_messages)
    """
    validator = get_srt_validator()
    return validator.validate_content(srt_content)


def validate_srt_file(srt_path: str) -> Tuple[bool, List[str]]:
    """
    Helper: Validează fișier SRT.

    Args:
        srt_path: Calea către fișierul SRT

    Returns:
        Tuple (is_valid, error_messages)
    """
    try:
        with open(srt_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return validate_srt(content)
    except Exception as e:
        return False, [f"Failed to read SRT file: {e}"]
