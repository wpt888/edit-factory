"""
ElevenLabs TTS Service - TTSService interface implementation.

Wraps existing ElevenLabsTTS functionality with unified interface.
"""
import base64
import logging
from pathlib import Path
from typing import List, Optional, Tuple
import httpx
import librosa
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .base import TTSService, TTSVoice, TTSResult
from app.config import get_settings

logger = logging.getLogger(__name__)

ELEVENLABS_MAX_CHARS = 5000


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type((httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.HTTPStatusError)),
    before_sleep=lambda retry_state: logger.warning(
        f"ElevenLabs API retry {retry_state.attempt_number}/3: {retry_state.outcome.exception()}"
    ),
    reraise=True
)
async def _call_elevenlabs_api_new(url: str, headers: dict, data: dict) -> httpx.Response:
    """Make ElevenLabs API call with automatic retry on transient errors."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=data)
        if response.status_code in (429, 500, 502, 503, 504):
            raise httpx.HTTPStatusError(
                f"Transient error {response.status_code}",
                request=response.request,
                response=response
            )
        return response


class ElevenLabsTTSService(TTSService):
    """
    ElevenLabs Text-to-Speech service implementing TTSService interface.

    Uses the exact settings from user's Ana Maria voice:
    - Model: eleven_flash_v2_5
    - Stability: 0.57
    - Similarity: 0.75
    - Style: 0.22
    - Speaker Boost: True
    """

    BASE_URL = "https://api.elevenlabs.io/v1"

    MAX_FAILOVER_RETRIES = 2  # Total attempts = 1 + retries = 3

    def __init__(
        self,
        output_dir: Path,
        api_key: Optional[str] = None,
        voice_id: Optional[str] = None,
        model_id: Optional[str] = None,
        profile_id: Optional[str] = None
    ):
        """
        Initialize ElevenLabs TTS service.

        Args:
            output_dir: Directory for generated audio files
            api_key: ElevenLabs API key (defaults to env var)
            voice_id: Voice ID (defaults to env var)
            model_id: Model ID (defaults to eleven_multilingual_v2)
            profile_id: Profile ID for multi-account key lookup
        """
        super().__init__(output_dir)

        settings = get_settings()
        self._profile_id = profile_id

        # If no explicit api_key and we have a profile_id, try account manager
        if not api_key and profile_id:
            try:
                from app.services.elevenlabs_account_manager import get_account_manager
                manager = get_account_manager()
                api_key = manager.get_api_key(profile_id)
            except (ValueError, Exception) as e:
                logger.debug(f"Account manager key lookup failed, falling back to env: {e}")

        self.api_key = api_key or settings.elevenlabs_api_key
        self._voice_id = voice_id or settings.elevenlabs_voice_id
        self.model_id = model_id or getattr(settings, 'elevenlabs_model', 'eleven_flash_v2_5')

        if not self.api_key:
            raise ValueError("ELEVENLABS_API_KEY is required")
        if not self._voice_id:
            raise ValueError("ELEVENLABS_VOICE_ID is required")

        # Ana Maria voice settings (extracted from user's ElevenLabs config)
        self.voice_settings = {
            "stability": 0.57,
            "similarity_boost": 0.75,
            "style": 0.22,
            "use_speaker_boost": True,
            "speed": 1.0
        }

        logger.info(f"ElevenLabsTTSService initialized with voice: {self._voice_id}, model: {self.model_id}")

    @property
    def provider_name(self) -> str:
        """Return provider identifier."""
        return "elevenlabs"

    @property
    def cost_per_1k_chars(self) -> float:
        """Return cost per 1000 characters (Scale plan pricing)."""
        return 0.24

    async def list_voices(self, language: Optional[str] = None) -> List[TTSVoice]:
        """
        List available voices from ElevenLabs API.

        Args:
            language: Optional language filter (not used by ElevenLabs API currently)

        Returns:
            List of available voices
        """
        url = f"{self.BASE_URL}/voices"
        headers = {"xi-api-key": self.api_key}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url, headers=headers)

                if response.status_code != 200:
                    logger.error(f"ElevenLabs API error: {response.status_code} - {response.content.decode('utf-8', errors='replace')}")
                    raise Exception(f"Failed to fetch voices: {response.status_code}")

                data = response.json()
                voices = []

                for v in data.get("voices", []):
                    # Extract language from labels if available
                    labels = v.get("labels", {})
                    voice_language = labels.get("language", "en")

                    # Filter by language if specified
                    if language and not voice_language.lower().startswith(language.lower()):
                        continue

                    voices.append(TTSVoice(
                        id=v["voice_id"],
                        name=v["name"],
                        language=voice_language,
                        gender=labels.get("gender"),
                        provider="elevenlabs",
                        requires_cloning=False,
                        cost_per_1k_chars=self.cost_per_1k_chars,
                        category=v.get("category", "premade")
                    ))

                # Sort: user voices (cloned/generated) first, then premade
                priority = {"cloned": 0, "generated": 1, "professional": 2, "premade": 3}
                voices.sort(key=lambda v: (priority.get(v.category or "premade", 99), v.name.lower()))

                logger.info(f"Fetched {len(voices)} ElevenLabs voices")
                return voices

        except Exception as e:
            logger.error(f"Failed to list voices: {e}")
            raise

    async def generate_audio(
        self,
        text: str,
        voice_id: str,
        output_path: Path,
        **kwargs
    ) -> TTSResult:
        """
        Generate audio from text using ElevenLabs API.

        Args:
            text: Text to convert to speech
            voice_id: Voice identifier
            output_path: Where to save the audio file
            **kwargs: Optional overrides (stability, similarity_boost, style, use_speaker_boost)

        Returns:
            TTSResult with audio path, duration, and cost
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Prepare voice settings with optional overrides
        voice_settings = {
            "stability": kwargs.get("stability", self.voice_settings["stability"]),
            "similarity_boost": kwargs.get("similarity_boost", self.voice_settings["similarity_boost"]),
            "style": kwargs.get("style", self.voice_settings["style"]),
            "use_speaker_boost": kwargs.get("use_speaker_boost", self.voice_settings["use_speaker_boost"]),
            "speed": kwargs.get("speed", self.voice_settings.get("speed", 1.0)),
        }

        # --- Cache check (includes voice settings so different settings don't return stale audio) ---
        from app.services.tts_cache import cache_lookup, cache_store
        vs = voice_settings
        cache_key = {
            "text": text, "voice_id": voice_id, "model_id": self.model_id, "provider": "elevenlabs",
            "vs": f"{vs['stability']:.2f}_{vs['similarity_boost']:.2f}_{vs['style']:.2f}_{vs.get('speed', 1.0):.2f}"
        }
        cached = cache_lookup(cache_key, "elevenlabs", output_path)
        if cached:
            return TTSResult(
                audio_path=output_path,
                duration_seconds=cached.get("duration_seconds", 0.0),
                provider="elevenlabs",
                voice_id=voice_id,
                cost=0.0
            )

        # Prepare request with 192kbps MP3 output format
        url = f"{self.BASE_URL}/text-to-speech/{voice_id}?output_format=mp3_44100_128"
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

        if len(text) > ELEVENLABS_MAX_CHARS:
            raise ValueError(f"Text too long ({len(text)} chars, max {ELEVENLABS_MAX_CHARS})")

        logger.info(f"Generating TTS for {len(text)} characters with voice {voice_id}...")

        try:
            response = await _call_elevenlabs_api_new(url, headers, data)

            # Handle 402 (quota exceeded) with key failover
            if response.status_code == 402 and self._profile_id:
                response = await self._try_failover(response, url, headers, data)

            if response.status_code != 200:
                error_detail = response.content.decode("utf-8", errors="replace")
                logger.error(f"ElevenLabs API error: {response.status_code} - {error_detail}")
                raise Exception(f"ElevenLabs API error: {response.status_code} - {error_detail}")

            # Save audio file
            with open(output_path, "wb") as f:
                f.write(response.content)

            # Calculate duration using librosa
            try:
                duration_seconds = librosa.get_duration(path=str(output_path))
            except Exception as e:
                logger.warning(f"Failed to get audio duration: {e}")
                duration_seconds = 0.0

            # Calculate cost
            cost = (len(text) / 1000.0) * self.cost_per_1k_chars

            logger.info(f"Audio saved to: {output_path} (duration: {duration_seconds:.2f}s, cost: ${cost:.4f})")

            # Log cost to tracker
            try:
                from app.services.cost_tracker import get_cost_tracker
                tracker = get_cost_tracker()
                tracker.log_elevenlabs_tts(
                    job_id=output_path.stem,
                    characters=len(text),
                    profile_id=self._profile_id,
                    text_preview=text[:100]
                )
            except Exception as e:
                logger.warning(f"Failed to log cost: {e}")

            # --- Cache store ---
            cache_store(cache_key, "elevenlabs", output_path, {
                "duration_seconds": duration_seconds,
                "cost": cost,
                "characters": len(text)
            })

            return TTSResult(
                audio_path=output_path,
                duration_seconds=duration_seconds,
                provider="elevenlabs",
                voice_id=voice_id,
                cost=cost
            )

        except httpx.TimeoutException:
            raise Exception("ElevenLabs API timeout - text may be too long")
        except Exception as e:
            logger.error(f"TTS generation failed: {e}")
            raise

    async def _try_failover(
        self,
        response: httpx.Response,
        url: str,
        headers: dict,
        data: dict
    ) -> httpx.Response:
        """
        Attempt key rotation on 402 (quota exceeded).

        Rotates through available keys via AccountManager.
        Returns the last response (success or final failure).
        """
        headers = dict(headers)
        current_key = headers.get("xi-api-key", self.api_key)
        current_hint = f"...{current_key[-4:]}" if len(current_key) >= 4 else "..."

        logger.warning(f"ElevenLabs 402 on key {current_hint}, attempting failover...")

        try:
            from app.services.elevenlabs_account_manager import get_account_manager
            manager = get_account_manager()
            manager.record_error(self._profile_id, current_key, "402 Quota exceeded")
        except Exception as e:
            logger.warning(f"Failed to record error: {e}")
            return response

        for attempt in range(self.MAX_FAILOVER_RETRIES):
            next_key = manager.get_next_api_key(self._profile_id, current_key)
            if not next_key:
                logger.error("All ElevenLabs keys exhausted")
                return response

            next_hint = f"...{next_key[-4:]}" if len(next_key) >= 4 else "..."
            logger.info(f"Rotating ElevenLabs key: {current_hint} -> {next_hint} (attempt {attempt + 2})")

            headers["xi-api-key"] = next_key
            response = await _call_elevenlabs_api_new(url, headers, data)

            if response.status_code != 402:
                self.api_key = next_key
                return response

            try:
                manager.record_error(self._profile_id, next_key, "402 Quota exceeded")
            except Exception:
                pass
            current_key = next_key
            current_hint = next_hint

        logger.error("All ElevenLabs keys returned 402")
        return response

    async def generate_audio_with_timestamps(
        self,
        text: str,
        voice_id: str,
        output_path: Path,
        model_id: Optional[str] = None,
        **kwargs
    ) -> Tuple[TTSResult, dict]:
        """
        Generate audio with character-level timestamps from ElevenLabs.

        Uses the /text-to-speech/{voice_id}/with-timestamps endpoint.
        Returns both the audio file and character-level timing data.

        Args:
            text: Text to convert to speech
            voice_id: Voice identifier
            output_path: Where to save the audio file
            model_id: Optional model override (eleven_flash_v2_5, eleven_turbo_v2_5, eleven_multilingual_v2)
            **kwargs: Voice settings overrides (stability, similarity_boost, style, use_speaker_boost)

        Returns:
            Tuple of (TTSResult, alignment_dict) where alignment_dict contains:
            {
                "characters": ["H", "e", "l", "l", "o", " ", ...],
                "character_start_times_seconds": [0.0, 0.05, 0.09, ...],
                "character_end_times_seconds": [0.05, 0.09, 0.14, ...]
            }
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Prepare voice settings with optional overrides
        effective_model = model_id or self.model_id
        voice_settings = {
            "stability": kwargs.get("stability", self.voice_settings["stability"]),
            "similarity_boost": kwargs.get("similarity_boost", self.voice_settings["similarity_boost"]),
            "style": kwargs.get("style", self.voice_settings["style"]),
            "use_speaker_boost": kwargs.get("use_speaker_boost", self.voice_settings["use_speaker_boost"]),
            "speed": kwargs.get("speed", self.voice_settings.get("speed", 1.0)),
        }

        # --- Cache check (includes voice settings so different settings don't return stale audio) ---
        from app.services.tts_cache import cache_lookup, cache_store
        vs = voice_settings
        cache_key = {
            "text": text, "voice_id": voice_id, "model_id": effective_model, "provider": "elevenlabs_ts",
            "vs": f"{vs['stability']:.2f}_{vs['similarity_boost']:.2f}_{vs['style']:.2f}_{vs.get('speed', 1.0):.2f}"
        }
        cached = cache_lookup(cache_key, "elevenlabs", output_path)
        if cached:
            alignment = cached.get("alignment", {})
            tts_result = TTSResult(
                audio_path=output_path,
                duration_seconds=cached.get("duration_seconds", 0.0),
                provider="elevenlabs",
                voice_id=voice_id,
                cost=0.0
            )
            return (tts_result, alignment)

        # Prepare request - with-timestamps endpoint returns JSON, not audio stream
        url = f"{self.BASE_URL}/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128"
        headers = {
            "Content-Type": "application/json",
            "xi-api-key": self.api_key
        }
        data = {
            "text": text,
            "model_id": model_id or self.model_id,
            "voice_settings": voice_settings
        }

        logger.info(f"Generating TTS with timestamps for {len(text)} characters with voice {voice_id}...")

        try:
            response = await _call_elevenlabs_api_new(url, headers, data)

            # Handle 402 (quota exceeded) with key failover
            if response.status_code == 402 and self._profile_id:
                response = await self._try_failover(response, url, headers, data)

            if response.status_code != 200:
                error_detail = response.content.decode("utf-8", errors="replace")
                logger.error(f"ElevenLabs API error: {response.status_code} - {error_detail}")
                raise Exception(f"ElevenLabs API error: {response.status_code} - {error_detail}")

            # Parse JSON response
            response_data = response.json()

            # Decode base64 audio and save to file
            audio_b64 = response_data.get("audio_base64")
            if not audio_b64:
                raise Exception("ElevenLabs API response missing audio_base64 field")
            audio_bytes = base64.b64decode(audio_b64)
            with open(output_path, "wb") as f:
                f.write(audio_bytes)

            # Extract alignment data
            alignment = response_data.get("alignment", {})

            # Calculate duration using librosa
            try:
                duration_seconds = librosa.get_duration(path=str(output_path))
            except Exception as e:
                logger.warning(f"Failed to get audio duration: {e}")
                duration_seconds = 0.0

            # Calculate cost
            cost = (len(text) / 1000.0) * self.cost_per_1k_chars

            logger.info(
                f"Audio with timestamps saved to: {output_path} "
                f"(duration: {duration_seconds:.2f}s, cost: ${cost:.4f}, "
                f"characters: {len(alignment.get('characters', []))})"
            )

            # Log cost to tracker
            try:
                from app.services.cost_tracker import get_cost_tracker
                tracker = get_cost_tracker()
                tracker.log_elevenlabs_tts(
                    job_id=output_path.stem,
                    characters=len(text),
                    profile_id=self._profile_id,
                    text_preview=text[:100]
                )
            except Exception as e:
                logger.warning(f"Failed to log cost: {e}")

            # --- Cache store ---
            cache_store(cache_key, "elevenlabs", output_path, {
                "duration_seconds": duration_seconds,
                "cost": cost,
                "characters": len(text),
                "alignment": alignment
            })

            tts_result = TTSResult(
                audio_path=output_path,
                duration_seconds=duration_seconds,
                provider="elevenlabs",
                voice_id=voice_id,
                cost=cost
            )

            return (tts_result, alignment)

        except httpx.TimeoutException:
            raise Exception("ElevenLabs API timeout - text may be too long")
        except Exception as e:
            logger.error(f"TTS generation with timestamps failed: {e}")
            raise

    async def supports_voice_cloning(self) -> bool:
        """
        Check if provider supports voice cloning.

        Returns:
            False (ElevenLabs cloning is a separate paid feature)
        """
        return False
