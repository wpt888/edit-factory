# Goal: Timeline transitions V1 — dip to black + flash white (desktop, Step 3)

Working directory: `C:\obSID SRL\n8n\edit_factory` (Blipost desktop app).

READ FIRST — binding part of this brief (verified file:line map, ffmpeg mechanics, data model, gotchas, out-of-scope): @goals/transitions-details.md

## Objective — 2 phases, strictly in this order

**P0 — Data model + plumbing (no visible feature yet):**
1. `transitionIn?: { kind: "dip_black" | "flash_white"; durationMs: number }` on `CompositionClip` and `TimelineEntry` (file:line in details). Absent/null = hard cut; first clip has none. Additive, NO migration — legacy compositions parse and render unchanged.
2. Backend allowlist validation at every video_timeline ingress: strict kind enum, durationMs clamped [150,600], 422 otherwise. Never pass user strings into a filtergraph.
3. Thread the field through save/restore, history/undo, preview request, render request, and the segment cache key (critical, see details).
4. Per-variant `defaultTransition` in the variant assembly settings; per-boundary override; resolve to concrete values before any request hits the backend.

**P1 — The no-overlap family, end to end:**
1. Render: fade-out on tail of clip N−1 + fade-in on head of clip N (durationMs/2 each, black or white), appended to the existing `-vf` chain in `extract_segment()` (assembly_service.py:2110-2238). Timeline duration unchanged by construction; the concat `-c copy` fast path (assembly_service.py:2401) stays byte-identical when no transitions exist.
2. Guards: no transitions on `kind:"intro"` clips, on boundaries where either side < 2×durationMs, or on interstitial slide boundaries (strip/reject + UI doesn't offer).
3. Instant preview: overlay div (black/white) opacity-animated from the existing master clock around the boundary — NO dual video playback (the ping-pong idle slot stays paused).
4. UI in Step 3: Assembly Settings → Default transition (None/Dip to black/Flash white) + Duration (Fast 200/Normal 350/Slow 500); timeline boundary markers → popover with type, duration, Use variant default. English copy, existing idioms, no new deps.

## Acceptance (all must hold — full definitions in the details file)
1. Duration invariant: render with ~10 transitions vs none → ffprobe equal ±1 frame; automated against real ffmpeg.
2. Zero-transition composition → concat still `-c copy` (asserted).
3. Transition edits change affected segment cache keys (test on make_key inputs).
4. Validation: bad kind/duration → 422; intro clip transitionIn stripped; legacy compositions unaffected.
5. Save/reload round-trips transitions + variant default; undo covers transition edits.
6. Visual verification (clause D): instant preview fade AND FFmpeg preview fade observed in the running app; overlays/subtitles do not fade. Screenshots.
7. Backend pytest + frontend lint/typecheck/build green for touched areas.

## Hard constraints
- **NEVER `git push`** (push = auto-deploy). Local commits only.
- No new dependencies; no xfade/dissolve/slide (explicitly out of scope — separate goal); no asset packs.
- The details file's Constraints and Out-of-scope sections are binding.

## Standing clauses
**A. Commit discipline.** Commit after EVERY logical modification — one coherent change, one commit, conventional message. No batching, no dirty tree. Never push.
**B. Wiki summary at FULL completion** (only then): update the relevant `docs/wiki/` page per this repo's convention, append the changelog/log entry, register new pages in the index; commit it.
**C. Return shape.** Final message = data, not prose: (1) what shipped per phase + acceptance results, (2) commits (hash + subject), (3) docs touched, (4) verification evidence (test tail + screenshot paths).
**D. Visual verification.** Never declare UI work done on code alone — drive the running app (Playwright MCP or the repo's testing conventions), observe the fades, and report what you saw.
