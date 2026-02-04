# Phase 05 Plan 02: Frontend Postiz Configuration UI Summary

## One-liner
Settings page with Postiz Publishing card for URL/key inputs, show/hide toggle, connection test, and status indicator.

## What Was Built

### Settings Page Postiz Integration (`frontend/src/app/settings/page.tsx`)

Extended the existing Settings page with a complete Postiz configuration section:

1. **State Management:**
   - `postizUrl`, `postizKey`, `postizEnabled` - credential storage
   - `testingConnection` - loading state for connection test
   - `connectionStatus` - "idle" | "success" | "error" status
   - `showApiKey` - toggle for API key visibility

2. **TTSSettings Interface Extended:**
   ```typescript
   interface TTSSettings {
     provider: string
     voice_id: string
     voice_name?: string
     postiz?: {
       api_url: string
       api_key: string
       enabled: boolean
     }
   }
   ```

3. **Load Settings:**
   - Loads Postiz credentials from `profile.tts_settings.postiz` on mount
   - Falls back to empty strings if not configured

4. **Save Settings:**
   - Saves both TTS and Postiz settings in single `apiPatch` call
   - Stores under `tts_settings.postiz` in profile JSONB

5. **Test Connection Handler:**
   - Validates URL and key presence
   - Calls `GET /postiz/status` endpoint
   - Updates status indicator based on response
   - Shows integration count on success

6. **Postiz Publishing Card:**
   - API URL input with placeholder
   - API Key input with show/hide toggle (Eye/EyeOff icons)
   - Test Connection button with loading spinner
   - Status indicators (green "Connected" / red "Connection failed")
   - Visual credential status indicator (green/yellow dot)

7. **UI Structure:**
   - Moved Save button outside TTS card (saves both sections)
   - Success message updated to "(TTS and Postiz)"

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Store postiz under tts_settings | Reuses existing JSONB column, no schema change needed |
| Show/hide API key toggle | Security UX - default masked, optional reveal |
| Test uses /postiz/status | Uses existing backend endpoint for validation |
| Single Save button | UX simplicity - saves all settings at once |
| Visual status indicator | Clear feedback on credential state |

## Deviations from Plan

None - plan executed exactly as written. Tasks 1 and 2 were combined into single commit since they form atomic feature.

## Verification Results

- [x] Build succeeds: `npm run build` completed successfully
- [x] Postiz Publishing section exists: Line 293 `<CardTitle>Postiz Publishing</CardTitle>`
- [x] Eye icons imported and used: Lines 13, 329
- [x] apiPatch includes postiz settings: Lines 129-133

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/app/settings/page.tsx` | +148/-11 lines - Added Postiz configuration card |

## Commit History

| Hash | Message |
|------|---------|
| 5a20563 | feat(05-02): add Postiz configuration section to Settings page |

## Performance

- Duration: ~7 minutes
- Tasks: 2/2 complete
- Build time: 16.2s

## Next Phase Readiness

**Ready for 05-03:** Backend reads profile Postiz credentials

Prerequisites met:
- UI can capture and save Postiz credentials
- Credentials stored in `tts_settings.postiz` JSONB
- Test Connection endpoint available for validation
