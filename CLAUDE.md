# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Edit Factory is a video processing platform for social media content creators (reels, TikTok, YouTube Shorts). It automates video production by combining:
- **Gemini AI** video analysis and scene detection
- **ElevenLabs/Edge-TTS** text-to-speech with voice cloning
- **Whisper AI** caption generation
- **Supabase** project/clip library management

## Development Commands

### Backend (FastAPI)

```bash
# Setup
python -m venv venv
source venv/bin/activate  # Linux/Mac
.\venv\Scripts\activate   # Windows
pip install -r requirements.txt

# Run server (auto-configures FFmpeg path)
python run.py

# Or direct uvicorn
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

API docs at http://localhost:8000/docs

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev      # Development at http://localhost:3000
npm run build    # Production build
```

### Captions Generator (Standalone Tkinter UI)

```bash
cd CAPTIONS_AENEAS
python caption_ui.py
# or Start_Simple.bat on Windows
```

## Architecture

```
edit_factory/
├── app/                          # FastAPI Backend
│   ├── main.py                   # Entry point
│   ├── config.py                 # Settings (pydantic-settings)
│   ├── models.py                 # Pydantic models
│   ├── api/
│   │   ├── routes.py             # Video/TTS/job endpoints
│   │   └── library_routes.py     # Project/clip CRUD endpoints
│   └── services/
│       ├── video_processor.py    # Core video analysis (motion, variance, phash)
│       ├── gemini_analyzer.py    # Gemini Vision API integration
│       ├── elevenlabs_tts.py     # Premium TTS with voice cloning
│       ├── edge_tts_service.py   # Microsoft TTS fallback
│       ├── voice_detector.py     # Silero VAD for voice detection
│       ├── silence_remover.py    # Audio silence removal
│       ├── cost_tracker.py       # ElevenLabs/Gemini cost logging
│       └── keyword_matcher.py    # Clip search/filter
│
├── frontend/                     # Next.js App Router
│   └── src/
│       ├── app/                  # Pages (library, usage, etc.)
│       └── components/           # React components (Shadcn/UI)
│
├── CAPTIONS_AENEAS/              # Standalone Caption Module
│   ├── caption_ui.py             # Tkinter GUI
│   ├── dynamic_captions.py       # Whisper transcription engine
│   ├── caption_preview.py        # Preview tool
│   └── text_correction.py        # Grammar correction
│
├── scripts/                      # Utility scripts
├── run.py                        # Server launcher (adds FFmpeg to PATH)
├── input/                        # Input videos
├── output/                       # Processed videos
└── ffmpeg/                       # Local FFmpeg binary
```

## Key Technical Details

### Video Scoring Algorithm

```python
combined_score = (motion * 0.6) + (variance * 0.3) + (brightness * 0.1)
```
- Perceptual hashing (pHash) with Hamming distance threshold of 12 for duplicate detection

### API Cost Tracking

- ElevenLabs: ~$0.22 per 1000 characters
- Gemini Vision: ~$0.02 per image analyzed
- Costs logged to Supabase `api_costs` table

### Caption Presets

- TikTok: 1 word per caption
- YouTube: 2 words per caption
- Standard: 3 words per caption
- Export formats: SRT, VTT, JSON, CSV

## Database Schema (Supabase)

Main tables:
- `projects`: id, name, description, status, target_duration, context_text
- `clips`: id, project_id, variant_index, raw_video_path, thumbnail_path, duration, is_selected, final_video_path, final_status
- `api_costs`: id, service, operation, cost, metadata

## Environment Variables

Required in `.env`:
```
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
SUPABASE_URL=...
SUPABASE_KEY=...
```

Optional:
```
REDIS_URL=redis://localhost:6379/0
GOOGLE_DRIVE_FOLDER_ID=...
```

## FFmpeg

FFmpeg is expected at `ffmpeg/ffmpeg-master-latest-win64-gpl/bin/` or in system PATH. The `run.py` script auto-configures this.
