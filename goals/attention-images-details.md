# Attention Images — details (apply-template route + editor UI + template editor screen)

Binding spec for `attention-images-prompt.md`. Verify every line number before editing — they drift.

## Where this picks up — ENGINE ALREADY SHIPPED, do NOT redo
Branch `feat/timeline-transitions-v1`. Two commits already landed the engine:
- `13f2024` feat(attention): render fade-out + behind/front subtitle layering
- `5160d99` feat(attention): templates carry size + zone, drive layer geometry

Working state (all done + tested — build ON it):
- `AttentionCue` (TS `frontend/src/types/attention-timeline.ts`; Pydantic `app/api/pipeline_routes.py` ~3265) has `zone: "behind"|"front"` (default "behind"). `layers: AttentionLayer[]` (max 20).
- `AttentionLayer`: `x,y,width,height` (0..1 fractions of frame), `zIndex`, `fit: contain|cover`, `animation{preset,enterMs,exitMs,delayMs,intensity}`.
- Renderer `app/services/video_effects/overlay_renderer.py::apply_attention_timeline` renders per-image size/position/timing + fade-IN and fade-OUT (helper `_fade_filter`, anchored to absolute timeline) + a `keep_audio: bool` param.
- `app/services/assembly_service.py`: composites `zone=="behind"` cues BEFORE the subtitle burn (in `assemble_video`, ~2418), and `zone=="front"` cues in a SECOND pass AFTER subtitles (in `assemble_and_render`, right after `_render_with_preset`, ~3020) with `keep_audio=True`. Front dims = `preset_data["width"/"height"]`.
- Templates: `AttentionTemplateBody` (`app/api/attention_routes.py`) has `size` (0..1, default .8) + `zone`. `app/services/attention_templates.py::distribute_attention_cues(*, duration_ms, subtitle_boundaries_ms, template, asset_ids)` builds cues from a template + asset ids; per-image positioning is in `layout_positions(layer_count, size)` (diagonal cascade — the chosen layout, keep it). **`distribute_attention_cues` is currently ORPHANED — only tests call it. P0 wires it.**
- Template CRUD API exists but has ZERO frontend consumer: `GET/POST/PUT/DELETE /attention-templates` (`attention_routes.py`), returns 3 hardcoded `SYSTEM_TEMPLATES` + caller's personal rows (config JSON).
- Timeline persistence: `GET/PUT /{pipeline_id}/attention-timeline/{preview_key}` (`pipeline_routes.py` ~3286-3339) → `editai_pipelines.attention_timeline[preview_key]` = `{revision, cues}`, optimistic-concurrency on `revision`.

## ⚠️ CRITICAL — mixed line endings (read before EVERY commit)
Many edit_factory files have MIXED CRLF/LF committed in HEAD, `core.autocrlf=true`, no `.gitattributes`. The Edit tool rewrites whole files to LF → `git diff` reports THOUSANDS of false churn lines (a 1-line change showed as 1274). Per file, before staging:
1. Compare `git diff --stat <f>` vs `git diff --stat --ignore-cr-at-eol <f>`. If they differ wildly → the file had mixed EOL; rebuild it.
2. Rebuild preserving HEAD's per-line EOL, keeping ONLY your content: get HEAD raw via `git cat-file -p HEAD:<f>` (NOT `git show` — it smudges and lies); split HEAD and your working file on `\n`; `difflib.SequenceMatcher` on the `\r`-stripped lines; for `equal` opcodes emit HEAD's original lines (keeps their exact EOL), for `insert`/`replace` emit your new lines with the file's DOMINANT EOL (`\r\n` if HEAD has more CRLF than LF, else `\n`); write bytes.
3. `git -c core.autocrlf=false add <f>`, then confirm `git diff --cached --stat` shows ONLY your real line count.
Files that are already uniform-LF in HEAD (e.g. the TS types, tests) stage clean with no rebuild — check first, only rebuild the churned ones.

## P0 — apply-template route (backend, curl-testable)
Add `POST /{pipeline_id}/attention-timeline/{preview_key}/apply-template` in `pipeline_routes.py` beside `update_attention_timeline` (~3303).
Body (Pydantic): `{ templateId: str, assetUrls: List[str] (min 1, max 100), durationMs: int (gt 0), subtitleBoundariesMs: List[int] = [], revision: int (ge 0), mode: Literal["replace","append"] = "replace" }`.
Logic:
1. `_validate_preview_key`; load pipeline; ownership check (mirror GET/PUT handlers exactly).
2. Resolve template: import `SYSTEM_TEMPLATES` from `attention_templates`; find by `id`; else `get_repository().get_attention_template(templateId)` and 403 unless `row["profile_id"]==profile.profile_id`; build the dict distribute expects = `{**row["config"], "id": row["id"], "name": row["name"]}`.
3. `new_cues = distribute_attention_cues(duration_ms=body.durationMs, subtitle_boundaries_ms=body.subtitleBoundariesMs, template=resolved, asset_ids=body.assetUrls)`.
4. Load current `{revision,cues}`; `body.revision != current.revision` → 409 `{message, current}` (mirror PUT).
5. `mode=="replace"` → cues=new_cues; `"append"` → current.cues+new_cues. Bump revision, persist EXACTLY like `update_attention_timeline` (in-memory `_pipelines` under lock + `repo.update_pipeline` / `_db_save_pipeline` fallback). Return the new document.
Client supplies durationMs + subtitleBoundariesMs (the editor already has them for snapping) — do NOT re-derive server-side; cue placement is low-stakes.
Test: template with size/zone/N layers → cues carry that zone, `width==size`, `len(layers)==template.layers`; revision conflict → 409.

## P1 — timeline editor: multi-layer + real upload + zone toggle + template picker
File `frontend/src/components/timeline-editor.tsx`. Current gaps (verify lines):
- Built on an `InterstitialSlide` abstraction flattening each cue to `cue.layers[0]` (~334); `updateCueLayer` only touches index 0 (~404-413); only "add" is `handleInsertSlide` = one new cue (~2446-2462); `emitSlides` maps slides→cues 1:1 (~320-389).
- Image input = raw "Image URL (advanced)" box (~3599-3606); above it a DECORATIVE non-wired tab bar `['Gallery','Upload','Products','Generate with AI','URL']` (~3596-3598).
Build:
1. **Multi-layer per cue**: let a cue hold/edit >1 layer. "+ image to this moment" affordance in the inspector; per-layer row (image, size, x/y, remove). Keep staggered `delayMs` so images pop one-by-one and stack (superimposed). Emit/save must round-trip ALL layers through the PUT (not just layers[0]).
2. **Real upload**: wire the Upload/Gallery tabs to an actual image source. FIND the existing mechanism first — there's an `ImagePickerDialog` (catalog-product scoped) and general asset upload; reuse, don't invent. Chosen asset URL fills `layer.assetUrl/assetId` (replaces the `pending:` placeholder).
3. **Zone toggle**: per-cue Behind / In front control writing `cue.zone` (renderer already honors it; preview should reflect it vs the subtitle div, which is `z-[50]`).
4. **Template picker**: pick a template (GET /attention-templates) + apply via the P0 route (pass the editor's known durationMs + subtitleBoundariesMs + chosen asset URLs), then reload the timeline. This is the "pick template → drop images → they spawn staggered/stacked at template size, behind/front, quick in/out" workflow.

## P2 — template editor screen (the "space" the user asked for)
A dedicated screen to create / edit / preview / save templates via the existing `/attention-templates` API. Controls: name, strategy (count | everySeconds), count/everySeconds, durationMs, layers, size, zone, animation preset, sfx. LIVE PREVIEW of the layout (call the same cascade logic as `layout_positions`) on a mock 9:16 frame so the user sees size + stacking before saving. Wire into the app nav / Step 3 per repo idioms. `is_system` templates are read-only; personal ones full CRUD.

## Data shapes (authoritative — mirror, don't diverge)
AttentionLayer: `{id, assetId, assetUrl?, x, y, width, height, zIndex, fit:"contain"|"cover", animation:{preset,enterMs,exitMs,delayMs,intensity}}`
AttentionCue: `{id, startMs, durationMs, layers: AttentionLayer[], zone:"behind"|"front", sfxAssetId?, sfxUrl?, sfxVolumeDb, templateId?}`
Template config: `{strategy, count, everySeconds, minimumGapMs, protectedStartMs, protectedEndMs, durationMs, animation, layers, size, zone, sfx, assetPool}`

## Verify / run
- Backend tests: from repo root, `PYTHONPATH=. venv/Scripts/python.exe -m pytest tests/test_attention_templates.py -q` (do NOT pass `-p no:cov` — pyproject sets `--cov` addopts that then error).
- ffmpeg in standalone scripts is NOT on PATH: `from app.ffmpeg_setup import _setup_ffmpeg_path; _setup_ffmpeg_path()` first.
- Run the app: `start-dev.bat` (backend 8000, web 3001, Electron frontend 3947). Backend runs WITHOUT `--reload` — restart it manually after backend code changes.
- Real overlay smoke (no full pipeline needed): generate a test clip + PNG with ffmpeg lavfi, call `apply_attention_timeline` on a `zone:"front"` cue with `keep_audio=True`, assert output != input and has both video+audio streams.

## Branch — work isolated (do this FIRST)
Before any edit: `git switch -c feat/attention-images` off the current `feat/timeline-transitions-v1` HEAD (it already contains the engine commits `13f2024` + `5160d99`, so they come along as ancestors). Do ALL work + commits on `feat/attention-images`.
Why: a PARALLEL session is actively committing X1 shell-parity work to `feat/timeline-transitions-v1` (commits `f209f34`, `c977991`, `5817570` interleave with the attention ones). Sharing that branch = commit races. Stay off it.
The working tree may carry pre-existing UNCOMMITTED changes from those parallel sessions — creating a branch does NOT remove them, and they must not end up in your commits. Stage only your attention files by explicit path (`git add <file>`), never `git add -A`/`.`; check each `git diff --cached` is yours. When touching `timeline-editor.tsx`, confirm the staged diff is only your change.

## Constraints / out-of-scope (binding)
- **NEVER `git push`** (push = deploy). Local commits only, on `feat/attention-images`.
- No new dependencies. Dark theme (lime primary). English copy.
- Do NOT change render z-order beyond the existing behind/front two-pass. Do NOT implement real pop/zoom/spin ffmpeg motion (that's preview-only CSS today; a separate goal) — fast fade in/out is the shipped motion.
- Additive JSON only (attention_timeline + template config are JSON) — NO DB migration.
- Keep `distribute_attention_cues` deterministic (existing tests assert determinism + SRT snapping).
