"""
Keyword Matcher pentru SRT files.
Găsește timestamps când apar cuvinte cheie în subtitrări.
Suportă fuzzy matching pentru variații ale cuvintelor.
"""
import re
import logging
from typing import List, Dict, Optional
from dataclasses import dataclass
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)


@dataclass
class KeywordMatch:
    """A keyword match found in SRT."""
    keyword: str
    matched_text: str  # The exact text that matched
    start_time: float  # Secunde
    end_time: float    # Secunde
    confidence: float  # 0-1, how good the match is


def parse_srt_timestamp(timestamp: str) -> float:
    """Convert SRT timestamp (00:00:05,200) to seconds."""
    # Format: HH:MM:SS,mmm or HH:MM:SS.mmm
    timestamp = timestamp.replace(',', '.')
    parts = timestamp.split(':')

    if len(parts) == 3:
        hours, minutes, seconds = parts
        return float(hours) * 3600 + float(minutes) * 60 + float(seconds)
    elif len(parts) == 2:
        minutes, seconds = parts
        return float(minutes) * 60 + float(seconds)
    else:
        return float(timestamp)


def parse_srt(srt_content: str) -> List[Dict]:
    """
    Parse SRT content and return list of subtitles.

    Returns:
        List of {id, start_time, end_time, text}
    """
    subtitles = []

    # Normalize line endings
    content = srt_content.replace('\r\n', '\n').replace('\r', '\n')
    blocks = content.strip().split('\n\n')

    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) < 3:
            continue

        try:
            # Prima linie = ID
            sub_id = int(lines[0].strip())

            # A doua linie = timestamps
            time_line = lines[1].strip()
            time_match = re.match(r'(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})', time_line)

            if not time_match:
                continue

            start_time = parse_srt_timestamp(time_match.group(1))
            end_time = parse_srt_timestamp(time_match.group(2))

            # Restul = text
            text = ' '.join(lines[2:]).strip()

            subtitles.append({
                'id': sub_id,
                'start_time': start_time,
                'end_time': end_time,
                'text': text
            })

        except (ValueError, IndexError) as e:
            logger.debug(f"Failed to parse SRT block: {e}")
            continue

    return subtitles


def normalize_word(word: str) -> str:
    """Normalize a word for comparison."""
    # Lowercase, approximate diacritics removal
    word = word.lower().strip()

    # Replace Romanian diacritics
    replacements = {
        'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ț': 't',
        'Ă': 'a', 'Â': 'a', 'Î': 'i', 'Ș': 's', 'Ț': 't'
    }
    for old, new in replacements.items():
        word = word.replace(old, new)

    # Remove punctuation
    word = re.sub(r'[^\w\s]', '', word)

    return word


def fuzzy_match(word: str, keyword: str, threshold: float = 0.7) -> float:
    """
    Check if a word matches the keyword.
    Returns similarity score (0-1).

    Supports:
    - Exact match
    - Prefix match (decant -> decantul, decanturi)
    - Fuzzy matching for typos
    """
    word_norm = normalize_word(word)
    keyword_norm = normalize_word(keyword)

    # Match exact
    if word_norm == keyword_norm:
        return 1.0

    # Prefix match - word starts with keyword
    if word_norm.startswith(keyword_norm):
        return 0.95

    # Suffix match - keyword is contained in word
    if keyword_norm in word_norm:
        return 0.9

    # Fuzzy matching for similar words
    ratio = SequenceMatcher(None, word_norm, keyword_norm).ratio()

    return ratio if ratio >= threshold else 0.0


def find_keyword_timestamps(
    srt_content: str,
    keywords: List[str],
    min_confidence: float = 0.7
) -> List[KeywordMatch]:
    """
    Find all keyword occurrences in SRT.

    Args:
        srt_content: SRT file content
        keywords: List of keywords to search for
        min_confidence: Minimum match score (0-1)

    Returns:
        List of KeywordMatch sorted by start_time
    """
    subtitles = parse_srt(srt_content)
    matches = []

    # Pre-compute normalized keywords for quick exact/contains matching
    keywords_lower = {kw: normalize_word(kw) for kw in keywords}

    for sub in subtitles:
        text = sub['text']
        words = text.split()

        for word in words:
            word_norm = normalize_word(word)
            matched_keywords = set()  # Track which keywords already matched this word

            # Quick exact/contains pre-filter before expensive fuzzy matching
            for keyword in keywords:
                kw_norm = keywords_lower[keyword]

                # Exact match
                if word_norm == kw_norm:
                    matched_keywords.add(keyword)
                    match = KeywordMatch(
                        keyword=keyword,
                        matched_text=word,
                        start_time=sub['start_time'],
                        end_time=sub['end_time'],
                        confidence=1.0
                    )
                    matches.append(match)
                    logger.debug(f"Keyword match (exact): '{keyword}' -> '{word}' at {sub['start_time']:.2f}s (confidence: 1.00)")
                    continue

                # Contains match (keyword in word or word starts with keyword)
                if kw_norm in word_norm:
                    matched_keywords.add(keyword)
                    conf = 0.95 if word_norm.startswith(kw_norm) else 0.9
                    if conf >= min_confidence:
                        match = KeywordMatch(
                            keyword=keyword,
                            matched_text=word,
                            start_time=sub['start_time'],
                            end_time=sub['end_time'],
                            confidence=conf
                        )
                        matches.append(match)
                        logger.debug(f"Keyword match (contains): '{keyword}' -> '{word}' at {sub['start_time']:.2f}s (confidence: {conf:.2f})")
                    continue

            # Only use expensive fuzzy matching for remaining unmatched keywords
            for keyword in keywords:
                if keyword in matched_keywords:
                    continue

                confidence = fuzzy_match(word, keyword, threshold=min_confidence)

                if confidence >= min_confidence:
                    match = KeywordMatch(
                        keyword=keyword,
                        matched_text=word,
                        start_time=sub['start_time'],
                        end_time=sub['end_time'],
                        confidence=confidence
                    )
                    matches.append(match)
                    logger.debug(f"Keyword match (fuzzy): '{keyword}' -> '{word}' at {sub['start_time']:.2f}s (confidence: {confidence:.2f})")

    # Sort by time
    matches.sort(key=lambda m: m.start_time)

    # Remove nearby duplicates (same keyword within 1 second interval)
    filtered = []
    for match in matches:
        is_duplicate = False
        for existing in filtered:
            if (existing.keyword == match.keyword and
                abs(existing.start_time - match.start_time) < 1.0):
                is_duplicate = True
                break
        if not is_duplicate:
            filtered.append(match)

    logger.info(f"Found {len(filtered)} keyword matches for {keywords}")
    return filtered


def get_keyword_segments(
    keyword_matches: List[KeywordMatch],
    segment_duration: float = 2.0
) -> List[Dict]:
    """
    Convert keyword matches to time segments for secondary video.

    Args:
        keyword_matches: List of matches from find_keyword_timestamps
        segment_duration: How long the secondary video segment should last

    Returns:
        List of segments: [{start_time, end_time, keyword}]
    """
    segments = []

    for match in keyword_matches:
        # Center segment around the keyword
        center = (match.start_time + match.end_time) / 2
        start = max(0, center - segment_duration / 2)
        end = center + segment_duration / 2

        segments.append({
            'start_time': start,
            'end_time': end,
            'keyword': match.keyword,
            'source': 'secondary'  # Marker indicating it comes from secondary video
        })

    return segments
