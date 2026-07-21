# Goal: Subtitle template rotation — diverse captions per variant

Working directory: `C:\OBSID SRL\n8n\edit_factory` (Blipost desktop). Run this /goal from the edit_factory window.

READ FIRST — binding: the "CRITICAL — mixed line endings" recipe in @goals/attention-images-details.md applies to EVERY commit (rebuild per-line EOL from HEAD; stage by explicit path; `git diff --cached --stat` must show only real lines). The tree may contain unrelated WIP — NEVER stage files you did not change for this goal.

## Product intent (user's words, condensed)
More diversity per batch. A "caption template" = a full subtitle look (existing `SubtitleSettings`: font, colors, box, karaoke on/off, position, …) PLUS `words_per_subtitle` (today a single global number; templates may use 2, 3, or 4 words per cue). The user defines an ordered rotation of N templates; with 10 output variants and 4 templates the assignment is 1,2,3,4,1,2,3,4,1,2. Leftover templates simply don't fire — not an error.

ORTHOGONAL to Meta A/B: the A/B switch exists only so Facebook and Instagram get different-looking videos (anti-penalty). Do NOT merge rotation into A/B. Rotation picks the BASE template per variant (by variant/script index); when `metaMultiplication` is ON, the existing A/B override layer still applies on top per version. Keep that layering simple and document it in code where they meet.

Per-variant editing stays possible: selecting one variant and tweaking its style creates an override for THAT variant only (template stays untouched); a visible "reset to template" undoes it. Editing a template updates every variant currently assigned to it. No mass-edit beyond that.

## Where things live (verified 2026-07-20)
- Templates already exist as `UserSubtitlePreset` (per-profile, `/profiles/{id}/subtitle-presets`) — extend them with optional `wordsPerSubtitle` rather than inventing a new entity.
- Style already flows per-variant to render: `subtitleOverrides: Partial<Record<StyleKey, SubtitleSettings>>` + `getSubtitleSettingsFor` / `getPreviewSubtitleSettingsFor` in `frontend/src/app/pipeline/` (page.tsx + components/step3-preview.tsx), backend `SubtitleStyleConfig.from_dict` in `app/services/video_effects/subtitle_styler.py` (karaoke incl.).
- `words_per_subtitle` is currently GLOBAL: it drives SRT cue grouping at Step 2 (TTS/Whisper word timings). Trace this flow first (`pipeline_routes.py`, step2-tts.tsx, assembly). Per-template word count means the render (and ideally preview) must REGROUP cues from the stored word timings per variant — without re-running TTS. Verify word timings are persisted; if regroup-at-render is feasible, do that; if not, regroup at preview-assembly time. State your choice in the wiki entry.
- Rotation config must persist in pipeline state AND in `PipelineTemplateSettings` (pipeline-template.ts + `app/services/pipeline_template_bundle.py`) so exported pipeline templates carry it.

## UI (Step 3 inspector, keep lazy)
In the Subtitle Style card: a "Template rotation" section — ordered list of the profile's presets (add/remove/reorder, minimal UI), toggle rotation on/off. When ON, each variant card shows its assigned template name + an edit affordance (override / reset-to-template). When OFF, behavior is exactly today's. Optional inspiration for caption-setting UX: `CAPTIONS_AENEAS/` (standalone module in repo root) — inspiration only, no code sharing.

## Acceptance
1. `pytest tests/` green (needs `.env`), `npx tsc --noEmit` + `npm run build` (frontend/) green. New tests: rotation assignment math (i % N incl. leftover templates) and per-variant regroup of cues by wordsPerSubtitle.
2. Real render smoke: pipeline with ≥3 variants + 2-template rotation (different wordsPerSubtitle, one karaoke ON one OFF) → rendered outputs visibly differ in grouping and style.
3. Playwright screenshot of Step 3 showing rotation UI + per-variant template badges (MANDATORY per CLAUDE.md). Frontend on :3000 or :3005, backend 8001 AUTH_DISABLED.
4. Wiki: new page registered in `docs/wiki/00-index.md` + entry in `01-log.md`.

## Hard constraints
- **NEVER `git push`.** Work on a new branch `feat/subtitle-template-rotation` off the current HEAD. No new deps. Backend has no --reload — restart manually (port 8001 profile per repo scripts).
- Do not refactor SubtitleEditor's internal layout — that is a separate goal (07); touch it only where you must add wordsPerSubtitle to preset save/apply.

## Standing clauses
**A.** One logical change = one commit, conventional message, EOL recipe, no dirty tree beyond pre-existing WIP. Never push.
**B.** Docs at FULL completion only (wiki index + log + page); commit.
**C.** Return = data: what was built, decisions taken (esp. regroup-at-render vs at-preview), commits (hash+subject), test tails, screenshot paths.
**D.** Drive the running app for acceptance 3; report what you saw.
