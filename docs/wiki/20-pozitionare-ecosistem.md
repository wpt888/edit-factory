# Poziționare ecosistem: fabrică, nu studio (2026-07-14)

Analiză cerută pe impasul de direcție: pipeline-ul de reels în masă vs studio de
creație AI vs sistem pe noduri (gen Flora/Weavy/Higgsfield). Context citit:
skill-urile blipost-desktop/blipost-website, wiki 17/18/19, starea celor două
repo-uri.

## Verdict

Impasul nu e o problemă de UX, ci de **poziționare nerezolvată**. Întrebarea
care îl dizolvă: *cine e clientul?*

- Client = "creatori care experimentează cu AI" → concurezi cu
  Higgsfield/Krea/Flora și pierzi: generarea AI e marfă revândută din fal.ai,
  ei au capital și acces la modele superior.
- Client = "oameni cu produse/footage care vor volum de conținut publicat" →
  pipeline-ul "rigid" e exact produsul, iar capătul-la-capăt
  **creare → programare → publicare** nu-l are nimeni: Higgsfield nu publică,
  Postiz/Blotato nu creează din footage-ul userului. Blipost le are pe amândouă.

Poziționarea de testat: **"Blipost transformă footage-ul tău de produs (plus AI
unde lipsește footage) într-un calendar de conținut publicat."** Fabrică cu
ieșire în calendar, nu studio creativ.

## De ce senzația de "disipare" e reală

Trei paradigme coexistă fără ierarhie declarată:

1. **Pipeline-ul de producție** (script→TTS→matching→render) — opinionat, cu scop
2. **Generarea AI** (FLUX, Seedance/Wan/Kling) — capabilitate generică
3. **Automations** (DAG în social-scheduler) — al treilea limbaj, neancorat

Disiparea vine din tratarea lui 2 și 3 ca *produse* când sunt *ingrediente*.
În cod decizia corectă e deja pe jumătate luată: wiki 13 + D2 arată că un video
Seedance intră în `editai_source_videos` și devine segment normal — generarea AI
*deja* funcționează ca furnizor de materie primă. Trebuie doar declarată așa și
în produs/marketing.

## Rigiditate și multi-track

Confirmă concluzia din wiki 18: **nu multi-track**. Argumentul de produs peste
cel tehnic:

- Userul care vrea track-uri are Premiere/CapCut și nu alege aplicația asta
  oricum; nu-l câștigi cu 20% dintr-un NLE.
- Userul țintă (vinde produse, vrea 30 reels/lună) percepe fiecare track în
  plus ca fricțiune. Pentru el "rigid" = "nu iau decizii de montaj".
- Flexibilitatea percepută se obține din pârghiile mici din wiki 18 (speed per
  segment, blur fill, crop box, merge/split manual, eventual overlay-uri
  poziționate pe timp) — 80% din beneficiu la 5% din cost.
- Ce lipsește real din editorul de segmente e o funcție țintită ("inserează
  clipul acesta la poziția X"), nu o schimbare de paradigmă.

## Sistemul pe noduri

**Pipeline-ul este deja un graf de noduri cu forma fixată.**
Script→TTS→matching→render e graful din Flora/Weavy, minus nevoia ca userul
să-l deseneze — asta e valoarea, nu limitarea. Flora/ComfyUI vând flexibilitatea
grafului către power-useri creativi; Blipost vinde *absența nevoii de a
construi graful* către oameni cu treabă.

Dacă nodurile își găsesc vreodată locul, e în **stratul de automations**
(orchestrare pentru avansați), nu în editor. Dar și acolo, pentru publicul
țintă, **template-urile bat nodurile**: "alege o rețetă" convertește mai bine
decât "desenează un graf". Nu se construiește acum.

## Ordinea de lucru recomandată

1. **Termină web-first** exact ca în wiki 19 (R2 upload → auth bridge →
   `render_jobs` → `/studio`). Decizie bună, în execuție, nu se relitighează.
2. **AI auto-segmentation (wiki 17)** — cea mai valoroasă mișcare contra
   senzației de rigiditate: elimină pasul cel mai manual, prezentabilă azi
   datorită hibridului FFmpeg-taie / Gemini-alege. Zile, nu săptămâni.
3. **Pârghiile mici din wiki 18** (speed, blur fill, crop box, merge/split) în
   locul oricărei discuții multi-track.
4. **Automations redefinit îngust**: recurență peste pipeline ("în fiecare
   luni, 5 produse din feed-ul X → videouri programate"), nu DAG builder
   generic. E promisiunea de "masă" livrată — și structural greu de copiat de
   Higgsfield (n-are nici pipeline de produs, nici publishing).
5. **Generarea AI ca sursă, nu destinație**: butonul de generare trăiește unde
   lipsește footage-ul (bibliotecă/segmente), nu ca secțiune-vitrină.

## Pasul de deblocare cel mai ieftin

Nu e cod, nici redesign: produsul actual, așa rigid cum e, pus în fața a 3–5
oameni care chiar au magazine online cu produse fizice. Predicție: nu se vor
plânge de lipsa track-urilor, ci de pașii manuali dinaintea lor (upload,
segmentare, alegerea variantei) — exact zonele cu soluții deja proiectate în
wiki 17/18/19.
