---
phase: 87-ml-feature-flags-subscription-gating-in-backend
plan: "01"
subsystem: ml-gating-backend
tags: [ml-gating, subscription-tier, fastapi-dependency, jwt, 412, 402]
requires:
  - phase: 86-ml-bundle-download-endpoint-ui
    artifact: "<base_dir>/ml/.installed marker written by desktop_ml_routes.py on successful install"
provides:
  - app/api/ml_gating.py: "require_ml_installed(feature) Depends factory → 412 when ML bundle absent"
  - app/api/ml_gating.py: "require_tier(min_tier) Depends factory → 402 when JWT sub-tier below required"
  - app/api/ml_gating.py: "_enforce_ml_installed(feature) bare fn for inline body-field gating"
  - app/api/ml_gating.py: "_TIER_ORDER dict {free:0, starter:1, pro:2} tier ranking"
  - app/api/tts_routes.py: "/clone-voice route gated by require_ml_installed('voice_clone') + require_tier('pro')"
  - app/api/library_routes.py: "/generate-from-segments inline _enforce_ml_installed('voice_mute') when mute_source_voice=True"
  - tests/test_ml_gating.py: "7 pytest cases covering ML-04/ML-05 matrix + positive controls + bypass"
affects:
  - phase: 95
    note: "Phase 95 (OAuth + Lemon Squeezy) will populate subscription_tier JWT claim; require_tier() already reads it fail-closed until then"
dependency_graph:
  requires: [86-ml-bundle-download-endpoint-ui]
  provides: [ml-gating-backend-module, 412-gate, 402-gate]
  affects: [phase-95-jwt-tier-claim]
tech_stack:
  added: []
  patterns:
    - "FastAPI Depends factory pattern for route-level gating"
    - "Inline body-field gating (body field triggers → call bare fn after body parse)"
    - "httpx.ASGITransport + asyncio.run() test pattern (Phase 86 LD-12)"
    - "dual JWT binding monkeypatch (ml_gating_module + auth_module)"
    - "autouse dependency_overrides fixture to short-circuit get_profile_context"
key_files:
  created:
    - app/api/ml_gating.py
    - tests/test_ml_gating.py
  modified:
    - app/api/tts_routes.py
    - app/api/library_routes.py
decisions:
  - id: dev-bypass-first
    summary: "require_tier() checks auth_disabled/desktop_mode BEFORE decoding JWT — matches auth.py:118-127 pattern, avoids JWT decode errors in dev mode"
  - id: authuser-untouched
    summary: "AuthUser dataclass NOT modified to carry subscription_tier — Phase 95 territory; require_tier re-decodes JWT independently"
  - id: body-field-asymmetry
    summary: "mute_source_voice is a request body field — FastAPI cannot read body in Depends(), so inline _enforce_ml_installed used instead of Depends(require_ml_installed())"
  - id: jwt-decode-duplication-accepted
    summary: "/clone-voice decodes JWT twice (get_profile_context + require_tier); acceptable for v1, consolidation deferred to Phase 95"
metrics:
  duration_minutes: 13
  completed_date: "2026-05-23T10:42:28Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 2
requirements_completed: [ML-04, ML-05]
---

# Phase 87 Plan 01: ML Feature Flags + Subscription Gating (Backend) Summary

**One-liner:** Backend ML-04/ML-05 gating via `app/api/ml_gating.py` — 412 when `<base_dir>/ml/.installed` absent, 402 when JWT `subscription_tier` below Pro, dev/desktop bypass, body-field asymmetry for voice-mute inline check.

## What Was Built

Three new exported callables in `app/api/ml_gating.py`:

1. `_enforce_ml_installed(feature)` — bare function, checks `get_base_dir() / "ml" / ".installed"`, raises `HTTPException(412, {"error": "ml_not_installed", "feature": feature})` if absent.
2. `require_ml_installed(feature)` — FastAPI Depends factory wrapping `_enforce_ml_installed`. Used at route signature level (unconditional gates).
3. `require_tier(min_tier)` — FastAPI Depends factory that reads `subscription_tier` from the raw JWT (re-extracted from Bearer token, bypassing AuthUser which drops non-standard claims). Raises `HTTPException(402, {"error": "tier_insufficient", "requires_tier": min_tier})` when below `_TIER_ORDER[min_tier]`. Bypasses check when `settings.auth_disabled` or `settings.desktop_mode` (matches `app/api/auth.py:118-127`).

Two routes patched:

- `/api/v1/tts/clone-voice` (`tts_routes.py`): Two new Depends parameters `_ml=Depends(require_ml_installed("voice_clone"))` + `_tier=Depends(require_tier("pro"))` at route signature.
- `/api/v1/library/projects/{id}/generate-from-segments` (`library_routes.py`): Inline `if request.mute_source_voice: _enforce_ml_installed("voice_mute")` after `settings.ensure_dirs()`, before `verify_project_ownership()`. Body-field asymmetry: FastAPI cannot read body in Depends() so the inline pattern is mandatory.

Seven pytest cases in `tests/test_ml_gating.py` — all pass under `DATA_BACKEND=sqlite`:
- `test_clone_voice_412_when_marker_missing` (ML-04 voice_clone)
- `test_generate_from_segments_412_when_mute_true_and_marker_missing` (ML-04 voice_mute)
- `test_generate_from_segments_skips_ml_when_mute_false` (positive control — no false 412)
- `test_clone_voice_402_when_tier_below_pro` (ML-05 tier gate)
- `test_tier_bypass_when_auth_disabled` (dev bypass)
- `test_tier_bypass_when_desktop_mode` (desktop bypass)
- `test_clone_voice_passes_gates_with_marker_and_pro` (E2E positive — gates don't block valid requests)

## Decisions Made

1. **Dev-bypass-first ordering**: `require_tier()` checks `auth_disabled`/`desktop_mode` before decoding JWT. In dev mode there is no JWT to decode; reversing the order would cause 500 ("Authentication not configured") before the bypass fires.

2. **AuthUser untouched**: `AuthUser` dataclass carries `id`, `email`, `role` only — no `subscription_tier`. Re-decoding the JWT inside `require_tier()` is the correct scope-limited approach for Phase 87; Phase 95 will consolidate.

3. **Body-field asymmetry**: `mute_source_voice` is parsed from the JSON body. FastAPI resolves `Depends()` before parsing the body, so using `Depends(require_ml_installed("voice_mute"))` would block ALL calls to `/generate-from-segments` regardless of `mute_source_voice` value. The inline check pattern is mandatory and intentional.

4. **JWT decode duplication accepted**: `/clone-voice` decodes the JWT twice per request (once in `get_profile_context` via `get_current_user`, once in `require_tier`). Acceptable overhead for v1 — Phase 95 will consolidate claim handling.

## Deviations from Plan

None — plan executed exactly as written. Pre-existing environment issues (missing `scipy`, `srt`, `anthropic`, `python-multipart`, `python-json-logger` packages) were resolved by installing them; these are runtime deps that were missing from the test environment, not caused by Phase 87 changes.

## Known Stubs

None — all gating logic is fully wired and functional. The `subscription_tier` JWT claim is intentionally absent until Phase 95 (Lemon Squeezy OAuth), which means production callers without the claim hit 402 (correct fail-closed behavior, documented in plan deferred section).

## Threat Flags

None — this phase adds gate logic that reduces attack surface (unauthorized ML feature access). No new network endpoints, file access patterns, or schema changes introduced.

## Self-Check: PASSED

All created files exist on disk. All task commits verified in git log.

| Item | Status |
|------|--------|
| app/api/ml_gating.py | FOUND |
| app/api/tts_routes.py | FOUND |
| app/api/library_routes.py | FOUND |
| tests/test_ml_gating.py | FOUND |
| 87-01-SUMMARY.md | FOUND |
| commit 07166c9 (Task 1) | FOUND |
| commit 6121d5e (Task 2) | FOUND |
| commit 8743389 (Task 3) | FOUND |
