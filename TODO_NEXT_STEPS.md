# TODO - Next Steps pentru Edit Factory

**Data creării**: 2026-01-02
**Status**: Prioritizat după impact și efort

---

## PRIORITATE ÎNALTĂ (Săptămâna 1-2)

### 1. Completează Job Storage Migration 🚧
**Efort**: 4-6 ore
**Impact**: ÎNALT (previne pierderea jobs la restart)

**Locații rămase** (15 în total):

```python
# routes.py - locații de actualizat:
# Line 626: jobs_store[job_id] = job → job_storage.create_job(job)
# Line 641: job = jobs_store.get(job_id) → job = job_storage.get_job(job_id)
# Line 707: job = jobs_store.get(job_id) → job = job_storage.get_job(job_id)
# Line 741: for j in jobs_store.values() → for j in job_storage.list_jobs()
# Line 749: job = jobs_store.get(job_id) → job = job_storage.get_job(job_id)
# Line 886: jobs_store[job_id] = job → job_storage.create_job(job)
# Line 901: job = jobs_store.get(job_id) → job = job_storage.get_job(job_id)
# Line 1037: jobs_store[job_id] = job → job_storage.create_job(job)
# Line 1053: job = jobs_store.get(job_id) → job = job_storage.get_job(job_id)
# Line 1123: job = jobs_store.get(job_id) → job = job_storage.get_job(job_id)
# Line 1210: jobs_store[job_id] = job → job_storage.create_job(job)
# Line 1227: job = jobs_store.get(job_id) → job = job_storage.get_job(job_id)
# Line 1400: job = jobs_store.get(job_id) → job = job_storage.get_job(job_id)
# Line 1415: del jobs_store[job_id] → job_storage.delete_job(job_id)
```

**Pattern de migrare**:
```python
# Old:
job = {...}
jobs_store[job_id] = job
job["status"] = "processing"

# New:
job_storage = get_job_storage()
job = {...}
job_storage.create_job(job)
job_storage.update_job(job_id, {"status": "processing"})
```

**Helper script**: Rulează `scripts/migrate_job_storage.py` pentru automatizare parțială

**Validare**:
- [ ] Testează fiecare endpoint modificat
- [ ] Verifică că job-urile apar în Supabase
- [ ] Testează fallback la in-memory dacă Supabase indisponibil

---

### 2. Creează Schema Supabase pentru Jobs 📊
**Efort**: 1 oră
**Impact**: ÎNALT (necesară pentru JobStorage)

**SQL Migration**:
```sql
-- Creează tabela jobs
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL DEFAULT 'video_processing',
    status TEXT NOT NULL DEFAULT 'pending',
    progress TEXT,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexuri pentru performanță
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_jobs_type_status ON jobs(job_type, status);

-- RLS (Row Level Security) - optional
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Policy pentru read all
CREATE POLICY "Allow read access to all jobs"
ON jobs FOR SELECT
USING (true);

-- Policy pentru write (doar pentru authenticated users)
CREATE POLICY "Allow insert/update for authenticated users"
ON jobs FOR ALL
USING (auth.uid() IS NOT NULL);
```

**Execuție**:
1. [ ] Conectează-te la Supabase Dashboard
2. [ ] SQL Editor → Paste migration
3. [ ] Run migration
4. [ ] Verifică că tabela apare în Table Editor

---

### 3. Testare JobStorage în Development 🧪
**Efort**: 2-3 ore
**Impact**: ÎNALT (validare înainte de production)

**Test Cases**:

```python
# test_job_storage.py

import pytest
from app.services.job_storage import JobStorage, get_job_storage
from datetime import datetime

def test_create_job():
    storage = get_job_storage()
    job = {
        "job_id": "test_123",
        "job_type": "video_processing",
        "status": "pending",
        "progress": "Queued"
    }
    created = storage.create_job(job)
    assert created["job_id"] == "test_123"

def test_get_job():
    storage = get_job_storage()
    job = storage.get_job("test_123")
    assert job is not None
    assert job["status"] == "pending"

def test_update_job():
    storage = get_job_storage()
    updated = storage.update_job("test_123", {"status": "processing"})
    assert updated["status"] == "processing"

def test_list_jobs():
    storage = get_job_storage()
    jobs = storage.list_jobs(status="pending", limit=10)
    assert isinstance(jobs, list)

def test_delete_job():
    storage = get_job_storage()
    result = storage.delete_job("test_123")
    assert result is True

def test_fallback_to_memory():
    # Test când Supabase e indisponibil
    storage = JobStorage()
    storage._supabase = None  # Simulează disconnect
    job = {"job_id": "mem_123", "status": "pending"}
    created = storage.create_job(job)
    assert created["job_id"] == "mem_123"
```

**Rulare**:
```bash
pytest app/tests/test_job_storage.py -v
```

**Checklist**:
- [ ] Toate test-urile trec
- [ ] Testează cu Supabase conectat
- [ ] Testează fallback (disconnect Supabase temporar)
- [ ] Verifică performanță (latency < 100ms)

---

## PRIORITATE MEDIE (Săptămâna 3-4)

### 4. Extract Video Utilities în video_utils.py 🛠️
**Efort**: 3 ore
**Impact**: MEDIU (reduce duplicare)

**Creează fișier**: `app/services/video_utils.py`

```python
"""
Video Utilities Service.
Shared helpers pentru video metadata extraction și processing.
"""
import subprocess
import json
import logging
from pathlib import Path
from typing import Optional, Dict, Tuple

logger = logging.getLogger(__name__)


def get_video_info(video_path: Path) -> Dict:
    """
    Extract video metadata (duration, fps, resolution, rotation).

    Returns:
        {
            "duration": float,
            "fps": float,
            "width": int,
            "height": int,
            "rotation": int,  # 0, 90, 180, 270
            "codec": str,
            "bitrate": int
        }
    """
    # Move logic from routes.py:446-532 and library_routes.py:1547-1587
    # Use ffprobe to extract metadata
    pass


def get_video_rotation(video_path: Path) -> int:
    """
    Detect video rotation angle.

    Returns:
        0, 90, 180, or 270 degrees
    """
    pass


def get_video_duration(video_path: Path) -> float:
    """Get video duration in seconds."""
    pass


def get_video_resolution(video_path: Path) -> Tuple[int, int]:
    """Get video resolution (width, height)."""
    pass
```

**Apoi actualizează**:
- [ ] `routes.py` - replace inline logic cu `from app.services.video_utils import get_video_info`
- [ ] `library_routes.py` - replace `_get_video_info()` cu shared function
- [ ] `video_processor.py` - verifică dacă beneficiază de helpers

---

### 5. Migrează Legacy Endpoints la /library/* 🔄
**Efort**: 6-8 ore
**Impact**: MEDIU (consolidare API)

**Endpoints de migrat**:

#### 5.1 Voice Muting
```python
# In library_routes.py
@router.post("/library/videos/mute-voice")
async def mute_voice_in_video(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    output_name: Optional[str] = Form(None),
    keep_percentage: float = Form(0.0)
):
    """Detectează și mută vocile dintr-un video."""
    # Move logic from routes.py:297-355
    # Use JobStorage instead of jobs_store
    pass
```

#### 5.2 Video Analysis
```python
@router.post("/library/videos/analyze")
async def analyze_video(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    target_duration: float = Form(20.0)
):
    """Analizează video și generează segmente."""
    # Move logic from routes.py:427-619
    pass
```

#### 5.3 TTS Generation
```python
@router.post("/library/audio/tts")
async def generate_tts(
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    voice_id: Optional[str] = Form(None)
):
    """Generează TTS audio din text."""
    # Move logic from routes.py:918-1125
    pass
```

**Checklist**:
- [ ] Migrează logica (copy-paste inițial)
- [ ] Înlocuiește `jobs_store` cu `job_storage`
- [ ] Testează fiecare endpoint
- [ ] Update API docs (Swagger)

---

### 6. Adaugă Deprecation Warnings în routes.py ⚠️
**Efort**: 1 oră
**Impact**: MEDIU (pregătire pentru removal)

**La începutul routes.py**:
```python
"""
DEPRECATED: Legacy routes - Use /library/* endpoints instead.

This module will be removed in v2.0.
All new development should use library_routes.py.

Migration guide: /docs/ROUTES_MIGRATION_STRATEGY.md
"""

import warnings

warnings.warn(
    "routes.py is deprecated. Use library_routes.py for all new endpoints. "
    "See ROUTES_MIGRATION_STRATEGY.md for migration guide.",
    DeprecationWarning,
    stacklevel=2
)
```

**La fiecare endpoint deprecated**:
```python
@router.post("/analyze")
async def analyze_video(...):
    """
    DEPRECATED: Use /library/videos/analyze instead.
    This endpoint will be removed in v2.0.
    """
    warnings.warn(
        "POST /analyze is deprecated. Use POST /library/videos/analyze",
        DeprecationWarning
    )
    # ... existing logic
```

---

## PRIORITATE SCĂZUTĂ (Backlog)

### 7. Edge-TTS Volume Tracking 📊
**Efort**: 2 ore
**Impact**: SCĂZUT (e free, doar pentru statistici)

```python
# În edge_tts_service.py
from app.services.cost_tracker import get_cost_tracker

async def generate_audio(self, text: str, voice: str, output_path: Path):
    # ... generate audio ...

    # Track volume (cost = 0 pentru Edge-TTS)
    tracker = get_cost_tracker()
    tracker.log_edge_tts(
        job_id=output_path.stem,
        characters=len(text),
        note="Free tier - volume tracking only"
    )
```

**Actualizează cost_tracker.py**:
```python
def log_edge_tts(self, job_id: str, characters: int, note: str = ""):
    """Log Edge-TTS usage (free tier, no cost)."""
    entry = CostEntry(
        timestamp=datetime.now().isoformat(),
        job_id=job_id,
        service="edge_tts",
        operation="tts",
        input_units=characters,
        cost_usd=0.0,  # Free
        details={"note": note}
    )
    self._add_entry(entry)
    self._save_to_supabase(entry)
```

---

### 8. Retry Logic în Cost Tracker 🔄
**Efort**: 2 ore
**Impact**: SCĂZUT (îmbunătățire robustețe)

```python
# În cost_tracker.py
import time

def _save_to_supabase(self, entry: CostEntry, max_retries: int = 3) -> bool:
    """Save entry to Supabase with retry logic."""
    if not self._supabase:
        return False

    for attempt in range(max_retries):
        try:
            data = {
                "job_id": entry.job_id,
                "service": entry.service,
                "operation": entry.operation,
                "units": entry.input_units,
                "estimated_cost": entry.cost_usd,
                "details": entry.details
            }

            result = self._supabase.table("api_costs").insert(data).execute()
            logger.info(f"Cost saved to Supabase: {entry.service} - ${entry.cost_usd}")
            return True
        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt  # Exponential backoff: 1s, 2s, 4s
                logger.warning(f"Supabase insert failed (attempt {attempt+1}/{max_retries}): {e}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                logger.error(f"Failed to save to Supabase after {max_retries} attempts: {e}")
                return False

    return False
```

---

### 9. Render Progress Tracking Endpoint 📈
**Efort**: 4 ore
**Impact**: SCĂZUT (nice-to-have pentru UX)

**Problema**: Frontend nu știe progresul render-ului (doar "processing")

**Soluție**: Similar cu generation progress

```python
# În library_routes.py

# Global progress store pentru render
_render_progress_store: Dict[str, dict] = {}

@router.get("/clips/{clip_id}/render/progress")
async def get_render_progress(clip_id: str):
    """Get render progress for a clip."""
    progress = _render_progress_store.get(clip_id, {
        "percentage": 0,
        "current_step": None,
        "estimated_remaining": None
    })
    return progress

# În _render_final_clip_task():
def report_render_progress(step: str, percentage: int):
    _render_progress_store[clip_id] = {
        "percentage": percentage,
        "current_step": step,
        "estimated_remaining": None  # TODO: calculate based on elapsed time
    }

# Example usage:
report_render_progress("Generating TTS", 20)
# ... generate TTS ...
report_render_progress("Adding subtitles", 60)
# ... add subtitles ...
report_render_progress("Encoding video", 90)
# ... final encoding ...
```

**Frontend update** (page.tsx):
```typescript
// Similar cu generation progress polling
const pollRenderProgress = async (clipId: string) => {
  const res = await fetch(`${API_URL}/library/clips/${clipId}/render/progress`);
  const progress = await res.json();
  setRenderProgress(progress);
};
```

---

### 10. Cleanup și Remove routes.py 🗑️
**Efort**: 2 ore
**Impact**: SCĂZUT (cleanup, doar după migrare completă)

**Când**: După 2-3 release-uri cu deprecation warnings (estimat: v2.0)

**Checklist**:
- [ ] Verifică că toate endpoint-urile au echivalent în library_routes.py
- [ ] Verifică că frontend-ul NU mai folosește endpoint-uri din routes.py
- [ ] Șterge fișierul `app/api/routes.py`
- [ ] Actualizează `app/main.py`:
  ```python
  # OLD:
  app.include_router(routes.router, prefix="/api/v1")
  app.include_router(library_routes.router, prefix="/api/v1")

  # NEW:
  app.include_router(library_routes.router, prefix="/api/v1")
  ```
- [ ] Update tests să folosească doar library endpoints
- [ ] Update documentație (README, API docs)

---

## TESTING CHECKLIST

### Unit Tests
- [ ] `test_job_storage.py` - JobStorage cu Supabase mock
- [ ] `test_srt_validator.py` - SRT validation logic
- [ ] `test_video_utils.py` - Video info extraction (după creare)

### Integration Tests
- [ ] `test_migration_endpoints.py` - Verify compatibilitate
- [ ] `test_render_pipeline.py` - Full render cu SRT validation
- [ ] `test_cost_tracking.py` - Toate serviciile (ElevenLabs, Gemini, Edge-TTS)

### E2E Tests
- [ ] `test_workflow_complete.py` - Project creation → Generation → Render → Export
- [ ] `test_job_persistence.py` - Create job → Restart server → Verify job exists

---

## METRICS & MONITORING

### KPIs de urmărit:
- [ ] Job storage latency: < 100ms (p95)
- [ ] SRT validation overhead: < 10ms
- [ ] Cost tracking coverage: 100% (toate serviciile)
- [ ] API response time: < 200ms (p95)
- [ ] Zero job loss rate (post-migration)

### Monitoring Setup:
- [ ] Supabase dashboard pentru jobs table
- [ ] Cost summary endpoint: `GET /library/usage/costs`
- [ ] Job cleanup cron: Daily cleanup of jobs > 7 days old

---

## RESOURCE LINKS

**Documentație**:
- Migration Notes: `/mnt/c/OBSID SRL/n8n/edit_factory/MIGRATION_NOTES.md`
- Voice Muting: `/mnt/c/OBSID SRL/n8n/edit_factory/VOICE_MUTING_ARCHITECTURE.md`
- Migration Strategy: `/mnt/c/OBSID SRL/n8n/edit_factory/ROUTES_MIGRATION_STRATEGY.md`
- Summary: `/mnt/c/OBSID SRL/n8n/edit_factory/ANALYSIS_AND_FIXES_SUMMARY.md`

**Code References**:
- JobStorage: `app/services/job_storage.py`
- SRT Validator: `app/services/srt_validator.py`
- Cost Tracker: `app/services/cost_tracker.py`
- Gemini Analyzer: `app/services/gemini_analyzer.py`

---

**Last Updated**: 2026-01-02
**Next Review**: După completarea Prioritate ÎNALTĂ (săptămâna 2)
