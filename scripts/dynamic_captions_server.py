#!/usr/bin/env python3
"""
Script pentru captions dinamice cu cuvinte putine per aparitie
Optimizat pentru look-ul modern de TikTok/YouTube Shorts/Instagram
Versiune pentru server Linux

Autor: Obsid SRL
"""

import os
import json
import argparse
from pathlib import Path
from typing import List, Dict, Any
import re

try:
    import whisper_timestamped as whisper
    from pydub import AudioSegment
except ImportError as e:
    print(f"Eroare la importul bibliotecilor: {e}")
    print("Ruleaza: pip install whisper-timestamped pydub")
    exit(1)

# Import local text_correction
try:
    from text_correction import correct_transcription, calculate_correction_stats, TextCorrector
except ImportError:
    # Defineste functii dummy daca modulul lipseste
    def correct_transcription(words, text, threshold=0.8):
        return words
    def calculate_correction_stats(words):
        return {'corrected_words': 0, 'correction_rate': 0, 'accuracy_estimate': 100, 'inserted_words': 0}
    class TextCorrector:
        pass


class DynamicCaptionsGenerator:
    """Generator pentru captions dinamice cu segmente scurte"""

    def __init__(self, model_name: str = "base"):
        self.model_name = model_name
        self.model = None

    def _clean_text(self, text: str, remove_punctuation: bool = False, text_case: str = "normal") -> str:
        """Curata textul conform optiunilor de formatare"""
        cleaned_text = text.strip()

        if remove_punctuation:
            import string
            cleaned_text = ''.join(char for char in cleaned_text
                                 if char not in string.punctuation or char == ' ')
            cleaned_text = ' '.join(cleaned_text.split())

        if text_case == "upper":
            cleaned_text = cleaned_text.upper()
        elif text_case == "lower":
            cleaned_text = cleaned_text.lower()

        return cleaned_text

    def load_model(self):
        """Incarca modelul Whisper"""
        if not self.model:
            print(f"Incarcare model Whisper: {self.model_name}")
            self.model = whisper.load_model(self.model_name)
            print("Model incarcat!")

    def generate_dynamic_captions(self, audio_path: str,
                                max_words_per_caption: int = 2,
                                min_duration: float = 0.6,
                                max_duration: float = 2.5,
                                output_dir: str = None,
                                remove_punctuation: bool = False,
                                text_case: str = "normal",
                                original_text: str = None,
                                language: str = "ro") -> Dict[str, Any]:
        """
        Genereaza captions dinamice cu controale fine

        Args:
            audio_path: Calea catre fisierul audio
            max_words_per_caption: Numarul maxim de cuvinte per caption
            min_duration: Durata minima a unui caption (secunde)
            max_duration: Durata maxima a unui caption (secunde)
            output_dir: Directorul de output
            remove_punctuation: Elimina semnele de punctuatie
            text_case: Formatarea textului ("normal", "upper", "lower")
            original_text: Textul original pentru corectare automata
            language: Limba pentru transcriere (default: ro)
        """

        if not self.model:
            self.load_model()

        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Fisierul audio nu exista: {audio_path}")

        if output_dir is None:
            output_dir = audio_path.parent
        else:
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)

        print(f"Procesare audio pentru captions dinamice: {audio_path.name}")
        print(f"Setari: max {max_words_per_caption} cuvinte/caption, durata {min_duration}-{max_duration}s")

        # Transcrie cu timestamps per cuvant
        result = whisper.transcribe(
            self.model,
            str(audio_path),
            language=language
        )

        # Extrage cuvintele cu timestamps precise
        all_words = []
        for segment in result.get('segments', []):
            if 'words' in segment and segment['words']:
                for word_info in segment.get('words', []):
                    word_data = {
                        'text': word_info.get('text', '').strip(),
                        'start': float(word_info.get('start', 0)),
                        'end': float(word_info.get('end', 0)),
                        'confidence': word_info.get('confidence', 1.0)
                    }
                    if word_data['text']:
                        word_data['text'] = self._clean_text(word_data['text'], remove_punctuation, text_case)
                        if word_data['text']:
                            all_words.append(word_data)
            else:
                text = segment.get('text', '').strip()
                if text:
                    words_in_segment = text.split()
                    segment_start = segment.get('start', 0)
                    segment_end = segment.get('end', 0)
                    segment_duration = segment_end - segment_start

                    if words_in_segment:
                        word_duration = segment_duration / len(words_in_segment)

                        for i, word in enumerate(words_in_segment):
                            word_start = segment_start + (i * word_duration)
                            word_end = word_start + word_duration

                            word_data = {
                                'text': self._clean_text(word.strip(), remove_punctuation, text_case),
                                'start': word_start,
                                'end': word_end,
                                'confidence': segment.get('avg_logprob', 1.0)
                            }
                            if word_data['text']:
                                all_words.append(word_data)

        print(f"Gasite {len(all_words)} cuvinte cu timestamps")

        # Aplica corectarea daca avem text original
        correction_stats = None
        if original_text and all_words:
            print("Aplic corectarea avansata folosind textul original...")
            all_words = correct_transcription(all_words, original_text)
            correction_stats = calculate_correction_stats(all_words)
            print(f"Corectare avansata completa: {correction_stats['corrected_words']} cuvinte corectate ({correction_stats['correction_rate']:.1f}%)")

        # Creeaza caption-uri dinamice
        dynamic_captions = self._create_simple_segments(
            all_words,
            max_words_per_caption,
            min_duration,
            max_duration,
            remove_punctuation,
            text_case
        )

        print(f"Captions dinamice generate!")
        print(f"{len(dynamic_captions)} caption-uri create din {len(all_words)} cuvinte")

        stats = {
            'total_words': len(all_words),
            'total_captions': len(dynamic_captions),
            'avg_words_per_caption': len(all_words) / len(dynamic_captions) if dynamic_captions else 0,
            'total_duration': dynamic_captions[-1]['end'] if dynamic_captions else 0
        }

        if correction_stats:
            stats['correction_applied'] = True
            stats['corrected_words'] = correction_stats['corrected_words']
            stats['correction_rate'] = correction_stats['correction_rate']
            stats['accuracy_estimate'] = correction_stats['accuracy_estimate']

        return {
            'captions': dynamic_captions,
            'stats': stats
        }

    def _create_simple_segments(self, words: List[Dict],
                               max_words: int,
                               min_duration: float,
                               max_duration: float,
                               remove_punctuation: bool = False,
                               text_case: str = "normal") -> List[Dict[str, Any]]:
        """Creeaza segmente simple cu timing precis fara suprapuneri"""

        if not words:
            return []

        segments = []
        current_words = []
        last_end_time = 0

        i = 0
        while i < len(words):
            current_words.append(words[i])

            should_close = False

            # Punctuatie de sfarsit de propozitie
            current_text = words[i]['text'].strip()
            if current_text.endswith(('.', '!', '?')):
                should_close = True

            # Numarul maxim de cuvinte
            elif len(current_words) >= max_words:
                should_close = True

            # Pauza mare intre cuvinte
            elif i + 1 < len(words):
                gap = words[i + 1]['start'] - words[i]['end']
                if gap > 0.5:
                    should_close = True

            # Sfarsitul listei
            elif i == len(words) - 1:
                should_close = True

            if should_close and current_words:
                segment_start = max(current_words[0]['start'], last_end_time + 0.05)
                segment_end = current_words[-1]['end']

                natural_duration = segment_end - segment_start
                if natural_duration < min_duration:
                    desired_end = segment_start + min_duration

                    if i + 1 < len(words):
                        next_start = words[i + 1]['start']
                        segment_end = min(desired_end, next_start - 0.05)
                    else:
                        segment_end = desired_end

                if segment_start < last_end_time + 0.05:
                    segment_start = last_end_time + 0.05

                final_duration = segment_end - segment_start
                if final_duration < 0.2:
                    segment_end = segment_start + 0.2

                words_text = [word['text'] for word in current_words]
                segment_text = ' '.join(words_text)
                segment_text = self._clean_text(segment_text, remove_punctuation, text_case)

                segments.append({
                    'id': len(segments) + 1,
                    'text': segment_text,
                    'start': segment_start,
                    'end': segment_end,
                    'word_count': len(current_words),
                    'words': current_words.copy(),
                    'duration': segment_end - segment_start
                })

                last_end_time = segment_end
                current_words = []

            i += 1

        return segments

    def save_srt(self, segments: List[Dict], output_path: str):
        """Salveaza in format SRT"""
        with open(output_path, 'w', encoding='utf-8') as f:
            for segment in segments:
                start_time = self._format_time_srt(segment['start'])
                end_time = self._format_time_srt(segment['end'])

                f.write(f"{segment['id']}\n")
                f.write(f"{start_time} --> {end_time}\n")
                f.write(f"{segment['text']}\n\n")

    def save_vtt(self, segments: List[Dict], output_path: str):
        """Salveaza in format VTT"""
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write("WEBVTT\n")
            f.write("Kind: captions\n")
            f.write("Language: ro\n\n")

            for segment in segments:
                start_time = self._format_time_vtt(segment['start'])
                end_time = self._format_time_vtt(segment['end'])

                f.write(f"{start_time} --> {end_time}\n")
                f.write(f"{segment['text']}\n\n")

    def save_json(self, segments: List[Dict], output_path: str):
        """Salveaza in format JSON"""
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump({'segments': segments}, f, indent=2, ensure_ascii=False)

    def _format_time_srt(self, seconds: float) -> str:
        """Formateaza timpul pentru SRT"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

    def _format_time_vtt(self, seconds: float) -> str:
        """Formateaza timpul pentru VTT"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def main():
    """Functia principala pentru captions dinamice"""
    parser = argparse.ArgumentParser(
        description="Generator captions dinamice pentru video modern"
    )

    parser.add_argument("audio_file", help="Calea catre fisierul audio")
    parser.add_argument("--output", "-o", help="Fisierul SRT output")
    parser.add_argument("--words", type=int, default=2,
                       help="Numarul maxim de cuvinte per caption (default: 2)")
    parser.add_argument("--min-duration", type=float, default=0.6,
                       help="Durata minima per caption in secunde (default: 0.6)")
    parser.add_argument("--max-duration", type=float, default=2.5,
                       help="Durata maxima per caption in secunde (default: 2.5)")
    parser.add_argument("--model", default="base",
                       choices=["tiny", "base", "small", "medium", "large"],
                       help="Modelul Whisper (default: base)")
    parser.add_argument("--language", default="ro",
                       help="Limba pentru transcriere (default: ro)")
    parser.add_argument("--no-punctuation", action="store_true",
                       help="Elimina semnele de punctuatie din captions")
    parser.add_argument("--text-case", choices=["normal", "upper", "lower"], default="normal",
                       help="Formatarea textului (default: normal)")
    parser.add_argument("--original-text", help="Textul original pentru corectare")
    parser.add_argument("--json", action="store_true", help="Output result as JSON")

    args = parser.parse_args()

    if args.words < 1 or args.words > 10:
        print("Numarul de cuvinte trebuie sa fie intre 1 si 10")
        return 1

    if args.min_duration > args.max_duration:
        print("Durata minima nu poate fi mai mare decat cea maxima")
        return 1

    try:
        generator = DynamicCaptionsGenerator(args.model)
        result = generator.generate_dynamic_captions(
            args.audio_file,
            max_words_per_caption=args.words,
            min_duration=args.min_duration,
            max_duration=args.max_duration,
            remove_punctuation=args.no_punctuation,
            text_case=args.text_case,
            original_text=args.original_text,
            language=args.language
        )

        # Determina output path
        if args.output:
            output_path = args.output
        else:
            output_path = str(Path(args.audio_file).with_suffix('.srt'))

        # Salveaza SRT
        generator.save_srt(result['captions'], output_path)

        stats = result['stats']

        if args.json:
            output_result = {
                "status": "success",
                "srt_path": output_path,
                "stats": stats
            }
            print(json.dumps(output_result))
        else:
            print(f"\nSRT generat: {output_path}")
            print(f"Caption-uri: {stats['total_captions']}")
            print(f"Cuvinte: {stats['total_words']}")
            print(f"Media cuvinte/caption: {stats['avg_words_per_caption']:.1f}")

        return 0

    except Exception as e:
        if args.json:
            print(json.dumps({"status": "error", "message": str(e)}))
        else:
            print(f"Eroare: {e}")
            import traceback
            traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())
