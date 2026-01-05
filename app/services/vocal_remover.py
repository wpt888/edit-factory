"""
Vocal Remover Service using Demucs AI
Separă vocile de muzică/efecte folosind machine learning.
"""

import subprocess
import shutil
import logging
from pathlib import Path
from typing import Optional
import tempfile

logger = logging.getLogger(__name__)


class VocalRemover:
    """
    Folosește Demucs (Meta AI) pentru a separa vocile de restul audio-ului.
    Mult mai precis decât noise cancelling pentru că folosește un model ML
    antrenat specific pentru source separation.
    """

    def __init__(self, model: str = "htdemucs", two_stems: bool = True):
        """
        Args:
            model: Modelul Demucs de folosit
                   - "htdemucs" (default): cel mai rapid, calitate bună
                   - "htdemucs_ft": fine-tuned, calitate mai bună
                   - "mdx_extra": calitate foarte bună, mai lent
            two_stems: Dacă True, separă doar în vocals/no_vocals (mai rapid)
                       Dacă False, separă în vocals/drums/bass/other
        """
        self.model = model
        self.two_stems = two_stems

    def remove_vocals(self, input_video: Path, output_video: Path) -> bool:
        """
        Elimină vocile dintr-un video și salvează rezultatul.

        Args:
            input_video: Calea către videoclipul sursă
            output_video: Calea pentru videoclipul rezultat (fără voci)

        Returns:
            True dacă operația a reușit, False altfel
        """
        input_video = Path(input_video)
        output_video = Path(output_video)

        if not input_video.exists():
            logger.error(f"Input video not found: {input_video}")
            return False

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # 1. Extragem audio-ul din video
            audio_path = temp_path / "audio.wav"
            extract_cmd = [
                "ffmpeg", "-y",
                "-i", str(input_video),
                "-vn",  # fără video
                "-acodec", "pcm_s16le",  # WAV format necesar pentru Demucs
                "-ar", "44100",  # sample rate
                "-ac", "2",  # stereo
                str(audio_path)
            ]

            logger.info(f"Extracting audio from {input_video.name}...")
            result = subprocess.run(extract_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error(f"FFmpeg audio extract error: {result.stderr}")
                return False

            # 2. Rulăm Demucs pentru separare
            demucs_output = temp_path / "separated"
            demucs_cmd = [
                "python", "-m", "demucs",
                "--two-stems=vocals" if self.two_stems else "",
                "-n", self.model,
                "-o", str(demucs_output),
                str(audio_path)
            ]
            # Eliminăm argumentele goale
            demucs_cmd = [arg for arg in demucs_cmd if arg]

            logger.info(f"Running Demucs vocal separation (model: {self.model})...")
            result = subprocess.run(demucs_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error(f"Demucs error: {result.stderr}")
                return False

            # 3. Găsim fișierul "no_vocals" generat
            # Demucs salvează în: output/model_name/audio/no_vocals.wav
            no_vocals_path = demucs_output / self.model / "audio" / "no_vocals.wav"
            if not no_vocals_path.exists():
                # Încercăm alt pattern
                for f in (demucs_output / self.model).rglob("no_vocals.wav"):
                    no_vocals_path = f
                    break

            if not no_vocals_path.exists():
                logger.error(f"No vocals track not found in {demucs_output}")
                # Listăm ce s-a generat pentru debug
                for f in demucs_output.rglob("*.wav"):
                    logger.info(f"  Found: {f}")
                return False

            logger.info(f"Found no_vocals track: {no_vocals_path}")

            # 4. Combinăm video-ul original cu audio-ul fără voci
            combine_cmd = [
                "ffmpeg", "-y",
                "-i", str(input_video),
                "-i", str(no_vocals_path),
                "-c:v", "copy",  # păstrăm video-ul neschimbat
                "-map", "0:v:0",  # video din primul input
                "-map", "1:a:0",  # audio din al doilea input
                "-c:a", "aac",
                "-b:a", "192k",
                str(output_video)
            ]

            logger.info(f"Combining video with vocal-free audio...")
            result = subprocess.run(combine_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error(f"FFmpeg combine error: {result.stderr}")
                return False

            logger.info(f"Successfully removed vocals: {output_video}")
            return True

    def remove_vocals_from_audio(self, input_audio: Path, output_audio: Path) -> bool:
        """
        Elimină vocile dintr-un fișier audio.

        Args:
            input_audio: Calea către audio-ul sursă (mp3, wav, etc.)
            output_audio: Calea pentru audio-ul rezultat (fără voci)

        Returns:
            True dacă operația a reușit, False altfel
        """
        input_audio = Path(input_audio)
        output_audio = Path(output_audio)

        if not input_audio.exists():
            logger.error(f"Input audio not found: {input_audio}")
            return False

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)

            # Convertim la WAV dacă e necesar
            if input_audio.suffix.lower() != ".wav":
                wav_path = temp_path / "input.wav"
                convert_cmd = [
                    "ffmpeg", "-y",
                    "-i", str(input_audio),
                    "-acodec", "pcm_s16le",
                    "-ar", "44100",
                    "-ac", "2",
                    str(wav_path)
                ]
                result = subprocess.run(convert_cmd, capture_output=True, text=True)
                if result.returncode != 0:
                    logger.error(f"Audio conversion error: {result.stderr}")
                    return False
            else:
                wav_path = input_audio

            # Rulăm Demucs
            demucs_output = temp_path / "separated"
            demucs_cmd = [
                "python", "-m", "demucs",
                "--two-stems=vocals",
                "-n", self.model,
                "-o", str(demucs_output),
                str(wav_path)
            ]

            logger.info(f"Running Demucs on audio file...")
            result = subprocess.run(demucs_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error(f"Demucs error: {result.stderr}")
                return False

            # Găsim no_vocals
            no_vocals_path = None
            for f in demucs_output.rglob("no_vocals.wav"):
                no_vocals_path = f
                break

            if not no_vocals_path or not no_vocals_path.exists():
                logger.error("No vocals track not found")
                return False

            # Copiem sau convertim output-ul
            if output_audio.suffix.lower() == ".wav":
                shutil.copy(no_vocals_path, output_audio)
            else:
                convert_cmd = [
                    "ffmpeg", "-y",
                    "-i", str(no_vocals_path),
                    str(output_audio)
                ]
                result = subprocess.run(convert_cmd, capture_output=True, text=True)
                if result.returncode != 0:
                    logger.error(f"Output conversion error: {result.stderr}")
                    return False

            return True


# Test rapid
if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 3:
        print("Usage: python vocal_remover.py input.mp4 output.mp4")
        sys.exit(1)

    remover = VocalRemover()
    success = remover.remove_vocals(Path(sys.argv[1]), Path(sys.argv[2]))
    print("Success!" if success else "Failed!")
