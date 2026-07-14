# AI auto-segmentation (idee, neimplementat)

Notă de design din 2026-07-14. Funcție propusă: un buton "Auto-detect
segments (AI)" pe un video sursă, care populează `editai_segments`
(start/stop + keywords) automat, în locul selecției manuale. Motivația e
dublă: valoare de marketing ("aplicația alege segmentele cu AI") și pariul
că modelele se îmbunătățesc — arhitectura de mai jos face modelul o piesă
interschimbabilă.

## Concluzia analizei (starea modelelor la 2026-07-14)

- **Gemini 2.5/3 Pro** — singurul LLM generalist viabil: video nativ prin
  API, sampling 1–10 fps, timestamps în răspuns. Punct slab documentat:
  acuratețea de localizare temporală e ~60% (vs ~84% înțelegere semantică
  pe VideoMME). La clipurile noastre de 1–2 min cu segmente de 3–5 s, o
  eroare de ±1 s la graniță e inacceptabilă.
- **Grok (xAI)** — doar funcție consumer în aplicația X + generare video
  (Imagine). Fără API de segmentare temporală. Nu e opțiune.
- **Twelve Labs (Marengo 3.0 / Pegasus)** — jucătorul specializat: shot
  boundary detection nativ în API, embeddings per segment, disponibil și
  pe AWS Bedrock. Alternativa "la cheie" dacă nu vrem hibridul propriu.

## Arhitectura decisă: hibrid, nu "Gemini dă timestamps"

Granițele sunt o problemă deterministă; alegerea e una semantică.

1. **Tăietura** — shot detection cu FFmpeg (filtru scene / PySceneDetect)
   prin `safe_ffmpeg_run` existent. Frame-accurate, local, gratis. Nu
   cerem niciodată timestamps unui LLM.
2. **Dedup** — pHash cu prag Hamming 8 (există deja în cod) pe candidați,
   înainte de AI.
3. **Judecata** — Gemini primește shot-urile candidate (thumbnails +
   context) și le etichetează cu keywords, le scorează și alege un set
   divers (anti-repetiție semantică). Infrastructura Gemini per profil
   există (api_key_vault, preset `ai_smart`).
4. **Stocarea** — rezultatul devine rânduri normale în `editai_segments`;
   tot pipeline-ul din aval (matching, asamblare aleatorie, variante)
   funcționează neschimbat.
5. **UI** — buton pe video-ul sursă + progres prin sistemul de joburi
   existent (`JobStorage` + polling).

De ce hibrid: tăieturile ies mereu curate (pe schimbări reale de scenă),
deci funcția e prezentabilă public azi; singura parte imperfectă e *care*
segmente alege AI-ul, iar aia e corectabilă din UI-ul de segmente existent
și se îmbunătățește gratuit când schimbăm modelul din config.

## Estimare

Câteva zile, nu săptămâni — e orchestrare de piese existente. Partea
delicată nu e codul, ci calibrarea promptului de selecție ("ce e un
segment bun") pe videoclipuri reale.
