# Goal: Background music with auto-ducking (Step 3 + render)

Working directory: `C:\obSID SRL\n8n\edit_factory` (Blipost desktop). PREREQUISITE: run only after goals/01 (consolidation) has landed in `main`. Branch `feat/bgm-ducking` off fresh `main`.

Context: the render chain has NO music input anywhere today (deliberate skip, 2026-07-11). Voice-chain facts that BIND you (learned the hard way): audio filters must apply AFTER loudnorm (else normalization cancels them) and must respect the `-itsoffset` intro shift; `voice_volume`/`audio_fade_*` already flow through the whole chain and sit in the preview cache fingerprint — mirror that exact path.

## Objective
1. **Music source**: per-variant background track. Reuse an EXISTING upload/asset mechanism (attention-images upload, TTS library storage — find and reuse, do not invent a new one). Optionally 3–5 bundled royalty-free tracks if trivially addable as static assets; skip the bundle if not trivial.
2. **Mix with auto-ducking**: FFmpeg `sidechaincompress` with the voice-over as sidechain source, then `amix`. Music loops or trims to timeline length; obeys existing audio fades; final loudness still normalized.
3. **Controls** (Step 3 inspector, new "Music" card): track pick/clear, music volume slider, ducking toggle (default ON), music fade in/out. Persist additively in composition/render-settings JSON — NO DB migration.
4. **Preview + cache**: rendered preview includes music; music selection + volume + ducking enter the preview cache fingerprint exactly like `voice_volume` (changing music invalidates cache).
5. Step 4 render carries the identical mix.

## Acceptance
1. Unit tests on filtergraph construction: ducking on/off, loop vs trim, with/without intro offset.
2. Real ffmpeg smoke: voice + music render → output has exactly one audio stream, duration unchanged; `astats`/`volumedetect` shows the music-under-voice region measurably quieter than a music-only region (ducking demonstrably works).
3. In the RUNNING app (clause D): pick a track on a variant → preview audibly has music; clear it → cache invalidates, music gone. Screenshot of the Music card.
4. Full `pytest tests/` green; `npx tsc --noEmit` + `npm run build` green; no regression in existing audio tests.

## Hard constraints
- **NEVER `git push`.** No new dependencies (FFmpeg filters only). Additive JSON only — no DB migration. Mixed-EOL commit recipe from @goals/attention-images-details.md applies to every commit.
- Audio-only feature: do not touch the video filter chain.
- English copy, dark theme (lime primary) for the UI card.

## Standing clauses
**A. Commit discipline.** One logical change = one commit, conventional message, EOL recipe, no dirty tree. Never push.
**B. Docs at FULL completion only:** new `docs/wiki/` page (BGM + ducking design, filtergraph, limits) + 01-log entry + 00-index registration; commit. Note that the backend needs a manual restart.
**C. Return shape.** Data only: shipped items, commits (hash+subject), test tails, wiki page, screenshot/audio-evidence paths.
**D. Verification.** Verify in the running app; report what you heard and saw.
