---
phase: 84-cross-platform-paths-and-ffmpeg-discovery
reviewed: 2026-05-23T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - app/config.py
  - app/ffmpeg_setup.py
  - app/main.py
  - electron/package.json
  - tests/test_config_base_dir.py
  - tests/test_ffmpeg_resolver.py
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: warnings
---

# Phase 84: Code Review Report

**Reviewed:** 2026-05-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** warnings

## Summary

Phase 84 extracted the FFmpeg resolver from `app/main.py` into a thin module `app/ffmpeg_setup.py`, added macOS and Linux branches to `_get_app_base_dir()` in `app/config.py`, updated `electron/package.json` with a macOS build target, and added a full parametrized test suite for both features.

The overall structure is clean. The resolver separation is well-motivated (avoids scipy/cv2 pull at test time) and the XDG-spec handling for Linux is correct. Two warnings are present: one is a real failure-mode bug (bundled-dir check that does not verify the executable exists), the other is dead code. Three info items cover duplication, a silent failure path, and a missing Linux electron-builder target.

## Warnings

### WR-01: Bundled FFmpeg directory accepted without checking the binary exists

**File:** `app/ffmpeg_setup.py:74-77`

**Issue:** The candidate-loop checks `candidate.exists() and candidate.is_dir()` but never verifies that a `ffmpeg` (or `ffmpeg.exe`) binary is inside the directory. An empty or partial `ffmpeg/ffmpeg-linux/bin/` directory (e.g., after a partial download or a stale checkout) will pass this check, causing `_setup_ffmpeg_path` to prepend that directory to `PATH` and skip the system-PATH fallback at step 3. Downstream subprocess calls will then fail with a confusing "command not found" rather than falling through to a working system install. The env-override path at lines 36-51 does validate with `env_path.is_file()` — the bundled path should be analogous.

**Fix:**
```python
# Replace:
for candidate in candidates:
    if candidate.exists() and candidate.is_dir():
        _logger.info(f"FFmpeg resolved via bundled binary: {candidate}")
        return candidate

# With: also require the binary to be present
for candidate in candidates:
    exe_name = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
    if candidate.is_dir() and (candidate / exe_name).exists():
        _logger.info(f"FFmpeg resolved via bundled binary: {candidate}")
        return candidate
```

---

### WR-02: Unused imports `sys` and `shutil` in `app/main.py`

**File:** `app/main.py:7-8`

**Issue:** `import sys` and `import shutil` were added in this phase but are never referenced in `app/main.py`'s executable code. All logic using `sys` and `shutil` now lives in `app/ffmpeg_setup.py`. The only occurrence of `shutil` in `main.py` is inside a docstring (line 25). Dead imports mislead readers into thinking these modules are used and may cause linter failures in CI.

**Fix:**
```python
# Remove these two lines from app/main.py:
import sys    # line 7
import shutil # line 8
```

---

## Info

### IN-01: No Linux electron-builder target in `electron/package.json`

**File:** `electron/package.json:6-12` (scripts block)

**Issue:** Phase 84 added `ffmpeg/ffmpeg-linux/bin` to the Python resolver and the tests cover it, but `electron/package.json` defines build targets only for Windows (`dist`, `dist:publish`) and macOS (`dist:mac`, `dist:mac:publish`). There is no `linux` section with an `extraResources` block to bundle the Linux FFmpeg binary. On a packaged Linux desktop build the resolver will skip the bundled path and fall through to system PATH (the right outcome), but the Linux user experience is inconsistent with Windows/macOS unless the intent is "Linux = dev/system-installed only."

**Fix:** If a packaged Linux build is ever planned, add:
```json
"linux": {
  "target": ["AppImage"],
  "extraResources": [
    {
      "from": "../ffmpeg/ffmpeg-linux/bin",
      "to": "ffmpeg/bin",
      "filter": ["ffmpeg", "ffprobe"]
    }
  ]
}
```
If Linux packaging is out of scope, add a comment to `package.json` noting this is intentional.

---

### IN-02: `_wsl_symlink_exe` silently swallows `OSError`

**File:** `app/ffmpeg_setup.py:95-100`

**Issue:** The `except OSError: pass` on the symlink-creation block discards all failure information. On systems with restricted filesystem permissions (e.g., Windows-mounted NTFS paths under WSL), the symlink silently fails, and the missing symlink will cause `ffmpeg` invocations to fail later with no trace back to the root cause.

**Fix:**
```python
except OSError as e:
    _logger.debug(f"Could not create symlink {link_path} -> {exe_path}: {e}")
```

---

### IN-03: Duplicated `DotEnvSettingsSource` import try/except block in `Settings.settings_customise_sources`

**File:** `app/config.py:165-193`

**Issue:** The triple-fallback import of `DotEnvSettingsSource` (lines 165-176) is copy-pasted verbatim for the project-root `.env` case (lines 182-191). If `pydantic-settings` changes its import path again, both blocks must be updated in sync.

**Fix:** Extract to a module-level helper:
```python
def _get_dotenv_source_class():
    for mod in ("pydantic_settings", "pydantic_settings.env_settings", "pydantic_settings.main"):
        try:
            return getattr(__import__(mod, fromlist=["DotEnvSettingsSource"]), "DotEnvSettingsSource")
        except (ImportError, AttributeError):
            continue
    return None
```
Then call `_get_dotenv_source_class()` once per `.env` file rather than repeating the try/except chain.

---

_Reviewed: 2026-05-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
