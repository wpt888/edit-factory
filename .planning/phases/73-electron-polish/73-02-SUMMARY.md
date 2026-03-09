---
phase: 73-electron-polish
plan: "02"
subsystem: infra
tags: [electron-builder, venv, pytorch, installer-size, requirements]

requires:
  - phase: 73-electron-polish
    provides: "Electron packaging config and build script"
provides:
  - "Split requirements into base (bundled) and ML (optional)"
  - "Venv filter excluding torch/whisper/nvidia from electron-builder bundle"
  - "Build script venv size estimation"
affects: [electron-packaging, installer-size, desktop-distribution]

tech-stack:
  added: []
  patterns: ["requirements-ml.txt for optional heavy dependencies", "electron-builder filter patterns for venv size control"]

key-files:
  created: [requirements-ml.txt]
  modified: [requirements.txt, electron/package.json, scripts/build-installer.js]

key-decisions:
  - "Moved torch, torchaudio, openai-whisper to requirements-ml.txt since all consumers use lazy imports"
  - "VAD section updated with reference to requirements-ml.txt instead of inline torch pins"

patterns-established:
  - "Split requirements: base requirements.txt for bundled, requirements-ml.txt for optional heavy ML"
  - "electron-builder venv filter pattern for excluding large directories"

requirements-completed: [ELEC-03]

duration: 2min
completed: 2026-03-09
---

# Phase 73 Plan 02: Slim Installer Venv Summary

**Split Python requirements into base (bundled) and ML (optional), excluding PyTorch/Whisper/Coqui from electron-builder venv bundle to keep installer under 500 MB**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-09T07:36:33Z
- **Completed:** 2026-03-09T07:38:52Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Separated openai-whisper, torch, torchaudio into requirements-ml.txt (not bundled)
- Added electron-builder venv filter excluding torch, torchaudio, torchvision, nvidia, triton, whisper, TTS, Cython directories
- Build script now reports which heavy packages exist in venv (informational, not blocking)

## Task Commits

Each task was committed atomically:

1. **Task 1: Split requirements and exclude heavy ML packages from venv bundle** - `6aec30f` (feat)
2. **Task 2: Add venv size estimation to build script** - `507b038` (feat)

## Files Created/Modified
- `requirements-ml.txt` - Optional ML dependencies (torch, whisper) for manual install
- `requirements.txt` - Removed openai-whisper and torch; added references to requirements-ml.txt
- `electron/package.json` - Venv extraResources filter now excludes 8 heavy package directories
- `scripts/build-installer.js` - verifyPrerequisites() reports heavy packages found in venv

## Decisions Made
- Moved torch and torchaudio from base requirements to requirements-ml.txt since voice_detector, silence_remover, and coqui all use lazy imports with graceful fallback
- Updated VAD comment section to reference requirements-ml.txt instead of keeping torch pins inline

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Moved torch/torchaudio from base requirements to ML requirements**
- **Found during:** Task 1
- **Issue:** Plan mentioned removing openai-whisper but torch==2.9.1 and torchaudio==2.9.1 were still pinned in base requirements.txt under the VAD section. These are 800+ MB and defeat the purpose of the plan.
- **Fix:** Moved both to requirements-ml.txt, replaced VAD section with reference comment
- **Files modified:** requirements.txt, requirements-ml.txt
- **Verification:** grep confirms torch no longer pinned in requirements.txt
- **Committed in:** 6aec30f (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for achieving the stated goal of keeping installer under 500 MB.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Installer venv is now slim (no PyTorch, Whisper, or Coqui TTS bundled)
- Developers with torch in their local venv are protected by electron-builder filter
- Ready for further Electron polish tasks

---
*Phase: 73-electron-polish*
*Completed: 2026-03-09*
