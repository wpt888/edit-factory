#!/usr/bin/env python3
"""
Edit Factory - SRT Generator
Generează subtitrări SRT din fișiere audio folosind Whisper.

Autor: Obsid SRL
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path

import whisper

# Configurare logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def format_timestamp(seconds: float) -> str:
    """Convertește secunde în format SRT timestamp (HH:MM:SS,mmm)."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def generate_srt(audio_path: str, output_path: str = None, model_size: str = "base") -> str:
    """
    Generează fișier SRT din audio folosind Whisper.

    Args:
        audio_path: Calea către fișierul audio
        output_path: Calea pentru output SRT (opțional)
        model_size: Dimensiunea modelului Whisper (tiny, base, small, medium, large)

    Returns:
        Calea către fișierul SRT generat
    """
    audio_path = Path(audio_path)
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    if output_path is None:
        output_path = audio_path.with_suffix('.srt')
    else:
        output_path = Path(output_path)

    logger.info(f"Loading Whisper model: {model_size}")
    model = whisper.load_model(model_size)

    logger.info(f"Transcribing: {audio_path}")
    result = model.transcribe(
        str(audio_path),
        word_timestamps=True,
        verbose=False
    )

    # Generăm SRT
    srt_content = []
    segment_idx = 1

    for segment in result['segments']:
        start_time = format_timestamp(segment['start'])
        end_time = format_timestamp(segment['end'])
        text = segment['text'].strip()

        if text:
            srt_content.append(f"{segment_idx}")
            srt_content.append(f"{start_time} --> {end_time}")
            srt_content.append(text)
            srt_content.append("")
            segment_idx += 1

    # Scriem fișierul SRT
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(srt_content))

    logger.info(f"SRT generated: {output_path}")
    logger.info(f"Total segments: {segment_idx - 1}")

    return str(output_path)


def generate_srt_from_text(
    text: str,
    audio_duration: float,
    output_path: str,
    chars_per_segment: int = 80
) -> str:
    """
    Generează SRT din text și durată audio (fără transcripție).
    Util când ai deja textul și vrei doar timing-ul.

    Args:
        text: Textul pentru subtitrări
        audio_duration: Durata audio în secunde
        output_path: Calea pentru output SRT
        chars_per_segment: Caractere maxime per segment

    Returns:
        Calea către fișierul SRT generat
    """
    words = text.split()
    segments = []
    current_segment = []
    current_length = 0

    for word in words:
        if current_length + len(word) + 1 > chars_per_segment and current_segment:
            segments.append(' '.join(current_segment))
            current_segment = [word]
            current_length = len(word)
        else:
            current_segment.append(word)
            current_length += len(word) + 1

    if current_segment:
        segments.append(' '.join(current_segment))

    # Calculăm timing-ul
    time_per_segment = audio_duration / len(segments)

    srt_content = []
    for i, segment_text in enumerate(segments):
        start_time = i * time_per_segment
        end_time = (i + 1) * time_per_segment

        srt_content.append(f"{i + 1}")
        srt_content.append(f"{format_timestamp(start_time)} --> {format_timestamp(end_time)}")
        srt_content.append(segment_text)
        srt_content.append("")

    output_path = Path(output_path)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(srt_content))

    logger.info(f"SRT generated from text: {output_path}")
    return str(output_path)


def main():
    parser = argparse.ArgumentParser(description="Generate SRT subtitles from audio")
    parser.add_argument("input", help="Path to audio file OR text (with --from-text)")
    parser.add_argument("--output", "-o", help="Output SRT file path")
    parser.add_argument("--model", default="base", choices=["tiny", "base", "small", "medium", "large"],
                        help="Whisper model size")
    parser.add_argument("--from-text", action="store_true", help="Generate from text instead of audio")
    parser.add_argument("--duration", type=float, help="Audio duration (required with --from-text)")
    parser.add_argument("--json", action="store_true", help="Output result as JSON")

    args = parser.parse_args()

    try:
        if args.from_text:
            if not args.duration:
                raise ValueError("--duration is required when using --from-text")
            if not args.output:
                raise ValueError("--output is required when using --from-text")

            srt_path = generate_srt_from_text(
                text=args.input,
                audio_duration=args.duration,
                output_path=args.output
            )
        else:
            srt_path = generate_srt(
                audio_path=args.input,
                output_path=args.output,
                model_size=args.model
            )

        result = {
            "status": "success",
            "srt_path": srt_path
        }

        if args.json:
            print(json.dumps(result))
        else:
            print(f"SRT generated: {srt_path}")

    except Exception as e:
        logger.error(f"Error: {e}")
        if args.json:
            print(json.dumps({"status": "error", "message": str(e)}))
        else:
            print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
