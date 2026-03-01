---
phase: 50
plan: 50-02
name: Setup Wizard Frontend + Settings Link
subsystem: frontend
tags: [setup-wizard, onboarding, license, api-keys, crash-reporting, settings]
dependency_graph:
  requires: [50-01]
  provides: [WIZD-01, WIZD-02, WIZD-03, WIZD-04, WIZD-05, WIZD-06]
  affects: [frontend/src/app/setup, frontend/src/components/navbar-wrapper.tsx, frontend/src/app/settings/page.tsx]
tech_stack:
  added: []
  patterns: [useState-stepper, async-post-no-body, apiError-instanceof, edit-mode-prefill]
key_files:
  created:
    - frontend/src/app/setup/page.tsx
  modified:
    - frontend/src/components/navbar-wrapper.tsx
    - frontend/src/app/settings/page.tsx
decisions:
  - Setup wizard uses useState with currentStep (1/2/3) — no stepper library needed
  - Non-desktop mode shows informational fallback card — wizard is desktop-only
  - Edit mode (?mode=edit) skips first-run guard and pre-fills values from GET /settings
  - Empty API key fields excluded from settings payload to avoid overwriting existing values
metrics:
  duration: 15 minutes
  completed: "2026-03-01T13:14:30Z"
  tasks_completed: 3
  files_changed: 3
---

# Phase 50 Plan 02: Setup Wizard Frontend + Settings Link Summary

3-step wizard at `/setup` with license activation, API key configuration, and crash reporting consent — plus navbar hiding and Settings page entry point.

## What Was Built

### Task 1: Hide navbar on /setup
Added `/setup` to `hideNavbarPaths` in `navbar-wrapper.tsx`. The wizard is a full-screen onboarding experience — the navbar should not appear.

### Task 2: Create /setup page (Setup Wizard)
Created `frontend/src/app/setup/page.tsx` as a 3-step wizard:

**Step 1 — License Activation:**
- License key input field with Enter key support
- Calls `POST /desktop/license/activate` with `{ license_key }`
- Shows success Alert and auto-advances to step 2 after 800ms
- Shows error Alert on failure with message from `ApiError.detail`

**Step 2 — API Configuration:**
- Supabase URL + Anon Key (required, marked with asterisk)
- Gemini API Key (optional)
- ElevenLabs API Key (optional)
- Each key has inline "Test" button calling `POST /desktop/test-connection`
- Test button shows spinner/check/error icons based on status state
- Back button disabled in edit mode (license already validated)

**Step 3 — Preferences:**
- Crash reporting Switch defaulting to OFF
- Description of what data is collected (error messages, stack traces, OS version; no video content or API keys)
- Finish/Save Changes button calling `handleFinish`

**First-run guard:**
- Calls `POST /desktop/license/validate` (no body) on mount
- 200 response → redirect to `/librarie` (already set up)
- 404 response → stay on wizard (first run)
- 403 response → show re-activation error message in Step 1
- Any other error → stay on wizard (assume first run)
- Only runs when `NEXT_PUBLIC_DESKTOP_MODE === "true"` and NOT in edit mode

**Edit mode (`?mode=edit`):**
- Skips first-run guard entirely
- Pre-fills from `GET /desktop/settings`
- Sets hints for redacted keys (shows "Current: ***xxxx" label)
- Starts at step 2 (license already valid)
- `handleFinish` skips `POST /first-run/complete` call

**handleFinish:**
1. Builds settings payload with only non-empty trimmed values (avoids overwriting existing keys)
2. Always includes `crash_reporting_enabled` boolean
3. Calls `POST /desktop/settings` with payload
4. Calls `POST /desktop/first-run/complete` (initial setup only)
5. Redirects to `/librarie`

**Non-desktop mode fallback:**
Renders a centered Card with Film icon and "The Setup Wizard is only available in desktop mode." message.

### Task 3: Settings page Setup Wizard link
Added "Setup Wizard" Card to `frontend/src/app/settings/page.tsx`:
- Gated on `process.env.NEXT_PUBLIC_DESKTOP_MODE === "true"` (invisible in web mode)
- Button links to `/setup?mode=edit` using Next.js `Link` with `Button asChild`
- Positioned before the version footer display

## Verification Results

All must_haves satisfied:
- `/setup/page.tsx` exists as 3-step wizard
- First-run guard: POST /license/validate with correct 200/404/403 behavior
- Step 1: license activation with success/error feedback
- Step 2: Supabase (required), Gemini + ElevenLabs (optional) with Test buttons
- Step 3: crash reporting Switch OFF by default with data description
- Finish: non-empty keys only, first-run/complete (initial only), redirect
- Edit mode: skips guard, pre-fills, starts at step 2
- Settings page: Setup Wizard card (desktop only) linking to /setup?mode=edit
- Navbar hidden: /setup in hideNavbarPaths
- Empty fields excluded from settings payload

Playwright screenshots taken and verified:
- `/setup` in non-desktop mode shows correct fallback card with Film icon, navbar hidden
- `/settings` page renders correctly with all existing sections intact

## Commits

- `7bcf14a` feat(50-02): hide navbar on /setup page
- `805cc65` feat(50-02): create Setup Wizard at /setup page
- `d721919` feat(50-02): add Setup Wizard link to Settings page

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

Files verified:
- FOUND: frontend/src/app/setup/page.tsx
- FOUND: frontend/src/components/navbar-wrapper.tsx (modified)
- FOUND: frontend/src/app/settings/page.tsx (modified)

Commits verified:
- FOUND: 7bcf14a (navbar-wrapper)
- FOUND: 805cc65 (setup/page.tsx)
- FOUND: d721919 (settings link)
