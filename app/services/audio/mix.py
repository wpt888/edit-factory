"""Background-music mix filtergraph builder (BGM + auto-ducking).

Pure, side-effect-free helper so it can be unit-tested without ffmpeg or
FastAPI. `_render_with_preset` switches from the legacy voice-only `-af` chain
to a `-filter_complex` graph whenever a music track is present; the graph keeps
the voice chain (loudnorm first, then user volume/fades) byte-identical to the
`-af` path and mixes ducked music underneath it.

Input index contract (matches the order `_render_with_preset` adds inputs):
    0 = video, 1 = voice (real TTS audio), 2 = music.

Ducking uses `sidechaincompress` with the voice as the sidechain key, so the
music dips only while the voice is speaking. `amix=duration=first` plus the
caller's existing `-t <voice_dur>` keep the output duration identical to a
no-music render.
"""

from __future__ import annotations

from typing import List, Sequence, Tuple

# sidechaincompress defaults tuned for spoken voice over background music.
# threshold is a linear amplitude (0-1); ratio/attack/release are dB / ms.
# ponytail: fixed defaults, expose as params only if a UI ever needs them.
_DUCK_PARAMS = "threshold=0.05:ratio=8:attack=20:release=300"

# Final mix + brickwall limiter shared by the ducked and non-ducked graphs.
_MIX_TAIL = (
    "amix=inputs=2:duration=first:dropout_transition=0:normalize=0,"
    "alimiter=limit=0.95[aout]"
)


def build_audio_mix_filter(
    voice_filters: Sequence[str],
    music_path: str,
    music_volume: float = 0.3,
    music_ducking: bool = True,
    music_fade_in: float = 0.0,
    music_fade_out: float = 0.0,
    music_loop: bool = True,
    audio_dur: float = 0.0,
    voice_input: str = "1:a",
    music_input: str = "2:a",
) -> Tuple[str, List[str]]:
    """Build the `-filter_complex` graph and the extra music input args.

    Args:
        voice_filters: the existing voice `-af` chain (loudnorm, volume, fades),
            already ordered loudnorm-first by the caller. Applied verbatim to the
            voice input so the voice is treated identically to a no-music render.
        music_path: local path to the resolved music file.
        music_volume: linear gain applied to the music before ducking.
        music_ducking: when True, sidechain-compress the music by the voice.
        music_fade_in / music_fade_out: seconds; fade-out anchored to audio_dur.
        music_loop: when True, prepend `-stream_loop -1` so the track fills the
            whole voiceover; amix=duration=first + the caller's `-t` trim it back.
        audio_dur: voiceover duration (for fade-out start). 0 disables fade-out.
        voice_input / music_input: ffmpeg stream specifiers for the two inputs.

    Returns:
        (filter_complex, input_args) where input_args are the ffmpeg args that
        add the music input (with optional stream loop). input_args must be
        appended AFTER the voice input so music lands at index 2.
    """
    input_args: List[str] = []
    if music_loop:
        input_args += ["-stream_loop", "-1"]
    input_args += ["-i", str(music_path)]

    # Voice chain — a filter is required between pad labels, so an empty chain
    # becomes a no-op `anull` that still produces the [voice] label.
    voice_chain = ",".join(f for f in voice_filters if f)
    voice_seg = f"[{voice_input}]{voice_chain}[voice]" if voice_chain else f"[{voice_input}]anull[voice]"

    # Music chain — volume is always meaningful (default 0.3) so it always runs.
    music_filters = [f"volume={music_volume:.2f}"]
    if music_fade_in > 0:
        music_filters.append(f"afade=t=in:st=0.00:d={music_fade_in:.2f}")
    if music_fade_out > 0 and audio_dur > music_fade_out:
        fade_out_st = audio_dur - music_fade_out
        music_filters.append(f"afade=t=out:st={fade_out_st:.2f}:d={music_fade_out:.2f}")
    music_seg = f"[{music_input}]{','.join(music_filters)}[m0]"

    parts = [voice_seg, music_seg]
    if music_ducking:
        parts.append("[voice]asplit[vo][sc]")
        parts.append(f"[m0][sc]sidechaincompress={_DUCK_PARAMS}[duck]")
        parts.append(f"[vo][duck]{_MIX_TAIL}")
    else:
        parts.append(f"[voice][m0]{_MIX_TAIL}")

    return ";".join(parts), input_args
