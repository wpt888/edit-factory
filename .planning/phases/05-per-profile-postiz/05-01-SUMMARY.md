# Phase 5 Plan 1: Backend Profile-Aware Postiz Factory Summary

**Completed:** 2026-02-04
**Duration:** 3 minutes

## One-liner

Refactored Postiz service from global singleton to profile-aware factory with instance caching, database credential lookup, and cache invalidation on settings change.

## What Was Built

### Profile-Aware Postiz Factory (`app/services/postiz_service.py`)

Transformed the Postiz publishing service from a single global instance to a per-profile factory pattern:

- **Instance caching:** `_postiz_instances: Dict[str, PostizPublisher]` keyed by profile_id
- **Database lookup:** Loads credentials from `profiles.tts_settings.postiz` JSONB column
- **Graceful fallback:** Uses env vars (POSTIZ_API_URL/KEY) if profile has no config
- **Cache invalidation:** `reset_postiz_publisher(profile_id)` clears cached instance when credentials change

```python
# New signature - requires profile_id
publisher = get_postiz_publisher(profile_id)

# Cache invalidation when settings change
reset_postiz_publisher(profile_id)  # Clear specific profile
reset_postiz_publisher()  # Clear all profiles
```

### Updated Postiz Routes (`app/api/postiz_routes.py`)

All 6 endpoints now use profile-specific Postiz credentials:

- `GET /status` - Uses `is_postiz_configured(profile_id)` and profile publisher
- `GET /integrations` - Fetches integrations using profile's Postiz API key
- `POST /upload` - Uploads video using profile's Postiz account
- `POST /bulk-upload` - Bulk uploads with profile-specific credentials
- `POST /publish` - Background task uses `get_postiz_publisher(profile_id)`
- `POST /bulk-publish` - Background task uses profile-specific publisher

Added proper error handling for missing credentials (returns 400 with helpful message).

### Profile PATCH Endpoint (`app/api/profile_routes.py`)

New endpoint for partial profile updates that triggers cache invalidation:

```python
@router.patch("/{profile_id}")
async def patch_profile(profile_id, updates: ProfileSettingsUpdate):
    # Update profile including tts_settings
    # If tts_settings changed, invalidate Postiz cache
    if tts_settings_updated:
        reset_postiz_publisher(profile_id)
```

This ensures users see immediate effect when saving new Postiz credentials in Settings.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 9ee2d04 | feat | Refactor Postiz service to profile-aware factory |
| 8e9024e | feat | Update Postiz routes to use profile-specific publishers |
| 35c3859 | feat | Add PATCH endpoint with Postiz cache invalidation |

## Key Files Changed

| File | Change |
|------|--------|
| `app/services/postiz_service.py` | Factory pattern with profile_id parameter, instance caching, database lookup |
| `app/api/postiz_routes.py` | All endpoints pass profile_id, ValueError handling for missing credentials |
| `app/api/profile_routes.py` | New PATCH endpoint, ProfileSettingsUpdate model, cache invalidation |

## Technical Decisions

### 1. Lazy Database Lookup
Load Postiz credentials from database only when instance is first requested for a profile, then cache. This avoids unnecessary DB queries while ensuring fresh credentials on first use.

### 2. Environment Variable Fallback
If profile has no `tts_settings.postiz` config, fall back to global POSTIZ_API_URL/KEY. This maintains backward compatibility during migration to per-profile credentials.

### 3. ValueError for Missing Credentials
Routes catch `ValueError` from `get_postiz_publisher()` and return 400 status with clear message directing users to configure credentials in Settings page.

### 4. PATCH vs PUT for Settings
Added PATCH endpoint specifically for partial updates including tts_settings, keeping PUT endpoint for basic name/description updates. This follows REST conventions and enables targeted cache invalidation.

## Deviations from Plan

### Plan File Reference Correction

**Plan referenced:** `app/api/profiles_routes.py` (plural)
**Actual file:** `app/api/profile_routes.py` (singular)

The plan mentioned PATCH endpoint in a file that didn't exist. The correct file was `profile_routes.py` which had PUT but not PATCH. Added PATCH endpoint to the correct file.

## Verification Results

1. **Python imports:** All modules import successfully
2. **Old pattern eliminated:** `grep "get_postiz_publisher()"` returns no matches
3. **Function signature:** `get_postiz_publisher` now requires `profile_id` parameter

## Next Phase Readiness

Phase 5 Plan 2 (Frontend Postiz Settings UI) can proceed. The backend now:
- Accepts Postiz credentials via PATCH `/profiles/{id}` with tts_settings.postiz
- Loads credentials from database when publishing
- Invalidates cache on credential change

Frontend needs to add Postiz settings form to Settings page.
