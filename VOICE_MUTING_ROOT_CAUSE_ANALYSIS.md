# Voice Muting Feature - Root Cause Analysis

**Date:** 2026-01-05
**Status:** ROOT CAUSE IDENTIFIED AND FIXED

## Problem Summary

Videos generated as variant_7, variant_8, variant_9 still contained audible voices despite the "Elimină vocea sursă" (mute source voice) checkbox being enabled in the UI.

## Root Cause

The `mute_source_voice` parameter was **NOT being sent to the backend** in the default workflow mode.

### Technical Details

#### Frontend Issue (library/page.tsx)

**Line 316:** Default workflow mode is `"video_only"`
```typescript
const [workflowMode, setWorkflowMode] = useState<"video_only" | "with_audio">("video_only");
```

**Lines 1155-1159:** `mute_source_voice` was ONLY sent when:
- Workflow mode is `"with_audio"` AND
- There is script text present

```typescript
// BEFORE (BROKEN):
if (workflowMode === "with_audio" && scriptText.trim()) {
    requestBody.tts_text = scriptText;
    requestBody.generate_tts = generateTts;
    requestBody.mute_source_voice = muteSourceVoice; // Only sent here!
}
```

**Result:** When generating videos in "video_only" mode (the default), the parameter was never included in the request body.

#### Backend Behavior (library_routes.py)

**Line 527:** The backend model has a default value
```python
class GenerateFromSegmentsRequest(BaseModel):
    mute_source_voice: bool = False  # Defaults to False if not provided
```

**Result:** When the parameter wasn't sent from the frontend, it defaulted to `False`, so voices were NOT muted.

## The Fix

### Changed File: `frontend/src/app/library/page.tsx`

**Lines 1148-1159:** Moved `mute_source_voice` to ALWAYS be sent, regardless of workflow mode:

```typescript
// AFTER (FIXED):
const requestBody: Record<string, unknown> = {
    variant_count: variantCount,
    selection_mode: selectionMode,
    target_duration: targetDuration,
    mute_source_voice: muteSourceVoice, // ALWAYS send this!
};

// Add TTS/Script data if workflow mode is with_audio
if (workflowMode === "with_audio" && scriptText.trim()) {
    requestBody.tts_text = scriptText;
    requestBody.generate_tts = generateTts;
}
```

### Added Debugging (library_routes.py)

Added comprehensive logging to trace the parameter flow:

1. **Endpoint entry** (line 547-549):
   - Logs when the endpoint is called
   - Logs the value of `mute_source_voice` received

2. **Voice detection start** (line 727-729):
   - Logs when voice detection begins
   - Confirms mute_source_voice is True

3. **Per-segment processing** (line 831-845):
   - Logs for each segment whether mute is enabled
   - Logs the audio filter being applied
   - Logs the FULL FFmpeg command

4. **FFmpeg command execution** (line 863-864):
   - Shows the exact command with all parameters

## How to Verify the Fix

1. **Check the logs** when generating new clips:
   ```bash
   tail -f logs/app.log | grep "MUTE DEBUG"
   ```

   You should see:
   ```
   [MUTE DEBUG] /generate-from-segments called for project xyz
   [MUTE DEBUG] Request parameters: variant_count=3, mute_source_voice=True
   [MUTE DEBUG] Project xyz: mute_source_voice=True
   [MUTE DEBUG] Starting voice detection for project xyz
   [MUTE DEBUG] Segment abc: mute_source_voice=True, file in voice_map=True
   [MUTE DEBUG] Found 2 overlapping voice intervals for segment
   [MUTE DEBUG] Applying audio filter: volume=0:enable='between(t,1.0,3.0)+between(t,5.0,7.0)'
   [MUTE DEBUG] FFmpeg command: ffmpeg -y -ss 10.5 -i /path/to/video.mp4 -t 5.0 -c:v libx264 -preset fast -af volume=0:enable='between(t,1.0,3.0)' -c:a aac -avoid_negative_ts make_zero /path/to/output.mp4
   ```

2. **Listen to new videos** (variant_10+) to confirm voices are muted

3. **Check the FFmpeg command** in logs includes `-af volume=0:enable='...'`

## Why the Isolated Tests Passed

The isolated FFmpeg tests in our debugging session worked because:
- We manually called the voice detection functions
- We manually constructed the FFmpeg commands with the `-af` filter
- We didn't test the FULL pipeline from UI → API → Generation

The actual generation pipeline in production had the parameter flow issue.

## Architecture Flow (Corrected)

```
UI Checkbox (muteSourceVoice=true)
    ↓
Frontend State (muteSourceVoice: true)
    ↓
API Request Body (ALWAYS includes mute_source_voice) ← FIXED HERE
    ↓
Backend Pydantic Model (receives mute_source_voice=true)
    ↓
_generate_from_segments_task(mute_source_voice=true)
    ↓
Voice Detection (Silero VAD detects voice timestamps)
    ↓
_get_overlapping_voice_mutes() (calculates overlaps)
    ↓
_build_mute_filter() (constructs FFmpeg filter)
    ↓
FFmpeg command with -af volume=0:enable='...'
    ↓
Clean output video WITHOUT voices
```

## Related Files

- `/mnt/c/OBSID SRL/n8n/edit_factory/frontend/src/app/library/page.tsx` (FIXED)
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py` (Added logging)
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/voice_detector.py` (Working correctly)

## Next Steps

1. Restart the frontend development server to apply the fix
2. Generate NEW clips (variant_10+) with the checkbox enabled
3. Monitor logs for `[MUTE DEBUG]` messages
4. Verify that new videos have voices muted
5. If still not working, check logs to see where the flow breaks

## Notes

- The fix is minimal and targeted
- The voice detection code was working correctly all along
- The issue was purely a parameter passing bug in the frontend
- Old clips (variant_1-9) cannot be retroactively fixed - they need to be regenerated
