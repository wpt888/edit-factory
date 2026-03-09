"""
Edge TTS Service - FREE Text-to-Speech using Microsoft Edge.
Excellent quality, many voices, no cost.
"""
import atexit
import asyncio
import concurrent.futures
import logging
import threading
from pathlib import Path
from typing import List, Dict, Optional
from dataclasses import dataclass
import edge_tts
from app.services.srt_validator import sanitize_srt_full

logger = logging.getLogger(__name__)

# Module-level singleton executor to avoid creating multiple ThreadPoolExecutors
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)
atexit.register(_executor.shutdown, wait=False)


@dataclass
class Voice:
    """Information about an available voice."""
    name: str
    short_name: str
    gender: str
    language: str
    locale: str


# Popular pre-defined voices for quick access
POPULAR_VOICES = {
    # Romanian
    "ro_male": "ro-RO-EmilNeural",
    "ro_female": "ro-RO-AlinaNeural",

    # English US
    "en_us_male": "en-US-GuyNeural",
    "en_us_female": "en-US-JennyNeural",
    "en_us_male_2": "en-US-ChristopherNeural",
    "en_us_female_2": "en-US-AriaNeural",

    # English UK
    "en_uk_male": "en-GB-RyanNeural",
    "en_uk_female": "en-GB-SoniaNeural",

    # Spanish
    "es_male": "es-ES-AlvaroNeural",
    "es_female": "es-ES-ElviraNeural",

    # French
    "fr_male": "fr-FR-HenriNeural",
    "fr_female": "fr-FR-DeniseNeural",

    # German
    "de_male": "de-DE-ConradNeural",
    "de_female": "de-DE-KatjaNeural",

    # Italian
    "it_male": "it-IT-DiegoNeural",
    "it_female": "it-IT-ElsaNeural",
}


class EdgeTTSService:
    """
    Text-to-Speech service using Microsoft Edge TTS.
    100% FREE, excellent quality.
    """

    # Class-level cache shared across all instances
    _voices_cache: Optional[List[Voice]] = None
    _voices_cache_async_lock: Optional[asyncio.Lock] = None
    _voices_cache_init_lock = threading.Lock()

    def __init__(self, output_dir: Optional[Path] = None):
        """
        Args:
            output_dir: Directorul pentru fișierele audio generate
        """
        self.output_dir = Path(output_dir) if output_dir else Path("./output")
        self.output_dir.mkdir(parents=True, exist_ok=True)

    async def list_voices(self, language: Optional[str] = None) -> List[Voice]:
        """
        Listează toate vocile disponibile.

        Args:
            language: Filtrare după limbă (ex: "ro", "en", "es")

        Returns:
            Lista de voci disponibile
        """
        # BUG-ET-01: Use asyncio.Lock for proper async double-checked locking
        if EdgeTTSService._voices_cache is None:
            if EdgeTTSService._voices_cache_async_lock is None:
                with EdgeTTSService._voices_cache_init_lock:
                    if EdgeTTSService._voices_cache_async_lock is None:
                        EdgeTTSService._voices_cache_async_lock = asyncio.Lock()
            async with EdgeTTSService._voices_cache_async_lock:
                if EdgeTTSService._voices_cache is None:
                    voices_list = await edge_tts.list_voices()
                    EdgeTTSService._voices_cache = [
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
            return [v for v in EdgeTTSService._voices_cache if v.language.lower() == language.lower()]

        return EdgeTTSService._voices_cache

    def list_voices_sync(self, language: Optional[str] = None) -> List[Voice]:
        """Synchronous version of list_voices."""
        try:
            asyncio.get_running_loop()
            # We're inside an async context - run in a separate thread to avoid deadlock
            future = _executor.submit(asyncio.run, self.list_voices(language))
            return future.result(timeout=60)
        except RuntimeError:
            # No running loop - safe to use asyncio.run
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
        if not text.strip():
            raise ValueError("Empty text")

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        logger.info(f"Generating TTS: {len(text)} chars with voice {voice}")

        for attempt in range(3):
            try:
                communicate = edge_tts.Communicate(
                    text=text,
                    voice=voice,
                    rate=rate,
                    volume=volume,
                    pitch=pitch
                )
                await communicate.save(str(output_path))
                break
            except Exception as e:
                if attempt < 2:
                    logger.warning(f"Edge TTS attempt {attempt + 1} failed: {e}, retrying...")
                    output_path.unlink(missing_ok=True)
                    await asyncio.sleep(1)
                else:
                    raise RuntimeError(f"Edge TTS error: {e}") from e

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
        """Synchronous version of generate_audio."""
        try:
            asyncio.get_running_loop()
            # We're inside an async context - run in a separate thread to avoid deadlock
            future = _executor.submit(asyncio.run, self.generate_audio(
                text, output_path, voice, rate, volume, pitch
            ))
            try:
                return future.result(timeout=120)
            except concurrent.futures.TimeoutError:
                raise Exception(f"Edge TTS generation timed out after 120s for {len(text)} characters")
        except RuntimeError:
            # No running loop - safe to use asyncio.run
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

        # Truncate audio file to avoid appending on retry
        if audio_path.exists():
            audio_path.unlink()

        communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)

        srt_content = []
        sub_index = 1

        try:
            with open(audio_path, "wb") as audio_file:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_file.write(chunk["data"])

                    elif chunk["type"] == "WordBoundary":
                        # Build SRT from word boundaries
                        offset = chunk.get("offset")
                        duration = chunk.get("duration")
                        if offset is None or duration is None:
                            logger.debug(f"Skipping WordBoundary chunk with missing offset/duration")
                            continue
                        start_ms = offset / 10000  # Convert to ms
                        duration_ms = duration / 10000
                        end_ms = start_ms + duration_ms

                        start_srt = self._ms_to_srt_time(start_ms)
                        end_srt = self._ms_to_srt_time(end_ms)
                        word = chunk.get("text", "")

                        srt_content.append(f"{sub_index}")
                        srt_content.append(f"{start_srt} --> {end_srt}")
                        srt_content.append(word)
                        srt_content.append("")
                        sub_index += 1
        except Exception:
            # Cleanup partial audio file on failure
            if audio_path.exists():
                audio_path.unlink(missing_ok=True)
            raise

        # Warn if no word boundaries were received
        if not srt_content:
            logger.warning(f"No WordBoundary chunks received from Edge TTS - SRT file will be empty")

        # Verify audio output is valid
        if not audio_path.exists() or audio_path.stat().st_size == 0:
            raise RuntimeError("Edge TTS produced empty output")

        # Save SRT
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write(sanitize_srt_full("\n".join(srt_content)))

        logger.info(f"Generated audio + SRT: {audio_path}, {srt_path}")
        result = {"audio": audio_path, "srt": srt_path}
        if not srt_content:
            result["srt_empty"] = True
        return result

    def generate_with_subtitles_sync(
        self,
        text: str,
        audio_path: Path,
        srt_path: Path,
        voice: str = "ro-RO-EmilNeural",
        rate: str = "+0%"
    ) -> Dict[str, Path]:
        """Synchronous version of generate_with_subtitles."""
        try:
            asyncio.get_running_loop()
            future = _executor.submit(asyncio.run, self.generate_with_subtitles(
                text, audio_path, srt_path, voice, rate
            ))
            return future.result(timeout=120)
        except (concurrent.futures.TimeoutError, TimeoutError) as e:
            # BUG-ET-02: Catch timeout errors explicitly
            logger.error(f"TTS subtitle generation timed out: {e}")
            raise RuntimeError(f"TTS subtitle generation timed out after 120s") from e
        except RuntimeError:
            return asyncio.run(self.generate_with_subtitles(
                text, audio_path, srt_path, voice, rate
            ))

    def _ms_to_srt_time(self, ms: float) -> str:
        """Convert milliseconds to SRT format (HH:MM:SS,mmm)."""
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

        # If no voices specified, use different voices
        if voices is None:
            available_voices = list(POPULAR_VOICES.values())
            voices = available_voices[:len(texts)]

        # Ensure we have enough voices
        while len(voices) < len(texts):
            voices.append(voices[0])  # Repeat first voice

        results = []

        for i, (text, voice) in enumerate(zip(texts, voices)):
            audio_path = output_dir / f"{base_name}_{i+1}.mp3"

            try:
                await self.generate_audio(text, audio_path, voice)
            except Exception as e:
                # BUG-ET-03: Cleanup generated files on partial variant failure
                logger.error(f"Variant {i+1} generation failed: {e}")
                for prev_result in results:
                    prev_path = Path(prev_result["audio_path"])
                    if prev_path.exists():
                        try:
                            prev_path.unlink()
                            logger.debug(f"Cleaned up partial file: {prev_path}")
                        except OSError:
                            pass
                raise RuntimeError(
                    f"Variant {i+1}/{len(texts)} failed (voice={voice}): {e}"
                ) from e

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
        """Synchronous version of generate_variants."""
        try:
            asyncio.get_running_loop()
            future = _executor.submit(asyncio.run, self.generate_variants(
                texts, output_dir, voices, base_name
            ))
            return future.result(timeout=300)
        except RuntimeError:
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

    # Fallback to English US
    logger.warning(f"Unknown voice key: {key}, falling back to en_us default")
    if gender == "male":
        return POPULAR_VOICES["en_us_male"]
    return POPULAR_VOICES["en_us_female"]


# Test rapid
if __name__ == "__main__":
    async def test():
        tts = EdgeTTSService(Path("./test_output"))

        # List Romanian voices
        print("Voci românești:")
        voices = await tts.list_voices("ro")
        for v in voices:
            print(f"  - {v.short_name} ({v.gender})")

        # Generate a test
        print("\nGenerăm audio test...")
        await tts.generate_audio(
            text="Bună ziua! Acesta este un test pentru Edge TTS. Funcționează perfect!",
            output_path=Path("./test_output/test_ro.mp3"),
            voice="ro-RO-EmilNeural"
        )
        print("Done! Check test_output/test_ro.mp3")

    asyncio.run(test())
