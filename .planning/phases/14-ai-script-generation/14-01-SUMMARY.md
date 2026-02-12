---
phase: 14-ai-script-generation
plan: 01
subsystem: backend
tags:
  - ai-script-generation
  - gemini
  - claude
  - tts-safe
  - keyword-aware
dependency_graph:
  requires:
    - app/config.py (Settings base class)
    - app/api/auth.py (ProfileContext)
    - google-genai (Gemini client)
  provides:
    - app/services/script_generator.py (ScriptGenerator service)
    - app/api/script_routes.py (Script generation API)
  affects:
    - app/main.py (router mounting)
    - requirements.txt (anthropic dependency)
tech_stack:
  added:
    - anthropic SDK (>=0.40.0)
    - Claude Sonnet 4 model (claude-sonnet-4-20250514)
  patterns:
    - Singleton service factory (get_script_generator)
    - Profile-scoped API endpoints
    - Lazy Supabase client initialization
    - TTS-safe text sanitization
key_files:
  created:
    - app/services/script_generator.py (310 lines)
    - app/api/script_routes.py (213 lines)
  modified:
    - requirements.txt (+anthropic dependency)
    - app/config.py (+anthropic_api_key field)
    - app/main.py (+script_router mount)
decisions:
  - Dual-provider support (Gemini + Claude) for flexibility
  - Keyword-aware prompts use editai_segments keywords
  - TTS-safe by design (strips emojis, markdown, stage directions)
  - 75-150 word target per script (~30-60s spoken)
  - ---SCRIPT--- delimiter for parsing multiple variants
  - Graceful degradation when Supabase unavailable (empty keywords)
metrics:
  duration_seconds: 174
  duration_minutes: 2.9
  tasks_completed: 2
  files_created: 2
  files_modified: 3
  commits: 2
  lines_added: 523
  completed_at: "2026-02-12T01:45:26Z"
---

# Phase 14 Plan 01: AI Script Generation Backend Summary

**One-liner:** AI script generation service with Gemini/Claude providers, TTS-safe sanitization, and segment keyword awareness for video-first workflows.

## What Was Built

Created the complete backend infrastructure for AI-powered script generation in Phase 14. This enables users to generate multiple TTS-ready script variants from a simple idea/context, with the AI automatically aware of available visual content (segment keywords) for better keyword-matching downstream.

**Core Components:**

1. **ScriptGenerator Service** (`app/services/script_generator.py`)
   - Dual AI provider support: Gemini 2.5 Flash and Claude Sonnet 4
   - Generates 1-10 script variants per request
   - TTS-safe sanitization pipeline (removes emojis, markdown, stage directions)
   - Keyword-aware prompts (includes segment keywords from user's library)
   - Target: 75-150 words per script (~30-60 seconds when spoken)
   - Singleton factory pattern for dependency injection

2. **Script Generation API** (`app/api/script_routes.py`)
   - `POST /api/v1/scripts/generate` - Generate script variants
   - `GET /api/v1/scripts/keywords` - List available segment keywords
   - Profile-scoped endpoints (multi-tenant ready)
   - Fetches unique keywords from `editai_segments` table
   - Error handling: 400 (invalid input), 503 (service unavailable)

3. **Configuration Updates**
   - Added `anthropic_api_key` to Settings
   - Added `anthropic>=0.40.0` to requirements.txt
   - Mounted script_router in main.py

## Implementation Highlights

### TTS-Safe Script Sanitization

The `_sanitize_for_tts()` method ensures scripts are clean for text-to-speech:

```python
# Removes:
- Emojis (Unicode ranges)
- Markdown formatting (**bold**, _italic_, #headers)
- Stage directions ([pause], (whisper))
- Hashtags (#trending)
- Links [text](url)

# Preserves:
- Proper punctuation (periods, commas, question marks)
- Natural pauses and sentence structure
```

### Keyword-Aware AI Prompts

Scripts reference available visual content naturally:

```python
# Fetch from database
unique_keywords = ["cooking", "ingredients", "stirring", "plating"]

# AI prompt includes:
"Available Visual Keywords: cooking, ingredients, stirring, plating"

# Result: Scripts naturally mention keywords that have matching video segments
```

### Dual Provider Architecture

```python
if provider == "gemini":
    client = genai.Client(api_key=...)
    response = client.models.generate_content(model="gemini-2.5-flash", ...)
else:  # claude
    client = anthropic.Anthropic(api_key=...)
    response = client.messages.create(model="claude-sonnet-4-20250514", ...)
```

### Script Parsing

Uses `---SCRIPT---` delimiter to parse multiple variants from AI response:

```
Script 1 text here...
---SCRIPT---
Script 2 text here...
---SCRIPT---
Script 3 text here...
```

## Technical Decisions

1. **Why Dual Provider Support?**
   - User choice: Some prefer Claude's creativity, others Gemini's speed
   - Cost flexibility: Gemini Flash is cheaper, Claude offers higher quality
   - Redundancy: If one provider is down, switch to the other

2. **Why Keyword Awareness?**
   - Script-first workflow depends on matching scripts to existing video segments
   - AI that knows available keywords writes scripts with better visual match potential
   - Reduces manual segment selection later in the pipeline

3. **Why TTS-Safe by Design?**
   - ElevenLabs/Edge-TTS can't handle emojis or markdown
   - Stage directions break natural speech rhythm
   - Proper punctuation = better TTS pauses and intonation

4. **Why 75-150 Words Target?**
   - Social media optimal: 30-60 seconds spoken (TikTok/Reels sweet spot)
   - Long enough for substantive content, short enough for retention
   - Matches typical TTS reading speed (~2.5 words/second)

5. **Why Profile-Scoped?**
   - Multi-tenant architecture (different users, different segment libraries)
   - Keywords from one user's library shouldn't leak to another
   - Consistent with existing segments_routes.py pattern

## Deviations from Plan

None - plan executed exactly as written.

## Testing & Verification

**Syntax checks passed:**
- `script_routes.py` syntax OK
- `main.py` syntax OK
- All imports resolve correctly

**Integration verification needed** (requires running app with dependencies):
- Backend starts without errors
- `/docs` shows new script endpoints
- Keywords endpoint returns profile-scoped data
- Generate endpoint calls ScriptGenerator service
- TTS sanitization removes all unsafe characters

**Future testing:**
- Generate scripts with Gemini and Claude
- Verify keyword incorporation in generated scripts
- Test TTS output with generated scripts (no errors)
- Verify profile isolation (User A keywords != User B keywords)

## Files Modified

**Created:**
- `app/services/script_generator.py` (310 lines)
- `app/api/script_routes.py` (213 lines)

**Modified:**
- `requirements.txt` - Added anthropic>=0.40.0
- `app/config.py` - Added anthropic_api_key field
- `app/main.py` - Mounted script_router

**Total changes:** 2 created, 3 modified, 523 lines added

## Commits

| Commit | Type | Message |
|--------|------|---------|
| `494e785` | feat | Add AI script generation service with dual-provider support |
| `b78cef1` | feat | Add script generation API routes and mount in app |

## Integration Points

**Upstream Dependencies:**
- Requires `editai_segments` table with `keywords` JSONB column
- Requires profile_id isolation in segments table
- Requires Supabase client initialization
- Requires ProfileContext authentication

**Downstream Consumers:**
- Phase 14 Plan 02 will use generated scripts for video assembly
- Phase 15 will match script keywords to segment keywords
- Frontend will call `/api/v1/scripts/generate` and `/api/v1/scripts/keywords`

**Environment Variables Required:**
```
GEMINI_API_KEY=...           # For Gemini provider
ANTHROPIC_API_KEY=...        # For Claude provider
SUPABASE_URL=...             # For keyword fetching
SUPABASE_KEY=...             # For keyword fetching
```

## Next Steps

1. **Install Dependencies** (if not already installed):
   ```bash
   pip install anthropic>=0.40.0
   ```

2. **Set API Keys** in `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

3. **Test Endpoints**:
   ```bash
   # Start backend
   python run.py

   # Test keywords endpoint
   curl http://localhost:8000/api/v1/scripts/keywords

   # Test generation
   curl -X POST http://localhost:8000/api/v1/scripts/generate \
     -H "Content-Type: application/json" \
     -d '{"idea": "quick pasta recipe", "variant_count": 3, "provider": "gemini"}'
   ```

4. **Frontend Integration** (Plan 02):
   - Create script generation UI
   - Display keyword chips before generation
   - Show multiple script variants for selection
   - Wire selected script to video assembly pipeline

## Self-Check: PASSED

**Verified created files exist:**
```bash
[ -f "app/services/script_generator.py" ] && echo "FOUND: script_generator.py"
[ -f "app/api/script_routes.py" ] && echo "FOUND: script_routes.py"
```
✓ Both files exist

**Verified commits exist:**
```bash
git log --oneline | grep -q "494e785" && echo "FOUND: 494e785"
git log --oneline | grep -q "b78cef1" && echo "FOUND: b78cef1"
```
✓ Both commits exist

**Verified dependencies:**
```bash
grep -q "anthropic>=0.40.0" requirements.txt && echo "FOUND: anthropic dependency"
```
✓ Dependency added

**Verified config:**
```bash
grep -q "anthropic_api_key" app/config.py && echo "FOUND: config field"
```
✓ Config field added

**Verified router mount:**
```bash
grep -q "script_router" app/main.py && echo "FOUND: router mount"
```
✓ Router mounted

All checks passed. Plan 14-01 complete and verified.
