# Task: Expose clip pacing control in Step 3 + human-readable timeline card labels

Working directory: C:\obSID SRL\n8n\edit_factory (Windows). Blipost desktop app (FastAPI backend + Next.js frontend). Builds on the just-committed group-first matching work (commit 65ce5a5, see docs/wiki/12-preview-render-parity.md).

## Change 1 — Clip pacing (segment length) control

Today the cut length is dictated by `min_segment_duration` (default 3.0s), hardcoded at the `preview_matches` call site (app/services/assembly_service.py, param exists; pipeline routes call it with the default). Users cannot choose whether they want fast cuts (~2s) or calm cuts (~4-5s).

- Backend: accept a `min_segment_duration` (float, clamp to 1.0–8.0) on the pipeline preview endpoint(s) in app/api/pipeline_routes.py that ultimately call `preview_matches` / `build_timeline`, and thread it through. It must ALSO reach the render path so preview and render stay in parity (this is critical — do not let preview use one value and render another). Persist the chosen value in the pipeline state (the `_pipelines` dict + Supabase persistence) so regenerate/render reuse it.
- Frontend: in Step 3 (frontend/src/app/pipeline/components/step3-preview.tsx), add a compact "Pacing" control near the existing preview controls — a small segmented control or select with 3 presets: "Fast (2s)", "Normal (3s)", "Slow (5s)" mapping to min_segment_duration 2.0 / 3.0 / 5.0. Changing it re-runs the preview matching for the variants (same flow the existing "regenerate preview" uses). Default stays Normal (3.0) so existing behavior is unchanged.
- Preview cache fingerprint (pipeline_routes.py render-preview fingerprint) must include min_segment_duration so switching pacing invalidates cached previews.

## Change 2 — Human card labels in the timeline strip

The filmstrip cards in frontend/src/components/timeline-editor.tsx are labeled like "#6-8 · 2.7s · 3 phrases" — developer jargon. Make the primary label content-oriented:

- Primary line: the matched keyword when present (e.g. "waterproof"), else the first 2-3 words of the group's first phrase text (e.g. ""Costumul imperm…""), truncated with ellipsis.
- Secondary line (smaller, muted): duration ("2.7s"). Keep phrase indices only in a tooltip (title attr) for debugging — remove them from the visible card.
- Keep thumbnails, selection, drag-swap, picker behavior untouched.

## Constraints

- Do NOT regress the parity invariant delivered in 65ce5a5 (same merge group ⇒ same segment_id; preview == render).
- Backend tests: `venv\Scripts\python.exe -m pytest tests/test_assembly_scoring.py -q` must stay green; add a small test that a custom min_segment_duration changes grouping as expected (e.g. 2.0 produces >= as many groups as 5.0 on the same entries).
- Frontend: `cd frontend && npm run lint` must pass.
- UI copy in English. Match existing control styling in Step 3 (neutral surfaces, lime primary).
- The repo may have pre-existing uncommitted changes in files you touch — do not revert them; if a file you must edit is already dirty, checkpoint-commit its current state first ("wip: checkpoint pre-existing changes in <file>").

## Standing clauses (mandatory)

A. Commit after EVERY logical modification — one coherent change, one commit, conventional message. Never push.
B. Wiki summary at FULL completion only: update docs/wiki/12-preview-render-parity.md (or a new page if clearer), append to docs/wiki/01-log.md, register any new page in docs/wiki/00-index.md. Commit the wiki change.
C. Return shape — data, not prose: (1) ≤10-line design summary, (2) test/lint results (commands + counts), (3) commit list (hash + subject), (4) wiki pages touched, (5) deviations and why. No file dumps.
