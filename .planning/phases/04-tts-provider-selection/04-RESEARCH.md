# Phase 4: TTS Provider Selection - Research

**Researched:** 2026-02-03
**Domain:** Text-to-Speech provider integration with FastAPI and React
**Confidence:** HIGH

## Summary

Phase 4 integrates free TTS alternatives (Edge TTS, Coqui XTTS, Kokoro) alongside the existing paid ElevenLabs provider, with UI provider selection, inline cost display, voice cloning workflow, and per-profile voice settings persistence. The implementation follows a proven pattern: (1) extend profile settings schema with TTS fields, (2) create service abstraction layer for multiple providers, (3) build FastAPI endpoints for TTS generation and voice cloning, (4) implement React UI with provider selection and file upload.

The research focused on four critical areas:
1. **Installation requirements** for Coqui XTTS and Kokoro (PyTorch, espeak-ng, Python version compatibility)
2. **Voice cloning workflow** for Coqui XTTS (6-second sample validation, model loading, inference patterns)
3. **Service architecture** for abstracting multiple TTS providers with unified interface
4. **UI patterns** for provider selection with inline cost display using Shadcn UI

The standard approach is a **unified TTS service factory** that returns provider-specific implementations behind a common interface. Edge TTS is already integrated and requires no additional dependencies (async-ready, 100+ voices, free). Coqui XTTS requires PyTorch (2-5GB), supports voice cloning with 6-second samples, and runs on CPU or GPU. Kokoro requires espeak-ng (system dependency), provides 5 preset voices, and is lightweight (~82M parameters).

**Primary recommendation:** Create a `TTSService` abstract base class with provider-specific implementations (`ElevenLabsTTSService`, `EdgeTTSService`, `CoquiTTSService`, `KokoroTTSService`). Store provider choice and voice settings in `profiles` table (Phase 1 foundation). Use FastAPI `UploadFile` with MIME type validation for voice cloning samples. Implement Shadcn Radio Group with card layout for provider selection UI with inline cost badges.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| edge-tts | 6.x | Free Microsoft TTS (already integrated) | Official Microsoft Edge voices, async-ready, 100+ voices, zero API cost |
| TTS (Coqui) | 0.22.x | Voice cloning TTS | Official Coqui library, XTTS-v2 model, 17 language support, voice cloning with 6s samples |
| kokoro | 0.9.4+ | Lightweight local TTS | Fast inference (~82M params), preset voices, good for basic free TTS |
| PyTorch | 2.x | Deep learning framework | Required by Coqui TTS, industry standard, CUDA support |
| soundfile | Latest | Audio I/O library | Required by Kokoro, standard for Python audio operations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pydub | Latest | Audio format conversion | Converting voice cloning samples to required format |
| librosa | Latest | Audio analysis | Validating voice sample duration and quality |
| httpx | Latest | HTTP client for API calls | Already in use for ElevenLabs, async-ready |

### System Dependencies
| Dependency | Platform | Purpose |
|------------|----------|---------|
| espeak-ng | Linux/macOS/Windows | Required by Kokoro for phoneme generation |
| FFmpeg | All platforms | Already integrated for video processing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Coqui XTTS | OpenVoice | Coqui has better voice cloning quality; OpenVoice is newer with less battle-testing |
| Kokoro | Piper TTS | Kokoro is lighter and faster; Piper has more voice variety but larger models |
| Edge TTS | Google Cloud TTS | Edge TTS is free; Google Cloud has better voices but costs $4/1M chars |

**Installation:**
```bash
# Edge TTS (already installed)
pip install edge-tts

# Coqui XTTS (large dependency ~2-5GB with PyTorch)
pip install TTS torch

# Kokoro (requires espeak-ng system dependency first)
# Linux: apt-get install espeak-ng
# macOS: brew install espeak-ng
# Windows: download installer from https://github.com/espeak-ng/espeak-ng/releases
pip install kokoro>=0.9.4 soundfile

# Supporting libraries
pip install pydub librosa
```

## Architecture Patterns

### Recommended Project Structure
```
app/services/
├── tts/
│   ├── __init__.py
│   ├── base.py              # TTSService abstract base class
│   ├── elevenlabs.py        # ElevenLabsTTSService (existing, refactored)
│   ├── edge.py              # EdgeTTSService (existing, refactored)
│   ├── coqui.py             # CoquiTTSService (new)
│   ├── kokoro.py            # KokoroTTSService (new)
│   └── factory.py           # get_tts_service(provider, settings)
app/api/
├── tts_routes.py            # TTS generation + voice cloning endpoints
app/models/
├── tts.py                   # Pydantic models for TTS requests/responses
frontend/src/components/tts/
├── provider-selector.tsx    # Provider selection with cost display
├── voice-cloning-upload.tsx # Voice sample upload with validation
```

### Pattern 1: Unified TTS Service Interface

**What:** Abstract base class defining common TTS operations across all providers.

**When to use:** Always for multi-provider TTS systems to ensure consistent API.

**Example:**
```python
# Source: Python ABC pattern + FastAPI dependency injection
# app/services/tts/base.py

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, List, Dict
from dataclasses import dataclass

@dataclass
class TTSVoice:
    """Unified voice representation across providers."""
    id: str                    # Provider-specific voice ID
    name: str                  # Display name
    language: str              # ISO language code
    gender: Optional[str]      # male/female/neutral
    provider: str              # elevenlabs/edge/coqui/kokoro
    requires_cloning: bool     # True for Coqui custom voices
    cost_per_1k_chars: float  # 0.0 for free providers

@dataclass
class TTSResult:
    """TTS generation result."""
    audio_path: Path
    duration_seconds: float
    provider: str
    voice_id: str
    cost: float  # 0.0 for free providers

class TTSService(ABC):
    """Abstract base class for all TTS providers."""

    def __init__(self, output_dir: Path):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Provider identifier (elevenlabs/edge/coqui/kokoro)."""
        pass

    @property
    @abstractmethod
    def cost_per_1k_chars(self) -> float:
        """Cost per 1000 characters (0.0 for free providers)."""
        pass

    @abstractmethod
    async def list_voices(self, language: Optional[str] = None) -> List[TTSVoice]:
        """List available voices for this provider."""
        pass

    @abstractmethod
    async def generate_audio(
        self,
        text: str,
        voice_id: str,
        output_path: Path,
        **kwargs  # Provider-specific options (rate, pitch, etc.)
    ) -> TTSResult:
        """Generate audio from text."""
        pass

    @abstractmethod
    async def supports_voice_cloning(self) -> bool:
        """Whether this provider supports voice cloning."""
        pass

    async def clone_voice(
        self,
        sample_audio_path: Path,
        voice_name: str
    ) -> str:
        """
        Clone a voice from audio sample.
        Returns voice_id that can be used in generate_audio.
        Only implemented for providers that support cloning.
        """
        raise NotImplementedError(f"{self.provider_name} does not support voice cloning")
```

### Pattern 2: TTS Service Factory with Profile Context

**What:** Factory function that instantiates the correct TTS provider based on profile settings.

**When to use:** Every TTS operation that needs to respect user's provider choice.

**Example:**
```python
# Source: Factory pattern + FastAPI settings injection
# app/services/tts/factory.py

from pathlib import Path
from typing import Optional
from app.config import get_settings
from app.services.tts.base import TTSService
from app.services.tts.elevenlabs import ElevenLabsTTSService
from app.services.tts.edge import EdgeTTSService
from app.services.tts.coqui import CoquiTTSService
from app.services.tts.kokoro import KokoroTTSService

def get_tts_service(
    provider: str,
    profile_id: str,
    voice_id: Optional[str] = None
) -> TTSService:
    """
    Get TTS service instance for the specified provider.

    Args:
        provider: 'elevenlabs' | 'edge' | 'coqui' | 'kokoro'
        profile_id: Profile ID for scoped output directory
        voice_id: Optional voice ID override

    Returns:
        TTSService implementation for the provider
    """
    settings = get_settings()
    output_dir = settings.output_dir / "tts" / profile_id / provider
    output_dir.mkdir(parents=True, exist_ok=True)

    if provider == "elevenlabs":
        return ElevenLabsTTSService(
            api_key=settings.elevenlabs_api_key,
            voice_id=voice_id or settings.elevenlabs_voice_id,
            model_id=settings.elevenlabs_model,
            output_dir=output_dir
        )
    elif provider == "edge":
        return EdgeTTSService(
            output_dir=output_dir,
            default_voice=voice_id or "en-US-GuyNeural"
        )
    elif provider == "coqui":
        return CoquiTTSService(
            output_dir=output_dir,
            model_name="tts_models/multilingual/multi-dataset/xtts_v2",
            use_gpu=True  # Fallback to CPU if CUDA unavailable
        )
    elif provider == "kokoro":
        return KokoroTTSService(
            output_dir=output_dir,
            default_voice=voice_id or "af"  # American English female
        )
    else:
        raise ValueError(f"Unknown TTS provider: {provider}")
```

### Pattern 3: Voice Cloning File Upload with Validation

**What:** FastAPI endpoint for uploading voice samples with MIME type and duration validation.

**When to use:** Voice cloning workflow for Coqui XTTS.

**Example:**
```python
# Source: FastAPI file upload best practices (https://betterstack.com/community/guides/scaling-python/uploading-files-using-fastapi/)
# app/api/tts_routes.py

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from pathlib import Path
import librosa
import soundfile as sf
from app.api.auth import ProfileContext, get_profile_context

router = APIRouter(prefix="/tts", tags=["tts"])

# Allowed audio MIME types for voice cloning
ALLOWED_AUDIO_MIMES = [
    "audio/mpeg",      # MP3
    "audio/wav",       # WAV
    "audio/x-wav",     # WAV alternative
    "audio/ogg",       # OGG
    "audio/mp4",       # M4A
    "audio/x-m4a",     # M4A alternative
]

# Max file size: 10MB (6-second sample should be much smaller)
MAX_AUDIO_SIZE = 10 * 1024 * 1024

@router.post("/clone-voice")
async def clone_voice(
    voice_name: str = Form(..., min_length=1, max_length=50),
    audio_sample: UploadFile = File(...),
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Clone a voice from audio sample (Coqui XTTS).

    Requirements:
    - Audio sample: 6+ seconds duration
    - Format: MP3, WAV, OGG, M4A
    - Max size: 10MB
    - Clear speech without background noise

    Returns:
        voice_id: Unique identifier for the cloned voice
        duration: Audio sample duration in seconds
    """
    # Validate MIME type
    if audio_sample.content_type not in ALLOWED_AUDIO_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid audio format. Allowed: {', '.join(ALLOWED_AUDIO_MIMES)}"
        )

    # Read file with size limit
    content = await audio_sample.read()
    if len(content) > MAX_AUDIO_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max size: {MAX_AUDIO_SIZE / 1024 / 1024}MB"
        )

    # Save to temp location for validation
    from app.config import get_settings
    settings = get_settings()
    temp_dir = settings.base_dir / "temp" / profile.profile_id / "voice_cloning"
    temp_dir.mkdir(parents=True, exist_ok=True)

    import uuid
    sample_id = str(uuid.uuid4())
    temp_path = temp_dir / f"{sample_id}.{audio_sample.filename.split('.')[-1]}"

    with open(temp_path, "wb") as f:
        f.write(content)

    try:
        # Validate audio duration using librosa
        audio_data, sample_rate = librosa.load(str(temp_path), sr=None)
        duration = librosa.get_duration(y=audio_data, sr=sample_rate)

        if duration < 6.0:
            raise HTTPException(
                status_code=400,
                detail=f"Audio sample too short: {duration:.1f}s. Minimum: 6 seconds"
            )

        if duration > 30.0:
            # Warn but don't reject - longer samples might be fine
            logger.warning(f"Voice sample longer than recommended (30s): {duration:.1f}s")

        # Convert to WAV if needed (Coqui prefers WAV)
        wav_path = temp_dir / f"{sample_id}.wav"
        if not temp_path.suffix == ".wav":
            sf.write(str(wav_path), audio_data, sample_rate)
        else:
            wav_path = temp_path

        # Clone voice using Coqui TTS service
        from app.services.tts.factory import get_tts_service
        tts_service = get_tts_service(
            provider="coqui",
            profile_id=profile.profile_id
        )

        voice_id = await tts_service.clone_voice(
            sample_audio_path=wav_path,
            voice_name=voice_name
        )

        # Store voice metadata in profile settings (Phase 1 profiles table)
        # This allows user to select cloned voice later
        from app.api.profile_routes import get_supabase
        supabase = get_supabase()

        if supabase:
            # Get current cloned_voices JSONB or initialize
            profile_data = supabase.table("profiles")\
                .select("cloned_voices")\
                .eq("id", profile.profile_id)\
                .single()\
                .execute()

            cloned_voices = profile_data.data.get("cloned_voices", []) if profile_data.data else []
            cloned_voices.append({
                "id": voice_id,
                "name": voice_name,
                "provider": "coqui",
                "sample_duration": duration,
                "created_at": datetime.utcnow().isoformat()
            })

            supabase.table("profiles")\
                .update({"cloned_voices": cloned_voices})\
                .eq("id", profile.profile_id)\
                .execute()

        return {
            "voice_id": voice_id,
            "voice_name": voice_name,
            "duration": duration,
            "provider": "coqui",
            "status": "success"
        }

    finally:
        # Cleanup temp files
        try:
            temp_path.unlink(missing_ok=True)
            if 'wav_path' in locals() and wav_path != temp_path:
                wav_path.unlink(missing_ok=True)
        except Exception as e:
            logger.warning(f"Failed to cleanup temp files: {e}")
```

### Pattern 4: Provider Selection UI with Inline Cost Display

**What:** React component using Shadcn Radio Group with card layout for TTS provider selection.

**When to use:** Settings page or video generation workflow where user selects TTS provider.

**Example:**
```tsx
// Source: Shadcn UI Radio Group patterns (https://ui.shadcn.com/docs/components/radio-group)
// frontend/src/components/tts/provider-selector.tsx

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

interface TTSProvider {
  id: string
  name: string
  description: string
  costPer1kChars: number // 0 for free
  features: string[]
  requiresSetup: boolean
  supportsVoiceCloning: boolean
}

const TTS_PROVIDERS: TTSProvider[] = [
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Premium quality, natural-sounding voices",
    costPer1kChars: 0.22,
    features: ["Highest quality", "Natural prosody", "Emotional range"],
    requiresSetup: true, // Requires API key
    supportsVoiceCloning: false
  },
  {
    id: "edge",
    name: "Edge TTS",
    description: "Microsoft Edge voices, completely free",
    costPer1kChars: 0,
    features: ["100+ voices", "Multiple languages", "Fast generation"],
    requiresSetup: false,
    supportsVoiceCloning: false
  },
  {
    id: "coqui",
    name: "Coqui XTTS",
    description: "Voice cloning with 6-second sample",
    costPer1kChars: 0,
    features: ["Voice cloning", "17 languages", "Local processing"],
    requiresSetup: true, // Requires model download
    supportsVoiceCloning: true
  },
  {
    id: "kokoro",
    name: "Kokoro TTS",
    description: "Fast lightweight local TTS",
    costPer1kChars: 0,
    features: ["Very fast", "5 preset voices", "Lightweight"],
    requiresSetup: true, // Requires espeak-ng
    supportsVoiceCloning: false
  }
]

interface ProviderSelectorProps {
  value: string
  onChange: (provider: string) => void
  disabled?: boolean
}

export function ProviderSelector({ value, onChange, disabled }: ProviderSelectorProps) {
  return (
    <RadioGroup value={value} onValueChange={onChange} disabled={disabled}>
      <div className="grid gap-4 md:grid-cols-2">
        {TTS_PROVIDERS.map((provider) => (
          <Card
            key={provider.id}
            className={`cursor-pointer transition-all hover:border-primary ${
              value === provider.id ? "border-primary ring-2 ring-primary ring-offset-2" : ""
            }`}
            onClick={() => !disabled && onChange(provider.id)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  <RadioGroupItem value={provider.id} id={provider.id} />
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={provider.id} className="font-semibold cursor-pointer">
                        {provider.name}
                      </Label>
                      {provider.costPer1kChars === 0 ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-800">
                          Free
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          ${provider.costPer1kChars.toFixed(2)}/1k chars
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {provider.description}
                    </p>
                    <ul className="text-xs text-muted-foreground space-y-1 mt-2">
                      {provider.features.map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-1">
                          <span className="text-primary">•</span>
                          {feature}
                        </li>
                      ))}
                    </ul>
                    {provider.supportsVoiceCloning && (
                      <Badge variant="outline" className="mt-2">
                        Voice Cloning Available
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </RadioGroup>
  )
}
```

### Pattern 5: Profile-Aware TTS Settings Persistence

**What:** Store TTS provider choice and voice settings in profiles table using JSONB field.

**When to use:** Phase 4 needs to persist user's TTS preferences per profile.

**Example:**
```sql
-- Source: Phase 1 profiles table foundation + TTS-specific fields
-- Migration: 006_add_tts_settings_to_profiles.sql

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tts_settings JSONB DEFAULT '{
  "provider": "edge",
  "elevenlabs": {
    "voice_id": null,
    "model": "eleven_multilingual_v2",
    "stability": 0.57,
    "similarity_boost": 0.75
  },
  "edge": {
    "voice": "en-US-GuyNeural",
    "rate": "+0%",
    "pitch": "+0Hz"
  },
  "coqui": {
    "model": "xtts_v2",
    "use_gpu": true
  },
  "kokoro": {
    "voice": "af"
  }
}'::jsonb;

-- Add cloned_voices JSONB array for voice cloning metadata
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cloned_voices JSONB DEFAULT '[]'::jsonb;

-- Index for fast TTS provider lookups
CREATE INDEX IF NOT EXISTS idx_profiles_tts_provider
ON profiles ((tts_settings->>'provider'));
```

### Anti-Patterns to Avoid

- **Loading all TTS models at startup:** Coqui XTTS model is 2GB+. Load lazily when provider is first used, not at application start. Use singleton pattern with lazy initialization.

- **Storing audio samples in database:** Voice cloning samples are 1-5MB. Store in file system (`output/tts/{profile_id}/voice_samples/`) and save only file path in database.

- **Blocking TTS generation in HTTP handler:** TTS generation can take 5-30 seconds. Use FastAPI `BackgroundTasks` and return job_id immediately, same pattern as video processing.

- **Not validating audio duration client-side:** Upload 30MB files only to reject them server-side wastes bandwidth. Use `<audio>` element's `onloadedmetadata` to validate duration before upload.

- **Hardcoding provider API keys in service classes:** Use `get_settings()` dependency injection, not environment variables directly in service constructors. This allows runtime config changes and testing.

- **Missing CUDA availability check:** Coqui XTTS falls back to CPU if CUDA unavailable. Check `torch.cuda.is_available()` and log warning if CPU mode (much slower).

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio duration validation | Manual WAV parsing | librosa.get_duration() | Handles all audio formats, resampling, edge cases |
| TTS cost calculation | Custom character counting | Cost tracker service (existing) | Already integrated with Supabase, handles all providers |
| Voice sample storage | Custom file naming scheme | UUID + profile_id scoping | Prevents collisions, automatic cleanup with profile deletion |
| Provider availability check | Try/catch on first use | Health check endpoint at startup | Fail fast, clear error messages, prevents silent fallback chains |
| Audio format conversion | FFmpeg subprocess calls | pydub or soundfile | Python-native, better error handling, format detection |

**Key insight:** TTS provider integration looks simple (call API, get audio) but has hidden complexity: model loading time, GPU memory management, audio format compatibility, voice cloning sample validation, cost tracking across providers. Use existing audio libraries (librosa, soundfile) and follow FastAPI async patterns to avoid reinventing audio processing.

## Common Pitfalls

### Pitfall 1: Coqui XTTS Model Download on First Use (Startup Delay)

**What goes wrong:** First user requesting Coqui TTS waits 3-5 minutes while model downloads (2GB+). HTTP request times out, user sees error despite model downloading in background.

**Why it happens:** TTS library auto-downloads models from HuggingFace on first instantiation. This happens synchronously during first `generate_audio()` call.

**How to avoid:**

```python
# Pre-download model during deployment, not at runtime
# deploy/download_tts_models.py

from TTS.api import TTS
import torch

def download_all_models():
    """Download TTS models during deployment."""
    models = [
        "tts_models/multilingual/multi-dataset/xtts_v2",
        # Add other models as needed
    ]

    for model_name in models:
        print(f"Downloading {model_name}...")
        tts = TTS(model_name)
        print(f"✓ {model_name} ready")

if __name__ == "__main__":
    download_all_models()

# Run during Docker build or deployment:
# python deploy/download_tts_models.py
```

**Warning signs:**
- First Coqui TTS request takes >60 seconds and times out
- Logs show HuggingFace download progress during API request
- Subsequent requests are fast but first one fails

**Phase impact:** CRITICAL for deployment. Add model download step to deployment pipeline (Docker build, startup script). Add loading state in UI for first-time model initialization.

### Pitfall 2: PyTorch CUDA Version Mismatch (GPU Not Used)

**What goes wrong:** Install Coqui TTS on system with NVIDIA GPU, but PyTorch uses CPU mode. TTS generation takes 30-60 seconds instead of 3-5 seconds.

**Why it happens:** `pip install torch` installs CPU-only PyTorch by default. CUDA version must match system CUDA installation.

**How to avoid:**

```bash
# Check system CUDA version first
nvidia-smi  # Shows CUDA version (e.g., 12.1)

# Install PyTorch with matching CUDA version (not just `pip install torch`)
# CUDA 11.8
pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# CUDA 12.1
pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Verify GPU is available
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
```

**Verification:**
```python
# app/services/tts/coqui.py
import torch
import logging

logger = logging.getLogger(__name__)

class CoquiTTSService:
    def __init__(self, output_dir: Path, model_name: str, use_gpu: bool = True):
        self.use_gpu = use_gpu and torch.cuda.is_available()

        if use_gpu and not torch.cuda.is_available():
            logger.warning("GPU requested but CUDA not available. Falling back to CPU (slower).")

        if self.use_gpu:
            logger.info(f"Using GPU: {torch.cuda.get_device_name(0)}")
        else:
            logger.info("Using CPU for TTS generation (slower)")
```

**Warning signs:**
- Coqui TTS works but is very slow (30+ seconds per generation)
- Logs show "Using CPU" despite GPU available
- `torch.cuda.is_available()` returns False on GPU system
- High CPU usage but low GPU usage during TTS generation

**Phase impact:** CRITICAL for production. Add GPU verification to deployment checklist. Log clear warning if CPU fallback occurs.

### Pitfall 3: espeak-ng Not Installed (Kokoro Fails Silently)

**What goes wrong:** Kokoro TTS installation succeeds (`pip install kokoro`) but fails at runtime with cryptic error "espeak not found" or "phonemizer error".

**Why it happens:** Kokoro requires espeak-ng system dependency for phoneme generation. Python package doesn't bundle it, assumes system installation.

**How to avoid:**

```python
# app/services/tts/kokoro.py
import subprocess
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

class KokoroTTSService:
    def __init__(self, output_dir: Path, default_voice: str):
        self.output_dir = output_dir
        self.default_voice = default_voice

        # Verify espeak-ng is installed at initialization
        if not self._check_espeak_available():
            raise RuntimeError(
                "espeak-ng not found. Install it before using Kokoro TTS:\n"
                "  Linux: apt-get install espeak-ng\n"
                "  macOS: brew install espeak-ng\n"
                "  Windows: https://github.com/espeak-ng/espeak-ng/releases"
            )

    def _check_espeak_available(self) -> bool:
        """Check if espeak-ng is installed."""
        try:
            result = subprocess.run(
                ["espeak-ng", "--version"],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False

# Add health check endpoint in FastAPI
@router.get("/health/tts")
async def tts_health_check():
    """Check if all TTS providers are available."""
    return {
        "elevenlabs": settings.elevenlabs_api_key != "",
        "edge": True,  # Always available
        "coqui": torch.cuda.is_available(),  # Check GPU
        "kokoro": _check_espeak_available()
    }
```

**Installation verification script:**
```bash
# deploy/verify_tts_dependencies.sh

#!/bin/bash
set -e

echo "Verifying TTS dependencies..."

# Check espeak-ng
if command -v espeak-ng &> /dev/null; then
    echo "✓ espeak-ng installed: $(espeak-ng --version | head -1)"
else
    echo "✗ espeak-ng NOT installed"
    exit 1
fi

# Check PyTorch
python -c "import torch; print(f'✓ PyTorch {torch.__version__}')"

# Check CUDA
python -c "import torch; print(f'✓ CUDA available: {torch.cuda.is_available()}')"

# Check TTS library
python -c "from TTS.api import TTS; print('✓ Coqui TTS library installed')"

# Check Kokoro
python -c "import kokoro; print('✓ Kokoro library installed')"

echo "All TTS dependencies verified!"
```

**Warning signs:**
- Kokoro provider selection UI shows but generation fails with "phonemizer error"
- Error mentions "espeak" in stack trace
- Other TTS providers work but Kokoro always fails

**Phase impact:** CRITICAL for deployment. Add espeak-ng installation to Docker image, deployment docs. Add health check endpoint to verify before enabling Kokoro in UI.

### Pitfall 4: Voice Cloning Sample Too Short (Quality Issues)

**What goes wrong:** User uploads 3-second voice sample (meets minimum), but cloned voice quality is poor (robotic, wrong pitch, unclear).

**Why it happens:** Coqui XTTS minimum is 6 seconds, but optimal quality needs 10-20 seconds. Documentation mentions 6s minimum but doesn't emphasize quality trade-off.

**How to avoid:**

```python
# app/api/tts_routes.py - Enhanced validation

MIN_DURATION = 6.0   # Hard minimum
RECOMMENDED_DURATION = 10.0  # Warn if below this
MAX_DURATION = 30.0  # Warn if above (diminishing returns)

@router.post("/clone-voice")
async def clone_voice(...):
    # ... existing validation ...

    duration = librosa.get_duration(y=audio_data, sr=sample_rate)

    warnings = []

    if duration < MIN_DURATION:
        raise HTTPException(
            status_code=400,
            detail=f"Audio sample too short: {duration:.1f}s. Minimum: {MIN_DURATION}s"
        )

    if duration < RECOMMENDED_DURATION:
        warnings.append(
            f"Sample duration ({duration:.1f}s) is below recommended {RECOMMENDED_DURATION}s. "
            "Voice quality may be reduced. For best results, use 10-20 second samples."
        )

    if duration > MAX_DURATION:
        warnings.append(
            f"Sample duration ({duration:.1f}s) is longer than needed. "
            "Audio beyond {MAX_DURATION}s has diminishing returns."
        )

    # Check for silence/quality issues
    rms = librosa.feature.rms(y=audio_data)
    avg_rms = rms.mean()

    if avg_rms < 0.01:
        warnings.append(
            "Audio sample appears very quiet. Ensure clear speech without background noise."
        )

    return {
        "voice_id": voice_id,
        "duration": duration,
        "warnings": warnings,  # Return to UI
        "quality_score": "good" if duration >= RECOMMENDED_DURATION else "acceptable"
    }
```

**UI guidance:**
```tsx
// frontend/src/components/tts/voice-cloning-upload.tsx

<Alert>
  <AlertTitle>Voice Sample Requirements</AlertTitle>
  <AlertDescription>
    <ul className="list-disc pl-4 space-y-1">
      <li><strong>Duration:</strong> 10-20 seconds (minimum 6s)</li>
      <li><strong>Content:</strong> Clear speech in target language</li>
      <li><strong>Quality:</strong> No background noise or music</li>
      <li><strong>Format:</strong> MP3, WAV, or M4A</li>
      <li><strong>Tip:</strong> Read a few sentences naturally</li>
    </ul>
  </AlertDescription>
</Alert>
```

**Warning signs:**
- Users complain cloned voice sounds robotic or unclear
- Many voice cloning uploads are rejected by duration validation
- Cloned voices work but don't sound like original

**Phase impact:** MEDIUM - Affects voice cloning quality, not functionality. Add clear UI guidance and validation warnings. Consider adding audio quality analysis (noise detection, speech clarity).

## Code Examples

Verified patterns from official sources and existing codebase:

### Complete Coqui TTS Service Implementation

```python
# Source: Coqui TTS official examples + Edit Factory patterns
# app/services/tts/coqui.py

import torch
from TTS.api import TTS
from pathlib import Path
from typing import Optional, List
import logging
import asyncio
from app.services.tts.base import TTSService, TTSVoice, TTSResult

logger = logging.getLogger(__name__)

class CoquiTTSService(TTSService):
    """
    Coqui XTTS v2 TTS service with voice cloning.
    Supports 17 languages, voice cloning from 6+ second samples.
    """

    # Singleton pattern: load model once per process
    _model_cache = {}
    _model_lock = asyncio.Lock()

    def __init__(
        self,
        output_dir: Path,
        model_name: str = "tts_models/multilingual/multi-dataset/xtts_v2",
        use_gpu: bool = True
    ):
        super().__init__(output_dir)
        self.model_name = model_name
        self.use_gpu = use_gpu and torch.cuda.is_available()

        if use_gpu and not torch.cuda.is_available():
            logger.warning("GPU requested but CUDA not available. Using CPU (slower).")

        # Don't load model here - lazy load on first use
        self._model: Optional[TTS] = None
        self._cloned_voices: Dict[str, Path] = {}  # voice_id -> sample_path

    @property
    def provider_name(self) -> str:
        return "coqui"

    @property
    def cost_per_1k_chars(self) -> float:
        return 0.0  # Free

    async def _get_model(self) -> TTS:
        """Lazy-load model with singleton pattern."""
        if self._model is None:
            async with self._model_lock:
                # Double-check after acquiring lock
                if self.model_name not in self._model_cache:
                    logger.info(f"Loading Coqui XTTS model: {self.model_name}")
                    # Load in executor to not block event loop (model loading is sync)
                    loop = asyncio.get_event_loop()
                    model = await loop.run_in_executor(
                        None,
                        lambda: TTS(self.model_name, gpu=self.use_gpu)
                    )
                    self._model_cache[self.model_name] = model
                    logger.info(f"Model loaded. GPU mode: {self.use_gpu}")

                self._model = self._model_cache[self.model_name]

        return self._model

    async def list_voices(self, language: Optional[str] = None) -> List[TTSVoice]:
        """
        List available voices.
        For XTTS, these are cloned voices + preset language options.
        """
        voices = []

        # Cloned voices (user-created)
        for voice_id, sample_path in self._cloned_voices.items():
            voices.append(TTSVoice(
                id=voice_id,
                name=f"Cloned: {voice_id}",
                language="multi",  # XTTS supports 17 languages per voice
                gender=None,
                provider="coqui",
                requires_cloning=True,
                cost_per_1k_chars=0.0
            ))

        # XTTS doesn't have preset voices - all voices are cloned
        # Return empty if no cloned voices yet
        return voices

    async def generate_audio(
        self,
        text: str,
        voice_id: str,
        output_path: Path,
        language: str = "en",
        **kwargs
    ) -> TTSResult:
        """
        Generate audio using cloned voice.

        Args:
            text: Text to synthesize
            voice_id: ID of cloned voice
            output_path: Where to save audio
            language: Language code (en, es, fr, de, it, pt, pl, tr, ru, nl, cs, ar, zh, ja, hu, ko, hi)
            **kwargs: Additional options
        """
        if voice_id not in self._cloned_voices:
            raise ValueError(f"Voice ID '{voice_id}' not found. Clone a voice first.")

        speaker_wav = self._cloned_voices[voice_id]
        model = await self._get_model()

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        logger.info(f"Generating TTS: {len(text)} chars, voice={voice_id}, lang={language}")

        # Run in executor (TTS is sync)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: model.tts_to_file(
                text=text,
                speaker_wav=str(speaker_wav),
                language=language,
                file_path=str(output_path)
            )
        )

        # Get duration
        import librosa
        audio_data, sr = librosa.load(str(output_path), sr=None)
        duration = librosa.get_duration(y=audio_data, sr=sr)

        logger.info(f"Audio generated: {output_path}, duration={duration:.1f}s")

        return TTSResult(
            audio_path=output_path,
            duration_seconds=duration,
            provider="coqui",
            voice_id=voice_id,
            cost=0.0
        )

    async def supports_voice_cloning(self) -> bool:
        return True

    async def clone_voice(
        self,
        sample_audio_path: Path,
        voice_name: str
    ) -> str:
        """
        Clone a voice from audio sample.

        Args:
            sample_audio_path: Path to 6+ second audio sample (WAV preferred)
            voice_name: Display name for the voice

        Returns:
            voice_id: Unique identifier for this cloned voice
        """
        if not sample_audio_path.exists():
            raise FileNotFoundError(f"Audio sample not found: {sample_audio_path}")

        # Validate sample duration
        import librosa
        audio_data, sr = librosa.load(str(sample_audio_path), sr=None)
        duration = librosa.get_duration(y=audio_data, sr=sr)

        if duration < 6.0:
            raise ValueError(f"Audio sample too short: {duration:.1f}s. Minimum: 6s")

        # Generate unique voice ID
        import uuid
        voice_id = f"{voice_name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}"

        # Store voice sample reference (XTTS uses sample at generation time)
        self._cloned_voices[voice_id] = sample_audio_path

        logger.info(f"Voice cloned: {voice_id}, sample_duration={duration:.1f}s")

        return voice_id
```

### Complete TTS API Routes

```python
# Source: FastAPI patterns + Edit Factory routing conventions
# app/api/tts_routes.py

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends
from pathlib import Path
from typing import Optional
import logging
from app.api.auth import ProfileContext, get_profile_context
from app.services.tts.factory import get_tts_service
from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tts", tags=["tts"])

@router.get("/providers")
async def list_providers():
    """
    List available TTS providers with cost information.
    """
    settings = get_settings()

    providers = [
        {
            "id": "edge",
            "name": "Edge TTS",
            "description": "Microsoft Edge voices, completely free",
            "cost_per_1k_chars": 0.0,
            "available": True,
            "features": ["100+ voices", "Multiple languages", "Fast generation"],
            "supports_voice_cloning": False
        },
        {
            "id": "elevenlabs",
            "name": "ElevenLabs",
            "description": "Premium quality, natural-sounding voices",
            "cost_per_1k_chars": 0.22,
            "available": bool(settings.elevenlabs_api_key),
            "features": ["Highest quality", "Natural prosody", "Emotional range"],
            "supports_voice_cloning": False
        },
        {
            "id": "coqui",
            "name": "Coqui XTTS",
            "description": "Voice cloning with 6-second sample",
            "cost_per_1k_chars": 0.0,
            "available": True,  # Check if model is downloaded
            "features": ["Voice cloning", "17 languages", "Local processing"],
            "supports_voice_cloning": True
        },
        {
            "id": "kokoro",
            "name": "Kokoro TTS",
            "description": "Fast lightweight local TTS",
            "cost_per_1k_chars": 0.0,
            "available": _check_kokoro_available(),
            "features": ["Very fast", "5 preset voices", "Lightweight"],
            "supports_voice_cloning": False
        }
    ]

    return {"providers": providers}

@router.get("/voices")
async def list_voices(
    provider: str,
    language: Optional[str] = None,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    List available voices for a provider.
    """
    try:
        tts_service = get_tts_service(
            provider=provider,
            profile_id=profile.profile_id
        )
        voices = await tts_service.list_voices(language=language)

        return {
            "provider": provider,
            "voices": [
                {
                    "id": v.id,
                    "name": v.name,
                    "language": v.language,
                    "gender": v.gender,
                    "cost_per_1k_chars": v.cost_per_1k_chars,
                    "requires_cloning": v.requires_cloning
                }
                for v in voices
            ]
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/generate")
async def generate_tts(
    text: str = Form(...),
    provider: str = Form(...),
    voice_id: str = Form(...),
    language: str = Form(default="en"),
    background_tasks: BackgroundTasks = None,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Generate TTS audio.
    Returns immediately with job_id for background processing.
    """
    from app.services.job_storage import get_job_storage
    import uuid

    job_storage = get_job_storage()
    job_id = str(uuid.uuid4())

    # Create job record
    job_storage.create_job(
        job_id=job_id,
        job_type="tts_generation",
        profile_id=profile.profile_id,
        initial_data={
            "text": text[:100] + "..." if len(text) > 100 else text,
            "provider": provider,
            "voice_id": voice_id,
            "language": language,
            "char_count": len(text)
        }
    )

    # Start background task
    background_tasks.add_task(
        _generate_tts_background,
        job_id=job_id,
        text=text,
        provider=provider,
        voice_id=voice_id,
        language=language,
        profile_id=profile.profile_id
    )

    return {
        "job_id": job_id,
        "status": "processing",
        "estimated_time_seconds": len(text) / 50  # Rough estimate: 50 chars/sec
    }

async def _generate_tts_background(
    job_id: str,
    text: str,
    provider: str,
    voice_id: str,
    language: str,
    profile_id: str
):
    """Background task for TTS generation."""
    from app.services.job_storage import get_job_storage
    from app.services.cost_tracker import get_cost_tracker

    job_storage = get_job_storage()
    cost_tracker = get_cost_tracker()

    try:
        job_storage.update_job(job_id, status="processing", progress=10)

        # Get TTS service
        tts_service = get_tts_service(
            provider=provider,
            profile_id=profile_id,
            voice_id=voice_id
        )

        # Generate audio
        settings = get_settings()
        output_path = settings.output_dir / "tts" / profile_id / f"{job_id}.mp3"

        job_storage.update_job(job_id, progress=30)

        result = await tts_service.generate_audio(
            text=text,
            voice_id=voice_id,
            output_path=output_path,
            language=language
        )

        job_storage.update_job(job_id, progress=80)

        # Log cost
        if result.cost > 0:
            cost_tracker.log_cost(
                service=provider,
                operation="tts_generation",
                cost=result.cost,
                profile_id=profile_id,
                metadata={
                    "char_count": len(text),
                    "voice_id": voice_id,
                    "duration": result.duration_seconds
                }
            )

        # Complete job
        job_storage.update_job(
            job_id,
            status="completed",
            progress=100,
            data={
                "audio_path": str(result.audio_path),
                "duration_seconds": result.duration_seconds,
                "cost": result.cost,
                "provider": result.provider,
                "voice_id": result.voice_id
            }
        )

        logger.info(f"[Job {job_id}] TTS generation complete: {result.audio_path}")

    except Exception as e:
        logger.error(f"[Job {job_id}] TTS generation failed: {e}")
        job_storage.update_job(
            job_id,
            status="failed",
            data={"error": str(e)}
        )

def _check_kokoro_available() -> bool:
    """Check if Kokoro TTS is available (espeak-ng installed)."""
    import subprocess
    try:
        result = subprocess.run(
            ["espeak-ng", "--version"],
            capture_output=True,
            timeout=5
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
```

### Profile Settings UI with TTS Provider Selection

```tsx
// Source: Edit Factory frontend patterns + Shadcn UI
// frontend/src/app/settings/page.tsx (TTS section)

"use client"

import { useState, useEffect } from "react"
import { useProfile } from "@/contexts/profile-context"
import { ProviderSelector } from "@/components/tts/provider-selector"
import { VoiceSelector } from "@/components/tts/voice-selector"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { apiPost, apiGet } from "@/lib/api"

export default function SettingsPage() {
  const { profile, refreshProfile } = useProfile()
  const { toast } = useToast()

  const [ttsProvider, setTtsProvider] = useState(profile?.tts_settings?.provider || "edge")
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState(null)
  const [loading, setLoading] = useState(false)

  // Load voices when provider changes
  useEffect(() => {
    const loadVoices = async () => {
      try {
        const response = await apiGet(`/tts/voices?provider=${ttsProvider}`)
        setVoices(response.voices)

        // Auto-select first voice if none selected
        if (!selectedVoice && response.voices.length > 0) {
          setSelectedVoice(response.voices[0].id)
        }
      } catch (error) {
        console.error("Failed to load voices:", error)
      }
    }

    loadVoices()
  }, [ttsProvider])

  const handleSave = async () => {
    setLoading(true)
    try {
      // Update profile TTS settings
      await apiPost(`/profiles/${profile.id}`, {
        tts_settings: {
          provider: ttsProvider,
          [ttsProvider]: {
            voice_id: selectedVoice
          }
        }
      })

      await refreshProfile()

      toast({
        title: "Settings saved",
        description: "TTS provider and voice updated successfully"
      })
    } catch (error) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Text-to-Speech Provider</CardTitle>
          <CardDescription>
            Choose your preferred TTS provider. Free options have no cost, paid providers offer premium quality.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ProviderSelector
            value={ttsProvider}
            onChange={setTtsProvider}
          />

          {voices.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Voice</label>
              <VoiceSelector
                voices={voices}
                value={selectedVoice}
                onChange={setSelectedVoice}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              onClick={handleSave}
              disabled={loading}
            >
              {loading ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Synchronous TTS API calls | FastAPI BackgroundTasks + job polling | Edit Factory v1 | 10-30 second TTS requests don't block, progress tracking |
| Single TTS provider (ElevenLabs) | Multi-provider abstraction | Phase 4 | Users can choose free alternatives, reduce costs |
| Hardcoded voice settings | Per-profile TTS settings in database | Phase 1 profiles | Different voices per profile/brand |
| Manual audio sample validation | librosa duration + quality checks | Phase 4 | Prevent poor voice cloning quality |
| Eager model loading | Lazy singleton pattern | Phase 4 | Faster startup, lower memory usage |

**Deprecated/outdated:**
- **Coqui AI SaaS platform:** Company shut down December 2025. Use open-source TTS library instead (still maintained by community).
- **Python 3.7-3.8 for TTS:** Coqui TTS requires Python 3.9+. PyTorch 2.x requires 3.8+. Edit Factory uses 3.12 (compatible).
- **CUDA 11.x for PyTorch:** Current PyTorch 2.x targets CUDA 12.x. Use CUDA 12.1+ for best compatibility.

## Open Questions

Things that couldn't be fully resolved:

1. **Should voice cloning samples be stored permanently or cleaned up?**
   - What we know: Samples are 1-5MB, used only during cloning, not needed for generation
   - What's unclear: Whether users want to re-use samples later or regenerate clones
   - Recommendation: Store for 30 days, then auto-cleanup. Add UI option to download sample if user wants to save it.

2. **Does Coqui XTTS model download work in Docker with restricted internet?**
   - What we know: Model auto-downloads from HuggingFace (2GB+) on first use
   - What's unclear: Whether corporate firewalls or Docker network restrictions block this
   - Recommendation: Pre-download model during Docker build. Add `RUN python deploy/download_tts_models.py` to Dockerfile.

3. **Should we support custom Coqui XTTS models (fine-tuned)?**
   - What we know: Users can fine-tune XTTS for better quality on specific voices
   - What's unclear: Whether Phase 4 scope includes custom model support or just base model
   - Recommendation: Phase 4 uses base XTTS-v2 model only. Add custom model support in Phase 5+ if users request it.

4. **How to handle GPU out-of-memory errors during concurrent TTS requests?**
   - What we know: XTTS loads 2GB model into VRAM, multiple concurrent requests can OOM
   - What's unclear: Whether to queue requests or use CPU fallback
   - Recommendation: Implement request queue with max concurrency=2 for GPU, unlimited for CPU. Add GPU memory monitoring.

## Sources

### Primary (HIGH confidence)
- [edge-tts GitHub](https://github.com/rany2/edge-tts) - Official Edge TTS Python library
- [edge-tts PyPI](https://pypi.org/project/edge-tts/) - Installation and version info
- [Coqui TTS GitHub](https://github.com/coqui-ai/TTS) - Official Coqui TTS library (community-maintained after company shutdown)
- [XTTS-v2 HuggingFace](https://huggingface.co/coqui/XTTS-v2) - Model card with requirements and usage
- [Kokoro GitHub](https://github.com/hexgrad/kokoro) - Official Kokoro TTS library
- [Kokoro PyPI](https://pypi.org/project/kokoro/) - Installation requirements
- [FastAPI File Upload Guide](https://betterstack.com/community/guides/scaling-python/uploading-files-using-fastapi/) - Best practices for file validation
- [Shadcn UI Radio Group](https://ui.shadcn.com/docs/components/radio-group) - Official component documentation

### Secondary (MEDIUM confidence)
- [PyTorch Installation Guide](https://pytorch.org/get-started/locally/) - CUDA version compatibility
- [Coqui TTS Review 2026](https://qcall.ai/coqui-tts-review) - Post-shutdown status, community maintenance
- [Voice Cloning Best Practices Discussion](https://github.com/coqui-ai/TTS/discussions/2507) - Community insights on sample quality
- [FastAPI File Upload Validation](https://medium.com/@jayhawk24/upload-files-in-fastapi-with-file-validation-787bd1a57658) - Audio-specific validation patterns

### Tertiary (LOW confidence)
- WebSearch findings about TTS provider comparisons (2026) - General market landscape
- Community discussions on Kokoro vs Piper performance - Anecdotal benchmarks

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official documentation for all libraries (edge-tts, Coqui TTS, Kokoro)
- Installation requirements: HIGH - Verified from official GitHub repos and PyPI pages
- Voice cloning workflow: HIGH - Official XTTS-v2 model card and examples
- Architecture patterns: HIGH - Based on FastAPI best practices and existing Edit Factory patterns
- Pitfalls: HIGH - Derived from official troubleshooting guides and deployment docs
- Code examples: HIGH - Adapted from official library examples + Edit Factory conventions

**Research date:** 2026-02-03
**Valid until:** 2026-04-03 (60 days - TTS libraries are stable, but verify PyTorch/CUDA compatibility at deployment)

**Note for planner:** Phase 4 adds TTS provider abstraction but doesn't modify video processing workflow. Existing `video_processor.py` and `elevenlabs_tts.py` need refactoring to use new `TTSService` interface. Profile system (Phase 1-3) provides TTS settings storage. UI needs provider selection component and voice cloning upload form. Installation complexity (PyTorch, espeak-ng) requires deployment documentation and verification scripts.
