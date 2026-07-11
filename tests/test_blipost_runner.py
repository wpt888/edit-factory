"""
Blipost render runner verification (desktop side of the hybrid render system).

Mirrors social-scheduler/scripts/verify-clip-render.mts: a synthetic source
video + a mock Lease API (stdlib HTTP server) driven through the REAL runner for
one lease→render→complete cycle, plus unit checks on the ported render engine
(ASS builder, ffmpeg args, output expansion, recipe validation).

Run: pytest tests/test_blipost_runner.py
"""
import asyncio
import json
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from app.services.blipost_runner import (
    BlipostRenderRunner,
    build_clip_args,
    build_clip_ass,
    expand_outputs,
    validate_recipe,
)
import app.services.blipost_runner as runner_module

FFMPEG = "ffmpeg"


# ---------------------------------------------------------------------------
# Unit: ported render engine
# ---------------------------------------------------------------------------

def test_expand_outputs_ordering():
    """Segment-outer, variant-inner, shared index — must match the web's
    expandOutputs() so lease PUT slots and the /complete count line up."""
    recipe = {
        "segments": [{"start": 0, "end": 2}, {"start": 3, "end": 5}],
        "variants": [{"captionStyle": "karaoke"}, {"captionStyle": "none"}],
        "transcript": {"segments": []},
    }
    outputs = expand_outputs(recipe)
    assert [o["index"] for o in outputs] == [0, 1, 2, 3]
    # index 0/1 = segment 0 × variant 0/1; index 2/3 = segment 1 × variant 0/1
    assert outputs[0]["segment"]["start"] == 0 and outputs[0]["variant"]["captionStyle"] == "karaoke"
    assert outputs[1]["segment"]["start"] == 0 and outputs[1]["variant"]["captionStyle"] == "none"
    assert outputs[2]["segment"]["start"] == 3 and outputs[2]["variant"]["captionStyle"] == "karaoke"


def test_build_clip_ass_hook_and_karaoke():
    segments = [{"start": 0.0, "end": 2.0, "text": "hello world"}]
    # karaoke + hook → both dialogue lines present
    ass = build_clip_ass(segments, 0.0, 2.0, karaoke=True, hook_text="Watch this")
    assert ass is not None
    assert "Style: Karaoke" in ass and "Style: Hook" in ass
    assert "\\k" in ass  # word-timing tags
    assert "Watch this" in ass
    # neither karaoke nor hook → None (caller skips the subtitles filter)
    assert build_clip_ass(segments, 0.0, 2.0, karaoke=False, hook_text=None) is None
    # brace injection in the hook is neutralised
    assert "{evil}" not in (build_clip_ass(segments, 0.0, 2.0, karaoke=False, hook_text="{evil}") or "")


def test_build_clip_args_codec_swap_and_escaping():
    cpu = build_clip_args("in.mp4", "out.mp4", 1.0, 3.0, None, use_nvenc=False)
    assert "libx264" in cpu and "veryfast" in cpu
    gpu = build_clip_args("in.mp4", "out.mp4", 1.0, 3.0, None, use_nvenc=True)
    assert "h264_nvenc" in gpu and "libx264" not in gpu
    # windows drive colon must be escaped for the subtitles filter
    withsub = build_clip_args("in.mp4", "out.mp4", 0.0, 2.0, r"C:\tmp\clip.ass", use_nvenc=False)
    vf = withsub[withsub.index("-vf") + 1]
    assert "subtitles='C\\:/tmp/clip.ass'" in vf


def test_validate_recipe():
    good = {
        "segments": [{"start": 0, "end": 2}],
        "variants": [{"captionStyle": "karaoke"}],
        "transcript": {"segments": []},
    }
    assert validate_recipe(good) is None
    assert validate_recipe({"segments": [], "variants": [{}], "transcript": {"segments": []}})
    assert validate_recipe({"segments": [{"start": 5, "end": 2}], "variants": [{}], "transcript": {"segments": []}})
    assert validate_recipe("nope")


def test_status_exposes_last_error():
    runner = BlipostRenderRunner()
    runner.last_error = "network unavailable"
    assert runner.status()["lastError"] == "network unavailable"


def test_auth_failure_stops_runner_and_requests_repair(monkeypatch):
    runner = BlipostRenderRunner()
    runner.running = True

    async def rejected(*_args, **_kwargs):
        return type("Response", (), {"status_code": 401, "text": "revoked"})()

    monkeypatch.setattr(runner, "_post", rejected)
    asyncio.run(runner._loop("https://example.invalid", "bad-token"))

    assert runner.running is False
    assert runner.state == "error"
    assert "Pair this device again" in (runner.last_error or "")


def test_transient_failures_use_exponential_backoff(monkeypatch):
    runner = BlipostRenderRunner()
    runner.running = True
    delays = []

    async def failing_cycle(*_args, **_kwargs):
        if len(delays) == 3:
            runner.running = False
            return "idle"
        raise RuntimeError("temporary outage")

    async def record_sleep(delay):
        delays.append(delay)

    monkeypatch.setattr(runner, "_lease_and_render", failing_cycle)
    monkeypatch.setattr(runner_module.asyncio, "sleep", record_sleep)
    asyncio.run(runner._loop("https://example.invalid", "token"))

    assert delays[:3] == [5.0, 10.0, 20.0]


def test_start_recovers_interrupted_job(monkeypatch, tmp_path):
    orphan = tmp_path / "blipost-runner-crashed"
    orphan.mkdir()
    (orphan / "recovery.json").write_text(
        json.dumps({"jobId": "job-crashed", "profileId": "profile-1"}), encoding="utf-8"
    )
    reported = []
    runner = BlipostRenderRunner()

    async def report(_base_url, _headers, path, body=None):
        reported.append((path, body))
        return type("Response", (), {"status_code": 200})()

    async def no_loop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(runner_module.tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(runner, "_post", report)
    monkeypatch.setattr(runner, "_loop", no_loop)
    asyncio.run(runner.start("profile-1", "https://example.invalid", "token"))

    assert reported == [("/jobs/job-crashed/fail", {
        "error": "Desktop runner restarted during render", "retriable": True
    })]
    assert not orphan.exists()
    assert runner.processed[0]["outcome"] == "interrupted"


# ---------------------------------------------------------------------------
# Mock Lease API
# ---------------------------------------------------------------------------

def _make_source_video(path: Path) -> None:
    subprocess.run(
        [FFMPEG, "-f", "lavfi", "-i", "testsrc2=duration=6:size=640x360:rate=15",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
         "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-y", str(path)],
        check=True, capture_output=True,
    )


class _LeaseHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):  # silence
        pass

    def _send(self, code: int, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> bytes:
        n = int(self.headers.get("content-length", 0))
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        s = self.server
        if self.path == "/source":
            data = s.source_bytes
            self.send_response(200)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self._send(404, {"error": "not found"})

    def do_PUT(self):
        s = self.server
        idx = int(self.path.rsplit("/", 1)[-1])
        s.uploaded[idx] = self._read_body()
        self.send_response(200)
        self.send_header("etag", '"x"')
        self.end_headers()

    def do_POST(self):
        s = self.server
        host = f"http://127.0.0.1:{s.server_address[1]}"
        if self.path.endswith("/lease"):
            if s.leased:
                return self._send(200, {"lease": None})
            s.leased = True
            outputs = [
                {"index": i, "r2Key": f"clips/u/{s.job_id}/clip-{i}.mp4",
                 "uploadUrl": f"{host}/put/{i}", "variant": i}
                for i in range(len(s.recipe["segments"]) * len(s.recipe["variants"]))
            ]
            return self._send(200, {"lease": {
                "jobId": s.job_id, "recipe": s.recipe, "sourceUrl": f"{host}/source",
                "outputs": outputs, "leaseExpiresAt": "2099-01-01T00:00:00Z",
            }})
        body = json.loads(self._read_body() or b"{}")
        if self.path.endswith("/heartbeat"):
            return self._send(200, {"leaseExpiresAt": "2099-01-01T00:00:00Z"})
        if self.path.endswith("/complete"):
            s.completed = body.get("outputs")
            return self._send(200, {"done": True, "mediaIds": []})
        if self.path.endswith("/fail"):
            s.failed = body
            return self._send(200, {"outcome": "failed"})
        self._send(404, {"error": "not found"})


def _start_server(source_bytes: bytes, recipe: dict) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _LeaseHandler)
    server.source_bytes = source_bytes
    server.recipe = recipe
    server.job_id = "job-1"
    server.leased = False
    server.uploaded = {}
    server.completed = None
    server.failed = None
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ---------------------------------------------------------------------------
# E2E: lease → render → upload → complete through the real runner
# ---------------------------------------------------------------------------

def test_lease_render_complete_cycle():
    if not shutil.which(FFMPEG):
        pytest.skip("ffmpeg not on PATH")

    work = Path(tempfile.mkdtemp(prefix="blipost-runner-test-"))
    try:
        source = work / "source.mp4"
        _make_source_video(source)

        recipe = {
            "sourceR2Key": "uploads/u/long.mp4",
            "durationSec": 6,
            "transcript": {"segments": [
                {"start": 0.0, "end": 3.0, "text": "here is the secret nobody tells you"},
                {"start": 3.0, "end": 5.5, "text": "this one change doubled my reach"},
            ]},
            "segments": [
                {"start": 0.5, "end": 3.0, "hookLine": "The secret"},
                {"start": 3.0, "end": 5.5},
            ],
            "variants": [{"captionStyle": "karaoke", "aspect": "9:16"}],
            "output": {"w": 1080, "h": 1920, "codec": "h264"},
        }
        expected = len(recipe["segments"]) * len(recipe["variants"])  # 2 clips

        server = _start_server(source.read_bytes(), recipe)
        base_url = f"http://127.0.0.1:{server.server_address[1]}"
        headers = {"authorization": "Bearer test", "content-type": "application/json"}

        runner = BlipostRenderRunner()
        runner.running = True

        async def run_cycle():
            outcome = await runner._lease_and_render(base_url, headers)
            # queue now empty → idle
            idle = await runner._lease_and_render(base_url, headers)
            return outcome, idle

        outcome, idle = asyncio.run(run_cycle())

        assert outcome == "rendered", f"cycle failed: {server.failed}"
        assert idle == "idle"
        # every expected clip was uploaded, and /complete got exactly that many
        assert set(server.uploaded.keys()) == set(range(expected))
        assert all(len(b) > 0 for b in server.uploaded.values())
        assert server.completed is not None and len(server.completed) == expected
        # completion records real bytes + the job's own r2 prefix
        for out in server.completed:
            assert out["r2Key"].startswith(f"clips/u/{server.job_id}/")
            assert out["sizeBytes"] > 0
        # runner history reflects the rendered job
        assert runner.processed and runner.processed[0]["outcome"] == "rendered"
        assert runner.processed[0]["clips"] == expected

        server.shutdown()
    finally:
        shutil.rmtree(work, ignore_errors=True)
