# macOS FFmpeg Binaries (ffmpeg-mac)

The `bin/` directory next to this README must contain two binaries:

- `ffmpeg` — macOS x86_64 (Intel) or arm64 (Apple Silicon) static build
- `ffprobe` — same target as ffmpeg

These binaries are NOT committed to the repo (each is ~80 MB). A developer must fetch them before building the macOS dmg.

## Fetch steps

1. Visit https://evermeet.cx/ffmpeg/ — provides the canonical static macOS builds.
2. Download the latest `ffmpeg-*.zip` (Intel) or `ffmpeg-*-arm64.zip` (Apple Silicon) — pick the architecture you are targeting.
3. Download the matching `ffprobe-*.zip` from the same page.
4. Unzip both into `ffmpeg/ffmpeg-mac/bin/`. The final layout must be:
   ```
   ffmpeg/ffmpeg-mac/bin/ffmpeg
   ffmpeg/ffmpeg-mac/bin/ffprobe
   ```
5. Run `chmod +x ffmpeg/ffmpeg-mac/bin/ffmpeg ffmpeg/ffmpeg-mac/bin/ffprobe` to ensure they are executable.
6. Verify: `./ffmpeg/ffmpeg-mac/bin/ffmpeg -version` should print FFmpeg version info.

## Why not committed

- Each binary is ~80 MB; ffmpeg-mac/bin would add ~160 MB to the repo.
- Architecture choice (Intel vs ARM) is build-time, not source-time.
- Phase 96 (release pipeline) may switch to fetching these in CI to avoid the manual step.

## Until binaries are placed

- Building the macOS dmg via `npm run dist:mac` will fail with a missing-file error from electron-builder (cannot copy from `../ffmpeg/ffmpeg-mac/bin` if the dir is empty).
- Running `python run.py` on macOS will fall through to `shutil.which("ffmpeg")` — Homebrew-installed FFmpeg works without these bundled binaries.

Tracked in Phase 84 (STATE.md line 114: "macOS FFmpeg binary needs to be added to repo or fetched in CI").
