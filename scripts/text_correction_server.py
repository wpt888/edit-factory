#!/usr/bin/env python3
"""
Modul pentru corectarea automata a textului transcris folosind textul original
Foloseste algoritmi de fuzzy matching si aliniere pentru corectare precisa
Versiune pentru server Linux

Autor: Obsid SRL
"""

import difflib
import re
from typing import List, Dict, Tuple, Optional
import unicodedata


class TextCorrector:
    """Corecteaza textul transcris folosind textul original ca referinta"""

    def __init__(self, original_text: str):
        self.original_text = self._normalize_text(original_text)
        self.original_words = self._extract_words(self.original_text)
        self.original_sentences = self._extract_sentences(self.original_text)

    def _normalize_text(self, text: str) -> str:
        """Normalizeaza textul pentru comparare"""
        text = ' '.join(text.split())
        return text

    def _extract_words(self, text: str) -> List[str]:
        """Extrage cuvintele din text"""
        words = re.findall(r'\S+', text)
        return words

    def _extract_sentences(self, text: str) -> List[str]:
        """Extrage propozitiile din text"""
        sentences = re.split(r'[.!?]+', text)
        return [s.strip() for s in sentences if s.strip()]

    def correct_word(self, word: str, context_words: List[str] = None) -> str:
        """Corecteaza un cuvant individual"""
        if not word or not word.strip():
            return word

        word_clean = re.sub(r'[^\w\s]', '', word).lower().strip()

        if not word_clean:
            return word

        if len(word_clean) <= 2 and word_clean in [w.lower().strip() for w in self.original_words]:
            return word

        best_match = None
        best_ratio = 0.0

        for orig_word in self.original_words:
            orig_clean = re.sub(r'[^\w\s]', '', orig_word).lower().strip()

            if not orig_clean:
                continue

            ratio = difflib.SequenceMatcher(None, word_clean, orig_clean).ratio()

            if ratio > 0.6 and ratio > best_ratio:
                best_match = orig_word
                best_ratio = ratio

        if not best_match or best_ratio < 0.8:
            for orig_word in self.original_words:
                orig_clean = re.sub(r'[^\w\s]', '', orig_word).lower().strip()

                if len(word_clean) >= 3 and len(orig_clean) >= 3:
                    if word_clean in orig_clean or orig_clean in word_clean:
                        if not best_match or len(orig_word) > len(best_match):
                            best_match = orig_word
                            best_ratio = 0.75

                if len(word_clean) >= 3 and len(orig_clean) >= 3:
                    if word_clean[:2] == orig_clean[:2]:
                        ratio = difflib.SequenceMatcher(None, word_clean, orig_clean).ratio()
                        if ratio > 0.6 and ratio > best_ratio:
                            best_match = orig_word
                            best_ratio = ratio

        if best_match and best_ratio > 0.5:
            if word and word[-1] in ',.!?;:':
                if best_match[-1] not in ',.!?;:':
                    return best_match + word[-1]
            return best_match

        return word

    def align_and_correct(self, transcribed_words: List[Dict],
                         force_alignment: bool = True) -> List[Dict]:
        """Aliniaza si corecteaza cuvintele transcrise cu textul original"""
        if not force_alignment:
            corrected = []
            for word_info in transcribed_words:
                corrected_word = self.correct_word(word_info['text'])
                corrected.append({
                    **word_info,
                    'text': corrected_word,
                    'original_text': word_info['text'],
                    'was_corrected': corrected_word != word_info['text']
                })
            return corrected

        transcribed_texts = [w['text'] for w in transcribed_words]

        transcribed_clean = [re.sub(r'[^\w\s]', '', t).lower().strip() for t in transcribed_texts]
        original_clean = [re.sub(r'[^\w\s]', '', w).lower().strip() for w in self.original_words]

        matcher = difflib.SequenceMatcher(None, transcribed_clean, original_clean)

        corrected = []

        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'equal':
                for i in range(i1, i2):
                    corrected.append({
                        **transcribed_words[i],
                        'text': self.original_words[j1 + (i - i1)],
                        'original_text': transcribed_words[i]['text'],
                        'was_corrected': False
                    })
            elif tag == 'replace':
                transcribed_slice = transcribed_words[i1:i2]
                original_slice = self.original_words[j1:j2]

                if transcribed_slice and original_slice:
                    total_duration = transcribed_slice[-1]['end'] - transcribed_slice[0]['start']
                    time_per_word = total_duration / len(original_slice)

                    for idx, orig_word in enumerate(original_slice):
                        start_time = transcribed_slice[0]['start'] + idx * time_per_word
                        end_time = start_time + time_per_word

                        corrected.append({
                            'text': orig_word,
                            'start': start_time,
                            'end': end_time,
                            'confidence': min(w['confidence'] for w in transcribed_slice) if transcribed_slice else 0.5,
                            'original_text': transcribed_slice[min(idx, len(transcribed_slice)-1)]['text'] if transcribed_slice else '',
                            'was_corrected': True
                        })
            elif tag == 'delete':
                pass
            elif tag == 'insert':
                if corrected:
                    prev_word = corrected[-1]
                    time_gap = 0.3

                    for idx, orig_word in enumerate(self.original_words[j1:j2]):
                        start_time = prev_word['end'] + idx * time_gap
                        end_time = start_time + time_gap

                        corrected.append({
                            'text': orig_word,
                            'start': start_time,
                            'end': end_time,
                            'confidence': 0.5,
                            'original_text': '',
                            'was_corrected': True,
                            'was_inserted': True
                        })

        return corrected


def correct_transcription(transcribed_words: List[Dict],
                         original_text: str,
                         confidence_threshold: float = 0.8) -> List[Dict]:
    """Functie wrapper pentru corectarea transcriptiei"""
    if not original_text:
        return transcribed_words

    corrector = TextCorrector(original_text)

    avg_confidence = sum(w.get('confidence', 1.0) for w in transcribed_words) / len(transcribed_words) if transcribed_words else 0

    force_alignment = avg_confidence < confidence_threshold

    return corrector.align_and_correct(transcribed_words, force_alignment)


def calculate_correction_stats(corrected_words: List[Dict]) -> Dict:
    """Calculeaza statistici despre corectari"""
    total_words = len(corrected_words)
    corrected_count = sum(1 for w in corrected_words if w.get('was_corrected', False))
    inserted_count = sum(1 for w in corrected_words if w.get('was_inserted', False))

    return {
        'total_words': total_words,
        'corrected_words': corrected_count,
        'inserted_words': inserted_count,
        'correction_rate': (corrected_count / total_words * 100) if total_words > 0 else 0,
        'accuracy_estimate': ((total_words - corrected_count) / total_words * 100) if total_words > 0 else 100
    }
