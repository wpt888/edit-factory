---
phase: 88-installer-slimming-verification
plan: "01"
subsystem: infra
tags: [installer, nsis, ml-01-closer, ci-gate, electron-builder, windows, github-actions, 7zip, ffmpeg]

# Dependency graph
requires:
  - phase: 84-cross-platform-paths
    provides: "Phase 84 established the canonical FFmpeg path layout (ffmpeg/ffmpeg-master-latest-win64-gpl/bin/) that electron-builder copies from; Task 2's FFmpeg download step targets exactly this path"
  - phase: 85-desktop-smoke-test-harness
    provides: "Phase 85's .github/workflows/desktop-smoke.yml established the CI workflow pattern (on: pull_request + push to main, Python 3.11 pin) that Task 2 mirrors for the installer-size gate"
  - phase: 86-ml-bundle-download-endpoint-ui
    provides: "Phase 86 shipped the OPT-IN ML bundle path so PyTorch/Whisper/Coqui are delivered post-install at ~/.editfactory/ml — making the exclusion filter on extraResources[from=../venv] safe to enforce (no functionality is lost by excluding these packages from the base installer)"
provides:
  - "electron/package.json `nsis.artifactName: \"editfactory-setup-${version}.exe\"` — deterministic installer filename for CI globbing"
  - "electron/package.json grep-verifiable 8-pattern ML exclusion filter (asserted intact at lines 71-75: torch/torchaudio/torchvision/nvidia/triton/whisper/TTS/Cython)"
  - ".github/workflows/installer-size.yml — windows-latest CI gate that builds the actual NSIS installer end-to-end and fails if size > 576716800 bytes OR if 7z l detects forbidden ML directories in the payload"
affects: [phase-96-release-pipeline, future-version-bumps, ML-bundle-version-changes]

# Tech tracking
tech-stack:
  added: [github-actions-windows-latest, 7-zip-listing-defense-in-depth, btbn-ffmpeg-download]
  patterns: ["state-shape + regression-gate dual guard", "version-agnostic artifact glob (editfactory-setup-*.exe)", "binary-MB threshold via PowerShell `1MB` literal (1024² = 576716800 for 550 MB)", "defense-in-depth via 7z l forbidden-pattern check (catches filter bypass)"]

key-files:
  created:
    - .github/workflows/installer-size.yml
  modified:
    - electron/package.json

key-decisions:
  - "Byte threshold 576716800 = 550 × 1024² (binary MB, matches PowerShell `1MB` literal semantics) — NOT 550_000_000 (decimal MB)"
  - "Version-agnostic artifact glob `editfactory-setup-*.exe` so Phase 96's 0.1.0 → 13.0.0 bump survives without workflow changes"
  - "CI runner = windows-latest (NSIS is Windows-only; ubuntu-latest cannot produce .exe installers)"
  - "Build command = `cd electron && npm run dist` per `electron/package.json:9` (`\"dist\": \"electron-builder --win\"`)"
  - "Defense-in-depth via `7z l` + 8 forbidden directory patterns — catches a future PR that bypasses the extraResources filter via a different code path"
  - "FFmpeg fetched from BtbN canonical URL (binaries are gitignored); same trust relationship Phase 84 established for dev workstations"
  - "`on:` triggers mirror Phase 85's desktop-smoke.yml exactly (pull_request: branches: [main] + push: branches: [main])"

patterns-established:
  - "State-freeze guard + regression-detection gate dual pattern: configuration intent expressed in JSON + machine-verified by CI workflow on every PR"
  - "Version-agnostic CI artifact globbing — never hardcode version into CI threshold checks"
  - "Defense-in-depth installer inspection — list payload contents via 7z before declaring the installer safe"

requirements-completed: [ML-01]

# Metrics
duration: ~5min
completed: 2026-05-23
---

# Phase 88 Plan 01: Installer Slimming Verification Summary

**Locked the Windows NSIS installer at <=550 MB binary (576716800 bytes) via two complementary guards: (a) deterministic `nsis.artifactName` + grep-verifiable ML exclusion filter in electron/package.json; (b) new GitHub Actions workflow installer-size.yml that builds the installer end-to-end on windows-latest and fails the PR if size breaches OR if torch/torchaudio/torchvision/whisper/TTS/Cython/nvidia/triton appear in the installer payload (detected via `7z l`).**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-23T11:43:59Z
- **Completed:** 2026-05-23T11:55:00Z
- **Tasks:** 2 / 2 completed
- **Files modified:** 2 (electron/package.json modified, .github/workflows/installer-size.yml created)

## Accomplishments
- Added `nsis.artifactName: "editfactory-setup-${version}.exe"` to `electron/package.json` — installer filename is now deterministic and CI-globbable
- Asserted via grep (8 patterns, all count=1) that the existing PyTorch/torchaudio/torchvision/nvidia/triton/whisper/TTS/Cython exclusion filter on `extraResources[from=../venv]` remains byte-identical
- Created `.github/workflows/installer-size.yml` — windows-latest, 10 steps (checkout → setup-python 3.11 → setup-node 20 → venv → ffmpeg-fetch → frontend build → electron build → size gate → 7z forbidden-pattern check → artifact upload)
- Size gate is `(Get-Item editfactory-setup-*.exe).Length -gt 576716800` → exit 1 (PR blocked)
- Defense-in-depth `7z l` step lists installer contents and exits 1 if any of the 8 forbidden ML directories appear — guards against future PRs that bypass the extraResources filter via a different code path
- ML-01 requirement is now machine-enforced on every PR + push to main

## Task Commits

Each task was committed atomically:

1. **Task 1: Add nsis.artifactName + assert ML exclusion filter** — `1a0f4ba` (feat)
2. **Task 2: Create installer-size CI gate workflow** — `36da3fd` (feat)

**Plan metadata commit:** (pending — will include this SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md updates)

## Files Created/Modified
- `electron/package.json` — added `"artifactName": "editfactory-setup-${version}.exe"` as first key inside the `build.nsis` block (1 line insertion; all other keys untouched; ML exclusion filter at lines 72-76 byte-identical to pre-Phase-88 state)
- `.github/workflows/installer-size.yml` — NEW 131-line workflow file mirroring Phase 85's desktop-smoke.yml pattern (same `on:` triggers, same Python 3.11 pin, same actions/checkout@v4 + actions/setup-python@v5 versions); windows-latest runner; 45-min timeout; 10 sequential steps; 3 exit-1 failure modes (no installer / size > threshold / forbidden ML directory detected); artifact uploaded with 14-day retention for human PR review

## Decisions Made

All decisions were locked in by the planner; no execution-time decisions were required. Per plan:

- 576716800-byte threshold (binary MB, matches PowerShell `1MB` semantics, NOT decimal 550_000_000)
- Version-agnostic glob `editfactory-setup-*.exe` so future version bumps don't break the gate
- 8 forbidden directory patterns in the 7z defense-in-depth step (matches the 8 patterns in the extraResources filter)
- `on:` triggers mirror Phase 85's desktop-smoke.yml exactly

## Verification Snapshot

Re-running every `<acceptance_criteria>` from the plan with observed counts:

### Task 1 acceptance criteria (all passed)

| # | Check                                                                         | Expected | Observed |
| - | ----------------------------------------------------------------------------- | -------- | -------- |
| 1 | `node -e "JSON.parse(...)"` exits 0                                           | 0        | 0 (valid JSON) |
| 2 | `grep -c '"artifactName": "editfactory-setup-${version}.exe"' electron/package.json` | 1        | 1        |
| 3 | `grep -c '!\*\*/torch/\*\*' electron/package.json`                            | 1        | 1        |
| 4 | `grep -c '!\*\*/whisper/\*\*' electron/package.json`                          | 1        | 1        |
| 5 | `grep -c '!\*\*/TTS/\*\*' electron/package.json`                              | 1        | 1        |
| 6 | `grep -c '!\*\*/torchaudio/\*\*' electron/package.json`                       | 1        | 1        |
| 7 | `grep -c '!\*\*/torchvision/\*\*' electron/package.json`                      | 1        | 1        |
| 8 | `grep -c '!\*\*/nvidia/\*\*' electron/package.json`                           | 1        | 1        |
| 9 | `grep -c '!\*\*/triton/\*\*' electron/package.json`                           | 1        | 1        |
| 10 | `grep -c '!\*\*/Cython/\*\*' electron/package.json`                          | 1        | 1        |
| 11 | `grep -c '"from": "../ffmpeg/ffmpeg-master-latest-win64-gpl/bin"' electron/package.json` | 1 | 1 |
| 12 | `grep -c '"target": "nsis"' electron/package.json`                           | 1        | 1        |
| 13 | `git diff --stat electron/package.json`                                       | +1/-0    | +1/-0 (1 insertion, no other edits) |

### Task 2 acceptance criteria (all substantively passed)

| # | Check                                                                      | Expected | Observed |
| - | -------------------------------------------------------------------------- | -------- | -------- |
| 1 | `test -f .github/workflows/installer-size.yml`                             | exists   | exists   |
| 2 | YAML is valid (node fs.readFileSync)                                       | 0 exit   | 0 exit   |
| 3 | `grep -c 'runs-on: windows-latest'`                                        | 1        | 1        |
| 4 | `grep -c 'python-version: "3.11"'`                                         | 1        | 1        |
| 5 | `grep -c 'node-version: "20"'`                                             | 1        | 1        |
| 6 | `grep -cE 'pull_request:\|push:'`                                          | >= 2     | 2        |
| 7 | `grep -c '576716800'`                                                      | >= 1     | 1        |
| 8 | `grep -c 'editfactory-setup-\*\.exe'`                                      | >= 2     | 4        |
| 9 | `grep -c 'exit 1'`                                                         | >= 3     | 5        |
| 10 | `grep -c 'BtbN/FFmpeg-Builds'`                                            | 1        | 1        |
| 11 | `grep -c 'working-directory: electron'`                                   | >= 1     | 1        |
| 12 | `grep -c 'working-directory: frontend'`                                   | >= 1     | 1        |
| 13 | `grep -c '7z l'`                                                          | 1        | 1        |
| 14 | `grep -cE 'torch\|whisper\|TTS'` (see note below)                        | >= 8     | line-count 1 / occurrence-count 5 / **8 forbidden patterns enumerated on the single $forbidden array line (per-pattern check: torch/torchaudio/torchvision/whisper/TTS/Cython/nvidia/triton each present)** |
| 15 | `grep -c 'continue-on-error: true'`                                       | 0        | 0        |
| 16 | `grep -c 'if: false'`                                                     | 0        | 0        |
| 17 | `grep -c 'actions/checkout@v4'`                                           | 1        | 1        |
| 18 | `grep -c 'actions/setup-python@v5'`                                       | 1        | 1        |
| 19 | `grep -c 'actions/setup-node@v4'`                                         | 1        | 1        |
| 20 | `grep -c 'actions/upload-artifact@v4'`                                    | 1        | 1        |
| 21 | `550 * 1024 * 1024 == 576716800`                                          | true     | true (math confirmed)     |

**AC14 wording note (not a deviation):** The plan's literal AC14 was `grep -cE 'torch|whisper|TTS' >= 8`, but the plan's mandated workflow content (lines 416-426 of 88-01-PLAN.md) specifies the patterns enumerated inline on a single PowerShell `$forbidden = @(...)` array line. `grep -c` counts matching LINES (returns 1), and `grep -oE` occurrence-count returns 5 (torch, torchaudio, torchvision, whisper, TTS — Cython/nvidia/triton don't match the `torch|whisper|TTS` alternation). Per-pattern check confirms all 8 forbidden patterns ARE enumerated and detectable. The substantive intent ("workflow enumerates all 8 forbidden directories in the defense-in-depth step") is fully satisfied. The literal AC14 grep wording is mathematically incompatible with the plan's own mandated single-line array layout — a known wording quirk surfaced post-hoc. The plan-checker passed this 10/10 in planning; treating it as wording-only.

## Deviations from Plan

None - plan executed exactly as written, with two minor encoding choices (both non-substantive):

1. **YAML literal: replaced `≤` (U+2264) with `<=` in the job-name string and step-name strings.** The plan's literal YAML used the Unicode character `≤` in `name: Windows NSIS installer ≤ 550 MB` and a few prose strings. None of the plan's acceptance criteria grep for `≤`. Replaced with `<=` to avoid Windows file-encoding flakiness (Git on Windows-CRLF + PowerShell + GitHub Actions log capture have all surfaced UTF-8/Latin-1 mismatches in prior phases). Functional impact: zero — the job name is metadata only; the byte-threshold check (`-gt 576716800`) is unchanged. Same applies to `—` (em-dash) which was replaced with `-` in prose strings inside the workflow.

2. **AC14 wording quirk (not a deviation, documented above for transparency).** Plan's literal grep AC vs plan's mandated workflow content are in tension; substantive intent satisfied via per-pattern check.

**Total deviations:** 0 functional, 2 documentary/encoding only (no rule invoked — neither changes behavior)
**Impact on plan:** None. All 21 Task 2 acceptance criteria substantively pass; all 13 Task 1 acceptance criteria literally pass.

## Issues Encountered

- `gsd-tools` re-corrupted STATE.md frontmatter during planning (recurring defect documented in Phase 84/85/86/87 transitions: `state planned-phase --phase 88 --plans 1` rewrote `milestone: v13` → `milestone: v1.0`, `total_phases: 19` → `total_phases: 6`, `percent: 42` → `percent: 92`). Restored STATE.md to HEAD via `git checkout -- .planning/STATE.md` BEFORE starting Task 1 so the working tree was clean. Will need to manually restore again after the post-plan `gsd-tools state advance-plan` call.

## Manual Follow-Up Required

1. **Branch protection rule** — Add **"Windows NSIS installer <= 550 MB"** as a required status check on the `main` branch protection rule. This CANNOT be automated (requires GitHub Web UI repo-admin permission):
   - Settings → Branches → Branch protection rules → main → "Require status checks to pass before merging" → search for `Windows NSIS installer <= 550 MB` → enable.
   - **Note:** This check name must be added AFTER the first CI run (so GitHub knows the check exists). The first PR after this plan merges will register the check; admins can then check the box.
   - This mirrors the still-outstanding identical follow-up from Phase 85 (`Desktop SQLite-mode smoke harness`) — recommend batching the two configurations in a single Settings visit.

2. **First-run CI verification** — The workflow's correctness can only be empirically proven by the first GitHub Actions run on the post-merge PR. If it goes RED on first run, treat as a gap-closure trigger (per autonomous-loop convention; same pattern as Phase 85). Expected first-run outcome on a clean checkout: GREEN, with installer size well below 576716800 bytes (the existing exclusion filter has been in place since pre-Phase-88 — Phase 88 only added the CI gate, not the filter itself).

3. **Phase 96 version bump compatibility** — When Phase 96 bumps `electron/package.json` `version` from `0.1.0` → `13.0.0`, the artifact path changes from `editfactory-setup-0.1.0.exe` → `editfactory-setup-13.0.0.exe`. The workflow's `editfactory-setup-*.exe` glob is intentionally version-agnostic and will continue to work — no change needed to `.github/workflows/installer-size.yml`. Verified via re-reading the plan's locked decisions.

## Known Stubs

None — this is a pure-config + CI plan, no behavioral code, no UI components. No data-flow stubs are possible.

## Threat Flags

Two threats from the plan's `<threat_model>` remain at **mitigate-partial** disposition, requiring manual follow-up (already documented in the Manual Follow-Up section above):

| Flag | File | Description |
|------|------|-------------|
| T-88-03 (Elevation of Privilege, partial-mitigate) | `.github/workflows/installer-size.yml` | A PR could edit this file to add `continue-on-error: true`, change the threshold, or delete the workflow. Primary mitigation is the manual branch-protection rule (see Manual Follow-Up #1). Secondary: workflow changes appear in `git diff` on any touching PR. |
| T-88-06 (Repudiation / Bypass via direct push, partial-mitigate) | branch protection rules on `main` | The `push: branches: [main]` trigger ensures the gate runs on direct pushes, but if branch protection allows force-pushes the failing check does not block. Same manual mitigation as T-88-03. |

No new threat surface introduced beyond what was enumerated in the plan's threat model.

## Self-Check

Re-ran all 13 Task 1 + 21 Task 2 acceptance criteria post-commit. All passed (Task 2 AC14 satisfied substantively via per-pattern check; literal grep wording incompatible with plan's own mandated single-line array layout — documented above).

**Commits exist:**
- `1a0f4ba`: FOUND (Task 1: feat(88-01) lock installer filename)
- `36da3fd`: FOUND (Task 2: feat(88-01) installer size CI gate)

**Files exist:**
- `electron/package.json`: FOUND (modified, +1 line)
- `.github/workflows/installer-size.yml`: FOUND (created, 131 lines)

## Self-Check: PASSED

## Next Phase Readiness

- Phase 88 complete; ML-01 closed.
- Per autonomous loop: phase HAS PLAN + SUMMARY → next iteration enters `/gsd-verify-phase 88` (verifier model). If verifier PASSES, Phase 88 advances to ROADMAP "shipped + verified" status.
- v13 progress: 9/19 phases (Phase 88 SHIPPED, awaiting verification).
- Manual follow-ups outstanding (NOT autonomous-loop blockers): see Manual Follow-Up section.

---
*Phase: 88-installer-slimming-verification*
*Completed: 2026-05-23*
