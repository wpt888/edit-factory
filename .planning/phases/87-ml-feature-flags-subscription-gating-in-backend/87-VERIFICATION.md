---
phase: 87-ml-feature-flags-subscription-gating-in-backend
verified: 2026-05-23T12:00:00Z
status: passed
score: 6/6
overrides_applied: 0
re_verification: false
---

# Phase 87: ML Feature Flags + Subscription Gating (Backend) Verification Report

**Phase Goal:** Backend routes that require the ML bundle return `412 Precondition Failed` with a structured error when the `<base_dir>/ml/.installed` marker is absent. Routes that require Pro tier return `402 Payment Required` (or `412` with `requires_tier`) when the JWT's `subscription_tier` is below Pro.
**Verified:** 2026-05-23T12:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Calling a voice-mute or voice-clone route without the ML bundle installed returns 412 with `{"error": "ml_not_installed", "feature": "<name>"}` | VERIFIED | `_enforce_ml_installed()` in `ml_gating.py:48-51` raises exactly this body; `test_clone_voice_412_when_marker_missing` and `test_generate_from_segments_412_when_mute_true_and_marker_missing` both assert the exact JSON shape and pass |
| 2 | Calling a Pro-only feature with a Starter subscription claim returns 402 with `{"error": "tier_insufficient", "requires_tier": "pro"}` | VERIFIED | `require_tier()` in `ml_gating.py:110-115` raises exactly this body; `test_clone_voice_402_when_tier_below_pro` asserts the exact JSON shape and passes |
| 3 | POST /api/v1/tts/clone-voice without `<base_dir>/ml/.installed` returns 412 with `feature='voice_clone'` | VERIFIED | `tts_routes.py:369` — `_ml: None = Depends(require_ml_installed("voice_clone"))` wired at route signature; test `test_clone_voice_412_when_marker_missing` passes |
| 4 | POST /api/v1/library/projects/{id}/generate-from-segments with `mute_source_voice=True` and without `<base_dir>/ml/.installed` returns 412 with `feature='voice_mute'` | VERIFIED | `library_routes.py:1169-1170` — inline `if request.mute_source_voice: _enforce_ml_installed("voice_mute")` BEFORE `verify_project_ownership`; test `test_generate_from_segments_412_when_mute_true_and_marker_missing` passes |
| 5 | POST /api/v1/library/projects/{id}/generate-from-segments with `mute_source_voice=False` ignores the ML marker (no false 412) | VERIFIED | Inline pattern is conditional; anti-pattern check confirms `Depends(require_ml_installed("voice_mute"))` returns 0 matches in `library_routes.py`; `test_generate_from_segments_skips_ml_when_mute_false` passes |
| 6 | When `auth_disabled=True` or `desktop_mode=True`, `require_tier()` bypasses the tier check | VERIFIED | `ml_gating.py:91` — `if settings.auth_disabled or settings.desktop_mode: return` fires before any JWT extraction; `test_tier_bypass_when_auth_disabled` and `test_tier_bypass_when_desktop_mode` both pass |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/api/ml_gating.py` | Exports `require_ml_installed`, `require_tier`, `_enforce_ml_installed`, `_TIER_ORDER` | VERIFIED | 119 lines, all 4 names exported; Python import check + `ast.parse()` both pass; commit 07166c9 |
| `app/api/tts_routes.py` | `/clone-voice` route gated by BOTH `require_ml_installed("voice_clone")` AND `require_tier("pro")` | VERIFIED | Lines 369-370 contain both `Depends` parameters; commit 6121d5e |
| `app/api/library_routes.py` | `/generate-from-segments` route uses inline `_enforce_ml_installed("voice_mute")` when `mute_source_voice=True` | VERIFIED | Lines 1167-1170 confirm inline conditional placement BEFORE `verify_project_ownership`; commit 6121d5e |
| `tests/test_ml_gating.py` | 6+ pytest cases covering ML marker absence/presence × tier matrix + positive control | VERIFIED | 7 test cases; all 7 pass under `DATA_BACKEND=sqlite python -m pytest tests/test_ml_gating.py -x -q`; commit 8743389 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/api/ml_gating.py` | `app/config.py:get_base_dir` | `from app.config import get_base_dir, get_settings` + call at line 45 | WIRED | `get_base_dir() / "ml" / ".installed"` — exact path; re-evaluates per call (no cache) |
| `app/api/ml_gating.py` | `app/api/auth.py:verify_jwt_token` | `from app.api.auth import verify_jwt_token` (line 18) + call at line 106 | WIRED | Re-extracts JWT inside `require_tier`; `AuthUser` untouched |
| `app/api/tts_routes.py:clone_voice_endpoint` | `app/api/ml_gating.py:require_ml_installed + require_tier` | `Depends()` at route signature lines 369-370 | WIRED | Both guards present; `from app.api.ml_gating import require_ml_installed, require_tier` at line 15 |
| `app/api/library_routes.py:generate_from_segments` | `app/api/ml_gating.py:_enforce_ml_installed` | Inline call inside route body, conditional on `request.mute_source_voice` | WIRED | `from app.api.ml_gating import _enforce_ml_installed` at line 26; inline at lines 1169-1170 |

### Data-Flow Trace (Level 4)

Not applicable — this phase delivers gating/guard logic only (raises HTTPException or returns None). No dynamic data is rendered. The 412/402 response bodies are hardcoded structured constants, which is the correct behavior for guard modules.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 7 test cases pass | `DATA_BACKEND=sqlite python -m pytest tests/test_ml_gating.py -x -q` | `7 passed, 26 warnings in 4.86s` | PASS |
| Module imports cleanly | `python -c "from app.api.ml_gating import require_ml_installed, require_tier, _enforce_ml_installed, _TIER_ORDER; assert _TIER_ORDER == {'free': 0, 'starter': 1, 'pro': 2}; print('imports OK, _TIER_ORDER correct')"` | `imports OK, _TIER_ORDER correct` | PASS |
| All 4 files parse cleanly | `python -c "import ast; ast.parse(...)"` on all 4 | `all 4 files parse cleanly` | PASS |
| Anti-pattern absent | `Depends(require_ml_installed("voice_mute"))` in `library_routes.py` | 0 matches | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| ML-04 | 87-01-PLAN.md | Routes that require ML return `412 Precondition Failed` with `{"error": "ml_not_installed", "feature": "<name>"}` when the marker is absent | SATISFIED | `_enforce_ml_installed()` implements the 412 gate; wired to `/clone-voice` (unconditional Depends) and `/generate-from-segments` (inline conditional); 2 test cases verify both paths |
| ML-05 | 87-01-PLAN.md | Routes that require Pro tier return `402 Payment Required` when subscription claim is below Pro | SATISFIED | `require_tier("pro")` implements the 402 gate fail-closed; wired to `/clone-voice` route signature; `test_clone_voice_402_when_tier_below_pro` verifies the exact 402 body |

Note: REQUIREMENTS.md still shows ML-04/ML-05 as `[ ] Pending` — this is expected. The traceability table is updated at milestone audit, not per-phase verification. Both requirements are substantively satisfied by the code shipped in this phase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/api/ml_gating.py` | 83 | `_TIER_ORDER.get(min_tier, _TIER_ORDER["pro"])` silently treats unknown tier strings as "pro" | Info (IN-01 from code review) | No runtime impact in current usage; developer ergonomics only — typo in `require_tier()` call would silently become max restriction |
| `tests/test_ml_gating.py` | — | Missing test for `tier=None` (absent `subscription_tier` claim) — `_TIER_ORDER.get(None, 0)` branch is untested | Info (IN-02 from code review) | The fail-closed path for tokens predating Phase 95 is exercised implicitly (no-credentials path tested) but not dedicated |
| `app/api/ml_gating.py` | 92 | Bypass log uses `logger.debug` while `auth.py` uses `logger.warning` for same event | Info (IN-03 from code review) | Misconfigured `auth_disabled=True` in production would be silent at INFO log level |

All three are info-level. None blocks the phase goal. All were identified in the code review (87-REVIEW.md) and are documented there with suggested fixes for Phase 95.

### Human Verification Required

None. All gating behaviors are backend HTTP response codes verifiable by automated tests. The 7-case test suite covers the full matrix including positive controls and bypass modes. No UI, visual, real-time, or external-service behavior is involved in this phase.

### Gaps Summary

No gaps. All 6 observable truths are VERIFIED by a combination of static code analysis and a live test run (7/7 passing). The phase goal is fully achieved.

---

_Verified: 2026-05-23T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
