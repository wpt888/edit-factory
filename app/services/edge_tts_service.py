"""
Edge TTS Service - Text-to-Speech GRATUIT folosind Microsoft Edge.
Calitate excelentă, multe voci, fără costuri.
"""
import asyncio
import logging
from pathlib import Path
from typing import List, Dict, Optional
from dataclasses import dataclass
import edge_tts

logger = logging.getLogger(__name__)


@dataclass
class Voice:
    """Informații despre o voce disponibilă."""
    name: str
    short_name: str
    gender: str
    language: str
    locale: str


# Voci populare pre-definite pentru acces rapid
POPULAR_VOICES = {
    # Română
    "ro_male": "ro-RO-EmilNeural",
    "ro_female": "ro-RO-AlinaNeural",

    # Engleză US
    "en_us_male": "en-US-GuyNeural",
    "en_us_female": "en-US-JennyNeural",
    "en_us_male_2": "en-US-ChristopherNeural",
    "en_us_female_2": "en-US-AriaNeural",

    # Engleză UK
    "en_uk_male": "en-GB-RyanNeural",
    "en_uk_female": "en-GB-SoniaNeural",

    # Spaniolă
    "es_male": "es-ES-AlvaroNeural",
    "es_female": "es-ES-ElviraNeural",

    # Franceză
    "fr_male": "fr-FR-HenriNeural",
    "fr_female": "fr-FR-DeniseNeural",

    # Germană
    "de_male": "de-DE-ConradNeural",
    "de_female": "de-DE-KatjaNeural",

    # Italiană
    "it_male": "it-IT-DiegoNeural",
    "it_female": "it-IT-ElsaNeural",
}


class EdgeTTSService:
    """
    Serviciu Text-to-Speech folosind Microsoft Edge TTS.
    100% GRATUIT, calitate excelentă.
    """

    def __init__(self, output_dir: Optional[Path] = None):
        """
        Args:
            output_dir: Directorul pentru fișierele audio generate
        """
        self.output_dir = Path(output_dir) if output_dir else Path("./output")
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._voices_cache: Optional[List[Voice]] = None

    async def list_voices(self, language: Optional[str] = None) -> List[Voice]:
        """
        Listează toate vocile disponibile.

        Args:
            language: Filtrare după limbă (ex: "ro", "en", "es")

        Returns:
            Lista de voci disponibile
        """
        if self._voices_cache is None:
            voices_list = await edge_tts.list_voices()
            self._voices_cache = [
                Voice(
                    name=v["FriendlyName"],
                    short_name=v["ShortName"],
                    gender=v["Gender"],
                    language=v["Locale"].split("-")[0],
                    locale=v["Locale"]
                )
                for v in voices_list
            ]

        if language:
            return [v for v in self._voices_cache if v.language.lower() == language.lower()]

        return self._voices_cache

    def list_voices_sync(self, language: Optional[str] = None) -> List[Voice]:
        """Versiune sincronă pentru list_voices."""
        return asyncio.run(self.list_voices(language))

    async def generate_audio(
        self,
        text: str,
        output_path: Path,
        voice: str = "ro-RO-EmilNeural",
        rate: str = "+0%",
        volume: str = "+0%",
        pitch: str = "+0Hz"
    ) -> Path:
        """
        Generează audio din text.

        Args:
            text: Textul de convertit în audio
            output_path: Calea pentru fișierul output (mp3)
            voice: Numele vocii (ex: "ro-RO-EmilNeural")
            rate: Viteza vorbirii (ex: "+10%", "-20%")
            volume: Volumul (ex: "+50%", "-10%")
            pitch: Înălțimea vocii (ex: "+5Hz", "-10Hz")

        Returns:
            Calea către fișierul audio generat
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        logger.info(f"Generating TTS: {len(text)} chars with voice {voice}")

        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate=rate,
            volume=volume,
            pitch=pitch
        )

        await communicate.save(str(output_path))

        logger.info(f"Audio saved: {output_path}")
        return output_path

    def generate_audio_sync(
        self,
        text: str,
        output_path: Path,
        voice: str = "ro-RO-EmilNeural",
        rate: str = "+0%",
        volume: str = "+0%",
        pitch: str = "+0Hz"
    ) -> Path:
        """Versiune sincronă pentru generate_audio."""
        return asyncio.run(self.generate_audio(
            text, output_path, voice, rate, volume, pitch
        ))

    async def generate_with_subtitles(
        self,
        text: str,
        audio_path: Path,
        srt_path: Path,
        voice: str = "ro-RO-EmilNeural",
        rate: str = "+0%"
    ) -> Dict[str, Path]:
        """
        Generează audio ȘI subtitrări SRT sincronizate.

        Args:
            text: Textul de convertit
            audio_path: Calea pentru audio
            srt_path: Calea pentru SRT
            voice: Vocea de folosit
            rate: Viteza vorbirii

        Returns:
            Dict cu căile: {"audio": Path, "srt": Path}
        """
        audio_path = Path(audio_path)
        srt_path = Path(srt_path)

        audio_path.parent.mkdir(parents=True, exist_ok=True)
        srt_path.parent.mkdir(parents=True, exist_ok=True)

        communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)

        srt_content = []
        sub_index = 1

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                # Salvăm audio chunk
                with open(audio_path, "ab") as f:
                    f.write(chunk["data"])

            elif chunk["type"] == "WordBoundary":
                # Construim SRT din word boundaries
                start_ms = chunk["offset"] / 10000  # Convert to ms
                duration_ms = chunk["duration"] / 10000
                end_ms = start_ms + duration_ms

                start_srt = self._ms_to_srt_time(start_ms)
                end_srt = self._ms_to_srt_time(end_ms)
                word = chunk["text"]

                srt_content.append(f"{sub_index}")
                srt_content.append(f"{start_srt} --> {end_srt}")
                srt_content.append(word)
                srt_content.append("")
                sub_index += 1

        # Salvăm SRT
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write("\n".join(srt_content))

        logger.info(f"Generated audio + SRT: {audio_path}, {srt_path}")
        return {"audio": audio_path, "srt": srt_path}

    def generate_with_subtitles_sync(
        self,
        text: str,
        audio_path: Path,
        srt_path: Path,
        voice: str = "ro-RO-EmilNeural",
        rate: str = "+0%"
    ) -> Dict[str, Path]:
        """Versiune sincronă pentru generate_with_subtitles."""
        return asyncio.run(self.generate_with_subtitles(
            text, audio_path, srt_path, voice, rate
        ))

    def _ms_to_srt_time(self, ms: float) -> str:
        """Convertește milisecunde în format SRT (HH:MM:SS,mmm)."""
        hours = int(ms // 3600000)
        ms = ms % 3600000
        minutes = int(ms // 60000)
        ms = ms % 60000
        seconds = int(ms // 1000)
        milliseconds = int(ms % 1000)

        return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"

    async def generate_variants(
        self,
        texts: List[str],
        output_dir: Path,
        voices: Optional[List[str]] = None,
        base_name: str = "variant"
    ) -> List[Dict]:
        """
        Generează multiple variante audio cu voci diferite.

        Args:
            texts: Lista de texte (unul per variantă)
            output_dir: Directorul pentru output
            voices: Lista de voci (sau auto-selectare)
            base_name: Numele de bază pentru fișiere

        Returns:
            Lista de dicturi cu info despre fiecare variantă
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Dacă nu avem voci specificate, folosim voci diferite
        if voices is None:
            available_voices = list(POPULAR_VOICES.values())
            voices = available_voices[:len(texts)]

        # Asigurăm că avem suficiente voci
        while len(voices) < len(texts):
            voices.append(voices[0])  # Repetăm prima voce

        results = []

        for i, (text, voice) in enumerate(zip(texts, voices)):
            audio_path = output_dir / f"{base_name}_{i+1}.mp3"

            await self.generate_audio(text, audio_path, voice)

            results.append({
                "variant_index": i + 1,
                "text": text[:100] + "..." if len(text) > 100 else text,
                "voice": voice,
                "audio_path": str(audio_path)
            })

        return results

    def generate_variants_sync(
        self,
        texts: List[str],
        output_dir: Path,
        voices: Optional[List[str]] = None,
        base_name: str = "variant"
    ) -> List[Dict]:
        """Versiune sincronă pentru generate_variants."""
        return asyncio.run(self.generate_variants(
            texts, output_dir, voices, base_name
        ))


def get_voice_for_language(language: str, gender: str = "male") -> str:
    """
    Returnează o voce pentru limba și genul specificat.

    Args:
        language: Codul limbii (ro, en, es, fr, de, it)
        gender: "male" sau "female"

    Returns:
        Numele vocii
    """
    key = f"{language}_{gender}"
    if key in POPULAR_VOICES:
        return POPULAR_VOICES[key]

    # Fallback pentru engleză US
    if gender == "male":
        return POPULAR_VOICES["en_us_male"]
    return POPULAR_VOICES["en_us_female"]


# Test rapid
if __name__ == "__main__":
    async def test():
        tts = EdgeTTSService(Path("./test_output"))

        # Listăm vocile românești
        print("Voci românești:")
        voices = await tts.list_voices("ro")
        for v in voices:
            print(f"  - {v.short_name} ({v.gender})")

        # Generăm un test
        print("\nGenerăm audio test...")
        await tts.generate_audio(
            text="Bună ziua! Acesta este un test pentru Edge TTS. Funcționează perfect!",
            output_path=Path("./test_output/test_ro.mp3"),
            voice="ro-RO-EmilNeural"
        )
        print("Done! Check test_output/test_ro.mp3")

    asyncio.run(test())
