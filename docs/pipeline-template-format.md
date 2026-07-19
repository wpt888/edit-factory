# Pipeline template export/import

Pipeline templates are portable JSON files with the format identifier
`edit-factory.pipeline-template` and an explicit `schemaVersion`. They contain
the pipeline configuration and authored content, but never credentials,
profile ownership, running jobs, generated audio/video files, or output paths.

## Maintenance contract

The canonical frontend contract is
`frontend/src/app/pipeline/pipeline-template.ts` (`PipelineTemplateSettings`).
Every new user-configurable pipeline option must be added to that interface and
to both sides of the capture/apply pair in `frontend/src/app/pipeline/page.tsx`:

- `capturePipelineTemplateSettings()` writes the live value to the file.
- `applyPipelineTemplateSettings()` restores the value after import or reload.

Settings must live in one of the seven required sections: `generation`,
`content`, `voice`, `assembly`, `timeline`, `subtitles`, or `render`. Do not add
a second ad-hoc export endpoint or a separate template storage column for a new
option. The backend stores the entire structure in
`editai_pipelines.template_settings`, and unknown nested fields are retained for
forward compatibility.

When the meaning or shape of existing fields changes incompatibly, increment
`PIPELINE_TEMPLATE_SCHEMA_VERSION` in both
`app/services/pipeline_template_bundle.py` and `pipeline-template.ts`, then add
an explicit migration path before accepting the new version.

## Portability and safety

The backend validates required sections, file size, schema version and SHA-256
checksum. Keys that look like API keys, tokens, passwords, credentials, or
authorization data are rejected recursively.

Media bindings are profile-scoped. Source videos are rebound by owned ID or
exact name. A foreign or missing source stays listed under
`assembly.unresolvedSourceVideos`, is not activated, and produces an import
warning. The original JSON still contains the full source reference so it can
be inspected or retried after the recipient adds the matching media.

## Version 1 coverage

Version 1 includes generation inputs and AI options, scripts and their names,
voice and pacing controls, source bindings, assembly policy, selected variants,
match/composition timelines, slides, attention layers, thumbnails and PiP
overlays, default and per-Meta subtitle styles, encoding configuration, output
preset, picture/audio adjustments, Meta multiplication, generated captions and
YouTube titles.
