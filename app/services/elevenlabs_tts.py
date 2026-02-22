"""
ElevenLabs TTS Service.
Generates high-quality voice-over using ElevenLabs API.
"""
import os
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Optional, Tuple
import httpx

logger = logging.getLogger(__name__)


class ElevenLabsTTS:
    """
    ElevenLabs Text-to-Speech service.

    Uses the exact settings from user's Ana Maria voice:
    - Model: eleven_flash_v2_5
    - Stability: 0.57
    - Similarity: 0.75
    - Style: 0.22
    - Speaker Boost: True
    """

    BASE_URL = "https://api.elevenlabs.io/v1"

    def __init__(
        self,
        api_key: Optional[str] = None,
        voice_id: Optional[str] = None,
        model_id: Optional[str] = None
    ):
        self.api_key = api_key or os.getenv("ELEVENLABS_API_KEY")
        self.voice_id = voice_id or os.getenv("ELEVENLABS_VOICE_ID")
        self.model_id = model_id or os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")

        if not self.api_key:
            raise ValueError("ELEVENLABS_API_KEY is required")
        if not self.voice_id:
            raise ValueError("ELEVENLABS_VOICE_ID is required")

        # Ana Maria voice settings (extracted from user's ElevenLabs config)
        self.voice_settings = {
            "stability": 0.57,
            "similarity_boost": 0.75,
            "style": 0.22,
            "use_speaker_boost": True
        }

        logger.info(f"ElevenLabsTTS initialized with voice: {self.voice_id}, model: {self.model_id}")

    async def generate_audio(
        self,
        text: str,
        output_path: Path,
        stability: Optional[float] = None,
        similarity_boost: Optional[float] = None,
        style: Optional[float] = None,
        use_speaker_boost: Optional[bool] = None
    ) -> Path:
        """
        Generate audio from text using ElevenLabs API.

        Args:
            text: The text to convert to speech
            output_path: Path where to save the audio file
            stability: Override default stability (0-1)
            similarity_boost: Override default similarity (0-1)
            style: Override default style (0-1)
            use_speaker_boost: Override default speaker boost

        Returns:
            Path to the generated audio file
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # --- Cache check ---
        from app.services.tts_cache import cache_lookup, cache_store
        cache_key = {"text": text, "voice_id": self.voice_id, "model_id": self.model_id, "provider": "legacy"}
        cached = cache_lookup(cache_key, "legacy", output_path)
        if cached:
            logger.info(f"Using cached TTS audio (cost: $0.00)")
            return output_path

        # Prepare voice settings
        voice_settings = {
            "stability": stability if stability is not None else self.voice_settings["stability"],
            "similarity_boost": similarity_boost if similarity_boost is not None else self.voice_settings["similarity_boost"],
            "style": style if style is not None else self.voice_settings["style"],
            "use_speaker_boost": use_speaker_boost if use_speaker_boost is not None else self.voice_settings["use_speaker_boost"]
        }

        # Prepare request
        # Request 192kbps MP3 output (flash v2.5 costs ~$0.11 per 1k chars, half of multilingual v2)
        url = f"{self.BASE_URL}/text-to-speech/{self.voice_id}?output_format=mp3_44100_192"

        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": self.api_key
        }

        data = {
            "text": text,
            "model_id": self.model_id,
            "voice_settings": voice_settings
        }

        logger.info(f"Generating TTS for {len(text)} characters...")

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(url, headers=headers, json=data)

                if response.status_code != 200:
                    error_detail = response.text
                    logger.error(f"ElevenLabs API error: {response.status_code} - {error_detail}")
                    raise Exception(f"ElevenLabs API error: {response.status_code} - {error_detail}")

                # Save audio file
                with open(output_path, "wb") as f:
                    f.write(response.content)

                logger.info(f"Audio saved to: {output_path}")

                # Log cost
                try:
                    from app.services.cost_tracker import get_cost_tracker
                    tracker = get_cost_tracker()
                    tracker.log_elevenlabs_tts(
                        job_id=output_path.stem,
                        characters=len(text),
                        text_preview=text
                    )
                except Exception as e:
                    logger.warning(f"Failed to log cost: {e}")

                # --- Cache store ---
                cache_store(cache_key, "legacy", output_path, {
                    "characters": len(text)
                })

                return output_path

        except httpx.TimeoutException:
            raise Exception("ElevenLabs API timeout - text may be too long")
        except Exception as e:
            logger.error(f"TTS generation failed: {e}")
            raise

    def _video_has_audio(self, video_path: Path) -> bool:
        """Check if video file has an audio stream."""
        try:
            probe_cmd = [
                "ffprobe", "-v", "error",
                "-select_streams", "a",
                "-show_entries", "stream=codec_type",
                "-of", "json",
                str(video_path)
            ]
            result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                import json
                data = json.loads(result.stdout)
                return len(data.get("streams", [])) > 0
        except Exception as e:
            logger.warning(f"Could not probe audio streams: {e}")
        return False

    def add_audio_to_video(
        self,
        video_path: Path,
        audio_path: Path,
        output_path: Path,
        video_volume: float = 0.1,
        audio_volume: float = 1.0
    ) -> Path:
        """
        Combine video with generated audio using ffmpeg.

        Args:
            video_path: Path to the input video
            audio_path: Path to the audio file
            output_path: Path for the output video
            video_volume: Volume of original video audio (0-1, default 0.1 for background)
            audio_volume: Volume of TTS audio (0-1, default 1.0)

        Returns:
            Path to the output video with audio
        """
        video_path = Path(video_path)
        audio_path = Path(audio_path)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Check if video has audio stream
        has_audio = self._video_has_audio(video_path)
        logger.info(f"Video {video_path.name} has audio: {has_audio}")

        if has_audio:
            # Mix original audio (low volume) with TTS audio
            cmd = [
                "ffmpeg", "-y",
                "-i", str(video_path),
                "-i", str(audio_path),
                "-filter_complex",
                f"[0:a]volume={video_volume}[a0];[1:a]volume={audio_volume}[a1];[a0][a1]amix=inputs=2:duration=longest[aout]",
                "-map", "0:v",
                "-map", "[aout]",
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest",
                str(output_path)
            ]
        else:
            # Video has no audio - just add TTS audio directly
            cmd = [
                "ffmpeg", "-y",
                "-i", str(video_path),
                "-i", str(audio_path),
                "-map", "0:v",
                "-map", "1:a",
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest",
                str(output_path)
            ]

        logger.info(f"Adding audio to video: {video_path.name}")

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

            if result.returncode != 0:
                # Fallback: try simple replacement without mixing
                logger.warning(f"Audio command failed, trying simple replacement. Error: {result.stderr[:200]}")
                cmd_simple = [
                    "ffmpeg", "-y",
                    "-i", str(video_path),
                    "-i", str(audio_path),
                    "-map", "0:v",
                    "-map", "1:a",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-shortest",
                    str(output_path)
                ]
                result = subprocess.run(cmd_simple, capture_output=True, text=True, timeout=300)

                if result.returncode != 0:
                    raise Exception(f"FFmpeg error: {result.stderr}")

            logger.info(f"Video with audio saved to: {output_path}")
            return output_path

        except subprocess.TimeoutExpired:
            raise Exception("FFmpeg timeout - video may be too long")
        except Exception as e:
            logger.error(f"Failed to add audio to video: {e}")
            raise

    async def generate_audio_trimmed(
        self,
        text: str,
        output_path: Path,
        remove_silence: bool = True,
        min_silence_duration: float = 0.3,
        silence_padding: float = 0.08,
        stability: Optional[float] = None,
        similarity_boost: Optional[float] = None,
        style: Optional[float] = None,
        use_speaker_boost: Optional[bool] = None
    ) -> Tuple[Path, dict]:
        """
        Generate TTS audio with automatic silence removal.

        Args:
            text: Text to convert to speech
            output_path: Path for the final audio
            remove_silence: Whether to remove silence (default True)
            min_silence_duration: Pauses shorter than this are kept (natural rhythm)
            silence_padding: Padding around words to avoid cutting
            stability, similarity_boost, style, use_speaker_boost: Voice settings

        Returns:
            Tuple of (output_path, silence_removal_stats)
        """
        output_path = Path(output_path)

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_dir = Path(temp_dir)

            # Generate raw TTS
            raw_audio = temp_dir / f"raw_{output_path.stem}.mp3"
            await self.generate_audio(
                text=text,
                output_path=raw_audio,
                stability=stability,
                similarity_boost=similarity_boost,
                style=style,
                use_speaker_boost=use_speaker_boost
            )

            if not remove_silence:
                # Just copy to output
                import shutil
                shutil.copy(raw_audio, output_path)
                return output_path, {"silence_removed": False}

            # Remove silence
            try:
                from .silence_remover import SilenceRemover

                remover = SilenceRemover(
                    min_silence_duration=min_silence_duration,
                    padding=silence_padding
                )

                result = remover.remove_silence(raw_audio, output_path)

                logger.info(
                    f"TTS silence removal: {result.original_duration:.1f}s -> {result.new_duration:.1f}s "
                    f"(saved {result.compression_ratio*100:.1f}%)"
                )

                return output_path, result.to_dict()

            except Exception as e:
                logger.warning(f"Silence removal failed, using raw audio: {e}")
                import shutil
                shutil.copy(raw_audio, output_path)
                return output_path, {"silence_removed": False, "error": str(e)}

    async def process_video_with_tts(
        self,
        video_path: Path,
        text: str,
        output_path: Path,
        temp_dir: Optional[Path] = None,
        remove_silence: bool = True,
        min_silence_duration: float = 0.3,
        silence_padding: float = 0.08
    ) -> Tuple[Path, dict]:
        """
        Complete workflow: Generate TTS, remove silence, and add to video.

        Args:
            video_path: Path to the input video
            text: Text to convert to speech
            output_path: Path for the final video
            temp_dir: Directory for temporary files
            remove_silence: Whether to remove silence from TTS
            min_silence_duration: Pauses shorter than this are kept
            silence_padding: Padding around words

        Returns:
            Tuple of (output_path, processing_stats)
        """
        if temp_dir is None:
            temp_dir = Path(tempfile.gettempdir()) / "elevenlabs_tts"
        temp_dir.mkdir(parents=True, exist_ok=True)

        stats = {}

        # Generate audio with silence removal
        audio_filename = f"tts_{output_path.stem}.mp3"
        audio_path = temp_dir / audio_filename

        if remove_silence:
            audio_path, silence_stats = await self.generate_audio_trimmed(
                text=text,
                output_path=audio_path,
                remove_silence=True,
                min_silence_duration=min_silence_duration,
                silence_padding=silence_padding
            )
            stats["silence_removal"] = silence_stats
        else:
            await self.generate_audio(text, audio_path)
            stats["silence_removal"] = {"enabled": False}

        # Add audio to video
        result = self.add_audio_to_video(video_path, audio_path, output_path)

        # Cleanup temp audio
        try:
            audio_path.unlink()
        except Exception:
            pass

        stats["output_video"] = str(result)
        return result, stats


def get_elevenlabs_tts() -> ElevenLabsTTS:
    """Factory function to get ElevenLabsTTS instance."""
    return ElevenLabsTTS()
