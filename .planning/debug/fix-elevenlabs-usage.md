---
status: awaiting_human_verify
trigger: "Fix the ElevenLabs usage display on the Usage page — it shows hardcoded 'free Plan' data instead of real account info from the ElevenLabs API."
created: 2026-02-26T00:00:00Z
updated: 2026-02-26T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED — .env has old free-account API key, backend calls live API with that key, returns old account data
test: curl http://localhost:8000/api/v1/usage — returned {"tier":"free","characters_used":469,"characters_limit":10000}
expecting: user provides new paid account API key so we can update .env
next_action: user updates ELEVENLABS_API_KEY in .env to new paid account key

## Symptoms

expected: Usage page shows user's actual ElevenLabs subscription plan (paid), real character usage, and real remaining characters
actual: Shows "free Plan" with 469/10,000 characters — stale data from old free account
errors: No errors — just wrong/hardcoded data
reproduction: Go to /usage page, look at the ElevenLabs TTS section
started: When user switched to a paid ElevenLabs account

## Eliminated

- hypothesis: frontend hardcodes values
  evidence: frontend calls /api/v1/usage and renders the response dynamically (page.tsx lines 118-127)
  timestamp: 2026-02-26

- hypothesis: backend endpoint doesn't call live API
  evidence: routes.py lines 117-146 make a live httpx GET to https://api.elevenlabs.io/v1/user/subscription
  timestamp: 2026-02-26

- hypothesis: some caching layer returns stale data
  evidence: live curl to /api/v1/usage returns real-time data from ElevenLabs (469/10000/free) — no cache
  timestamp: 2026-02-26

## Evidence

- timestamp: 2026-02-26
  checked: frontend/src/app/usage/page.tsx lines 114-127
  found: page fetches /api/v1/usage and renders usageStats.elevenlabs.tier, characters_used, etc. dynamically
  implication: frontend is correct — not the source of the bug

- timestamp: 2026-02-26
  checked: app/api/routes.py lines 101-162
  found: /usage endpoint makes live httpx call to ElevenLabs /v1/user/subscription with settings.elevenlabs_api_key
  implication: backend code is correct — fetches live data

- timestamp: 2026-02-26
  checked: curl http://localhost:8000/api/v1/usage
  found: {"characters_used":469,"characters_limit":10000,"tier":"free",...}
  implication: live call is working but returning old account data

- timestamp: 2026-02-26
  checked: .env ELEVENLABS_API_KEY value
  found: key sk_0d8cd0232ea35f14c8b64d9864f566462f39cd9c2793ff46 — this is the old free account key
  implication: ROOT CAUSE — .env has old API key, all live API calls (usage + TTS generation) use old account

## Resolution

root_cause: .env file has ELEVENLABS_API_KEY set to the old free account key (sk_0d8cd0232ea35f14c8b64d9864f566462f39cd9c2793ff46). The backend code is correct — it calls the live ElevenLabs API — but it authenticates as the old free account, so all subscription data and TTS calls go to that account.
fix: Update ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env to the new paid account credentials
verification: After updating .env and restarting backend, curl /api/v1/usage should return tier=paid/creator/starter with higher character limits
files_changed: [".env"]
