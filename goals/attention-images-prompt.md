# Goal: Attention Images — apply-template route + editor UI + template editor (desktop, Step 3)

Working directory: `C:\obSID SRL\n8n\edit_factory` (Blipost desktop). Run this /goal from the edit_factory window so @goals/ resolves.

READ FIRST — binding part of this brief (engine state, file:line map, data shapes, the CRITICAL mixed-EOL commit recipe, branch setup, verify/run, out-of-scope): @goals/attention-images-details.md

ENGINE already shipped on `feat/timeline-transitions-v1` (13f2024 + 5160d99): cue `zone` behind/front two-pass render, fade-out, template `size`+`zone`, `layout_positions`, `distribute_attention_cues`. Wire it to a route + UI; do NOT redo the engine.

## Objective — 3 phases, strictly in this order

**P0 — apply-template route (backend, curl-testable):** add `POST /{pipeline_id}/attention-timeline/{preview_key}/apply-template` in `pipeline_routes.py` beside `update_attention_timeline` (body + logic in details) → resolve template (SYSTEM_TEMPLATES or owned personal) → `distribute_attention_cues` → revision-checked save (mirror the PUT; 409 on stale). Client supplies duration + boundaries. Test threading + conflict.

**P1 — timeline editor = the usable workflow** (`frontend/src/components/timeline-editor.tsx`): (1) multi-layer per cue — add/edit a 2nd/3rd image on one moment (today only `layers[0]`), all layers round-trip save; (2) real upload wired to the decorative Upload/Gallery tabs (reuse existing `ImagePickerDialog`/asset upload); (3) per-cue Behind/In-front toggle → `cue.zone`; (4) template picker applying a template via P0 (pass editor's duration + boundaries + image URLs) then reloading.

**P2 — template editor screen (the "space"):** dedicated create/edit/preview/save via the existing `/attention-templates` API, with a LIVE layout preview (size + cascade) on a mock 9:16 frame. System templates read-only; personal full CRUD. Wire into nav/Step 3 per repo idioms.

## Acceptance (full defs in details)
1. P0: applied template → cues carry its zone, per-layer `width==size`, `len(layers)==template.layers`; stale revision → 409. Backend pytest green.
2. P1 in the RUNNING app (clause D): pick template + upload 3 images → staggered + stacked at template size, quick in/out; front-zone renders OVER the subtitle in a real export, behind-zone UNDER. Screenshots.
3. Multi-layer + zone + upload round-trip save/reload; existing single-image timelines still load.
4. P2 in the app: create → preview → save a personal template, then apply it in the editor. Screenshots.
5. Frontend lint/typecheck/build + backend pytest green; commits clean (EOL recipe followed).

## Hard constraints
- **FIRST** `git switch -c feat/attention-images` off current `feat/timeline-transitions-v1` HEAD (has engine commits 13f2024 + 5160d99); ALL work there — a parallel session holds that branch (details). **NEVER `git push`**. Stage ONLY your attention files by explicit path.
- Before EVERY commit apply the mixed-EOL recipe in details (the Edit tool churns whole files to LF; rebuild preserving HEAD's per-line EOL) — `git diff --cached --stat` must show only your real lines.
- Other constraints (no new deps, dark theme, English, additive JSON / no migration, no ffmpeg pop/zoom/spin motion) + out-of-scope: see details, binding.

## Standing clauses
**A. Commit discipline.** After EVERY logical change — one commit, conventional message, EOL recipe applied. No dirty tree. Never push.
**B. Docs at FULL completion only:** update the relevant `docs/wiki/` page + log + index per convention; commit. Note backend restart after the route change; no migration.
**C. Return shape.** Final message = data: shipped per phase + acceptance, commits (hash+subject), docs touched, verification evidence (test tail + screenshot paths).
**D. Visual verification.** Never declare UI done on code alone — drive the running app (Playwright MCP or repo conventions), observe images spawn/stack/fade + behind-vs-front z-order in a real render, report what you saw.
