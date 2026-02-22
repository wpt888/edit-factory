"""
TTS Library Service

Manages persistent TTS assets (MP3 + SRT files) for the TTS Library feature.
Provides generation, regeneration, deletion, and pipeline auto-save functionality.
"""
import logging
import shutil
import uuid
from pathlib import Path
from typing import Optional, Tuple

from app.config import get_settings

logger = logging.getLogger(__name__)

# Singleton instance
_instance = None


def get_tts_library_service():
    """Get singleton TTS library service instance."""
    global _instance
    if _instance is None:
        _instance = TTSLibraryService()
    return _instance


class TTSLibraryService:
    """Manages persistent TTS audio and subtitle assets."""

    def __init__(self):
        self.settings = get_settings()
        self.media_base = self.settings.base_dir / "media" / "tts"
        self.media_base.mkdir(parents=True, exist_ok=True)

    def _asset_dir(self, profile_id: str) -> Path:
        """Get or create the asset directory for a profile."""
        d = self.media_base / profile_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    async def generate_asset(
        self,
        text: str,
        profile_id: str,
        asset_id: str,
        model: str = "eleven_flash_v2_5",
    ) -> dict:
        """
        Generate MP3 + SRT for a TTS asset.

        Returns dict with keys: mp3_path, srt_path, srt_content, audio_duration,
        char_count, tts_timestamps, tts_voice_id
        """
        from app.services.tts.elevenlabs import ElevenLabsTTSService
        from app.services.silence_remover import SilenceRemover
        from app.services.tts_subtitle_generator import generate_srt_from_timestamps

        asset_dir = self._asset_dir(profile_id)
        temp_dir = self.settings.base_dir / "temp" / profile_id / f"ttslib_{asset_id[:8]}"
        temp_dir.mkdir(parents=True, exist_ok=True)

        try:
            # Generate TTS with timestamps (profile_id enables multi-account failover)
            tts_service = ElevenLabsTTSService(output_dir=temp_dir, model_id=model, profile_id=profile_id)
            voice_id = tts_service._voice_id
            raw_audio_path = temp_dir / "tts_raw.mp3"

            logger.info(f"TTS Library: generating for asset {asset_id} ({len(text)} chars, model={model})")

            tts_result, timestamps = await tts_service.generate_audio_with_timestamps(
                text=text,
                voice_id=voice_id,
                output_path=raw_audio_path,
                model_id=model,
            )

            # Apply silence removal
            trimmed_path = temp_dir / "tts_trimmed.mp3"
            remover = SilenceRemover(min_silence_duration=0.25, padding=0.06)
            removal_result = remover.remove_silence(tts_result.audio_path, trimmed_path)
            audio_duration = removal_result.new_duration

            logger.info(
                f"TTS Library: silence removal {removal_result.original_duration:.1f}s -> "
                f"{audio_duration:.1f}s for asset {asset_id}"
            )

            # Generate SRT
            srt_content = generate_srt_from_timestamps(timestamps)

            # Copy to persistent location
            mp3_dest = asset_dir / f"{asset_id}.mp3"
            srt_dest = asset_dir / f"{asset_id}.srt"

            shutil.copy2(str(trimmed_path), str(mp3_dest))
            srt_dest.write_text(srt_content, encoding="utf-8")

            # Relative paths for DB storage
            mp3_rel = f"media/tts/{profile_id}/{asset_id}.mp3"
            srt_rel = f"media/tts/{profile_id}/{asset_id}.srt"

            return {
                "mp3_path": mp3_rel,
                "srt_path": srt_rel,
                "srt_content": srt_content,
                "audio_duration": audio_duration,
                "char_count": len(text),
                "tts_timestamps": timestamps,
                "tts_voice_id": voice_id,
            }

        finally:
            # Clean up temp dir
            try:
                shutil.rmtree(str(temp_dir), ignore_errors=True)
            except Exception:
                pass

    async def regenerate_asset(
        self,
        asset_id: str,
        new_text: str,
        profile_id: str,
        model: str = "eleven_flash_v2_5",
        old_mp3_path: Optional[str] = None,
        old_srt_path: Optional[str] = None,
    ) -> dict:
        """Delete old files and generate new ones for an updated asset."""
        # Delete old files
        if old_mp3_path:
            self.delete_file(old_mp3_path)
        if old_srt_path:
            self.delete_file(old_srt_path)

        return await self.generate_asset(new_text, profile_id, asset_id, model)

    def delete_file(self, rel_path: str):
        """Delete a file by its relative path."""
        full_path = self.settings.base_dir / rel_path
        try:
            if full_path.exists():
                full_path.unlink()
                logger.info(f"Deleted: {rel_path}")
        except Exception as e:
            logger.warning(f"Failed to delete {rel_path}: {e}")

    def delete_asset_files(self, mp3_path: Optional[str], srt_path: Optional[str]):
        """Delete both MP3 and SRT files for an asset."""
        if mp3_path:
            self.delete_file(mp3_path)
        if srt_path:
            self.delete_file(srt_path)

    def save_from_pipeline(
        self,
        profile_id: str,
        text: str,
        audio_path: str,
        srt_content: Optional[str],
        timestamps: Optional[dict],
        model: str,
        duration: float,
        voice_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Copy TTS output from pipeline/render into the persistent library.
        Deduplicates on (profile_id, text, model). Returns asset_id or None if skipped/failed.
        """
        # Lazy import supabase
        try:
            from app.db import get_supabase
            supabase = get_supabase()
            if not supabase:
                return None
        except Exception as e:
            logger.warning(f"TTS Library save_from_pipeline: no supabase: {e}")
            return None

        # Check for existing duplicate
        try:
            existing = (
                supabase.table("editai_tts_assets")
                .select("id")
                .eq("profile_id", profile_id)
                .eq("tts_text", text.strip())
                .eq("tts_model", model)
                .limit(1)
                .execute()
            )
            if existing.data:
                logger.info(f"TTS Library: dedup hit, skipping save for text={text[:40]}...")
                return None
        except Exception as e:
            logger.warning(f"TTS Library dedup check failed: {e}")

        asset_id = str(uuid.uuid4())
        asset_dir = self._asset_dir(profile_id)

        # Copy MP3
        mp3_rel = None
        source = Path(audio_path)
        if source.exists():
            mp3_dest = asset_dir / f"{asset_id}.mp3"
            shutil.copy2(str(source), str(mp3_dest))
            mp3_rel = f"media/tts/{profile_id}/{asset_id}.mp3"

        # Write SRT
        srt_rel = None
        if srt_content:
            srt_dest = asset_dir / f"{asset_id}.srt"
            srt_dest.write_text(srt_content, encoding="utf-8")
            srt_rel = f"media/tts/{profile_id}/{asset_id}.srt"

        # Insert into DB
        try:
            supabase.table("editai_tts_assets").insert({
                "id": asset_id,
                "profile_id": profile_id,
                "tts_text": text.strip(),
                "mp3_path": mp3_rel,
                "srt_path": srt_rel,
                "srt_content": srt_content,
                "tts_provider": "elevenlabs",
                "tts_model": model,
                "tts_voice_id": voice_id,
                "audio_duration": duration,
                "char_count": len(text),
                "tts_timestamps": timestamps,
                "status": "ready",
            }).execute()
            logger.info(f"TTS Library: saved pipeline asset {asset_id}")
            return asset_id
        except Exception as e:
            logger.warning(f"TTS Library: failed to insert asset: {e}")
            return None
