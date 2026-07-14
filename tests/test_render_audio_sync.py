import asyncio
import inspect
from pathlib import Path
from types import SimpleNamespace

import pytest


def test_render_starts_audio_at_zero_under_rapid_intro(tmp_path, monkeypatch):
    """The muxer must never add the rapid-intro duration to the audio PTS."""
    from app.api import library_routes

    assert "intro_offset_sec" not in inspect.signature(
        library_routes._render_with_preset
    ).parameters

    video_path = tmp_path / "assembled.mp4"
    audio_path = tmp_path / "voiceover.mp3"
    output_path = tmp_path / "final.mp4"
    video_path.write_bytes(b"video")
    audio_path.write_bytes(b"audio")

    captured_commands = []

    def fake_ffprobe(*_args, **_kwargs):
        return SimpleNamespace(returncode=0, stdout="5.0\n", stderr="")

    def fake_render(command, *_args, **_kwargs):
        captured_commands.append(command)
        Path(command[-1]).write_bytes(b"rendered")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(library_routes, "safe_ffmpeg_run", fake_ffprobe)
    monkeypatch.setattr(library_routes, "safe_ffmpeg_run_with_progress", fake_render)
    monkeypatch.setattr(library_routes, "is_nvenc_available", lambda: False)

    asyncio.run(
        library_routes._render_with_preset(
            video_path=video_path,
            audio_path=audio_path,
            srt_path=None,
            subtitle_settings=None,
            preset={
                "name": "Preview",
                "width": 540,
                "height": 960,
                "fps": 30,
                "extra_flags": "-movflags +faststart",
            },
            output_path=output_path,
            audio_fade_in=0.25,
            audio_fade_out=0.5,
            _preview_mode=True,
            force_cpu=True,
        )
    )

    assert len(captured_commands) == 1
    command = captured_commands[0]
    assert "-itsoffset" not in command

    audio_input_index = command.index(str(audio_path))
    assert command[audio_input_index - 1] == "-i"

    duration_index = command.index("-t")
    assert float(command[duration_index + 1]) == pytest.approx(5.0)

    audio_filter = command[command.index("-af") + 1]
    assert "afade=t=in:st=0.00:d=0.25" in audio_filter
    assert "afade=t=out:st=4.50:d=0.50" in audio_filter
