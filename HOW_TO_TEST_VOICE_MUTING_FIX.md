# How to Test the Voice Muting Fix

## What Was Fixed

The "Elimină vocea sursă" checkbox was not working because the `mute_source_voice` parameter was only being sent to the backend when in "with_audio" mode. Now it's ALWAYS sent, regardless of workflow mode.

## Steps to Test

### 1. Restart the Frontend

The frontend code has been updated, so you need to restart it:

```bash
cd frontend
npm run dev
```

### 2. Monitor Backend Logs

In a separate terminal, watch the backend logs:

```bash
cd /mnt/c/OBSID\ SRL/n8n/edit_factory
tail -f logs/app.log | grep "MUTE DEBUG"
```

Or if using uvicorn directly, watch the console output.

### 3. Generate New Clips

1. Go to http://localhost:3000/library
2. Select your project
3. Go to the "Generare Clip-uri din Segmente" tab
4. **IMPORTANT:** Make sure "Elimină vocea sursă" checkbox is CHECKED ✅
5. Set variant count to 1 (for faster testing)
6. Click "Generează Clip-uri"

### 4. Check the Logs

You should see debug output like this:

```
[MUTE DEBUG] /generate-from-segments called for project 123abc
[MUTE DEBUG] Request parameters: variant_count=1, mute_source_voice=True
[MUTE DEBUG] Project 123abc: mute_source_voice=True
[MUTE DEBUG] Starting voice detection for project 123abc
Detecting voice in: /path/to/source_video.mp4
  Found 5 voice segments (12.3s total)
[MUTE DEBUG] Segment 456def: mute_source_voice=True, file in voice_map=True
[MUTE DEBUG] Found 2 overlapping voice intervals for segment
[MUTE DEBUG] Applying audio filter: volume=0:enable='between(t,1.234,3.456)+between(t,5.678,7.890)'
[MUTE DEBUG] FFmpeg command: ffmpeg -y -ss 10.5 -i /path/to/video.mp4 -t 5.0 -c:v libx264 -preset fast -af volume=0:enable='between(t,1.234,3.456)+between(t,5.678,7.890)' -c:a aac -avoid_negative_ts make_zero /path/to/output.mp4
```

### 5. Listen to the Generated Video

**CRITICAL:** The new clip will be **variant_10** or higher (depending on how many you've already generated).

1. Wait for generation to complete
2. Find the new clip in the library (it will have a higher variant number)
3. Play it and listen carefully
4. **The voices should be SILENT or significantly reduced**

### 6. What to Look For in Logs

✅ **GOOD - Fix is working:**
```
mute_source_voice=True
Starting voice detection
Found X voice segments
Applying audio filter: volume=0:enable='...'
FFmpeg command includes -af volume=0:enable='...'
```

❌ **BAD - Still broken:**
```
mute_source_voice=False  ← Should be True!
```

OR

```
No voice detected  ← Silero VAD might not be working
```

OR

```
FFmpeg command does NOT include -af  ← Filter not applied
```

## Common Issues

### Issue: mute_source_voice=False in logs

**Solution:** Make sure the checkbox is CHECKED in the UI before generating. If it's still False, check browser console for JavaScript errors.

### Issue: "No voice detected" but there clearly is voice

**Solution:**
- Check that PyTorch and Silero VAD are installed: `pip list | grep torch`
- Try lowering the threshold in `voice_detector.py` from 0.5 to 0.3
- Check that ffmpeg can extract audio: `ffmpeg -i input.mp4 -vn -ar 16000 test.wav`

### Issue: FFmpeg command doesn't include -af

**Solution:**
- Check that voice segments were actually detected
- Check that segments overlap with the clip being extracted
- Look for errors in voice detection earlier in the logs

## Comparing Old vs New

| Variant | Status |
|---------|--------|
| variant_7, 8, 9 | ❌ Have voices (generated with bug) |
| variant_10+ | ✅ Should NOT have voices (generated with fix) |

**NOTE:** You CANNOT fix old clips. They need to be regenerated.

## If Still Not Working

1. Share the FULL log output from `grep "MUTE DEBUG"`
2. Share the FULL FFmpeg command from logs
3. Share the generated video file so we can analyze it
4. Check if the checkbox state is being preserved in React state

## Success Criteria

✅ Logs show `mute_source_voice=True`
✅ Logs show voice segments detected
✅ Logs show FFmpeg command with `-af volume=0:enable='...'`
✅ Generated video has NO audible voices (or very quiet)
✅ Background music/sound effects still present (if any)
