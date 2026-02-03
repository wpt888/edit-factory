---
phase: 04-tts-provider-selection
plan: 04
subsystem: tts
status: complete
tags: [kokoro, tts, local-tts, espeak-ng, free-tier]
dependencies:
  requires: [04-01]
  provides: ["kokoro-tts-service"]
  affects: [04-05, 04-06]
tech-stack:
  added:
    - kokoro>=0.9.4 (lightweight local TTS)
    - soundfile>=0.12.1 (audio file I/O)
  patterns:
    - lazy-import-for-optional-dependencies
    - system-dependency-validation
    - preset-voice-configuration
key-files:
  created:
    - app/services/tts/kokoro.py
  modified:
    - requirements.txt
    - app/services/tts/factory.py
decisions:
  - id: kokoro-espeak-validation
    what: Check espeak-ng availability in constructor with clear error message
    why: Fail fast with actionable instructions rather than cryptic runtime errors
    alternatives: [lazy-check-on-first-use, skip-validation]
    chosen: constructor-validation
  - id: kokoro-lazy-import
    what: Import kokoro library inside generate_audio() method
    why: Avoid import-time failures if kokoro not installed (graceful degradation)
    alternatives: [module-level-import, try-except-import]
    chosen: lazy-import
  - id: kokoro-preset-voices
    what: 5 hardcoded preset voices (af, am, bf, bm, default)
    why: Kokoro uses preset models, no dynamic voice discovery API
    alternatives: [dynamic-loading, config-file]
    chosen: preset-constant
metrics:
  duration: 2 minutes
  completed: 2026-02-03
---

# Phase 04 Plan 04: Kokoro TTS Service Implementation Summary

**One-liner:** Kokoro TTS service with espeak-ng validation, 5 preset voices, and zero-cost local audio generation

## What Was Built

### Kokoro TTS Service

**File:** `app/services/tts/kokoro.py`

Lightweight, fast, free local TTS implementation:

- **Extends TTSService interface** with full abstract method implementation
- **espeak-ng validation** in constructor with clear installation instructions for Linux/macOS/Windows
- **5 preset voices** (American/British, Male/Female, Default) via KOKORO_VOICES constant
- **Lazy import pattern** for kokoro library to avoid import-time dependencies
- **asyncio.to_thread** for non-blocking audio generation
- **Zero cost** (cost_per_1k_chars = 0.0)
- **No voice cloning** support (preset voices only)

### Factory Integration

**File:** `app/services/tts/factory.py`

Updated factory to support "kokoro" provider:

- **Lazy import** of KokoroTTSService inside factory function
- **default_voice parameter** with fallback to "af" (American English Female)
- **Profile-scoped output** directory: `output/tts/{profile_id}/kokoro/`

### Dependencies

**File:** `requirements.txt`

Added Kokoro TTS dependencies:

- **kokoro>=0.9.4** - Lightweight local TTS engine
- **soundfile>=0.12.1** - Audio file I/O library
- **espeak-ng system dependency** documented with installation instructions

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add Kokoro TTS dependencies | 6f99519 | requirements.txt |
| 2 | Create KokoroTTSService | c3041c0 | app/services/tts/kokoro.py |
| 3 | Update factory for Kokoro provider | 0308933 | app/services/tts/factory.py |

## Technical Implementation

### espeak-ng Validation

Kokoro requires espeak-ng system dependency. Constructor validates availability:

```python
def _check_espeak_available(self) -> bool:
    try:
        result = subprocess.run(
            ["espeak-ng", "--version"],
            capture_output=True,
            timeout=5,
            text=True
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            logger.info(f"espeak-ng found: {version}")
            return True
        return False
    except FileNotFoundError:
        return False
```

If not found, raises RuntimeError with installation instructions.

### Preset Voices

5 hardcoded voices for English TTS:

```python
KOKORO_VOICES = [
    {"id": "af", "name": "American English Female", "language": "en", "gender": "female"},
    {"id": "am", "name": "American English Male", "language": "en", "gender": "male"},
    {"id": "bf", "name": "British English Female", "language": "en", "gender": "female"},
    {"id": "bm", "name": "British English Male", "language": "en", "gender": "male"},
    {"id": "default", "name": "Default Voice", "language": "en", "gender": "neutral"},
]
```

### Audio Generation Flow

1. **Lazy import** kokoro and soundfile libraries
2. **Generate audio** in thread pool (asyncio.to_thread) to avoid blocking
3. **Save to output_path** using soundfile
4. **Calculate duration** from audio_data length and sample_rate
5. **Return TTSResult** with zero cost

### Factory Usage

```python
service = get_tts_service(
    provider="kokoro",
    profile_id="abc123",
    voice_id="bf"  # British Female
)

result = await service.generate_audio(
    text="Hello world",
    voice_id="bf",
    output_path=Path("output/audio.wav")
)
```

## Decisions Made

### 1. Constructor espeak-ng Validation

**Decision:** Check espeak-ng availability in __init__() and raise RuntimeError if missing

**Rationale:**
- Fail fast with clear error message
- Better UX than cryptic runtime errors during audio generation
- Installation instructions provided immediately

**Alternatives considered:**
- Lazy check on first audio generation (delays error discovery)
- Skip validation (poor error messages)

### 2. Lazy Import Pattern

**Decision:** Import kokoro library inside generate_audio() method

**Rationale:**
- Graceful degradation if kokoro not installed
- Factory can return service instance without import error
- Allows other TTS providers to work even if Kokoro dependencies missing

**Alternatives considered:**
- Module-level import (fails entire app if missing)
- Try-except at module level (masks import errors)

### 3. Preset Voice Configuration

**Decision:** Hardcode 5 voices in KOKORO_VOICES constant

**Rationale:**
- Kokoro uses preset models, no dynamic discovery API
- Simple, predictable voice list
- Easy to extend if new voices added to library

**Alternatives considered:**
- Dynamic loading from kokoro library metadata (not exposed by library)
- External config file (unnecessary complexity)

## Verification Results

All verification checks passed:

✓ requirements.txt includes kokoro>=0.9.4 and soundfile
✓ KokoroTTSService class exists and extends TTSService
✓ espeak-ng validation in constructor
✓ 5 preset voices in KOKORO_VOICES
✓ list_voices() returns TTSVoice objects
✓ generate_audio() implements full interface
✓ Factory includes "kokoro" provider with lazy import
✓ Factory passes default_voice parameter

## Integration Points

### Upstream (Dependencies)

- **04-01 (TTSService Interface)**: Extends TTSService abstract base class
- **Profile context**: Uses profile_id for scoped output directories

### Downstream (Enables)

- **04-05 (UI Integration)**: Kokoro available in provider dropdown
- **04-06 (Cost Tracker)**: Zero-cost provider for cost comparison
- **Free TTS alternative**: Users can generate audio without API costs

## Next Phase Readiness

**Phase 4 Progress: 4/7 plans complete**

Wave 2 providers complete:
- ✅ 04-02: ElevenLabs (premium, voice cloning)
- ✅ 04-03: Coqui (local, voice cloning, GPU)
- ✅ 04-04: Kokoro (lightweight, fast, free)

Remaining:
- 04-05: TTS API routes (unified endpoint for all providers)
- 04-06: Cost tracking integration (log TTS costs to api_costs table)
- 04-07: Frontend provider selection UI (dropdown, settings, preview)

**Ready to proceed:** Yes

All 4 TTS providers now implemented. Ready for API integration in 04-05.

## Performance

**Duration:** 2 minutes
**Tasks:** 3/3 completed
**Commits:** 3

Execution breakdown:
- Task 1 (dependencies): 30 seconds
- Task 2 (service implementation): 60 seconds
- Task 3 (factory update): 30 seconds

## Deviations from Plan

None - plan executed exactly as written.

## Notes

### System Dependency

Kokoro requires espeak-ng to be installed on the system:

- **Linux:** `apt-get install espeak-ng`
- **macOS:** `brew install espeak-ng`
- **Windows:** Download from https://github.com/espeak-ng/espeak-ng/releases

Constructor will raise clear error if not found.

### Voice Limitations

Kokoro currently supports English only (American and British accents). For multilingual TTS, use Edge or Coqui providers.

### Performance Characteristics

- **Fast**: Optimized for speed, good for real-time generation
- **Lightweight**: Minimal dependencies, small model size
- **Local**: No API calls, works offline
- **Free**: Zero cost per character

Ideal for development, testing, and cost-conscious production workloads.
