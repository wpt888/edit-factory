# Goal: Consolidation — land subtitle rotation + inspector into main

Working directory: `C:\OBSID SRL\n8n\edit_factory`. Run this /goal from the edit_factory window.

READ FIRST — binding: the "CRITICAL — mixed line endings" recipe in @goals/attention-images-details.md applies to EVERY commit (rebuild per-line EOL from HEAD; stage by explicit path; `git diff --cached --stat` must show only real lines).

State (verified 2026-07-20; re-verify first):
- `feat/subtitle-inspector` (current HEAD 3c5d382) contains BOTH deliveries stacked: subtitle-template-rotation (05cdfa9, ebb91f6, c7cd5b9) + subtitle inspector (8f52598..3c5d382). Both verified green: 33 rotation pytest tests, tsc, screenshots, wiki page 36 + log entries.
- The working tree has UNCOMMITTED WIP from a PARALLEL delivery (attention templates refactor + timeline multi-track + workspace-split: `app/api/attention_routes.py`, `app/services/attention_templates.py`, `frontend/src/app/attention-templates/page.tsx`, `attention-template-picker.tsx`, `timeline-editor.tsx`, `multi-track-timeline.tsx`, `workspace-split.tsx`, `step3-preview.tsx`, tests, 3 untracked electron/*.png, untracked `karaoke-maximized-preview.spec.ts`, `docs/wiki/01-log.md`, `electron/package.json`). Do NOT discard it.

## Objective — strictly in order
P0 — Triage the WIP: `git diff` each modified file and decide whether it is a coherent finished delivery. If yes → commit it in a few coherent groups (attention refactor / timeline / misc) with honest messages ON THE CURRENT BRANCH before anything else. If it looks half-done or you cannot tell → STOP and report; do not merge anything.
P1 — Merge `feat/subtitle-inspector` → `main` (this brings rotation + inspector + the WIP commits from P0). Conflicts possible in `step3-preview.tsx`, `page.tsx`, `pipeline_routes.py` — features are orthogonal (rotation = template assignment + words regroup; attention/timeline = overlays/lanes). KEEP BOTH; never drop a hunk to silence a conflict.
P2 — Do NOT delete the feature branches; leave them.

## Acceptance
1. On `main`: `PYTHONPATH=. venv/Scripts/python.exe -m pytest tests/ -q` green (needs `.env`; ≥778 tests), `npx tsc --noEmit` + `npm run build` (frontend/) green.
2. Playwright: `npx playwright test tests/subtitle-template-rotation.spec.ts tests/karaoke-inline-preview.spec.ts --reporter=list` green (frontend :3000/:3005, backend 8001 AUTH_DISABLED).
3. Visual spot-check in the RUNNING app: one pipeline with 2-template rotation (different wordsPerSubtitle) → open the FFmpeg preview of variants 1 and 2 and CONFIRM the burned cues group differently (2 vs 4 words). Screenshot both. This closes the one open observation from review.
4. Wiki: consolidation entry in `docs/wiki/01-log.md`; commit.

## Hard constraints
- **NEVER `git push`.** Local merges only. No new deps. No "improvements" while merging — bugs found go in the report, not in commits.
- Backend has no --reload — restart manually.

## Standing clauses
**A.** One logical change = one commit, conventional message, EOL recipe, clean tree at the end. Never push.
**B.** Docs at FULL completion only; commit.
**C.** Return = data: P0 triage verdict per file-group, conflicts + resolution, commits (hash+subject), test tails, screenshot paths.
**D.** Drive the running app for acceptance 3; report what you saw.
