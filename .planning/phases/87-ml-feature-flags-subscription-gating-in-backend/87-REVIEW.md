---
phase: 87-ml-feature-flags-subscription-gating-in-backend
reviewed: 2026-05-23T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - app/api/ml_gating.py
  - app/api/tts_routes.py
  - app/api/library_routes.py
  - tests/test_ml_gating.py
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: issues_found
---

# Phase 87: Code Review Report

**Reviewed:** 2026-05-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found (0 critical, 0 warning, 3 info)

## Summary

Phase 87 introduces ML-04 (412 when `<base_dir>/ml/.installed` is absent) and ML-05 (402 when JWT `subscription_tier` claim is below required tier). The implementation is correct and the five concerns raised in the review brief are all satisfied:

1. **JWT decode security** — `algorithms=["HS256"]` is pinned at `auth.py:71` and `audience="authenticated"` is enforced. `_TIER_ORDER.get(None, 0)` correctly treats a missing `subscription_tier` claim as rank 0, producing a fail-closed 402 when any gated tier is required. No algorithm-confusion vector exists. The double-decode concern (two call sites for `verify_jwt_token`) produces identical results given the same token, secret, and algorithm — no validity-skew risk.
2. **Body-field gating asymmetry** — `library_routes.py:1167-1170` is the only ML enforcement on `/generate-from-segments`. No `Depends(require_ml_installed(...))` exists on that route signature. The conditional `if request.mute_source_voice` before `_enforce_ml_installed("voice_mute")` prevents false 412s when `mute_source_voice=False`.
3. **Dev/desktop bypass parity** — `require_tier()` checks `settings.auth_disabled or settings.desktop_mode` (line 91) before any credential extraction, matching `auth.py:118` exactly. `verify_jwt_token` is never reached in dev mode.
4. **Test coverage** — 7 tests cover the required matrix: 412-missing-marker for clone and mute, 402-starter for clone, 200-pro for clone (gates pass), 200-mute-False positive control, dev-bypass via `auth_disabled`, dev-bypass via `desktop_mode`. One minor gap noted below.
5. **Path traversal in marker check** — `get_base_dir() / "ml" / ".installed"` uses only hardcoded suffix components. `get_base_dir()` reads env-controlled paths (APPDATA, XDG_CONFIG_HOME) only in desktop mode, and the operation is read-only `.exists()`. No write path to a user-controlled location exists — no tarslip-analogue.

Three minor info-level items are noted below.

## Info

### IN-01: Silent default to "pro" rank for unrecognized `min_tier` argument

**File:** `app/api/ml_gating.py:83`
**Issue:** `required_rank = _TIER_ORDER.get(min_tier, _TIER_ORDER["pro"])` silently treats any unrecognized string (e.g., a typo like `require_tier("Premium")`) as the maximum rank (`pro`). This will gate correctly but provides no feedback to the developer that the tier name is wrong — the route just becomes unexpectedly locked to pro-tier users.
**Fix:** Assert or raise at factory call time so misconfigurations surface immediately at startup or import time:
```python
def require_tier(min_tier: str) -> Callable:
    if min_tier not in _TIER_ORDER:
        raise ValueError(f"require_tier: unknown tier {min_tier!r}. Valid: {list(_TIER_ORDER)}")
    required_rank = _TIER_ORDER[min_tier]
    ...
```

### IN-02: Missing test for absent `subscription_tier` claim (claim=None branch)

**File:** `tests/test_ml_gating.py`
**Issue:** The `_mock_jwt_with_tier(monkeypatch, tier)` helper is exercised with `"starter"` and `"pro"` but never with `tier=None` (the `if tier is not None` branch at line 98 is the absent-claim case). The `_TIER_ORDER.get(None, 0)` path in `ml_gating.py:108` therefore has no dedicated test. The absent-claim path is the primary fail-closed guarantee for production tokens that predate the subscription_tier claim.
**Fix:** Add a test case:
```python
def test_clone_voice_402_when_tier_claim_absent(marker_present, force_production_mode, monkeypatch):
    """JWT has no subscription_tier claim → treated as free (rank 0) → 402."""
    _mock_jwt_with_tier(monkeypatch, None)  # tier=None → claim omitted from payload

    async def _run():
        async with httpx.AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as client:
            files = {"audio_file": ("sample.wav", io.BytesIO(b"fake-bytes"), "audio/wav")}
            data = {"voice_name": "test"}
            return await _post(
                client,
                "/api/v1/tts/clone-voice",
                files=files,
                data=data,
                headers={"Authorization": "Bearer fake-token"},
            )

    response = asyncio.run(_run())
    assert response.status_code == 402
    detail = response.json().get("detail", response.json())
    assert detail == {"error": "tier_insufficient", "requires_tier": "pro"}
```

### IN-03: Dev-bypass log level is DEBUG while auth.py uses WARNING

**File:** `app/api/ml_gating.py:92`
**Issue:** The bypass log at line 92 uses `logger.debug(...)`, while `auth.py:120-122` logs the same event at `logger.warning(...)`. In production deployments where the log level is INFO or above, a misconfigured `auth_disabled=True` or `desktop_mode=True` would produce no visible log output from the tier check bypass, making misconfiguration harder to detect.
**Fix:** Raise the log level to match `auth.py` convention:
```python
logger.warning("Tier check bypassed — auth_disabled=%s desktop_mode=%s",
               settings.auth_disabled, settings.desktop_mode)
```

---

_Reviewed: 2026-05-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
