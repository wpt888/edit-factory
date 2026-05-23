# Linux FFmpeg Binaries (ffmpeg-linux)

The `bin/` directory next to this README is for the Linux x86_64 FFmpeg binary, used by the Python FFmpeg resolver (`app/ffmpeg_setup.py:_resolve_ffmpeg_path`) when running from source on Linux.

**NOTE:** v13 does NOT ship a Linux electron installer. Linux users run the app from source. These binaries are only used by `python run.py` on Linux.

## Fetch steps

1. Visit https://johnvansickle.com/ffmpeg/ — provides canonical static Linux builds.
2. Download `ffmpeg-release-amd64-static.tar.xz`.
3. Extract:
   ```
   tar -xf ffmpeg-release-amd64-static.tar.xz
   ```
4. Move the `ffmpeg` and `ffprobe` binaries into `ffmpeg/ffmpeg-linux/bin/`:
   ```
   mkdir -p ffmpeg/ffmpeg-linux/bin
   mv ffmpeg-*-amd64-static/ffmpeg ffmpeg/ffmpeg-linux/bin/
   mv ffmpeg-*-amd64-static/ffprobe ffmpeg/ffmpeg-linux/bin/
   chmod +x ffmpeg/ffmpeg-linux/bin/ffmpeg ffmpeg/ffmpeg-linux/bin/ffprobe
   ```
5. Verify: `./ffmpeg/ffmpeg-linux/bin/ffmpeg -version` should print FFmpeg version info.

## Alternative: system PATH

The resolver falls back to `shutil.which("ffmpeg")` if the bundled binary is missing. So `apt install ffmpeg` (or equivalent) also works — no need to fetch these binaries unless you want them isolated to the repo.

Tracked in Phase 84 (FUNC-05 — system PATH fallback on all three OSes).
