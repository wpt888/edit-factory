# Edit Factory - Ghid Complet de Testare

**Data creării:** 2024-12-31
**Versiune:** 1.0.0

---

## Cuprins

1. [Prezentare Generală](#prezentare-generală)
2. [Structura Sistemului de Testare](#structura-sistemului-de-testare)
3. [Cum să Rulezi Testele](#cum-să-rulezi-testele)
4. [Teste Disponibile](#teste-disponibile)
5. [Monitoring Automat](#monitoring-automat)
6. [Interpretarea Rezultatelor](#interpretarea-rezultatelor)
7. [Troubleshooting](#troubleshooting)
8. [Checklist Manual](#checklist-manual)

---

## Prezentare Generală

Sistemul de testare Edit Factory verifică automat:

- **Backend API** - Health checks, endpoints, servicii Python
- **Frontend UI** - Încărcarea paginilor, funcționalități, responsive design
- **Servicii** - FFmpeg, VAD (Voice Activity Detection), TTS, Silence Remover
- **Integrare** - Comunicarea între frontend și backend

### Arhitectura

```
testing/
├── test_platform.sh       # Script principal de testare (bash)
├── playwright_tests.py    # Teste UI automate (Python/Playwright)
├── monitor.sh             # Daemon pentru monitoring periodic
├── TESTING_GUIDE.md       # Această documentație
├── logs/                  # Loguri de execuție
├── reports/               # Rapoarte de teste (MD, JSON)
└── screenshots/           # Screenshots pentru teste eșuate
```

---

## Structura Sistemului de Testare

### 1. test_platform.sh

Script bash care rulează teste de bază:

| Test | Descriere |
|------|-----------|
| Backend Health | Verifică dacă API-ul răspunde |
| Backend Endpoints | Testează toate endpoint-urile |
| Frontend Health | Verifică dacă Next.js rulează |
| Frontend Pages | Testează toate paginile |
| FFmpeg | Verifică instalarea FFmpeg |
| Python Services | Importă și verifică serviciile |
| Playwright UI | Rulează teste UI automate |

### 2. playwright_tests.py

Teste UI detaliate cu Playwright:

| Test | Descriere |
|------|-----------|
| Home Page Loads | Verifică încărcarea paginii principale |
| Library Page Loads | Verifică pagina Library |
| Segments Page Loads | Verifică pagina Segments |
| Usage Page Loads | Verifică pagina Usage |
| File Upload Area | Verifică zona de upload |
| Tabs Navigation | Testează navigarea între tab-uri |
| Slider Controls | Testează controalele slider |
| Mobile Viewport | Testează pe viewport mobil |
| No Console Errors | Verifică lipsa erorilor în consolă |

### 3. monitor.sh

Daemon care rulează teste automat:

- **Interval:** 5 minute (configurabil)
- **Logare:** Toate rezultatele în `logs/monitor.log`
- **Rapoarte:** Generate automat în `reports/`
- **Alertare:** Suport pentru notificări (Slack, email)

---

## Cum să Rulezi Testele

### Cerințe Prealabile

```bash
# 1. Asigură-te că serverele rulează
cd /mnt/c/OBSID\ SRL/n8n/edit_factory

# Backend (Terminal 1)
python run.py
# sau
uvicorn app.main:app --host 0.0.0.0 --port 8001

# Frontend (Terminal 2)
cd frontend
npm run dev
```

### Rulare Manuală (O Dată)

```bash
cd testing

# Fă script-urile executabile
chmod +x test_platform.sh monitor.sh

# Rulează toate testele
./test_platform.sh

# Sau doar testele Playwright
python3 playwright_tests.py
```

### Rulare cu Monitoring Continuu

```bash
cd testing

# Pornește monitoring-ul (rulează în fundal)
./monitor.sh start

# Verifică statusul
./monitor.sh status

# Vezi logurile în timp real
./monitor.sh logs

# Oprește monitoring-ul
./monitor.sh stop

# Rulează o singură dată fără daemon
./monitor.sh run-once
```

### Configurare URL-uri

Dacă serverele rulează pe alte porturi:

```bash
# Setează variabilele de mediu
export FRONTEND_URL="http://localhost:3000"
export BACKEND_URL="http://localhost:8001"

# Apoi rulează testele
./test_platform.sh
```

---

## Teste Disponibile

### Backend Tests

#### 1. Health Check
```bash
curl http://localhost:8001/api/v1/health
```
**Așteptat:** HTTP 200

#### 2. Endpoints
| Endpoint | Metodă | Așteptat |
|----------|--------|----------|
| `/api/v1/health` | GET | 200 |
| `/api/v1/jobs` | GET | 200 |
| `/api/v1/library/projects` | GET | 200 |
| `/api/v1/voices` | GET | 200 |

### Frontend Tests

#### 1. Pagini
| Pagină | URL | Verificări |
|--------|-----|------------|
| Home | `/` | Încărcare, upload zone |
| Library | `/library` | Lista proiecte |
| Segments | `/segments` | Video player, timeline |
| Usage | `/usage` | Statistici |

#### 2. Funcționalități UI
- **Video Upload** - Drag & drop, click pentru selectare
- **Video Player** - Play/pause, seek, fullscreen
- **Timeline** - Zoom, segment markers, click to seek
- **Segment Creation** - Select range, add keywords
- **Forms** - Toate input-urile funcționează

### Service Tests

#### 1. FFmpeg
```bash
ffmpeg -version
```

#### 2. Python Services
```python
from app.services.video_processor import VideoProcessor
from app.services.silence_remover import SilenceRemover
from app.services.voice_detector import VoiceDetector
```

---

## Monitoring Automat

### Configurare Cron (Linux/WSL)

Pentru a rula automat la fiecare 5 minute:

```bash
# Editează crontab
crontab -e

# Adaugă linia:
*/5 * * * * /mnt/c/OBSID\ SRL/n8n/edit_factory/testing/test_platform.sh >> /mnt/c/OBSID\ SRL/n8n/edit_factory/testing/logs/cron.log 2>&1
```

### Configurare Windows Task Scheduler

1. Deschide Task Scheduler
2. Create Basic Task → "Edit Factory Monitor"
3. Trigger: Daily, repeat every 5 minutes
4. Action: Start a program
   - Program: `wsl.exe`
   - Arguments: `-e /mnt/c/OBSID\ SRL/n8n/edit_factory/testing/test_platform.sh`

### Daemon Mode

```bash
# Pornește daemon-ul
./monitor.sh start

# Rulează în fundal și verifică periodic
# Logurile se salvează în logs/monitor.log
```

---

## Interpretarea Rezultatelor

### Raport de Test (Exemplu)

```markdown
# Edit Factory - Test Report
**Data:** 2024-12-31 23:30:00

## Rezultate Teste

| Test | Status | Durată | Detalii |
|------|--------|--------|---------|
| Backend Health | ✅ PASS | 1s | API responding |
| Backend Endpoints | ✅ PASS | 3s | All endpoints responding |
| Frontend Health | ✅ PASS | 1s | Page loading |
| Frontend Pages | ✅ PASS | 4s | All pages loading |
| FFmpeg | ✅ PASS | 0s | ffmpeg version 6.0 |
| Python Services | ✅ PASS | 2s | All services importable |
| UI Playwright Tests | ✅ PASS | 15s | All UI tests passed |

## Sumar
- **Total teste:** 7
- **Passed:** 7 ✅
- **Failed:** 0 ❌
- **Success Rate:** 100%
```

### Coduri de Ieșire

| Cod | Semnificație |
|-----|--------------|
| 0 | Toate testele au trecut |
| 1 | Cel puțin un test a eșuat |

### Screenshots

Când un test Playwright eșuează:
- Se salvează automat screenshot în `screenshots/`
- Numele include testul și timestamp-ul
- Util pentru debugging

---

## Troubleshooting

### Problemă: "Backend not responding"

```bash
# Verifică dacă serverul rulează
curl http://localhost:8001/api/v1/health

# Verifică portul
netstat -tlnp | grep 8001

# Pornește serverul
cd /mnt/c/OBSID\ SRL/n8n/edit_factory
python run.py
```

### Problemă: "Frontend not responding"

```bash
# Verifică procesul Next.js
ps aux | grep next

# Pornește frontend-ul
cd frontend
npm run dev
```

### Problemă: "Playwright not installed"

```bash
# Instalează Playwright
pip install playwright

# Instalează browserele
playwright install chromium
```

### Problemă: "FFmpeg not found"

```bash
# WSL/Linux
sudo apt install ffmpeg

# Sau adaugă în PATH
export PATH="/mnt/c/OBSID SRL/n8n/edit_factory/ffmpeg/ffmpeg-master-latest-win64-gpl/bin:$PATH"
```

### Problemă: "Python services import failed"

```bash
# Activează venv
source venv_linux/bin/activate

# Instalează dependențe
pip install -r requirements.txt
```

---

## Checklist Manual

### Pre-Deployment Checklist

- [ ] **Backend**
  - [ ] API health check OK
  - [ ] Toate endpoint-urile răspund
  - [ ] Conexiunea la Supabase funcționează
  - [ ] ElevenLabs API key valid
  - [ ] Gemini API key valid

- [ ] **Frontend**
  - [ ] Toate paginile se încarcă
  - [ ] Upload video funcționează
  - [ ] Video player funcționează
  - [ ] Timeline zoom/scroll funcționează
  - [ ] Segment creation funcționează
  - [ ] Fullscreen funcționează
  - [ ] Nu sunt erori în consolă

- [ ] **Servicii**
  - [ ] FFmpeg disponibil
  - [ ] VAD (Voice Detection) funcționează
  - [ ] Silence Remover funcționează
  - [ ] TTS (ElevenLabs/Edge-TTS) funcționează

- [ ] **Procesare Video**
  - [ ] Analiză video OK
  - [ ] Generare variante OK
  - [ ] Adăugare audio OK
  - [ ] Adăugare subtitrări OK
  - [ ] Mute source voice OK

### Teste de Performanță

- [ ] Home page < 3s încărcare
- [ ] Video analysis < 30s pentru video 1 min
- [ ] Video processing < 2 min pentru video 1 min

### Teste de Securitate

- [ ] API keys nu sunt expuse în frontend
- [ ] CORS configurat corect
- [ ] Input validation funcționează

---

## Comenzi Rapide

```bash
# Rulează toate testele o dată
./testing/test_platform.sh

# Pornește monitoring continuu
./testing/monitor.sh start

# Vezi statusul
./testing/monitor.sh status

# Vezi logurile
./testing/monitor.sh logs

# Oprește monitoring
./testing/monitor.sh stop

# Rulează doar teste UI
python3 testing/playwright_tests.py

# Vezi ultimele rapoarte
ls -la testing/reports/
```

---

## Contact

Pentru probleme sau întrebări legate de testare, verifică:
- Logurile în `testing/logs/`
- Rapoartele în `testing/reports/`
- Screenshots în `testing/screenshots/`
