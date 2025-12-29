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
    """Un match de keyword găsit în SRT."""
    keyword: str
    matched_text: str  # Textul exact care a făcut match
    start_time: float  # Secunde
    end_time: float    # Secunde
    confidence: float  # 0-1, cât de bun e match-ul


def parse_srt_timestamp(timestamp: str) -> float:
    """Convertește timestamp SRT (00:00:05,200) în secunde."""
    # Format: HH:MM:SS,mmm sau HH:MM:SS.mmm
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
    Parsează conținutul SRT și returnează lista de subtitrări.

    Returns:
        List of {id, start_time, end_time, text}
    """
    subtitles = []

    # Normalizăm line endings
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
    """Normalizează un cuvânt pentru comparație."""
    # Lowercase, remove diacritics aproximativ
    word = word.lower().strip()

    # Înlocuim diacritice românești
    replacements = {
        'ă': 'a', 'â': 'a', 'î': 'i', 'ș': 's', 'ț': 't',
        'Ă': 'a', 'Â': 'a', 'Î': 'i', 'Ș': 's', 'Ț': 't'
    }
    for old, new in replacements.items():
        word = word.replace(old, new)

    # Eliminăm punctuația
    word = re.sub(r'[^\w\s]', '', word)

    return word


def fuzzy_match(word: str, keyword: str, threshold: float = 0.7) -> float:
    """
    Verifică dacă un cuvânt face match cu keyword-ul.
    Returnează scorul de similaritate (0-1).

    Suportă:
    - Match exact
    - Match cu prefix (decant -> decantul, decanturi)
    - Fuzzy matching pentru typos
    """
    word_norm = normalize_word(word)
    keyword_norm = normalize_word(keyword)

    # Match exact
    if word_norm == keyword_norm:
        return 1.0

    # Match cu prefix - cuvântul începe cu keyword
    if word_norm.startswith(keyword_norm):
        return 0.95

    # Match cu sufix - keyword e conținut în cuvânt
    if keyword_norm in word_norm:
        return 0.9

    # Fuzzy matching pentru cuvinte similare
    ratio = SequenceMatcher(None, word_norm, keyword_norm).ratio()

    return ratio if ratio >= threshold else 0.0


def find_keyword_timestamps(
    srt_content: str,
    keywords: List[str],
    min_confidence: float = 0.7
) -> List[KeywordMatch]:
    """
    Găsește toate aparițiile keywords în SRT.

    Args:
        srt_content: Conținutul fișierului SRT
        keywords: Lista de cuvinte cheie de căutat
        min_confidence: Scorul minim pentru match (0-1)

    Returns:
        Lista de KeywordMatch sortată după start_time
    """
    subtitles = parse_srt(srt_content)
    matches = []

    for sub in subtitles:
        text = sub['text']
        words = text.split()

        for word in words:
            for keyword in keywords:
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
                    logger.debug(f"Keyword match: '{keyword}' -> '{word}' at {sub['start_time']:.2f}s (confidence: {confidence:.2f})")

    # Sortăm după timp
    matches.sort(key=lambda m: m.start_time)

    # Eliminăm duplicate apropiate (același keyword în interval de 1 secundă)
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
    Convertește keyword matches în segmente de timp pentru video secundar.

    Args:
        keyword_matches: Lista de matches din find_keyword_timestamps
        segment_duration: Cât timp să dureze segmentul video secundar

    Returns:
        Lista de segmente: [{start_time, end_time, keyword}]
    """
    segments = []

    for match in keyword_matches:
        # Centram segmentul în jurul keyword-ului
        center = (match.start_time + match.end_time) / 2
        start = max(0, center - segment_duration / 2)
        end = center + segment_duration / 2

        segments.append({
            'start_time': start,
            'end_time': end,
            'keyword': match.keyword,
            'source': 'secondary'  # Marker că vine din video secundar
        })

    return segments
