# Voice Muting Architecture

## Overview

Voice muting în Edit Factory e implementat corect, fără duplicare semnificativă de cod.

## Component Architecture

### 1. Core Service: `voice_detector.py`

**Responsabilități:**
- Voice Activity Detection (VAD) cu Silero
- Funcția centrală: `mute_voice_segments(video_path, output_path, voice_segments)`

```python
def mute_voice_segments(
    video_path: Path,
    output_path: Path,
    voice_segments: List[VoiceSegment],
    fade_duration: float = 0.05,
    keep_percentage: float = 0.0
) -> bool
```

**Implementare FFmpeg:**
```python
audio_filter = f"volume={vol}:enable='{combined_condition}'"
# Example: volume=0:enable='between(t,1.0,3.0)+between(t,5.0,7.0)'
```

### 2. Video Processor Integration: `video_processor.py`

#### Method: `mute_voice_in_video()`

**Purpose:** High-level wrapper pentru video complet
- Detectează voce
- Aplică mute pe tot video-ul
- Folosește direct `mute_voice_segments()` din voice_detector.py

**Code:**
```python
from .voice_detector import VoiceDetector, mute_voice_segments

detector = self._get_voice_detector()
voice_segments = detector.detect_voice(video_path)
success = mute_voice_segments(
    video_path=video_path,
    output_path=output_path,
    voice_segments=voice_segments,
    fade_duration=fade_duration,
    keep_percentage=keep_percentage
)
```

✅ **No duplication** - uses the shared function!

#### Method: `extract_segments()` - Mute Selectiv

**Purpose:** Mute voice doar în porțiunile extrase
- Calculează suprapunerea voice cu fiecare segment
- Construiește filtru FFmpeg per segment
- Timp relativ la segment (nu absolut la video)

**Helper Functions:**
- `_get_overlapping_voice_mutes()` - Calculează intersecția
- `_build_mute_filter()` - Construiește string FFmpeg

**Implementation:**
```python
overlapping_mutes = self._get_overlapping_voice_mutes(
    seg.start_time, seg.end_time, voice_segments
)
if overlapping_mutes:
    audio_filter = self._build_mute_filter(overlapping_mutes)
    # Apply filter during segment extraction
```

**Key Difference:**
- `mute_voice_segments()` - Mute pe video complet, timpi absoluți
- `extract_segments()` - Mute pe segmente extrase, timpi relativi

## FFmpeg Filter Syntax

Ambele metode folosesc același pattern FFmpeg:

```bash
-af "volume=LEVEL:enable='CONDITION'"

# Examples:
volume=0:enable='between(t,1.0,3.0)'                    # Single interval
volume=0:enable='between(t,1.0,3.0)+between(t,5.0,7.0)' # Multiple intervals (OR)
volume=0.1:enable='between(t,1.0,3.0)'                  # Keep 10% volume
```

## Usage Patterns

### Pattern 1: Mute Full Video
```python
from app.services.video_processor import VideoProcessorService

processor = VideoProcessorService()
output_path, segments_info = processor.mute_voice_in_video(
    video_path="input.mp4",
    output_name="output",
    keep_percentage=0.0  # Complete mute
)
```

### Pattern 2: Detect Only
```python
from app.services.voice_detector import VoiceDetector

detector = VoiceDetector(threshold=0.5)
voice_segments = detector.detect_voice(video_path)
# Returns: List[VoiceSegment]
```

### Pattern 3: Manual Mute with Custom Segments
```python
from app.services.voice_detector import mute_voice_segments, VoiceSegment

segments = [
    VoiceSegment(start_time=1.0, end_time=3.0, confidence=0.9),
    VoiceSegment(start_time=5.0, end_time=7.0, confidence=0.85)
]

success = mute_voice_segments(
    video_path=input_path,
    output_path=output_path,
    voice_segments=segments
)
```

### Pattern 4: Extract Segments with Voice Mute
```python
processor = VideoProcessorService()
segments = [...]  # VideoSegment list
voice_segments = detector.detect_voice(source_video)

output_path = processor.extract_segments(
    video_path=source_video,
    segments=segments,
    output_name="final",
    voice_segments=voice_segments  # Auto-mute overlapping portions
)
```

## Dependencies

- **Silero VAD**: Voice detection (requires PyTorch)
- **FFmpeg**: Audio filtering and muting
- **Fallback**: If Silero unavailable, returns empty voice segments

## Conclusion

✅ **Architecture is sound**
- No code duplication
- Clear separation of concerns
- Shared core logic in voice_detector.py
- Specialized helpers in video_processor.py for segment-level muting

**No refactoring needed!**
