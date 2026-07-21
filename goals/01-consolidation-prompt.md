# Goal: Consolidation — land the three finished work lots into main

Working directory: `C:\obSID SRL\n8n\edit_factory` (Blipost desktop). Run this /goal from the edit_factory window so @goals/ resolves.

READ FIRST — binding: the "CRITICAL — mixed line endings" recipe in @goals/attention-images-details.md applies to EVERY commit here (Edit tool churns CRLF files to LF; rebuild per-line EOL from HEAD; stage by explicit path; `git diff --cached --stat` must show only real lines).

State (verified 2026-07-19; re-verify first — it drifts):
- `feat/attention-images` (current): attention P0–P2 committed, PLUS ~830 uncommitted lines. WARNING: these hunks MIX several parallel deliveries — attention Step-1 picker integration, karaoke ASS (`subtitle_styler.py` +165, untracked `tests/test_karaoke_ass.py`, untracked `attention-template-picker.tsx`), and timeline multi-track-unify leftovers — across step1/2/3, page.tsx, timeline files, video-segment-player, thumbnail-picker, dialog.tsx, subtitle-editor.
- Transitions v1: branch `worktree-agent-a22083ccab05e3f25` (base 2994250, 14 commits, wiki page 30 only there). Green there 2026-07-18: 711 tests, tsc, build.
- `feat/caption-studio-runner`: unmerged since 2026-07-11.
- Dead code: `assembly_service.py` ~L2363 `if False and interstitial_slides:` + stale "Phase 46" comment on `RenderRequest.interstitial_slides`.

## Objective — strictly in order
P0 — commit the WIP on `feat/attention-images`: run `PYTHONPATH=. venv/Scripts/python.exe -m pytest tests/test_karaoke_ass.py tests/test_attention_templates.py tests/test_assembly_scoring.py -q` (never `-p no:cov`). Green → commit in a few coherent file-groups (karaoke / attention picker / timeline-multitrack + wiring), honest messages; do NOT attempt surgical per-feature hunk splitting inside one file. Red → STOP, report, change nothing.
P1 — merge `feat/attention-images` → `main`.
P2 — merge `worktree-agent-a22083ccab05e3f25` → `main`. Conflicts expected in `timeline-editor.tsx`, `assembly_service.py`, `step3-preview.tsx`, `multi-track-timeline.tsx`. The features are orthogonal — transitions = boundary fades in `extract_segment` + `BoundaryTransitionMarker` + default-transition selects; attention/karaoke = overlay passes + ASS styling. KEEP BOTH; never drop a hunk to silence a conflict.
P3 — `feat/caption-studio-runner`: modest conflicts → merge; heavily divergent → do NOT force, report and skip.
P4 — delete the dead interstitial path + stale comment (separate small commit).

## Acceptance
1. `main`: full `pytest tests/` green (≥711 + new tests), `npx tsc --noEmit` + `npm run build` (frontend/) green.
2. Real-render smoke: one composition with dip_black transition + attention cue (zone "front") + karaoke subs renders; boundary frame dark, overlay above subs, duration ±1 frame. Standalone scripts: `from app.ffmpeg_setup import _setup_ffmpeg_path; _setup_ffmpeg_path()` first.
3. Step 3 in the RUNNING app (clause D): transition popover + attention lane + subtitle styles on one variant. Screenshot. NOTE: Electron frontend (3947) is a standalone build — rebuild it, or verify on web dev :3001.
4. Wiki: register page 30 in `00-index.md`; consolidation entry in `01-log.md`.

## Hard constraints
- **NEVER `git push`.** Local merges only. No new deps. Backend has no --reload — restart manually.
- Consolidation only: no "improvements" while merging. Bugs found → list in return, don't fix (except trivial merge-induced breakage).

## Standing clauses
**A.** One logical change = one commit, conventional message, EOL recipe, no dirty tree. Never push.
**B.** Docs at FULL completion only: `docs/wiki/` 00-index + 01-log + page-30 registration; commit.
**C.** Return = data: per-phase outcome, conflicts + resolution, commits (hash+subject), test tails, wiki pages, screenshots.
**D.** Drive the running app for acceptance 3; report what you saw.
