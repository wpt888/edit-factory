"""Background-music mix (BGM + auto-ducking) tests.

Unit tests exercise build_audio_mix_filter's graph construction (ducking on/off,
loop, fades, loudnorm-first ordering, determinism across encode branches).

The ffmpeg smoke renders synth voice (gated sine bursts) + synth music (steady
tone) through the SAME command shape as _render_with_preset (video -vf +
filter_complex mix) and proves: exactly one audio stream, duration unchanged vs
a no-music render, and — via a lowpass that isolates the music band — that the
music is measurably quieter in a voice-active window than a voice-silent one.
Follows tests/test_transitions_ffmpeg.py conventions (skip without ffmpeg).
"""
import re
import shutil
import subprocess

import pytest

from app.services.audio.mix import build_audio_mix_filter, _DUCK_PARAMS


# ── Unit tests (no ffmpeg) ──────────────────────────────────────────────────

VOICE_CHAIN = ["loudnorm=I=-14:TP=-1.5:LRA=11", "volume=1.20", "afade=t=in:st=0.00:d=0.50"]


def test_ducking_on_builds_sidechain():
    graph, inputs = build_audio_mix_filter(VOICE_CHAIN, "m.mp3", music_ducking=True)
    assert f"sidechaincompress={_DUCK_PARAMS}" in graph
    assert "asplit[vo][sc]" in graph
    assert "[vo][duck]amix=inputs=2:duration=first" in graph
    assert graph.endswith("alimiter=limit=0.95[aout]")


def test_ducking_off_skips_sidechain():
    graph, _ = build_audio_mix_filter(VOICE_CHAIN, "m.mp3", music_ducking=False)
    assert "sidechaincompress" not in graph
    assert "asplit" not in graph
    assert "[voice][m0]amix=inputs=2:duration=first" in graph


def test_loudnorm_stays_first_on_voice():
    graph, _ = build_audio_mix_filter(VOICE_CHAIN, "m.mp3")
    voice_seg = graph.split(";")[0]
    # The voice segment must apply loudnorm before any user volume/fade filter.
    assert voice_seg.startswith("[1:a]loudnorm=")
    assert voice_seg.index("loudnorm") < voice_seg.index("volume=1.20")


def test_empty_voice_chain_uses_anull():
    graph, _ = build_audio_mix_filter([], "m.mp3")
    assert graph.split(";")[0] == "[1:a]anull[voice]"


def test_loop_adds_stream_loop():
    _, inputs = build_audio_mix_filter([], "m.mp3", music_loop=True)
    assert inputs == ["-stream_loop", "-1", "-i", "m.mp3"]


def test_no_loop_trims_no_stream_loop():
    _, inputs = build_audio_mix_filter([], "m.mp3", music_loop=False)
    assert inputs == ["-i", "m.mp3"]


def test_music_volume_and_fades_applied():
    graph, _ = build_audio_mix_filter(
        [], "m.mp3", music_volume=0.25, music_fade_in=1.0, music_fade_out=2.0, audio_dur=10.0
    )
    music_seg = graph.split(";")[1]
    assert "volume=0.25" in music_seg
    assert "afade=t=in:st=0.00:d=1.00" in music_seg
    assert "afade=t=out:st=8.00:d=2.00" in music_seg


def test_fade_out_skipped_when_longer_than_audio():
    graph, _ = build_audio_mix_filter([], "m.mp3", music_fade_out=5.0, audio_dur=3.0)
    assert "afade=t=out" not in graph


def test_both_encode_branches_get_identical_graph():
    # _render_with_preset builds the graph once and feeds both the single-pass
    # and pass-2 commands; the helper must be deterministic for that to hold.
    a = build_audio_mix_filter(VOICE_CHAIN, "m.mp3", music_volume=0.3, audio_dur=5.0)
    b = build_audio_mix_filter(VOICE_CHAIN, "m.mp3", music_volume=0.3, audio_dur=5.0)
    assert a == b


# ── Real ffmpeg smoke ───────────────────────────────────────────────────────

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe not on PATH",
)

# Voice = 2000Hz sine, ON while mod(t,2)<1 → active [0,1)&[2,3), silent [1,2)&[3,4).
_VOICE_EXPR = "aevalsrc=exprs=sin(2000*2*PI*t)*lt(mod(t\\,2)\\,1):s=48000:d=4"
_MUSIC_EXPR = "sine=frequency=100:sample_rate=48000:duration=8"
_DUR = 4.0


def _ffprobe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True, timeout=30,
    )
    return float(out.stdout.strip())


def _count_audio_streams(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=index", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True, timeout=30,
    )
    return len([line for line in out.stdout.splitlines() if line.strip()])


def _music_band_mean_db(path, start):
    """mean_volume over a 0.7s window after `start`, lowpassed to isolate the
    100Hz music band (kills the 2000Hz voice), so we measure music level only."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-ss", str(start), "-t", "0.7", "-i", str(path),
         "-af", "lowpass=f=300,volumedetect", "-f", "null", "-"],
        capture_output=True, text=True, timeout=30,
    )
    match = re.search(r"mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB", proc.stderr)
    assert match, f"no mean_volume in ffmpeg output:\n{proc.stderr[-1500:]}"
    return float(match.group(1))


def _render(tmp_path, with_music):
    """Mirror _render_with_preset's command shape: video -vf + (optional) music
    filter_complex mix, mapping [aout] and clamping to the voice duration."""
    out = tmp_path / (f"mix_{'music' if with_music else 'nomusic'}.mp4")
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=size=320x568:rate=30:duration=4",
        "-f", "lavfi", "-i", _VOICE_EXPR,
    ]
    if with_music:
        graph, music_inputs = build_audio_mix_filter(
            [], "MUSIC_PLACEHOLDER", music_volume=0.8, music_ducking=True,
        )
        # Swap the placeholder input for a lavfi music source (index 2).
        assert music_inputs[-1] == "MUSIC_PLACEHOLDER"
        cmd += music_inputs[:-2] + ["-f", "lavfi", "-i", _MUSIC_EXPR]
        cmd += ["-vf", "scale=320:568", "-filter_complex", graph,
                "-map", "0:v:0", "-map", "[aout]"]
    else:
        cmd += ["-vf", "scale=320:568", "-map", "0:v:0", "-map", "1:a:0"]
    cmd += ["-t", str(_DUR), "-c:v", "libx264", "-preset", "ultrafast",
            "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, f"ffmpeg failed:\n{' '.join(cmd)}\n{result.stderr[-2000:]}"
    return out


def test_mix_one_stream_and_duration_invariant(tmp_path):
    with_music = _render(tmp_path, with_music=True)
    no_music = _render(tmp_path, with_music=False)
    assert _count_audio_streams(with_music) == 1
    # Duration must not change vs the no-music render (both clamped to voice).
    assert abs(_ffprobe_duration(with_music) - _ffprobe_duration(no_music)) < 1.0 / 30


def test_ducking_makes_music_quieter_under_voice(tmp_path):
    out = _render(tmp_path, with_music=True)
    voice_active = _music_band_mean_db(out, start=0.2)   # window [0.2,0.9): voice on
    voice_silent = _music_band_mean_db(out, start=1.3)   # window [1.3,2.0): voice off
    # Music must be measurably ducked while the voice speaks.
    assert voice_active < voice_silent - 2.0, (
        f"expected ducking: active={voice_active}dB should be >2dB below "
        f"silent={voice_silent}dB"
    )
