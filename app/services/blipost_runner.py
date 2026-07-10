"""
Blipost render runner (desktop fleet member).

Ports social-scheduler/render-runner/runner.ts 1:1 to Python so a paired desktop
can lease and render clip jobs off the web app's Lease API — free of credits,
on the user's own GPU/CPU. No R2 credentials and no DB: everything flows through
the Lease API (`/api/render/v1/*`) and the presigned GET/PUT URLs it hands back.

The render engine (ASS caption file + ffmpeg args) is a straight port of
`lib/clipping/captions.ts::buildClipAss` and `lib/clipping/render.ts::buildClipArgs`
plus `lib/render/local.ts::renderRecipe`, so a clip rendered here is byte-for-byte
equivalent to one rendered on the cloud fleet — except the encoder swaps to
`h264_nvenc` when the machine has an NVIDIA GPU.

Only runs when the user flips "Accept render jobs" on in Settings.
"""
import asyncio
import logging
import tempfile
from pathlib import Path
from typing import List, Optional

import httpx

from app.services.ffmpeg_semaphore import acquire_render_slot, is_nvenc_available, safe_ffmpeg_run

logger = logging.getLogger(__name__)

_API_PREFIX = "/api/render/v1"
_POLL_INTERVAL_S = 5.0
_HEARTBEAT_INTERVAL_S = 60.0
_LEASE_TIMEOUT = httpx.Timeout(60.0, connect=10.0)
_DOWNLOAD_TIMEOUT = httpx.Timeout(600.0, connect=10.0)
_MAX_PROCESSED_HISTORY = 20


# =============================================================================
# Render engine — ports of lib/clipping/captions.ts + lib/clipping/render.ts
# =============================================================================

# Reference vertical canvas the styles were tuned for (mirrors captions.ts
# CAPTION_REF_W/H). Font sizes/margins scale by PlayResY so a source-aspect clip
# gets proportional captions instead of an anamorphic squish.
_CAPTION_REF_W = 1080
_CAPTION_REF_H = 1920

# Caption style presets — mirrors lib/clipping/caption-presets.ts (same ids,
# same values). "classic" reproduces the original hardcoded style byte-for-byte.
_LIME = "#B4F03A"
_CAPTION_PRESETS: dict = {
    "classic": {"font": "Arial", "size": 72, "textColor": "#FFFFFF", "highlightColor": "#FFFF00",
                "outlineColor": "#000000", "outline": 4, "box": False, "position": "bottom", "uppercase": False},
    "bold-center": {"font": "Arial", "size": 84, "textColor": "#FFFFFF", "highlightColor": _LIME,
                    "outlineColor": "#000000", "outline": 5, "box": False, "position": "center", "uppercase": True},
    "minimal-lower": {"font": "Arial", "size": 58, "textColor": "#FFFFFF", "highlightColor": "#FFFFFF",
                      "outlineColor": "#000000", "outline": 2, "box": False, "position": "bottom", "uppercase": False},
    "highlight-box": {"font": "Arial", "size": 66, "textColor": "#FFFFFF", "highlightColor": _LIME,
                      "outlineColor": "#000000", "outline": 3, "box": True, "position": "bottom", "uppercase": True},
    "lime-pop": {"font": "Arial", "size": 76, "textColor": "#FFFFFF", "highlightColor": _LIME,
                 "outlineColor": "#000000", "outline": 4, "box": False, "position": "bottom", "uppercase": True},
}
_DEFAULT_CAPTION_PRESET = "classic"


def _resolve_caption_preset(preset_id: Optional[str], overrides: Optional[dict]) -> dict:
    """Preset id → style dict, unknown/absent → classic; overrides layered on.
    Mirrors caption-presets.ts::resolveCaptionPreset + the spread in buildClipAss."""
    preset = dict(_CAPTION_PRESETS.get(preset_id or "", _CAPTION_PRESETS[_DEFAULT_CAPTION_PRESET]))
    for key in ("highlightColor", "position", "uppercase"):
        if overrides and overrides.get(key) is not None:
            preset[key] = overrides[key]
    return preset


def _hex_to_ass(hex_color: str) -> str:
    """#RRGGBB → ASS &H00BBGGRR (opaque). Mirrors captions.ts::hexToAss."""
    h = hex_color.lstrip("#")
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}".upper()


def _alignment_for(position: str) -> int:
    """Caption position → ASS numpad alignment. Mirrors captions.ts::alignmentFor."""
    return 8 if position == "top" else 5 if position == "center" else 2


def _ass_header(res_w: int, res_h: int, preset: dict) -> str:
    """ASS header parameterised by render resolution + style preset. Mirrors
    captions.ts::assHeader (Hook style stays fixed)."""
    k = res_h / _CAPTION_REF_H

    def px(n: int) -> int:
        return max(1, round(n * k))

    align = _alignment_for(preset["position"])
    margin_v = 0 if preset["position"] == "center" else px(220)
    border_style = 3 if preset["box"] else 1
    shadow = 0 if preset["box"] else 2
    karaoke = (
        f"Style: Karaoke,{preset['font']},{px(preset['size'])},"
        f"{_hex_to_ass(preset['highlightColor'])},{_hex_to_ass(preset['textColor'])},"
        f"{_hex_to_ass(preset['outlineColor'])},&H80000000,-1,0,0,0,100,100,0,0,"
        f"{border_style},{px(preset['outline'])},{shadow},{align},{px(60)},{px(60)},{margin_v},1"
    )

    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {round(res_w)}\n"
        f"PlayResY: {round(res_h)}\n"
        "WrapStyle: 0\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"{karaoke}\n"
        f"Style: Hook,Arial,{px(84)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,{px(5)},2,8,{px(80)},{px(80)},{px(180)},1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def _ass_time(total_sec: float) -> str:
    """h:mm:ss.cs — the ASS timestamp format. Mirrors captions.ts::assTime."""
    clamped = max(0.0, total_sec)
    h = int(clamped // 3600)
    m = int((clamped % 3600) // 60)
    s = int(clamped % 60)
    cs = round((clamped % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ass_escape(text: str) -> str:
    """The Dialogue Text field breaks on newlines/braces. Mirrors captions.ts::assEscape."""
    return text.replace("\n", " ").replace("{", "(").replace("}", ")").strip()


def _karaoke_dialogue(
    segments: List[dict], clip_start: float, clip_end: float, uppercase: bool = False
) -> List[str]:
    """Word-timed \\k karaoke lines for the transcript slice, clip-relative.
    Mirrors captions.ts::karaokeDialogue."""
    lines: List[str] = []
    for seg in segments:
        start = max(float(seg["start"]), clip_start)
        end = min(float(seg["end"]), clip_end)
        if end - start < 0.2:
            continue
        text = str(seg.get("text", ""))
        if uppercase:
            text = text.upper()
        words = [w for w in text.strip().split() if w]
        if not words:
            continue
        rel_start = start - clip_start
        rel_end = end - clip_start
        centis_per_word = max(1, round(((rel_end - rel_start) * 100) / len(words)))
        karaoke = " ".join(f"{{\\k{centis_per_word}}}{w}" for w in words)
        lines.append(f"Dialogue: 0,{_ass_time(rel_start)},{_ass_time(rel_end)},Karaoke,,0,0,0,,{karaoke}")
    return lines


def build_clip_ass(
    segments: List[dict],
    clip_start: float,
    clip_end: float,
    karaoke: bool,
    hook_text: Optional[str],
    res: tuple[int, int] = (_CAPTION_REF_W, _CAPTION_REF_H),
    preset_id: Optional[str] = None,
    overrides: Optional[dict] = None,
) -> Optional[str]:
    """Recipe-variant caption file: optional karaoke word-highlights + optional
    static top hook line. Returns None when neither is requested (caller then
    skips the subtitles filter). Mirrors captions.ts::buildClipAss."""
    preset = _resolve_caption_preset(preset_id, overrides)
    lines: List[str] = []
    hook = (hook_text or "").strip()
    if hook:
        rel_end = max(0.0, clip_end - clip_start)
        lines.append(f"Dialogue: 1,{_ass_time(0)},{_ass_time(rel_end)},Hook,,0,0,0,,{_ass_escape(hook)}")
    if karaoke:
        lines.extend(_karaoke_dialogue(segments, clip_start, clip_end, bool(preset["uppercase"])))
    if not lines:
        return None
    return _ass_header(res[0], res[1], preset) + "\n".join(lines) + "\n"


def build_clip_args(
    input_path: str,
    output_path: str,
    start_sec: float,
    duration_sec: float,
    subtitle_path: Optional[str],
    use_nvenc: bool,
    aspect: str = "9:16",
) -> List[str]:
    """ffmpeg args: cut [start, start+duration), then either center-crop to 9:16 +
    scale to 1080x1920 (default) or keep the source frame as-is (aspect="source",
    only forcing even dims), optional caption burn. Mirrors render.ts::buildClipArgs,
    swapping libx264→h264_nvenc when a GPU is present (the desktop's free advantage)."""
    if aspect == "source":
        filters = [
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "setsar=1",
        ]
    else:
        filters = [
            "crop=min(iw\\,ih*9/16):ih:(iw-ow)/2:0",
            "scale=1080:1920",
            "setsar=1",
        ]
    if subtitle_path:
        # ffmpeg subtitles filter needs forward slashes and an escaped drive colon.
        escaped = subtitle_path.replace("\\", "/").replace(":", "\\:")
        filters.append(f"subtitles='{escaped}'")

    # ponytail: NVENC preset p4 (balanced) + no explicit -cq — matches cloud x264
    # veryfast closely enough for shorts; add "-cq 23" here if file sizes bloat.
    video_codec = ["-c:v", "h264_nvenc", "-preset", "p4"] if use_nvenc else ["-c:v", "libx264", "-preset", "veryfast"]

    return [
        "ffmpeg",
        "-ss", str(start_sec),
        "-i", input_path,
        "-t", str(duration_sec),
        "-vf", ",".join(filters),
        *video_codec,
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y", output_path,
    ]


def expand_outputs(recipe: dict) -> List[dict]:
    """Flatten a recipe into its (segment × variant) output list, in the SAME
    stable order the web's expandOutputs() uses (segment-outer, variant-inner,
    shared index counter) so output indices line up with the lease's PUT slots
    and the /complete count guard. Mirrors lib/render/recipe.ts::expandOutputs."""
    outputs: List[dict] = []
    index = 0
    for segment in recipe["segments"]:
        for variant in recipe["variants"]:
            outputs.append({"index": index, "segment": segment, "variant": variant})
            index += 1
    return outputs


def validate_recipe(recipe: object) -> Optional[str]:
    """Cheap structural check before we touch ffmpeg — the web already validated
    with Zod at dispatch, this just guards against a poisoned/garbled payload.
    Returns an error string, or None when the recipe is usable."""
    if not isinstance(recipe, dict):
        return "recipe is not an object"
    segments = recipe.get("segments")
    variants = recipe.get("variants")
    transcript = recipe.get("transcript")
    if not isinstance(segments, list) or not segments:
        return "recipe has no segments"
    if not isinstance(variants, list) or not variants:
        return "recipe has no variants"
    if not isinstance(transcript, dict) or not isinstance(transcript.get("segments"), list):
        return "recipe transcript missing"
    for i, seg in enumerate(segments):
        try:
            start = float(seg["start"])
            end = float(seg["end"])
        except (KeyError, TypeError, ValueError):
            return f"segment {i}: start/end not numeric"
        if end <= start or start < 0:
            return f"segment {i}: invalid time range"
    return None


def _probe_dimensions(path: str) -> Optional[tuple[int, int]]:
    """Source video WxH via `ffmpeg -i` stderr (no ffprobe dependency). Mirrors
    render.ts::probeDimensions. Returns even dims, or None when unparseable."""
    import re
    import subprocess

    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-i", path],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except Exception:
        return None
    stderr = proc.stderr or ""
    video_line = next((l for l in stderr.split("\n") if re.search(r"Stream #.*Video:", l)), None)
    if not video_line:
        return None
    m = re.search(r"\b(\d{2,5})x(\d{2,5})\b", video_line)
    if not m:
        return None
    w, h = int(m.group(1)), int(m.group(2))
    if not w or not h:
        return None
    return (w - (w % 2), h - (h % 2))


def _render_one(recipe: dict, output: dict, source_path: str, work_dir: Path, use_nvenc: bool) -> dict:
    """Renders one (segment × variant) clip to disk. Mirrors local.ts::renderOne.
    Blocking (ffmpeg) — call via asyncio.to_thread. Returns
    { index, path, durationSec, variant }."""
    index = output["index"]
    segment = output["segment"]
    variant = output["variant"]
    output_path = work_dir / f"clip-{index}.mp4"
    aspect = variant.get("aspect") or "9:16"

    # Source-aspect clips size captions to the real frame; 9:16 keeps the reference.
    res = (_CAPTION_REF_W, _CAPTION_REF_H)
    if aspect == "source":
        res = _probe_dimensions(source_path) or (_CAPTION_REF_W, _CAPTION_REF_H)

    # hookText on the variant wins; otherwise fall back to the segment's LLM hook.
    hook_text = variant.get("hookText") or segment.get("hookLine")
    ass = build_clip_ass(
        recipe["transcript"]["segments"],
        float(segment["start"]),
        float(segment["end"]),
        karaoke=variant.get("captionStyle") != "none",
        hook_text=hook_text,
        res=res,
        preset_id=variant.get("captionPreset"),
        overrides=variant.get("captionOverrides"),
    )

    subtitle_path: Optional[str] = None
    if ass:
        sub = work_dir / f"clip-{index}.ass"
        sub.write_text(ass, encoding="utf-8")
        subtitle_path = str(sub)

    duration_sec = float(segment["end"]) - float(segment["start"])
    args = build_clip_args(source_path, str(output_path), float(segment["start"]), duration_sec, subtitle_path, use_nvenc, aspect)
    # Generous per-clip timeout: a 90s short encodes in seconds on GPU, longer on
    # a slow CPU box; 15 min is a safety ceiling, not an expectation.
    result = safe_ffmpeg_run(args, timeout=900, operation=f"blipost-render clip-{index}")
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg exited {result.returncode}: {(result.stderr or '')[-500:]}")
    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError(f"clip-{index} produced no output")

    return {"index": index, "path": str(output_path), "durationSec": duration_sec, "variant": index}


# =============================================================================
# Runner controller — one lease→render→complete loop, user-toggled
# =============================================================================


class BlipostRenderRunner:
    """Manages a single background lease→render→complete loop for one paired
    desktop. Started/stopped from Settings; never runs unless the user opts in."""

    def __init__(self) -> None:
        self._task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self.running = False
        self.profile_id: Optional[str] = None
        self.state = "idle"            # idle | rendering | error
        self.current_job: Optional[str] = None
        self.last_error: Optional[str] = None
        self.processed: List[dict] = []  # newest first: [{ jobId, clips, at, outcome }]

    # ---- lifecycle ----

    async def start(self, profile_id: str, base_url: str, token: str) -> None:
        async with self._lock:
            if self.running:
                # Single global runner: refuse to silently serve profile B's
                # Settings toggle while it's already leasing profile A's jobs
                # (it would keep using A's token). One active profile at a time.
                if self.profile_id and self.profile_id != profile_id:
                    raise RuntimeError(
                        "The render runner is already active under another profile — stop it there first."
                    )
                return
            self.profile_id = profile_id
            self.running = True
            self.state = "idle"
            self.last_error = None
            self._task = asyncio.create_task(self._loop(base_url.rstrip("/"), token))
            logger.info("[Blipost render] runner started (nvenc=%s)", is_nvenc_available())

    async def stop(self) -> None:
        async with self._lock:
            self.running = False
            task = self._task
            self._task = None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self.state = "idle"
        self.current_job = None
        logger.info("[Blipost render] runner stopped")

    def status(self) -> dict:
        return {
            "running": self.running,
            "state": self.state,
            "currentJob": self.current_job,
            "processed": self.processed[:_MAX_PROCESSED_HISTORY],
            "nvenc": is_nvenc_available(),
        }

    def _record(self, job_id: str, clips: int, outcome: str) -> None:
        self.processed.insert(0, {"jobId": job_id, "clips": clips, "outcome": outcome})
        del self.processed[_MAX_PROCESSED_HISTORY:]

    # ---- loop ----

    async def _loop(self, base_url: str, token: str) -> None:
        headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}
        while self.running:
            try:
                outcome = await self._lease_and_render(base_url, headers)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # never let one cycle kill the loop
                logger.warning("[Blipost render] cycle error: %s", e)
                self.state = "error"
                self.last_error = str(e)
                outcome = "error"
            if outcome == "rendered":
                continue  # queue may be hot — grab the next immediately
            self.state = "idle" if outcome != "error" else self.state
            await asyncio.sleep(_POLL_INTERVAL_S)

    async def _post(self, base_url: str, headers: dict, path: str, body: Optional[dict] = None) -> httpx.Response:
        async with httpx.AsyncClient(timeout=_LEASE_TIMEOUT) as client:
            return await client.post(f"{base_url}{_API_PREFIX}{path}", headers=headers, json=body)

    async def _lease_and_render(self, base_url: str, headers: dict) -> str:
        """One lease→render→complete cycle. Returns 'rendered' | 'idle' | 'error'.
        Mirrors runner.ts::leaseAndRender."""
        res = await self._post(base_url, headers, "/lease")
        if res.status_code != 200:
            raise RuntimeError(f"lease failed: {res.status_code} {res.text[:200]}")
        lease = res.json().get("lease")
        if not lease:
            return "idle"

        job_id = lease["jobId"]
        recipe = lease["recipe"]
        err = validate_recipe(recipe)
        if err:
            await self._post(base_url, headers, f"/jobs/{job_id}/fail", {"error": f"bad recipe: {err}", "retriable": False})
            return "error"

        self.state = "rendering"
        self.current_job = job_id
        aborted = asyncio.Event()
        hb_task = asyncio.create_task(self._heartbeat(base_url, headers, job_id, aborted))
        work_dir = Path(tempfile.mkdtemp(prefix="blipost-runner-"))
        use_nvenc = is_nvenc_available()

        try:
            source_path = work_dir / "source.mp4"
            await self._download(lease["sourceUrl"], source_path)

            outputs_meta = {o["index"]: o for o in lease["outputs"]}
            reported: List[dict] = []
            for out in expand_outputs(recipe):
                if aborted.is_set():
                    raise RuntimeError("lease reclaimed mid-render")
                target = outputs_meta.get(out["index"])
                if not target:
                    raise RuntimeError(f"no upload target for output {out['index']}")

                # Heavy encode: gate on the shared render semaphore, run off-loop.
                async with await acquire_render_slot():
                    rendered = await asyncio.to_thread(_render_one, recipe, out, str(source_path), work_dir, use_nvenc)

                clip_path = Path(rendered["path"])
                data = clip_path.read_bytes()
                await self._put(target["uploadUrl"], data)
                reported.append({
                    "r2Key": target["r2Key"],
                    "sizeBytes": len(data),
                    "durationSec": rendered["durationSec"],
                    "variant": rendered["variant"],
                })
                clip_path.unlink(missing_ok=True)

            hb_task.cancel()
            done = await self._post(base_url, headers, f"/jobs/{job_id}/complete", {"outputs": reported})
            if done.status_code != 200:
                raise RuntimeError(f"complete failed: {done.status_code} {done.text[:200]}")
            self._record(job_id, len(reported), "rendered")
            logger.info("[Blipost render] job %s rendered (%d clips)", job_id, len(reported))
            return "rendered"
        except asyncio.CancelledError:
            raise
        except Exception as e:
            try:
                await self._post(base_url, headers, f"/jobs/{job_id}/fail", {"error": str(e)[:500], "retriable": True})
            except Exception:
                pass
            self._record(job_id, 0, "failed")
            raise
        finally:
            hb_task.cancel()
            self.current_job = None
            _rmtree(work_dir)

    async def _heartbeat(self, base_url: str, headers: dict, job_id: str, aborted: asyncio.Event) -> None:
        """Extends the lease every 60s while rendering; a 409 means the lease was
        reclaimed (we ran past it) → signal the render loop to bail. Mirrors the
        setInterval heartbeat in runner.ts."""
        try:
            while True:
                await asyncio.sleep(_HEARTBEAT_INTERVAL_S)
                try:
                    hb = await self._post(base_url, headers, f"/jobs/{job_id}/heartbeat")
                    if hb.status_code == 409:
                        aborted.set()
                        return
                except Exception:
                    pass  # transient blip — next tick retries
        except asyncio.CancelledError:
            return

    async def _download(self, url: str, dest: Path) -> None:
        """Stream the presigned source download to disk (no auth header)."""
        async with httpx.AsyncClient(timeout=_DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
            async with client.stream("GET", url) as resp:
                if resp.status_code != 200:
                    raise RuntimeError(f"source download failed: {resp.status_code}")
                with dest.open("wb") as f:
                    async for chunk in resp.aiter_bytes(1 << 20):
                        f.write(chunk)

    async def _put(self, url: str, data: bytes) -> None:
        """PUT rendered clip bytes to its presigned R2 URL (no auth header)."""
        async with httpx.AsyncClient(timeout=_DOWNLOAD_TIMEOUT) as client:
            resp = await client.put(url, content=data, headers={"content-type": "video/mp4"})
        if not resp.is_success:
            raise RuntimeError(f"upload failed: {resp.status_code}")


def _rmtree(path: Path) -> None:
    import shutil
    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception:
        pass


# ---- singleton -------------------------------------------------------------

_runner: Optional[BlipostRenderRunner] = None


def get_render_runner() -> BlipostRenderRunner:
    global _runner
    if _runner is None:
        _runner = BlipostRenderRunner()
    return _runner
