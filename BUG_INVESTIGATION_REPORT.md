# Comprehensive Bug Investigation Report
## Edit Factory - Deep Dive Analysis

**Date:** 2026-01-04
**Investigator:** Claude Code (Debug Specialist)
**Scope:** Voice Detection, Video Processing, FFmpeg Integration, Job Tracking, Frontend-Backend Communication

---

## Executive Summary

This report details findings from a comprehensive investigation of the Edit Factory video processing platform. **One critical bug was discovered** that prevents the voice muting feature from working when generating clips from segments. Additionally, several potential issues and areas of concern were identified across the codebase.

---

## 🔴 CRITICAL BUG #1: Voice Muting Not Applied in Segment Generation

### Description
When users click "GENEREAZĂ X VARIANTE DIN SEGMENTE" with the voice muting checkbox enabled, the `mute_source_voice` parameter is correctly sent to the backend but **is never applied during video processing**.

### Root Cause
The `_generate_from_segments_task()` function in `app/api/library_routes.py` receives the `mute_source_voice` parameter (line 616) but **does not pass it to the FFmpeg video extraction commands**.

### Evidence Trail

1. **Frontend sends correct payload:**
   ```typescript
   // frontend/src/app/library/page.tsx:1158
   requestBody.mute_source_voice = muteSourceVoice;
   ```

2. **Backend receives parameter:**
   ```python
   # app/api/library_routes.py:527
   class GenerateFromSegmentsRequest(BaseModel):
       mute_source_voice: bool = False
   ```

3. **Parameter is passed to background task:**
   ```python
   # app/api/library_routes.py:596
   background_tasks.add_task(
       _generate_from_segments_task,
       # ... other params ...
       mute_source_voice=request.mute_source_voice,
   )
   ```

4. **❌ BUG: Parameter is NOT used in video processing:**
   ```python
   # app/api/library_routes.py:735-761
   # FFmpeg commands for segment extraction and concatenation
   # DO NOT include any voice detection or audio filtering!
   extract_cmd = [
       "ffmpeg", "-y",
       "-ss", str(seg["start_time"]),
       "-i", seg["file_path"],
       "-t", str(seg["duration"]),
       "-c:v", "libx264", "-preset", "fast",
       "-c:a", "aac",  # ← No audio filtering!
       # ... rest of command
   ]
   ```

### Expected Behavior
When `mute_source_voice=True`:
1. Detect voice segments using Silero VAD (VoiceDetector)
2. Calculate overlapping voice intervals for each video segment
3. Build FFmpeg audio filter using `_build_mute_filter()`
4. Apply filter with `-af "volume=0:enable='between(t,X,Y)...'"` during segment extraction

### Comparison: Working Implementation
The `video_processor.py` service DOES implement voice muting correctly:

```python
# app/services/video_processor.py:1529-1544
if mute_source_voice:
    report_progress("Detecting voice in source video")
    detector = VoiceDetector(threshold=0.5, min_speech_duration=0.25)
    voice_segments = detector.detect_voice(video_path)

    if voice_segments:
        logger.info(f"Detected {len(voice_segments)} voice segments")
        # Voice segments are then passed to extract_segments()
```

```python
# app/services/video_processor.py:659-667
if voice_segments:
    overlapping_mutes = self._get_overlapping_voice_mutes(
        seg.start_time, seg.end_time, voice_segments
    )
    if overlapping_mutes:
        audio_filter = self._build_mute_filter(overlapping_mutes)
        logger.info(f"Segment {i+1}: Muting {len(overlapping_mutes)} voice portions")
```

### Impact
- **Severity:** HIGH
- **User Impact:** Voice muting feature completely non-functional for segment-based generation
- **Workaround:** None (feature simply doesn't work)

### Recommended Fix
Modify `_generate_from_segments_task()` to implement voice detection and muting:

```python
async def _generate_from_segments_task(
    project_id: str,
    segments: List[dict],
    variant_count: int,
    selection_mode: str,
    target_duration: int,
    tts_text: Optional[str],
    mute_source_voice: bool,
    start_variant_index: int = 1
):
    # ... existing code ...

    # ADD: Voice detection if enabled
    voice_segments_by_file = {}
    if mute_source_voice:
        from app.services.voice_detector import VoiceDetector
        detector = VoiceDetector(threshold=0.5, min_speech_duration=0.25)

        # Detect voice for each unique source video
        unique_files = {seg['file_path'] for seg in available_segments}
        for file_path in unique_files:
            try:
                voice_segments = detector.detect_voice(Path(file_path))
                voice_segments_by_file[file_path] = voice_segments
                logger.info(f"Detected {len(voice_segments)} voice segments in {file_path}")
            except Exception as e:
                logger.error(f"Voice detection failed for {file_path}: {e}")

    # ... in segment extraction loop ...

    # ADD: Build audio filter if needed
    audio_filter_args = []
    if mute_source_voice and seg["file_path"] in voice_segments_by_file:
        voice_segs = voice_segments_by_file[seg["file_path"]]

        # Calculate overlapping voice intervals
        overlapping_mutes = _get_overlapping_voice_mutes(
            seg["start_time"],
            seg["end_time"],
            voice_segs
        )

        if overlapping_mutes:
            audio_filter = _build_mute_filter(overlapping_mutes)
            audio_filter_args = ["-af", audio_filter]
            logger.info(f"Applying voice mute to segment: {len(overlapping_mutes)} intervals")

    # MODIFY: Add audio filter to FFmpeg command
    extract_cmd = [
        "ffmpeg", "-y",
        "-ss", str(seg["start_time"]),
        "-i", seg["file_path"],
        "-t", str(seg["duration"]),
        "-c:v", "libx264", "-preset", "fast",
        "-c:a", "aac",
    ]
    if audio_filter_args:
        extract_cmd.extend(audio_filter_args)
    extract_cmd.extend([
        "-avoid_negative_ts", "make_zero",
        str(segment_output)
    ])
```

You'll also need to extract helper functions from `video_processor.py`:
- `_get_overlapping_voice_mutes()`
- `_build_mute_filter()`

---

## 🟡 POTENTIAL ISSUES DISCOVERED

### Issue #2: Silero VAD Model Loading
**File:** `app/services/voice_detector.py:74-83`

**Observation:**
```python
def _load_model(self):
    try:
        self.model, self.utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=False,
            trust_repo=True  # ⚠️ Security concern
        )
```

**Concerns:**
1. **Network Dependency:** Model loads from torch.hub on first use - requires internet
2. **Security:** `trust_repo=True` bypasses safety checks
3. **Error Handling:** If load fails, `self.model = None` but no retry mechanism
4. **Performance:** No indication of model load time (can be 5-10 seconds)

**Recommendations:**
- Pre-download model during setup/deployment
- Cache model locally
- Add timeout and retry logic
- Log model load time for debugging

### Issue #3: FFmpeg Audio Filter Escaping
**File:** `app/services/voice_detector.py:596-620`

**Observation:**
```python
def _build_mute_filter(self, mute_intervals: List[Tuple[float, float]]) -> str:
    # ...
    combined_condition = "+".join(conditions)
    return f"volume=0:enable='{combined_condition}'"
```

The comment says "subprocess.run with list passes string directly, no shell interpretation" but the filter string contains single quotes which could cause issues if:
- Video has many voice segments (very long filter string)
- Edge cases with special characters in timestamps

**Recommendation:**
- Add validation for max filter length
- Test with edge cases (100+ voice segments)

### Issue #4: Hardcoded Thumbnail Timestamp
**File:** `app/api/library_routes.py:1529`

```python
cmd = [
    "ffmpeg", "-y",
    "-i", str(video_path),
    "-ss", "1",  # ← Always extracts at 1 second
    "-vframes", "1",
    # ...
]
```

**Issue:**
If a video is shorter than 1 second, thumbnail generation fails silently.

**Recommendation:**
```python
duration = _get_video_duration(video_path)
timestamp = min(1.0, duration * 0.1)  # 10% into video or 1s, whichever is smaller
```

### Issue #5: Concurrent Video Processing Race Condition
**File:** `app/api/library_routes.py:630-634`

```python
lock = get_project_lock(project_id)
if not lock.acquire(blocking=False):
    logger.warning(f"Project {project_id} is already being processed, skipping")
    return
```

**Observation:**
Lock prevents concurrent processing but doesn't inform user. Frontend might show:
- Multiple "Generating..." states
- Confusion about which request succeeded

**Recommendation:**
- Return HTTP 409 Conflict instead of silent return
- Or queue requests instead of rejecting

### Issue #6: Video Duration Calculation Inconsistency
**Files:** Multiple locations

**Observation:**
There are THREE different implementations of `_get_video_duration()`:

1. `library_routes.py:1500-1514` - Returns float, catches all exceptions
2. `segments_routes.py:_get_video_info()` - Returns dict with duration
3. `video_processor.py` - Uses ffprobe in different way

**Issue:**
Inconsistent error handling and return types could cause bugs.

**Recommendation:**
- Consolidate into single utility function in shared module
- Standardized error handling

### Issue #7: Temporary File Cleanup
**File:** `app/api/library_routes.py:727-751`

```python
concat_list_path = settings.base_dir / "temp" / f"concat_{project_id}_{variant_idx}.txt"
# ...
with open(concat_list_path, "w") as f:
    for seg in segments_for_variant:
        segment_output = settings.base_dir / "temp" / f"seg_{project_id}_{variant_idx}_{seg['id'][:8]}.mp4"
        # ... extract segment ...
        f.write(f"file '{segment_output}'\n")
```

**Issue:**
Temporary segment files and concat lists are created but **never explicitly cleaned up**.

**Potential Impact:**
- Disk space accumulation over time
- `/temp` directory grows indefinitely

**Recommendation:**
```python
finally:
    # Cleanup temp files
    concat_list_path.unlink(missing_ok=True)
    for seg in segments_for_variant:
        temp_file = settings.base_dir / "temp" / f"seg_{project_id}_{variant_idx}_{seg['id'][:8]}.mp4"
        temp_file.unlink(missing_ok=True)
```

### Issue #8: Job Storage Dual Write
**File:** `app/services/job_storage.py:58-82`

**Observation:**
Every job operation writes to BOTH Supabase AND in-memory dict on failure:

```python
if self._supabase:
    try:
        # Write to Supabase
    except Exception as e:
        # Fallback to memory
        self._memory_store[job_id] = job_data
```

**Issue:**
If Supabase is intermittently failing:
- Jobs could exist in memory but not in DB (inconsistent state)
- No mechanism to sync memory → Supabase when it recovers

**Recommendation:**
- Add periodic sync job to push memory store to Supabase
- Or use write-ahead log pattern

### Issue #9: SRT Validation Unicode Handling
**File:** `app/services/srt_validator.py:324-329`

```python
def validate_srt_file(srt_path: str) -> Tuple[bool, List[str]]:
    try:
        with open(srt_path, 'r', encoding='utf-8') as f:
            content = f.read()
```

**Potential Issue:**
No handling for:
- BOM (Byte Order Mark) in UTF-8 files
- Mixed encodings
- Files saved as UTF-16

**Recommendation:**
```python
# Try UTF-8 first, then fallback
try:
    with open(srt_path, 'r', encoding='utf-8-sig') as f:  # Handles BOM
        content = f.read()
except UnicodeDecodeError:
    # Try UTF-16
    with open(srt_path, 'r', encoding='utf-16') as f:
        content = f.read()
```

### Issue #10: Progress Reporting Gap
**File:** `app/api/library_routes.py:666-806`

**Observation:**
Progress updates happen at:
- 5% - "Se pregătesc segmentele..."
- 10-90% - Per-variant progress
- 95% - "Se finalizează..."

**Issue:**
If variant generation fails (e.g., FFmpeg error), progress gets stuck. No error reporting to user.

**Recommendation:**
```python
except Exception as e:
    logger.error(f"Error creating variant {variant_idx}: {e}")
    update_generation_progress(
        project_id,
        base_pct,
        f"❌ Eroare la varianta {variant_idx}: {str(e)[:50]}"
    )
    continue
```

---

## 🟢 WELL-IMPLEMENTED FEATURES

### ✅ Voice Detection Implementation (Silero VAD)
The `voice_detector.py` service is well-designed:
- Proper abstraction with `VoiceSegment` dataclass
- Multiple fallback audio readers (torchaudio → scipy → FFmpeg)
- Sample rate conversion (16kHz required for Silero)
- Overlap detection and merging

### ✅ FFmpeg Audio Filter Construction
The `_build_mute_filter()` function correctly uses FFmpeg expression syntax:
```python
# Correct syntax: volume=0:enable='condition1+condition2+...'
combined_condition = "+".join(conditions)
return f"volume=0:enable='{combined_condition}'"
```

### ✅ Job Storage Fallback Pattern
The dual Supabase/memory approach provides resilience:
- Graceful degradation when DB is unavailable
- No hard failures

### ✅ SRT Validation
Comprehensive SRT validation with:
- Timestamp format checking
- Index sequencing
- Time ordering validation
- Common issue fixes (dot → comma conversion)

---

## 📊 SUMMARY STATISTICS

| Category | Count | Notes |
|----------|-------|-------|
| Critical Bugs | 1 | Voice muting not applied |
| Potential Issues | 10 | Varying severity |
| Code Quality | Good | Well-structured, modular |
| Error Handling | Mixed | Some areas excellent, others need improvement |
| Documentation | Good | Docstrings present |

---

## 🎯 PRIORITY RECOMMENDATIONS

### Immediate (Fix Now)
1. **Fix voice muting in segment generation** (BUG #1)
2. Add temporary file cleanup to prevent disk bloat

### Short Term (This Week)
3. Consolidate video duration calculation functions
4. Add progress error reporting
5. Fix thumbnail generation for short videos

### Medium Term (This Month)
6. Implement retry logic for Silero model loading
7. Add job storage sync mechanism
8. Improve SRT Unicode handling

### Long Term (Nice to Have)
9. Pre-cache Silero model during deployment
10. Refactor concurrent processing to use queue instead of lock rejection

---

## 🔍 TESTING RECOMMENDATIONS

To verify fixes and prevent regressions:

### Test Case 1: Voice Muting
```
1. Upload video with voice + background music
2. Select segments manually
3. Enable "Mute Source Voice" checkbox
4. Generate variants
5. VERIFY: Voice is muted, music remains
```

### Test Case 2: Short Video Thumbnails
```
1. Upload video <1 second duration
2. Process it
3. VERIFY: Thumbnail generates successfully
```

### Test Case 3: Concurrent Generation
```
1. Start generation for project A
2. Immediately trigger generation again for project A
3. VERIFY: User receives clear error/feedback
```

### Test Case 4: Temporary File Cleanup
```
1. Generate 10 variants
2. Check /temp directory size
3. Wait 1 hour
4. VERIFY: Temp files cleaned up
```

---

## 📝 NOTES

- The codebase is generally well-structured with good separation of concerns
- FFmpeg integration is mostly solid, but error handling could be improved
- The voice detection implementation is sophisticated (Silero VAD is state-of-the-art)
- Main issue is the disconnect between the `/generate-from-segments` endpoint and the `video_processor.py` service
- Consider adding integration tests for the full workflow

---

**End of Report**
