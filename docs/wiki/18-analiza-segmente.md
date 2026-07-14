# Analiză: sistemul de segmente (2026-07-14)

Analiză cerută pe patru întrebări: (1) comenzi inutile / lipsă în zona de segmente, (2) ce face sistemul de grupuri, (3) merită track-uri multiple pe timeline?, (4) sunt suficiente setările de transformare? Research pe backend (`segments_routes.py`, `assembly_service.py`, `segment_transforms.py`) și frontend (segments page, timeline-editor, panouri transform).

---

## 1. Sistemul de grupuri — de fapt sunt DOUĂ sisteme diferite

Confuzia e justificată: sub numele „grupuri" trăiesc două mecanisme fără legătură între ele.

### A. Product Groups (cele create manual în editorul de segmente)

- Un grup = un **interval de timp pe video-ul sursă** cu etichetă și culoare (`editai_product_groups`: label, start_time, end_time, color).
- Rol: **categorisire tematică** — ex. „Hero Shot", „B-Roll", „Parfum X". Când creezi/mutați un segment care se suprapune >50% cu intervalul unui grup, eticheta grupului e adăugată automat în keywords-urile segmentului și în coloana `product_group` (`segments_routes.py:429-477`).
- Efect la matching: eticheta de grup dă **bonus de scor** (+0.5 dacă keyword-ul e chiar numele grupului, +0.2 bonus de continuitate dacă fraza curentă rămâne în același grup — `assembly_service.py:823-846`). O frază poate și **forța** un grup: atunci doar segmentele din grupul respectiv sunt candidate.

Pe scurt: product groups = un mod de a spune „aceste bucăți din video sunt despre același lucru", ca matching-ul să le prefere coerent. Dacă nu folosești videouri cu produse/teme multiple, sistemul nu-ți aduce nimic — de-aia pare inutil în fluxul tău curent.

### B. Merge Groups (automate, invizibile ca UI)

- Frazele SRT au ~0.3–0.5s fiecare; fără grupare, un clip de 30s ar avea 30+ tăieturi. `_merge_srt_groups()` (`assembly_service.py:140-155`) lipește fraze consecutive până ating `min_segment_duration` (presetul „Pacing": 2s/3s/5s), apoi **un singur segment video e ales per grup**.
- Sunt efemere (calculate la fiecare preview/render, nu se salvează în DB). Pe timeline-ul din Step 3 un grup apare ca un singur bloc cu badge „N phrases".

**Verdict:** merge groups sunt esențiale — fără ele output-ul ar fi un slideshow epileptic. Product groups sunt o funcționalitate reală dar de nișă; dacă nu o folosești, poate fi ascunsă din UI (nu ștearsă — datele și bonusul de matching nu costă nimic).

---

## 2. Comenzi inutile sau semi-moarte

Inventarul complet (33 endpoint-uri în `segments_routes.py`) e curat — fără duplicate reale. Ce am găsit totuși:

| Găsit | Detaliu | Recomandare |
|---|---|---|
| **Opacity per segment** | E cablată cap-coadă, dar FFmpeg o implementează ca `colorchannelmixer` — segmentul devine mai **întunecat spre negru**, nu transparent (nu există alt strat sub el pe care să se vadă). Pe un timeline single-track, „opacitate" nu are sens semantic. | Cel mai vizibil candidat de eliminat din panoul Transform — sau redenumit „Dim/Fade" dacă vrei efectul de întunecare. |
| **Override transformări per-proiect** | `PUT /projects/{id}/segments/{id}/transforms` scrie override-uri, dar doar fluxul legacy de proiecte le citește (`segments_routes.py:2548`); `merge_transforms()` din `segment_transforms.py:137` nu e apelat nicăieri în pipeline. Pipeline-ul principal ignoră complet aceste override-uri. | Feature semi-orfan din era „projects". De șters odată cu restul fluxului legacy, sau de ignorat. |
| **`/browse-local`** (tkinter file picker) | Returnează 501 pe desktop (Electron are dialog nativ prin IPC); util doar în modul web/dev. | OK ca fallback, nu e mort. |
| **`POST /reset-usage`** | Resetează `usage_count`. Funcțional, dar dacă nu există buton în UI pentru el, e API mort din perspectiva utilizatorului. | De verificat dacă are UI; altfel candidat de curățenie. |
| Restul (stream vs preview-stream, find-local vs browse-local, self-heal thumbnails) | Perechi care par redundante dar servesc căi diferite (original vs proxy, căutare programatică vs picker interactiv). | Păstrate. |

Notă tehnică cunoscută: schema `editai_product_groups` din SQLite e incompletă față de Supabase (item amânat Phase 82-03) — irelevant cât timp rulezi pe Supabase.

---

## 3. Facilități care lipsesc (și merită)

Ordonate după raport impact/efort, pentru conținut vertical 9:16:

1. **Speed / time remap per segment** — lipsește complet (nici un `setpts`/`atempo` în extraction). Slow-motion pe B-roll e unul dintre cele mai folosite trucuri în reels și e ieftin de adăugat: un câmp `speed` în `SegmentTransform` + `setpts=PTS/speed` la extracție. **Cea mai valoroasă adăugare.**
2. **Blur fill în loc de bare negre la zoom-out** — garda din 2026-07-11 face `pad` cu negru când `scale < 1` (`segment_transforms.py:109-112`). Standardul în editoarele de social e fundal blurat din același cadru (`split → boxblur → overlay`). Schimbare mică, câștig vizual mare.
3. **Crop box explicit** — acum „crop-ul" se face indirect din scale + pan, ceea ce funcționează dar e neintuitiv (utilizatorul gândește „încadrează zona asta", nu „mărește 1.3x și mută 40px"). Un dreptunghi de crop desenat pe preview ar fi UX-ul corect; scale+pan pot rămâne dedesubt ca implementare.
4. **Color per segment (brightness/contrast/saturation)** — filtrul `eq` există deja, dar doar **global, post-concat** (`library_routes.py:4484-4514`). Mutarea a 3 slidere în panoul per-segment e aproape gratis, pentru că infrastructura de filtre există.
5. **Ken Burns / zoom keyframat pe segmente video** — există deja pentru slide-urile interstițiale, dar transformările de segment sunt statice pe toată durata. Un simplu „zoom de la X la Y" (`zoompan` sau `scale` cu expresie pe `t`) ar da viață cadrelor statice. Efort mediu.
6. **Merge/split manual de grupuri pe timeline-ul Step 3** — acum granularitatea tăieturilor o controlezi doar global din presetul Pacing. Un „unește cu următorul" / „desparte" per bloc ar da control fin fără să atingă algoritmul.

Ce NU aș adăuga: keyframing generic pe toate proprietățile, curbe de viteză, masking — complexitate de NLE profesionist, nefolosită într-un tool de producție rapidă.

---

## 4. Track-uri multiple pe timeline — recomandare: NU (deocamdată)

**Starea actuală:** timeline-ul Step 3 e single-track video, condus de audio (TTS-ul e coloana vertebrală, frazele SRT dictează pozițiile; `timeline-editor.tsx`, ~3300 linii). Există deja un al doilea timeline read-only (grid „attention timeline" cu video/imagini/subtitrări/voiceover/SFX) doar pentru inspecție.

**De ce nu merită acum:**

- **Modelul de date e audio-first prin design.** Totul (matching, merge groups, cache-ul de preview cu fingerprint, render-ul) presupune „un flux video care urmărește un flux audio". Track-uri libere înseamnă rescris `MatchPreview`, algoritmul de assembly, cache-ul de preview și player-ul ping-pong — practic un mini-NLE. Estimare realistă: săptămâni, cu regresii garantate în preview/render parity, care abia a fost stabilizată.
- **Cazurile reale de „încă un strat" au deja soluții punctuale:** overlay-uri text/imagine există (`overlay_renderer.py`), interstițiale există, intro rapid există, subtitrările sunt strat separat la render. Adică beneficiile tipice ale unui al doilea track sunt deja acoperite de facilități țintite.
- **Riscul de rigiditate e mai bine tratat cu pârghii mici:** speed per segment (#1), merge/split manual (#6) și un eventual „audio ducking" (muzică de fundal cu volum automat sub voce — un singur track audio fix, nu track-uri libere) dau 80% din flexibilitatea percepută la 5% din cost.

**Când ar merita reevaluat:** dacă produsul pivotează spre editare generală (nu script→TTS→video), sau dacă apare nevoia concretă de picture-in-picture / reacții suprapuse. Atunci soluția corectă e probabil un track de **overlay-uri poziționate pe timp** (imagini/video mici peste cadrul principal), nu track-uri video egale — mult mai ieftin și acoperă cazul real.

---

## 5. Panoul Transform — evaluare setări curente

| Setare | Verdict |
|---|---|
| Rotation (+ butoane 90°) | ✅ Corectă, cu `transpose` optimizat pentru unghiuri drepte. |
| Scale 0.1–3.0x | ✅ OK; garda de zoom-out funcționează. UI-ul ar putea limita practic la 0.5–2.0 (sub/peste, rezultatul e inutilizabil vizual). |
| Pan X/Y ±500px | ✅ OK, dar fără scale>1 pan-ul doar scoate cadrul din ecran (umple cu negru). Merită dezactivat vizual când scale ≤ 1, ca hint. |
| Flip H/V | ✅ Ieftine și utile (flip H e trucul clasic anti-detecție de conținut repostat). |
| Opacity | ⚠️ Vezi §2 — nu face ce sugerează numele. Eliminat sau redenumit. |
| Global tab (bulk overwrite/add) | ✅ Bine gândit — modul „add" ca offset e o alegere corectă. |

**Consistență preview/render:** transformările se aplică identic în preview și render final (aceeași extracție, `assembly_service.py:1837-1946`) — punct forte, nu-l strica.

**Completări recomandate în panou** (în ordinea din §3): Speed, Blur fill toggle, Color (3 slidere), Crop box. Toate patru încap în panoul existent fără redesign.

---

## Status remediere (2026-07-14, aceeași zi)

Punctele din §2 (Opacity, override-uri per-proiect) și recomandările 1, 2 și 4
din §3 (speed, blur fill, color per segment) plus fix-ul de UX pe Pan din §5
au fost implementate — detalii în [change log](01-log.md#2026-07-14--remediere-sistem-segmente-transforms-v2--curățenie-api).
Rămase deliberat pentru faza 2: crop box pe preview (§3.3), Ken Burns pe
segmente video (§3.5), merge/split manual de grupuri (§3.6).

## TL;DR

- **Grupuri:** două sisteme — *merge groups* (automate, esențiale, lipesc frazele SRT în cadre coerente) și *product groups* (manuale, de nișă, categorisire + bonus de matching; ascunde-le dacă nu le folosești).
- **De tăiat:** Opacity din panoul Transform (efect înșelător), override-urile de transformări per-proiect (orfane).
- **De adăugat:** speed per segment, blur fill la zoom-out, color per segment, crop box — toate ieftine pe infrastructura existentă.
- **Multi-track:** nu — costul e un mini-NLE, iar nevoile reale sunt acoperite mai ieftin de overlay-uri țintite + merge/split manual + eventual muzică de fundal cu ducking.
