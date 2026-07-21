# Goal: Headline overlay — on-screen hook text for muted autoplay

Working directory: `C:\obSID SRL\n8n\edit_factory` (Blipost desktop). PREREQUISITE: goals/01 landed in `main`. Branch `feat/headline-overlay` off fresh `main`.

Premise: most first views are muted; the hook must exist visually. One big styled text ("headline") over the first ~2–3s of each variant, auto-generated, editable.

## Objective
1. **Model**: per-variant headline = `{text, styleId, startMs=0, durationMs≈2500, enabled}` stored additively in composition JSON (no migration). Auto-filled from the script's first sentence; editable; can be disabled.
2. **Render**: burn via the ASS machinery in `app/services/video_effects/subtitle_styler.py` (karaoke work lives there post-consolidation) — a static ASS event on its own layer, same burn pass as subtitles. Do NOT disturb the existing z-order architecture (subtitle burn + attention behind/front two-pass). Headline sits in the upper zone, subtitles lower — distinct style/margins so they can never collide.
3. **Styles**: 2–3 presets (e.g. bold boxed, outlined caps, minimal), defined like existing subtitle style presets; safe-area aware (the timeline editor already has a safe-area overlay — respect its insets).
4. **Preview parity**: Step 3 instant preview shows the headline as a DOM overlay (same pattern as the existing subtitle preview div), correct during scrub/pause, only within its time window.
5. **UI**: small "Headline" block in the Step 3 inspector: toggle, text input, style picker.

## Acceptance
1. Default pipeline run → each variant carries an auto-headline; visible in instant preview AND in a real render for the first ~2.5s only, gone after.
2. Headline never overlaps rendered subtitles in the default styles (verify with the longest test subtitle line).
3. Round-trips save/reload; disabling removes it from both preview and render; preview cache fingerprint invalidates on text/style change.
4. `pytest tests/` + `npx tsc --noEmit` + `npm run build` green; ASS unit test for the headline event (timing window, layer, style fields).

## Hard constraints
- **NEVER `git push`.** No new deps. Additive JSON only — no migration. Mixed-EOL recipe (@goals/attention-images-details.md) on every commit. English copy, dark theme (lime primary).
- Do not modify subtitle or attention rendering behavior; the headline is purely additive.

## Standing clauses
**A. Commit discipline.** One logical change = one commit, conventional message, EOL recipe, no dirty tree. Never push.
**B. Docs at FULL completion only:** new/updated `docs/wiki/` page + 01-log + 00-index; commit. Note backend manual restart.
**C. Return shape.** Data only: shipped items, commits (hash+subject), test tails, wiki pages, screenshot paths.
**D. Verification.** In the running app: instant preview + one real rendered frame with the headline; report what you saw.
