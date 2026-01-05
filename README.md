# Edit Factory

**Video Processing API pentru reels și short-form content**

Edit Factory este o platformă completă pentru automatizarea producției video, destinată content creator-ilor de social media. Combină procesare video AI, text-to-speech, generare de subtitrări și workflow management într-un singur sistem.

## Caracteristici Principale

### Procesare Video cu AI
- **Gemini AI Integration** - Analiză inteligentă a segmentelor video
- **Scene Detection** - Detectare automată a schimbărilor de scenă
- **Motion & Variance Scoring** - Selectare automată a celor mai dinamice momente
- **Perceptual Hashing** - Evitarea conținutului duplicat

### Text-to-Speech (TTS)
- **ElevenLabs** - Voci premium cu clonare vocală
- **Edge-TTS** - Voci Microsoft gratuite (fallback)
- **Voice Activity Detection (VAD)** - Detectarea și mutarea vocilor din video

### Subtitrări & Captions
- **Whisper AI** - Transcripție audio de înaltă calitate
- **Dynamic Captions** - Subtitrări dinamice (1-5 cuvinte/caption)
- **Export multi-format**: SRT, VTT, JSON, CSV
- **Preset-uri rapide**: TikTok, YouTube, Standard

### Library & Workflow
- **Project Management** - Organizare pe proiecte cu variante
- **Clip Library** - Gestionare clipuri cu thumbnails
- **Export Presets** - Setări predefinite pentru diferite platforme
- **Cost Tracking** - Monitorizare costuri API (ElevenLabs, Gemini)

### Integrări
- **Supabase** - Persistență date și autentificare
- **Google Drive** - Import/export fișiere
- **FFmpeg** - Procesare video/audio

## Structura Proiectului

```
edit_factory/
├── app/                        # Backend FastAPI
│   ├── api/
│   │   ├── routes.py           # Endpoints principale video processing
│   │   └── library_routes.py   # Endpoints library & workflow
│   ├── services/
│   │   ├── video_processor.py  # Procesare video cu AI
│   │   ├── gemini_analyzer.py  # Analiză video cu Gemini
│   │   ├── elevenlabs_tts.py   # TTS ElevenLabs
│   │   ├── edge_tts_service.py # TTS Edge (Microsoft)
│   │   ├── voice_detector.py   # Detectare vocală
│   │   ├── silence_remover.py  # Eliminare silențe
│   │   ├── voice_cloning_service.py # Clonare vocală
│   │   ├── cost_tracker.py     # Tracking costuri API
│   │   └── keyword_matcher.py  # Matching keywords pentru clipuri
│   ├── config.py               # Configurări aplicație
│   ├── main.py                 # Entrypoint FastAPI
│   └── models.py               # Pydantic models
│
├── frontend/                   # Frontend Next.js
│   ├── app/                    # Next.js App Router
│   ├── components/             # React components
│   └── lib/                    # Utilități
│
├── CAPTIONS_AENEAS/            # Modul independent pentru captions
│   ├── caption_ui.py           # UI grafic Tkinter
│   ├── dynamic_captions.py     # Engine Whisper AI
│   ├── caption_preview.py      # Preview captions
│   ├── text_correction.py      # Corectare text
│   └── Start_Simple.bat        # Launcher rapid
│
├── scripts/                    # Scripturi utilitare
│   ├── video_processor.py      # Procesor video standalone
│   ├── generate_srt.py         # Generator SRT
│   ├── dynamic_captions_server.py
│   └── text_correction_server.py
│
├── input/                      # Fișiere input
├── output/                     # Fișiere procesate
├── temp/                       # Fișiere temporare
├── static/                     # Static files pentru frontend
├── ffmpeg/                     # FFmpeg local
│
├── run.py                      # Script pornire server
├── requirements.txt            # Dependențe Python
└── package.json                # Configurare Node.js
```

## Instalare

### Cerințe
- Python 3.10+
- Node.js 18+
- FFmpeg
- Redis (opțional, pentru Celery)

### 1. Clonare și Setup

```bash
git clone https://github.com/obsid2025/edit-factory.git
cd edit-factory

# Virtual environment Python
python -m venv venv
source venv/bin/activate  # Linux/Mac
# sau
.\venv\Scripts\activate   # Windows

# Instalare dependențe Python
pip install -r requirements.txt

# Instalare dependențe Frontend
cd frontend
npm install
```

### 2. Configurare Environment

Creează fișierul `.env` în rădăcina proiectului:

```env
# Server
HOST=0.0.0.0
PORT=8000
DEBUG=true

# Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# ElevenLabs TTS
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_MODEL=eleven_multilingual_v2

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_key

# Google Drive (opțional)
GOOGLE_DRIVE_FOLDER_ID=your_folder_id
GOOGLE_CREDENTIALS_PATH=./credentials.json

# Redis (opțional)
REDIS_URL=redis://localhost:6379/0
```

### 3. FFmpeg

FFmpeg este inclus local în folder-ul `ffmpeg/`. Dacă nu există, descarcă de la [ffmpeg.org](https://ffmpeg.org/download.html) și plasează-l în:
```
ffmpeg/ffmpeg-master-latest-win64-gpl/bin/
```

## Utilizare

### Pornire Server Backend

```bash
python run.py
```

Server disponibil la:
- **API**: http://localhost:8000/api/v1
- **Docs**: http://localhost:8000/docs
- **Static**: http://localhost:8000/static

### Pornire Frontend

```bash
cd frontend
npm run dev
```

Frontend disponibil la http://localhost:3000

### Generator Captions (Standalone)

```bash
cd CAPTIONS_AENEAS
python caption_ui.py
# sau
Start_Simple.bat
```

## API Endpoints Principale

### Video Processing
- `POST /api/v1/upload` - Upload video pentru procesare
- `POST /api/v1/analyze` - Analiză video cu AI
- `GET /api/v1/jobs/{job_id}` - Status job procesare
- `GET /api/v1/costs` - Costuri API curente

### Library & Workflow
- `GET /api/v1/library/projects` - Listă proiecte
- `POST /api/v1/library/projects` - Creare proiect nou
- `GET /api/v1/library/projects/{id}/clips` - Clipuri proiect
- `POST /api/v1/library/clips/{id}/export` - Export clip final

### TTS & Audio
- `POST /api/v1/tts/generate` - Generare audio TTS
- `POST /api/v1/voice/clone` - Clonare vocală
- `GET /api/v1/usage` - Statistici utilizare API-uri

## Tehnologii Folosite

**Backend:**
- FastAPI + Uvicorn
- OpenCV + NumPy + SciPy
- Google Gemini AI
- OpenAI Whisper
- ElevenLabs API
- PyTorch + TorchAudio (VAD)
- Supabase Python Client
- Celery + Redis (task queue)

**Frontend:**
- Next.js 14
- React
- TypeScript
- Tailwind CSS

**Tools:**
- FFmpeg (video/audio processing)
- PySceneDetect (scene detection)

## Development

### Structura Baze de Date (Supabase)

```sql
-- Proiecte
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active',
    target_duration INTEGER DEFAULT 20,
    context_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clipuri
CREATE TABLE clips (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    variant_index INTEGER,
    raw_video_path TEXT,
    thumbnail_path TEXT,
    duration FLOAT,
    is_selected BOOLEAN DEFAULT false,
    final_video_path TEXT,
    final_status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cost Tracking
CREATE TABLE api_costs (
    id UUID PRIMARY KEY,
    service TEXT NOT NULL,
    operation TEXT,
    cost FLOAT DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Logging

Log-urile sunt salvate în `logs/` și afișate în consolă:
```
2024-12-20 14:00:00 - app.main - INFO - Edit Factory started
2024-12-20 14:00:01 - services.video_processor - INFO - Processing video: input.mp4
```

## Roadmap

- [ ] Export direct pe social media (TikTok, Instagram, YouTube)
- [ ] Batch processing pentru multiple videoclipuri
- [ ] Template-uri pentru diferite nișe
- [ ] Analytics și raportare
- [ ] Mobile app companion

## Licență

ISC License - vezi [LICENSE](LICENSE) pentru detalii.

## Contribuții

Contribuțiile sunt binevenite! Deschide un issue sau pull request pe [GitHub](https://github.com/obsid2025/edit-factory).

---

**OBSID SRL** - Edit Factory v1.0.0
