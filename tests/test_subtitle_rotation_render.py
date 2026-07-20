"""Real FFmpeg smoke for rotated subtitle templates."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess

import pytest

from app.ffmpeg_setup import _setup_ffmpeg_path

_setup_ffmpeg_path()

from app.services.subtitle_rotation import assigned_preset_id, regroup_srt_for_variant
from app.services.video_effects.subtitle_styler import build_subtitle_filter


pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe not available",
)


def _run(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr[-3000:]


def _timestamps(text: str, duration: float = 4.0) -> dict:
    step = duration / len(text)
    return {
        "characters": list(text),
        "character_start_times_seconds": [index * step for index in range(len(text))],
        "character_end_times_seconds": [(index + 1) * step for index in range(len(text))],
    }


def _frame_digest(video: Path, frame: Path) -> str:
    _run([
        "ffmpeg", "-y", "-ss", "2.5", "-i", str(video),
        "-frames:v", "1", str(frame),
    ])
    return hashlib.sha256(frame.read_bytes()).hexdigest()


def test_three_variant_rotation_renders_distinct_templates(tmp_path):
    artifact_root = os.getenv("SUBTITLE_ROTATION_SMOKE_DIR")
    workdir = Path(artifact_root) if artifact_root else tmp_path
    workdir.mkdir(parents=True, exist_ok=True)

    source = workdir / "source.mp4"
    _run([
        "ffmpeg", "-y", "-f", "lavfi", "-i",
        "color=c=0x20252b:s=320x568:r=30:d=4",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        str(source),
    ])

    templates = {
        "punchy": {
            "words": 2,
            "style": {
                "fontFamily": "Arial",
                "fontSize": 42,
                "textColor": "#FFFFFF",
                "outlineColor": "#000000",
                "outlineWidth": 3,
                "positionY": 62,
                "karaoke": True,
                "highlightColor": "#A3E635",
            },
        },
        "clean": {
            "words": 4,
            "style": {
                "fontFamily": "Arial",
                "fontSize": 30,
                "textColor": "#FFCC66",
                "outlineColor": "#4C1D95",
                "outlineWidth": 1,
                "positionY": 78,
                "karaoke": False,
            },
        },
    }
    preset_ids = ["punchy", "clean"]
    timestamps = _timestamps("unu doi trei patru cinci sase sapte opt")
    outputs: list[Path] = []
    frame_hashes: list[str] = []

    for variant_index in range(3):
        preset_id = assigned_preset_id(variant_index, preset_ids)
        assert preset_id is not None
        template = templates[preset_id]
        preview_key = str(variant_index + 1)
        srt_path = workdir / f"variant-{preview_key}.srt"
        srt_path.write_text(
            regroup_srt_for_variant(
                timestamps,
                preview_key=preview_key,
                words_by_key={preview_key: template["words"]},
                karaoke=template["style"]["karaoke"],
            ),
            encoding="utf-8",
        )
        output = workdir / f"variant-{preview_key}-{preset_id}.mp4"
        subtitle_filter = build_subtitle_filter(
            srt_path,
            template["style"],
            video_width=320,
            video_height=568,
        )
        _run([
            "ffmpeg", "-y", "-i", str(source), "-vf", subtitle_filter,
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-an", str(output),
        ])
        outputs.append(output)
        frame_hashes.append(_frame_digest(output, workdir / f"variant-{preview_key}.png"))

    # Round-robin assignment: variants 1 and 3 share the exact render recipe;
    # variant 2 differs in cue grouping, position, colour, size and karaoke mode.
    assert frame_hashes[0] == frame_hashes[2]
    assert frame_hashes[0] != frame_hashes[1]
    punchy_srt = re.sub(
        r"\{\\k\d+\}",
        "",
        (workdir / "variant-1.srt").read_text(encoding="utf-8"),
    )
    clean_srt = (workdir / "variant-2.srt").read_text(encoding="utf-8")
    assert "cinci sase\n" in punchy_srt
    assert "cinci sase sapte opt\n" in clean_srt

    contact_sheet = workdir / "subtitle-rotation-render-smoke.png"
    _run([
        "ffmpeg", "-y",
        "-i", str(workdir / "variant-1.png"),
        "-i", str(workdir / "variant-2.png"),
        "-i", str(workdir / "variant-3.png"),
        "-filter_complex", "hstack=inputs=3",
        "-frames:v", "1", contact_sheet,
    ])
    assert contact_sheet.stat().st_size > 0
    assert all(path.stat().st_size > 0 for path in outputs)
