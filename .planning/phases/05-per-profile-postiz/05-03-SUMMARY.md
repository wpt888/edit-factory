# Phase 5 Plan 03: Cost Quota and Dashboard API Summary

**Completed:** 2026-02-04
**Duration:** ~3 minutes
**Commits:** 3

## One-liner

Monthly cost tracking with quota enforcement at TTS generation + profile dashboard API for activity visibility.

## What Was Built

### 1. Monthly Cost Calculation (cost_tracker.py)

Added two new methods to CostTracker class:

- `get_monthly_costs(profile_id)` - Returns current calendar month's total costs for a profile
- `check_quota(profile_id, monthly_quota)` - Returns tuple (exceeded, current_costs, quota)

Both methods support Supabase as primary storage with local JSON fallback.

```python
# Example usage
tracker = get_cost_tracker()
monthly = tracker.get_monthly_costs("profile-uuid")  # Returns: 4.52
exceeded, current, quota = tracker.check_quota("profile-uuid", 10.0)  # Returns: (False, 4.52, 10.0)
```

### 2. Quota Enforcement (tts_routes.py)

Added quota check to POST `/tts/generate` endpoint:

- Checks `monthly_quota_usd` from profile before starting TTS job
- Returns HTTP 402 (Payment Required) when quota exceeded
- Response includes `error: "quota_exceeded"`, `current_costs`, and `monthly_quota`
- Graceful degradation: continues without blocking if quota check fails

```python
# Response on quota exceeded
{
    "detail": {
        "error": "quota_exceeded",
        "message": "Monthly quota exceeded. Current: $10.50, Quota: $10.00",
        "current_costs": 10.5,
        "monthly_quota": 10.0
    }
}
```

### 3. Profile Dashboard Endpoint (profile_routes.py)

Added GET `/profiles/{profile_id}/dashboard`:

- Time range filter: `7d`, `30d`, `90d`, `all`
- Returns project/clip counts from `editai_projects`/`editai_clips`
- Counts rendered clips (`final_status = 'completed'`)
- Cost breakdown: ElevenLabs, Gemini, total, monthly, quota, quota_remaining

```python
# Example response
{
    "profile_id": "uuid",
    "time_range": "30d",
    "stats": {
        "projects_count": 5,
        "clips_count": 23,
        "rendered_count": 18
    },
    "costs": {
        "elevenlabs": 3.45,
        "gemini": 1.20,
        "total": 4.65,
        "monthly": 4.65,
        "monthly_quota": 10.0,
        "quota_remaining": 5.35
    }
}
```

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| a620c2d | feat | Add monthly cost calculation and quota check to CostTracker |
| b0c9979 | feat | Add quota enforcement to TTS generation endpoint |
| 805fcb0 | feat | Add profile dashboard endpoint |

## Files Modified

| File | Changes |
|------|---------|
| `app/services/cost_tracker.py` | Added `get_monthly_costs()` and `check_quota()` methods |
| `app/api/tts_routes.py` | Added quota check before TTS job creation |
| `app/api/profile_routes.py` | Added `/profiles/{profile_id}/dashboard` endpoint |

## Key Links Verified

- `app/api/tts_routes.py` -> `app/services/cost_tracker.py` via `check_quota()` call
- `app/api/profile_routes.py` -> Supabase `editai_projects`/`editai_clips` via count queries

## Deviations from Plan

### Deviation 1: Quota enforcement in tts_routes.py instead of routes.py

**Reason:** The plan referenced `app/api/routes.py`, but the actual TTS generation endpoint (`/tts/generate`) is in `app/api/tts_routes.py`. Added quota enforcement to the correct file.

### Deviation 2: Updated get_all_entries to accept profile_id

**Rule 2 - Missing Critical:** While adding `get_monthly_costs()`, noticed `get_all_entries()` didn't support profile filtering. Added `profile_id` parameter for consistency with other methods.

## Success Criteria Met

- [x] CostTracker.get_monthly_costs() calculates current month's costs per profile
- [x] CostTracker.check_quota() returns exceeded status, current costs, and quota
- [x] TTS generate endpoint returns 402 when quota exceeded
- [x] Dashboard endpoint returns project/clip counts and cost breakdown
- [x] Dashboard includes monthly costs, quota, and remaining balance

## Integration Points

**Frontend can now:**
1. Display quota status on Settings page (from dashboard endpoint)
2. Show "Quota Exceeded" error when TTS generation fails with 402
3. Display monthly spend vs quota in profile switcher

**Backend provides:**
1. Pre-check before expensive API calls (TTS generation)
2. Activity visibility per profile for multi-tenant awareness
