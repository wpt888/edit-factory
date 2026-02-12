"""
TTS Subtitle Generator Service

Converts ElevenLabs character-level timestamps into properly formatted SRT subtitle content.
Enables subtitle generation directly from TTS timing data, eliminating the need for Whisper ASR
and providing perfect sync with voiceover audio.
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _seconds_to_srt_time(seconds: float) -> str:
    """
    Convert float seconds to SRT time format: HH:MM:SS,mmm

    Args:
        seconds: Time in seconds (e.g., 65.123)

    Returns:
        SRT-formatted time string (e.g., "00:01:05,123")
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)

    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def generate_srt_from_timestamps(
    timestamps: Optional[dict],
    max_chars_per_phrase: int = 40,
    max_words_per_phrase: int = 7
) -> str:
    """
    Generate SRT subtitle content from ElevenLabs character-level timestamps.

    This function performs a 3-step grouping process:
    1. Characters to words (split on spaces and punctuation)
    2. Words to phrases (max 40 chars or 7 words per subtitle entry)
    3. Phrases to SRT format (sequential numbering with HH:MM:SS,mmm timing)

    Args:
        timestamps: ElevenLabs alignment dict with structure:
            {
                "characters": ["H", "e", "l", "l", "o", " ", ...],
                "character_start_times_seconds": [0.0, 0.05, 0.09, ...],
                "character_end_times_seconds": [0.05, 0.09, 0.14, ...]
            }
        max_chars_per_phrase: Maximum characters per subtitle entry (default: 40)
        max_words_per_phrase: Maximum words per subtitle entry (default: 7)

    Returns:
        SRT-formatted string with sequential subtitle entries, or empty string if input is invalid

    Example:
        >>> timestamps = {
        ...     "characters": list("Hello world"),
        ...     "character_start_times_seconds": [0.0, 0.05, 0.09, 0.12, 0.15, 0.20, 0.25, 0.30, 0.34, 0.38, 0.42],
        ...     "character_end_times_seconds": [0.05, 0.09, 0.12, 0.15, 0.20, 0.25, 0.30, 0.34, 0.38, 0.42, 0.46]
        ... }
        >>> print(generate_srt_from_timestamps(timestamps))
        1
        00:00:00,000 --> 00:00:00,460
        Hello world
    """
    # Handle edge cases
    if timestamps is None:
        logger.warning("Timestamps is None, returning empty string")
        return ""

    if not isinstance(timestamps, dict):
        logger.warning(f"Timestamps is not a dict (type: {type(timestamps)}), returning empty string")
        return ""

    # Extract required keys
    characters = timestamps.get("characters", [])
    start_times = timestamps.get("character_start_times_seconds", [])
    end_times = timestamps.get("character_end_times_seconds", [])

    # Validate required data
    if not characters or not start_times or not end_times:
        logger.warning("Missing required keys in timestamps dict (characters, character_start_times_seconds, character_end_times_seconds)")
        return ""

    if len(characters) != len(start_times) or len(characters) != len(end_times):
        logger.warning(f"Mismatched array lengths: characters={len(characters)}, starts={len(start_times)}, ends={len(end_times)}")
        return ""

    # Step 1: Characters to words
    words = []
    current_word_chars = []
    current_word_start = None
    current_word_end = None

    for i, char in enumerate(characters):
        char_start = start_times[i]
        char_end = end_times[i]

        # Space indicates word boundary
        if char == " ":
            # Finalize current word if we have accumulated characters
            if current_word_chars:
                word_text = "".join(current_word_chars).strip()
                if word_text:  # Skip empty words
                    words.append({
                        "text": word_text,
                        "start": current_word_start,
                        "end": current_word_end
                    })
                # Reset accumulator
                current_word_chars = []
                current_word_start = None
                current_word_end = None
        else:
            # Accumulate character into current word
            current_word_chars.append(char)
            if current_word_start is None:
                current_word_start = char_start
            current_word_end = char_end

    # Finalize last word if exists
    if current_word_chars:
        word_text = "".join(current_word_chars).strip()
        if word_text:
            words.append({
                "text": word_text,
                "start": current_word_start,
                "end": current_word_end
            })

    # Handle case where no words were extracted
    if not words:
        logger.warning("No words extracted from character data")
        return ""

    # Step 2: Words to phrases
    phrases = []
    current_phrase_words = []
    current_phrase_start = None
    current_phrase_end = None
    current_phrase_text = ""

    for word in words:
        word_text = word["text"]
        word_start = word["start"]
        word_end = word["end"]

        # Check if adding this word would exceed limits
        would_exceed_chars = len(current_phrase_text) + len(word_text) + (1 if current_phrase_text else 0) > max_chars_per_phrase
        would_exceed_words = len(current_phrase_words) >= max_words_per_phrase

        # Check for sentence-ending punctuation
        ends_sentence = word_text and word_text[-1] in ".!?"

        # Create new phrase if we would exceed limits (but not on first word)
        if current_phrase_words and (would_exceed_chars or would_exceed_words):
            # Finalize current phrase
            phrases.append({
                "text": current_phrase_text,
                "start": current_phrase_start,
                "end": current_phrase_end
            })
            # Reset accumulator
            current_phrase_words = []
            current_phrase_text = ""
            current_phrase_start = None
            current_phrase_end = None

        # Add word to current phrase
        current_phrase_words.append(word)
        if current_phrase_start is None:
            current_phrase_start = word_start
        current_phrase_end = word_end

        # Update phrase text with space separator
        if current_phrase_text:
            current_phrase_text += " " + word_text
        else:
            current_phrase_text = word_text

        # If sentence ends, finalize phrase
        if ends_sentence:
            phrases.append({
                "text": current_phrase_text,
                "start": current_phrase_start,
                "end": current_phrase_end
            })
            # Reset accumulator
            current_phrase_words = []
            current_phrase_text = ""
            current_phrase_start = None
            current_phrase_end = None

    # Finalize last phrase if exists
    if current_phrase_words:
        phrases.append({
            "text": current_phrase_text,
            "start": current_phrase_start,
            "end": current_phrase_end
        })

    # Step 3: Phrases to SRT
    srt_entries = []
    for index, phrase in enumerate(phrases, start=1):
        start_time_str = _seconds_to_srt_time(phrase["start"])
        end_time_str = _seconds_to_srt_time(phrase["end"])
        text = phrase["text"]

        # SRT format: index, timestamp line, text, blank line
        srt_entry = f"{index}\n{start_time_str} --> {end_time_str}\n{text}\n"
        srt_entries.append(srt_entry)

    # Join all entries with blank line separator
    srt_content = "\n".join(srt_entries)

    logger.info(f"Generated SRT with {len(phrases)} subtitle entries from {len(words)} words ({len(characters)} characters)")

    return srt_content
