# Goal: Hook variants — multiply the first 2 seconds, reuse the body

Working directory: `C:\obSID SRL\n8n\edit_factory` (Blipost desktop). PREREQUISITE: goals/01 landed in `main` (goals/02 NOT required). Branch `feat/hook-variants` off fresh `main`.

Premise: today N variants = N fully different scripts, full TTS cost each. Retention is decided in the first ~2s. Give one good script 3–5 alternative hooks (rewritten first sentence) with the BODY SHARED, so the user gets statistically meaningful A/B material at the TTS cost of one sentence per extra variant.

## Objective — design first, then build
P0 — **Design note (before any code)**: study how Meta Multiplication already fans one script into 2 preview versions (A/B) — state keys, preview_key shape, render fan-out. Write a 1-page design in `docs/wiki/` choosing the state model for hook children; STRONGLY prefer extending the existing multiplication mechanism over inventing a new axis. Map exactly where SRT timings shift and where audio is stitched. Commit it; it is your contract for P1–P4.
P1 — **Hook generation**: on a script, "Generate hook variants" → N alternative first sentences via the existing AI-provider path (Rules apply). Each hook editable by the user.
P2 — **Audio**: TTS only the hook sentence per variant; stitch hook audio + shared body audio (concat; tiny crossfade/apad at the seam if needed to kill clicks). FALLBACK behind a flag (default OFF): full-TTS regen per hook variant if seam artifacts prove unavoidable — document the flag.
P3 — **Subtitles + timeline**: re-time SRT — body cues shift by (new hook duration − old); first-phrase segments re-match per hook; body composition (segments, transforms, attention cues) is REUSED, not re-assembled.
P4 — **Preview + render**: each hook variant is a renderable child (like Meta A/B), labeled Hook A/B/C…; independently selectable for render.

## Acceptance
1. From one script: 3 hook variants, each playable in Step 3 with correct subtitle timing across the hook/body seam (no drift, no overlap).
2. TTS characters consumed for extra variants ≈ hook sentence only (verify via the cost log / char counter); fallback flag documented.
3. Audio seam clean: no audible click; total duration = hook + body ±50ms.
4. Rendering 2 hook variants of the same script succeeds; only phrase-1 footage may differ between them.
5. Full `pytest tests/` + `npx tsc --noEmit` + `npm run build` green.

## Hard constraints
- **NEVER `git push`.** No DB migration — additive JSON in pipeline state only. No new deps. Mixed-EOL recipe (@goals/attention-images-details.md) on every commit.
- Do NOT rewrite the pipeline state model; extend the existing multiplication pattern per your P0 design.
- English copy, dark theme (lime primary).

## Standing clauses
**A. Commit discipline.** One logical change = one commit, conventional message, EOL recipe, no dirty tree. Never push.
**B. Docs at FULL completion only:** update the P0 wiki page to as-built + 01-log + 00-index; commit. Note backend manual restart.
**C. Return shape.** Data only: per-phase outcome, commits (hash+subject), test tails, wiki pages, evidence paths.
**D. Verification.** Play Hook A and Hook B in the running app, screenshot both; report seam behavior you observed.
