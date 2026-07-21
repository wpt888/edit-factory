# Goal: AI auto-segmentation — fill the segment pool automatically

Working directory: `C:\obSID SRL\n8n\edit_factory` (Blipost desktop). PREREQUISITE: goals/01 landed in `main`. Branch `feat/auto-segmentation` off fresh `main`. Can run in parallel with goals/02 (different surfaces) but NOT with 03/04.

READ FIRST — binding design (decided 2026-07-14, do not re-litigate the architecture): @docs/wiki/17-ai-auto-segmentation.md — hybrid FFmpeg shot detection + Gemini SELECTION/keywording; the LLM never produces timestamps.

## Objective
1. **Detection**: background job (existing JobStorage + FastAPI BackgroundTasks pattern) on a source video → FFmpeg scene detection (`scdet` / `select='gt(scene,T)'`, threshold configurable) → candidate shots with start/end.
2. **Selection + keywords**: Gemini scores/filters candidates and assigns keywords per kept shot (frame sampling per wiki 17), cost-tracked via the existing cost tracker. Graceful degradation: no Gemini key → keep motion/variance scoring only, keywords empty.
3. **Review UI**: proposed segments land in a review state on the Segments page (reuse the existing segment/timeline UI, don't fork it): approve / adjust bounds / reject. Approved rows become normal `editai_segments` rows (usage_count etc. as today).
4. **Entry point**: an "Auto-segment" action on a source video (Segments page), progress via the existing job-polling pattern.

## Acceptance
1. Real video (≥60s, multiple scenes) → job completes → plausible shot boundaries (±0.5s of visible cuts on a known test clip), keywords present when Gemini is available.
2. Degraded mode (no key) still yields approvable candidates.
3. Approved segments are immediately usable by pipeline matching (appear in the Step 3 segment pool).
4. Costs logged per analysis; job state survives polling/restart per existing job semantics.
5. `pytest tests/` + `npx tsc --noEmit` + `npm run build` green; unit tests for boundary parsing + threshold config; one integration test behind a real-ffmpeg marker. Standalone scripts need `from app.ffmpeg_setup import _setup_ffmpeg_path; _setup_ffmpeg_path()` first.

## Hard constraints
- **NEVER `git push`.** No new deps (FFmpeg + existing Gemini client only). DB: reuse `editai_segments`; if a review-state marker is unavoidable, prefer reusing a status/JSON field over new columns; a new nullable column only as last resort, via repo migration conventions.
- Mixed-EOL recipe (@goals/attention-images-details.md) on every commit. English copy, dark theme (lime primary).

## Standing clauses
**A. Commit discipline.** One logical change = one commit, conventional message, EOL recipe, no dirty tree. Never push.
**B. Docs at FULL completion only:** update wiki 17 from "idea" to as-built + 01-log + 00-index; commit. Note backend manual restart.
**C. Return shape.** Data only: shipped items, commits (hash+subject), test tails, wiki pages, evidence paths.
**D. Verification.** Run the full flow in the running app on a real video (detect → review → approve → visible in Step 3 pool); screenshots; report what you saw.
