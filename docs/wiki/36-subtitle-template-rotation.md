# Subtitle-template rotation

Date: 2026-07-20 · Branch: `feat/subtitle-template-rotation`

## Purpose

Step 3 can assign an ordered set of reusable subtitle presets to script
variants. Assignment is deterministic and based only on the zero-based script
index:

```text
assignedPreset = presetIds[variantIndex % presetIds.length]
```

For ten variants and four presets this produces `1,2,3,4,1,2,3,4,1,2`.
Presets beyond the number of variants are simply unused. Disabling rotation or
using an empty list preserves the previous single-style behavior.

## Template and pipeline state

The existing profile-level `UserSubtitlePreset` remains the only caption
template entity. It now has optional `wordsPerSubtitle` (`1..20`) alongside its
full `SubtitleSettings`. Existing presets without the field use the pipeline's
global word count.

The pipeline stores:

```json
{
  "subtitles": {
    "rotation": {
      "enabled": true,
      "presetIds": ["preset-a", "preset-b"]
    },
    "variantOverrides": {
      "0_A": {"textColor": "#A3E635"}
    }
  }
}
```

Rotation lives under `template_settings.subtitles`, so the same ordered config
is included in `PipelineTemplateSettings` exports and restored on import. The
IDs refer to presets owned by the active profile; the rotation API rejects
duplicates and unavailable preset IDs. SQLite mirrors the existing Supabase
`profiles.user_subtitle_presets` JSON column additively.

## Style precedence

Rotation is orthogonal to Meta multiplication. Browser preview and final render
use the same shallow layering order:

1. pipeline default plus the rotated preset (base);
2. the matching Meta A/B layer, including the existing built-in fallback;
3. an optional card-local `PreviewKey` delta.

Card edits persist only the fields that differ from layer 1+2. This is
important: editing a reusable template still updates every assigned card, while
the explicitly changed property on an overridden card remains local. “Reset to
template” removes that delta. With rotation disabled, the old A/B/default path
is unchanged.

## Cue regrouping decision

Per-template word counts are applied at preview assembly and final render from
the character timings already returned by ElevenLabs and persisted in
`tts_previews.tts_timestamps`. The audio file is reused; only SRT cue boundaries
are rebuilt for the selected variant/template. No second TTS provider call is
made.

The render request carries `words_per_subtitle_by_key`. Each job resolves its
exact `PreviewKey`, then its base script key, then the legacy global fallback.
Cached SRT is reused only when its word count and karaoke mode match; otherwise
the persisted timings generate a new SRT, including `\k` tags when the assigned
template enables karaoke. Pipelines created before timing persistence may still
need the existing fallback regeneration once because there is no timing data to
regroup.

## Step 3 UI

The lazy Subtitle Style inspector contains a “Template rotation” section with:

- on/off toggle;
- ordered preset rows with add, remove, replace, move-up and move-down controls;
- per-template word count and template editor;
- an assigned-template badge on every variant card;
- card-local Override and Reset to template actions.

Editing a template updates the profile preset optimistically, persists it via
`PUT /profiles/{profile}/subtitle-presets/{preset}`, and schedules preview
reassembly for every assigned variant.

## Verification

- Backend: `778 passed, 1 skipped, 18 xfailed` (`pytest tests/`).
- Frontend: `npm run typecheck` and `npm run build` passed; all 30 Next routes
  were generated and standalone assets copied.
- Playwright: four rotation tests cover modulo assignment, leftover presets,
  per-template word counts, delta inheritance, Step 3 controls and badges.
- Real FFmpeg smoke: three variants with a two-template rotation. Variants 1
  and 3 render two-word green karaoke cues; variant 2 renders four-word static
  captions with a different size, colour and position. Frame hashes confirm
  `1 == 3` and `1 != 2`.
- A service-level test supplies persisted audio/timings and fails if the TTS
  method is called, proving regrouping does not regenerate voice-over audio.

Artifacts:

- `frontend/screenshots/subtitle-template-rotation-step3-final.png`
- `output/subtitle-rotation-smoke-final/subtitle-rotation-render-smoke.png`
- `output/subtitle-rotation-smoke-final/variant-1-punchy.mp4`
- `output/subtitle-rotation-smoke-final/variant-2-clean.mp4`
- `output/subtitle-rotation-smoke-final/variant-3-punchy.mp4`

The backend runs without reload and must be restarted after deployment.
