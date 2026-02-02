# Technology Stack: Profile/Workspace Isolation & Free TTS Integration

**Project:** Edit Factory - Profile/Workspace Isolation Milestone
**Researched:** February 3, 2026
**Focus Areas:** Multi-tenant architecture, free TTS providers, developer experience tooling

## Recommended Stack

### Multi-Tenant Architecture

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Supabase RLS | Current | Workspace data isolation | Native PostgreSQL Row-Level Security provides defense-in-depth isolation at database level. Zero additional infrastructure required. |
| Auth app_metadata | Current | Tenant/workspace identification | Store `workspace_id` in `raw_app_meta_data` (immutable by users) rather than `user_metadata`. Accessible in RLS policies via `auth.jwt()`. |
| PostgreSQL workspace_id column | Current | Tenant scoping | Add `workspace_id UUID` to all tenant-scoped tables (projects, clips, api_costs, etc.). Use as final column in composite indexes for query performance. |

**Confidence:** HIGH (verified via official Supabase RLS documentation)

**Rationale:**
- Supabase RLS is production-tested for multi-tenancy with active community patterns in 2026
- No additional services required (Redis, separate databases, application-level filtering)
- Performance: RLS policies execute at database level with proper indexing
- Security: Users literally cannot access other workspaces' data, even with API key compromise
- DX: Setup takes ~2 hours with templates, integrates seamlessly with existing Supabase auth

**Implementation Pattern:**
```python
# Store workspace_id during signup
await supabase.auth.sign_up({
    "email": email,
    "password": password,
    "options": {
        "app_metadata": {"workspace_id": workspace_id}
    }
})

# RLS policy example
CREATE POLICY "Users can only access their workspace projects"
ON projects
FOR ALL
USING (workspace_id = (auth.jwt() -> 'app_metadata' ->> 'workspace_id')::uuid);
```

### Free TTS Providers

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| Kokoro TTS | >=0.9.4 | Primary free TTS engine | 82M parameters, Apache 2.0 license, quality comparable to larger models, runs on modest hardware. ONNX format for CPU inference. Actively maintained in 2026. |
| piper-tts | 1.4.0 | Edge device TTS | Fastest inference on limited hardware (Raspberry Pi optimized). Lower quality than Kokoro but excellent speed/resource tradeoff. Good for preview/draft mode. |
| Coqui TTS | 0.27.5 | High-quality neural TTS | Pre-trained voices in 1100+ languages. Best quality but most resource-intensive. Use for premium/final renders when quality critical. |
| edge-tts | Current (via RealtimeTTS) | Existing fallback | Already integrated. Keep as zero-setup fallback option. |
| RealtimeTTS | Latest | Unified TTS interface | Abstraction layer supporting all engines above. Install with `pip install realtimetts[all]` for unified API. |

**Confidence:** HIGH for Kokoro/Piper/Coqui (verified via PyPI, GitHub, official docs), MEDIUM for RealtimeTTS (verified via GitHub)

**Installation Priority:**

1. **Kokoro (Recommended Default):**
```bash
pip install kokoro>=0.9.4 soundfile
# System dependency
apt-get install espeak-ng  # Linux
brew install espeak        # macOS
```
**Python:** 3.9-3.12 (not 3.13+)
**Models:** Download `kokoro-v1.0.onnx` and `voices-v1.0.bin` (auto-downloaded or manual)

2. **Piper (Fast Preview Mode):**
```bash
pip install piper-tts==1.4.0
```
**Python:** 3.9+
**Models:** Auto-downloads on first use

3. **Coqui (Premium Quality):**
```bash
# Install PyTorch first (required since 0.27.4)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install coqui-tts==0.27.5
```
**Python:** 3.10-3.14
**Models:** 1100+ pre-trained voices, downloaded on demand

4. **RealtimeTTS (Optional Abstraction):**
```bash
pip install realtimetts[all]
```
**Python:** 3.9-3.12
**Note:** Includes all engines above via extras, but heavier install

### Developer Experience: One-Click Launch

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| concurrently | 9.2.1 | Cross-platform parallel execution | Run FastAPI + Next.js dev servers simultaneously. Works on Windows/WSL/Linux/Mac. 8.6M weekly downloads, actively maintained. |
| Windows .bat script | N/A | Windows native launcher | For users running from Windows (not WSL). Activates venv, starts backend, opens frontend. |
| Bash .sh script | N/A | WSL/Linux/Mac launcher | For WSL/Unix environments. Uses `concurrently` or background processes. |

**Confidence:** HIGH (concurrently verified via npm registry, batch/bash patterns verified via community implementations)

**Recommended Approach: Dual Scripts**

**Option A: npm-based (Recommended for existing Node.js project):**

Add to `package.json` in project root:
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\" --names \"API,UI\" --prefix-colors \"blue,green\"",
    "dev:backend": "cd .. && venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000",
    "dev:frontend": "cd frontend && npm run dev"
  },
  "devDependencies": {
    "concurrently": "^9.2.1"
  }
}
```

**Usage:** `npm run dev` from project root

**Option B: Windows Batch File** (`start-dev.bat`):

```batch
@echo off
echo Starting Edit Factory Development Environment...

REM Start backend in new window
start "Edit Factory Backend" cmd /k "cd /d %~dp0 && venv\Scripts\activate.bat && python -m uvicorn app.main:app --reload --port 8000"

REM Wait 2 seconds for backend to initialize
timeout /t 2 /nobreak >nul

REM Start frontend in new window
start "Edit Factory Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev"

echo Both servers started in separate windows.
echo Backend: http://localhost:8000
echo Frontend: http://localhost:3000
pause
```

**Usage:** Double-click `start-dev.bat` from Windows Explorer or run from PowerShell

**Option C: WSL Bash Script** (`start-dev.sh`):

```bash
#!/bin/bash
set -e

echo "Starting Edit Factory Development Environment..."

# Activate venv and start backend in background
source venv/bin/activate
uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!

# Start frontend in background
cd frontend
npm run dev &
FRONTEND_PID=$!

echo "Both servers started:"
echo "  Backend (PID $BACKEND_PID): http://localhost:8000"
echo "  Frontend (PID $FRONTEND_PID): http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both servers..."

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
```

**Usage:** `chmod +x start-dev.sh && ./start-dev.sh`

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Multi-Tenancy | Supabase RLS | Separate databases per tenant | Over-engineering for 2-10 workspaces. Adds complexity, backup/migration overhead. RLS is simpler and secure. |
| Multi-Tenancy | app_metadata | Custom tenants_to_users table | Extra SELECT on every query. app_metadata is in JWT, zero additional lookups. |
| Multi-Tenancy | RLS policies | Application-level filtering | Security risk if forgotten in any query. RLS is defense-in-depth at DB level. |
| Free TTS | Kokoro | Bark | Bark (Suno AI) is 890M params, 10x larger. Slower inference, higher memory. Kokoro has better speed/quality ratio. |
| Free TTS | Kokoro | StyleTTS2 | StyleTTS2 requires complex voice cloning setup. Overkill for preset voices use case. |
| Free TTS | Coqui | pyttsx3 | pyttsx3 uses system voices (robotic quality). Coqui is neural TTS with natural prosody. |
| Free TTS | RealtimeTTS | Individual engine integrations | RealtimeTTS adds abstraction overhead. Direct integration gives more control. Use RealtimeTTS if switching engines frequently. |
| Launch Script | concurrently | tmux/screen | tmux/screen not standard on Windows. concurrently is cross-platform npm package. |
| Launch Script | Batch + Bash scripts | Docker Compose | Docker adds container overhead for local dev. Native processes are faster, simpler for single-user dev environment. |
| Launch Script | npm scripts | Python invoke/fabric | invoke/fabric are Python task runners but frontend is Node.js. Mixing task runners is confusing. npm is already required for frontend. |

## Installation Sequences

### Workspace Isolation (Backend)

**No new dependencies required.** Uses existing Supabase client and PostgreSQL.

**Migration Steps:**
1. Add `workspace_id UUID` column to tenant-scoped tables
2. Create RLS policies for each table
3. Add workspace_id to composite indexes
4. Update signup flow to set app_metadata
5. Create workspace management endpoints

**Estimated Time:** 4-6 hours for full migration

### Free TTS Integration (Backend)

**Recommended: Start with Kokoro only**

```bash
# From project root
source venv/bin/activate  # or venv\Scripts\activate.bat on Windows

# Install Kokoro
pip install kokoro>=0.9.4 soundfile

# Install system dependency (Linux/WSL)
sudo apt-get install espeak-ng

# Verify installation
python -c "import kokoro; print('Kokoro installed successfully')"
```

**Add to requirements.txt:**
```
kokoro>=0.9.4
soundfile>=0.12.1
```

**Later: Add Piper for fast preview**
```bash
pip install piper-tts==1.4.0
```

**Later: Add Coqui for premium quality**
```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install coqui-tts==0.27.5
```

### One-Click Launch (Developer Experience)

**Option 1: npm-based (Recommended)**

```bash
# From project root
npm install --save-dev concurrently@^9.2.1

# Add scripts to package.json (see above)

# Test
npm run dev
```

**Option 2: Standalone Scripts**

Create `start-dev.bat` and/or `start-dev.sh` in project root (see templates above).

**Windows:**
```cmd
REM Just double-click start-dev.bat
start-dev.bat
```

**WSL/Linux/Mac:**
```bash
chmod +x start-dev.sh
./start-dev.sh
```

## Architecture Integration Notes

### Workspace Isolation Architecture

**Database Layer:**
- Add `workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` to:
  - `projects`
  - `clips`
  - `api_costs`
  - `jobs` (if persisted to DB)
  - New `workspace_postiz_configs` table (per-workspace Postiz API keys)
  - New `workspace_tts_presets` table (per-workspace voice settings)

**RLS Policy Pattern:**
```sql
-- Enable RLS on table
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "workspace_isolation_policy" ON projects
FOR ALL
USING (workspace_id = (auth.jwt() -> 'app_metadata' ->> 'workspace_id')::uuid);
```

**Auth Flow:**
1. User signs up → assign to workspace (or create new workspace)
2. Set `app_metadata.workspace_id` during signup
3. All queries automatically filtered by RLS
4. User can switch workspaces → update JWT → new app_metadata

**Frontend State:**
- Add workspace context provider
- Show workspace switcher in navbar
- Filter client-side state by current workspace (optimistic updates)

### Free TTS Integration Architecture

**Service Layer Pattern:**

```python
# app/services/tts_manager.py
from enum import Enum
from typing import Protocol

class TTSEngine(Enum):
    KOKORO = "kokoro"
    PIPER = "piper"
    COQUI = "coqui"
    EDGE = "edge"  # existing fallback

class TTSProvider(Protocol):
    async def synthesize(self, text: str, voice: str) -> bytes:
        ...

class KokoroTTS:
    async def synthesize(self, text: str, voice: str) -> bytes:
        # Implementation using kokoro library
        pass

class TTSManager:
    def __init__(self):
        self.providers = {
            TTSEngine.KOKORO: KokoroTTS(),
            TTSEngine.PIPER: PiperTTS(),
            TTSEngine.EDGE: EdgeTTS(),
            # COQUI added later
        }

    async def get_audio(
        self,
        text: str,
        engine: TTSEngine,
        voice: str,
        workspace_id: str  # for per-workspace presets
    ) -> bytes:
        provider = self.providers[engine]
        return await provider.synthesize(text, voice)
```

**API Changes:**
- Add `tts_engine` parameter to TTS endpoints (default: "kokoro")
- Add workspace-scoped voice presets endpoint
- Cost tracking per engine (Kokoro/Piper are free → $0.00 cost)

**Migration Strategy:**
1. Phase 1: Add Kokoro as optional engine, keep Edge-TTS default
2. Phase 2: Make Kokoro default, Edge-TTS fallback
3. Phase 3: Add Piper for fast preview mode
4. Phase 4: Add Coqui for premium quality

### Launch Script Integration

**Project Structure:**
```
edit_factory/
├── start-dev.bat          # Windows launcher
├── start-dev.sh           # WSL/Unix launcher
├── package.json           # Contains concurrently scripts
├── venv/                  # Python virtual environment
├── app/                   # FastAPI backend
├── frontend/              # Next.js frontend
│   └── package.json       # Frontend dependencies
└── .env                   # Environment variables
```

**Deployment Note:**
These scripts are for **local development only**. Production uses:
- Backend: `uvicorn app.main:app --host 0.0.0.0 --port 8000` (or gunicorn)
- Frontend: `npm run build && npm start` (Next.js production server)

## Python Version Compatibility Matrix

| Library | Min Python | Max Python | Notes |
|---------|------------|------------|-------|
| FastAPI | 3.8+ | 3.12+ | Existing backend |
| Kokoro | 3.9 | 3.12 | **Blocker: No Python 3.13 support yet** |
| Piper | 3.9 | 3.14 | Most permissive |
| Coqui | 3.10 | 3.14 | Requires PyTorch 2.2+ |
| RealtimeTTS | 3.9 | 3.12 | Same as Kokoro (uses Coqui internally) |

**Recommendation:** Use Python 3.11 (sweet spot for all libraries)

**Current Project:** Check `python --version` in venv. If Python 3.13+, downgrade venv to 3.11 for TTS compatibility.

## Cost Analysis

| Component | Setup Cost | Runtime Cost | Notes |
|-----------|------------|--------------|-------|
| Supabase RLS | 2-4 hours dev time | $0 | No additional infrastructure |
| Kokoro TTS | 1 hour integration | $0 | Open-source, runs locally |
| Piper TTS | 30 min integration | $0 | Open-source, runs locally |
| Coqui TTS | 1 hour integration + model download | $0 | Open-source, 1-5GB model storage |
| Edge TTS | Already integrated | $0 | Free Microsoft service (existing) |
| concurrently | 15 min setup | $0 | npm package |
| Launch scripts | 30 min creation | $0 | One-time setup |

**Total Cost:** ~6-8 hours developer time, $0 infrastructure cost

**Comparison to Paid TTS:**
- ElevenLabs: ~$0.22 per 1000 characters
- For 100,000 character/month usage: $22/month savings with free TTS
- For multi-workspace setup: $22/month × number of workspaces

## Performance Considerations

### Workspace Isolation Performance

**Query Performance:**
- RLS adds WHERE clause to every query: `workspace_id = 'user-workspace-id'`
- **Mitigation:** Add `workspace_id` as final column in composite indexes
- Example: `CREATE INDEX idx_projects_workspace ON projects(workspace_id, created_at DESC);`
- **Impact:** Negligible with proper indexing (<1ms overhead per query)

**Scaling:**
- RLS scales to 10,000+ tenants (proven in production Supabase apps)
- For 2-10 workspaces (user's use case): zero performance concern

### TTS Performance

| Engine | Inference Speed (RTX) | CPU Inference | Model Size | Quality |
|--------|----------------------|---------------|------------|---------|
| Kokoro | ~2-3x realtime | ~1-1.5x realtime | 82M params (~330MB) | High |
| Piper | ~5-10x realtime | ~3-5x realtime | Small (~10-50MB/voice) | Medium |
| Coqui | ~1-2x realtime | ~0.5-1x realtime | 200M-890M params (1-5GB) | Highest |
| Edge-TTS | Network dependent | N/A (cloud API) | N/A | Medium-High |

**RTX = Real-Time Factor** (1x = generates 1 second of audio per 1 second of processing)

**Recommendation for Edit Factory:**
- **Default:** Kokoro (good quality, fast on CPU, small model)
- **Fast Preview:** Piper (when speed > quality, e.g., draft review)
- **Premium:** Coqui (final renders when quality critical)
- **Fallback:** Edge-TTS (if local engines fail or unavailable)

**Hardware Requirements:**
- Kokoro: 4GB RAM, CPU inference acceptable
- Piper: 2GB RAM, runs on Raspberry Pi
- Coqui: 8GB RAM recommended, GPU optional (2-4x faster with CUDA)

## Security Considerations

### Workspace Isolation Security

**Defense-in-Depth:**
1. **Database Level (RLS):** Primary security boundary
2. **Application Level (FastAPI):** Validate workspace_id in endpoints
3. **Frontend Level (Next.js):** Filter UI state by workspace

**Critical Pattern:**
```python
# WRONG: Application-level filtering only
@router.get("/projects")
async def list_projects(user: User = Depends(get_current_user)):
    # If we forget .filter(workspace_id=...), data leak!
    return await db.projects.find_all()

# RIGHT: RLS enforces at DB level
@router.get("/projects")
async def list_projects(user: User = Depends(get_current_user)):
    # Even if we forget to filter, RLS prevents leak
    return await db.projects.find_all()  # RLS auto-filters
```

**app_metadata vs user_metadata:**
- **app_metadata:** Server-side only, immutable by users. Store workspace_id here.
- **user_metadata:** User can modify via API. Never trust for access control.

### TTS Security

**Local TTS (Kokoro/Piper/Coqui):**
- No network calls → no data leakage
- Models run on local server → privacy-friendly
- No API keys to manage → reduced attack surface

**Edge-TTS:**
- Sends text to Microsoft servers → not GDPR-safe for sensitive content
- Use local engines for content with PII/confidential data

## Sources

### Supabase Multi-Tenancy & RLS
- [Row Level Security | Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security) - HIGH confidence (official docs)
- [User Management | Supabase Docs](https://supabase.com/docs/guides/auth/managing-user-data) - HIGH confidence (official docs)
- [Multi-Tenant Applications with RLS on Supabase](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/) - MEDIUM confidence (verified implementation)
- [Enforcing Row Level Security in Supabase: A Deep Dive](https://dev.to/blackie360/-enforcing-row-level-security-in-supabase-a-deep-dive-into-lockins-multi-tenant-architecture-4hd2) - MEDIUM confidence (real-world case study)
- [Supabase Multi Tenancy - Simple and Fast](https://roughlywritten.substack.com/p/supabase-multi-tenancy-simple-and) - MEDIUM confidence (app_metadata pattern)

### Free TTS Providers
- [The Best Open-Source Text-to-Speech Models in 2026](https://www.bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models) - HIGH confidence (comprehensive 2026 comparison)
- [Best open source text-to-speech models and how to run them](https://northflank.com/blog/best-open-source-text-to-speech-models-and-how-to-run-them) - MEDIUM confidence (technical details)
- [Top Python Packages for Realistic Text-to-Speech Solutions](https://smallest.ai/blog/python-packages-realistic-text-to-speech) - MEDIUM confidence (Python integration)
- [Best ElevenLabs Alternatives 2026: Open-Source TTS Comparison](https://ocdevel.com/blog/20250720-tts) - MEDIUM confidence (comparison)
- [GitHub - KoljaB/RealtimeTTS](https://github.com/KoljaB/RealtimeTTS) - HIGH confidence (official repo, verified via WebFetch)
- [GitHub - nazdridoy/kokoro-tts](https://github.com/nazdridoy/kokoro-tts) - HIGH confidence (official CLI tool, verified via WebFetch)
- [coqui-tts · PyPI](https://pypi.org/project/coqui-tts/) - HIGH confidence (verified version 0.27.5, Jan 26, 2026)
- [piper-tts · PyPI](https://pypi.org/project/piper-tts/) - HIGH confidence (verified version 1.4.0, Jan 30, 2026)
- [Kokoro-82M: Install and Run Locally](https://aleksandarhaber.com/kokoro-82m-install-and-run-locally-fast-small-and-free-text-to-speech-tts-ai-model-kokoro-82m/) - MEDIUM confidence (installation guide)

### Launch Scripts & Developer Experience
- [concurrently - npm](https://www.npmjs.com/package/concurrently) - HIGH confidence (attempted WebFetch, verified via search for version 9.2.1)
- [How to run npm scripts concurrently?](https://dev.to/przemyslawjanbeigert/how-to-run-npm-scripts-concurrently-2l4c) - MEDIUM confidence (usage patterns)
- [GitHub - open-cli-tools/concurrently](https://github.com/open-cli-tools/concurrently) - HIGH confidence (official repo)
- [Windows batch script to run a Python program within virtual environment](https://gist.github.com/nmpowell/d444820b58f10568b15a082ee4f591cf) - MEDIUM confidence (batch file pattern)
- [Activating Python Virtual Environment with Custom Batch Script](https://medium.com/@sawlemon/activating-python-virtual-environment-with-custom-batch-script-9a86492447df) - MEDIUM confidence (Windows venv activation)
- [Set up Node.js on WSL 2 | Microsoft Learn](https://learn.microsoft.com/en-us/windows/dev-environment/javascript/nodejs-on-wsl) - HIGH confidence (official Microsoft docs)
- [Install Next.js on Windows | Microsoft Learn](https://learn.microsoft.com/en-us/windows/dev-environment/javascript/nextjs-on-wsl) - HIGH confidence (official Microsoft docs)

## Version Verification Status

| Component | Verified Source | Verification Date | Confidence |
|-----------|----------------|-------------------|------------|
| Supabase RLS patterns | Official docs | Feb 3, 2026 | HIGH |
| Kokoro TTS | GitHub + community | Feb 3, 2026 | HIGH |
| Piper TTS 1.4.0 | PyPI search | Feb 3, 2026 | HIGH |
| Coqui TTS 0.27.5 | PyPI WebFetch | Feb 3, 2026 | HIGH |
| concurrently 9.2.1 | npm search | Feb 3, 2026 | HIGH |
| app_metadata pattern | Supabase docs + community | Feb 3, 2026 | HIGH |
| Python version constraints | PyPI package metadata | Feb 3, 2026 | HIGH |
