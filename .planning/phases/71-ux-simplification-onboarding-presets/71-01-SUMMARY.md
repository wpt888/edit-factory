---
phase: 71-ux-simplification-onboarding-presets
plan: 01
subsystem: ui
tags: [setup-wizard, tts, edge-tts, onboarding, validation]

requires:
  - phase: 69-key-vault-tts-fallback
    provides: KeyVault encrypted storage and Edge TTS fallback
provides:
  - Free TTS preset button in setup wizard Step 2
  - Auto-validation on blur for API key fields
  - tts_provider field in desktop settings endpoint
affects: [71-02-caption-presets]

tech-stack:
  added: []
  patterns: [preset-selection-card, onblur-auto-validation]

key-files:
  created: []
  modified:
    - frontend/src/app/setup/page.tsx
    - app/api/desktop_routes.py

key-decisions:
  - "Free TTS preset uses clickable card UI pattern with green border/bg when selected"
  - "tts_provider stored in config.json (non-key setting) not vault"
  - "Next button gated on Supabase status or existing hint (edit mode)"

patterns-established:
  - "Preset card: clickable div with border highlight and checkmark for selection state"
  - "Auto-validate on blur: onBlur handler triggers testConnection if field non-empty and status idle"

requirements-completed: [UX-03]

duration: 7min
completed: 2026-03-09
---

# Phase 71 Plan 01: Free TTS Preset and Setup Wizard Validation Summary

**Free TTS (Edge TTS) preset card in setup wizard with auto-validation on blur for API key fields and tts_provider backend persistence**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-09T06:54:32Z
- **Completed:** 2026-03-09T07:01:37Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Setup wizard Step 2 now shows a prominent "Use Free TTS (Edge TTS)" preset card at the top
- Clicking Free TTS dims ElevenLabs section and shows green indicator with toggle to expand back
- Gemini and ElevenLabs key fields auto-validate on blur (no manual Test button click needed)
- Next button properly gated on Supabase validation (required) while ElevenLabs is optional
- tts_provider preference persisted to backend config.json via POST /desktop/settings
- GET /desktop/settings returns tts_provider for edit mode pre-fill

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Free TTS preset and auto-validation to setup wizard** - `7c4c07d` (feat)
2. **Task 2: Add tts_provider to desktop settings endpoint** - `79ad570` (feat)

## Files Created/Modified
- `frontend/src/app/setup/page.tsx` - Added Free TTS preset card, onBlur auto-validation, Next button gating, tts_provider in settings payload
- `app/api/desktop_routes.py` - Added tts_provider field to DesktopSettingsUpdate model and GET response

## Decisions Made
- Free TTS preset uses a clickable card with green border/background when selected (matches existing UI patterns)
- tts_provider is a non-key setting stored in config.json alongside crash_reporting_enabled
- Next button is disabled when supabaseStatus is not "ok" AND no supabaseHint exists (allows edit mode to proceed)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Free TTS preset is functional; users can skip ElevenLabs key entry entirely
- Ready for 71-02 caption presets plan
- tts_provider field available for future TTS routing logic

---
*Phase: 71-ux-simplification-onboarding-presets*
*Completed: 2026-03-09*
