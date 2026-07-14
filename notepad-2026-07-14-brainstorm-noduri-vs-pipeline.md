# Brainstorm: noduri vs pipeline — analiză MVP (2026-07-14)

Notepad al conversației de strategie din 2026-07-14 (Claude + fondator). Include
recapitularea întregii discuții și analiza amplă cerută: "părere sinceră, din
perspectiva unui CEO de startup de milioane".

---

## 1. Recapitularea conversației

**Runda 1 (fondator):** impas de direcție. Desktop abandonat ca lansare (licențe
Apple/Microsoft), web-first deja în execuție. Conflict interior: pipeline-ul de
reels e rigid (un singur timeline, fără multi-track), generarea AI + automations
au disipat focusul, sistemele pe noduri (Flora/Weavy/Higgsfield) par flexibile
dar nu e clar cum s-ar lega cu editarea video și selecția de segmente.

**Runda 1 (Claude):** impasul e de poziționare, nu de UX. Recomandare "fabrică,
nu studio" (wiki 20): pipeline = coloană vertebrală, AI gen = furnizor de
segmente, scheduler = ieșire; fără multi-track, fără noduri; client țintă =
vânzători de produse care vor volum publicat, nu creatori care experimentează.

**Runda 2 (fondator, poziția curentă):**
- Parțial de acord, dar pipeline-ul *exact cum e acum* limitează audiența prea
  tare. "Nu e rău ce avem, dar nu e destul."
- Un sistem pe noduri ar fi "super bun", dar: (a) nu e clar cum se combină cu
  timeline-ul și editarea video; (b) observație corectă din piață — toată lumea
  face noduri acum (și-a făcut cont pe Wireflow să verifice) și nodurile tind să
  complice, să dea "senzația de greu".
- Concluzie proprie: încă o platformă de noduri pentru *generare* AI = greu de
  avut succes. Generarea AI ar trebui să fie bonus. Diferențiatorul ar fi
  **editarea video pe bază de noduri**, cu export și încărcare pe social media
  la capăt.
- Diagnoza UX pe aplicația actuală: patru locuri separate (AI images/video,
  footage & segments, clipping, pipeline) care nu se leagă vizibil cap-la-cap;
  fluxul "întâi selectezi segmente, abia apoi pipeline" e contraintuitiv.
- Ambiție declarată: să concureze cu Higgsfield și companiile similare — "nu
  avem nicio șansă fără facilități în plus față de ce oferă ei".
- Schița de produs: un **nod principal "Video Composer"** care primește ca
  input imagini/video/audio, se poate maximiza într-un editor propriu-zis, și
  în care se pot selecta și segmente de pe videoclipuri.

---

## 2. Ce e corect în intuiția ta (și vreau să rămână)

**(a) Diagnoza fragmentării e reală și e cea mai valoroasă observație din toată
discuția.** Aplicația de azi e un rând de camere fără hol: AI gen, segmente,
clipping, pipeline — fiecare cu intrarea ei, fără o suprafață care să arate cum
curge materia primă dintr-una în alta. Asta nu e o problemă de "rigiditate a
pipeline-ului", e o problemă de **model mental absent**: utilizatorul nu vede
fabrica, vede patru unelte. Orice direcție alegem, asta trebuie reparat.

**(b) Observația despre saturația nodurilor de generare e matură.** Ai testat
Wireflow, ai văzut Flora/Weavy/Higgsfield, și ai tras singur concluzia corectă:
"încă un canvas de generat imagini/video cu AI" e o categorie deja plină, în
care diferențierea e imposibilă pentru noi (revindem aceleași modele fal.ai pe
care le revând toți). Mulți fondatori nu au disciplina asta — de obicei văd
trendul și sar în el.

**(c) Sinteza "composer node cu timeline înăuntru" e arhitectural sănătoasă —
și există precedent serios.** Ăsta e punctul unde îți dau mai multă dreptate
decât mi-am dat mie în runda 1. În industria video profesională, nodurile
există de decenii: Nuke, DaVinci Fusion, Blender compositor. Dar toate au
învățat aceeași lecție: **nodurile sunt corecte pentru dataflow (de unde vine
media, ce transformări suferă, ce variante se ramifică), timeline-ul e corect
pentru timp (în ce ordine și cât durează)**. Nimeni nu a reușit "editare pură
pe noduri" pentru că secvențierea temporală e liniară prin natură — și orice
încercare colapsează exact în soluția pe care ai schițat-o tu: un nod de
compoziție care, deschis, e un timeline. Deci nu e o idee ciudată; e sinteza la
care a ajuns și industria. Intuiția ta aici e bună.

---

## 3. Ce lipsește din teză — și e chiar diferențiatorul

Toate platformele de canvas pe care le-ai enumerat au același capăt de graf:
**"download asset"**. Flora, Weavy, Wireflow, Krea, chiar și Higgsfield —
graful se termină cu un fișier pe disc. Ce nu are niciuna: **un nod de
Publish/Schedule**. Iar noi avem deja, funcțional, exact bucata aia: scheduler,
conectori sociali, coadă de render, credite, billing.

Reformularea pe care ți-o propun ca poziționare:

> **"Canvas-ul unde conținutul AI devine calendar de publicare."**
> Graful nostru nu se termină în download — se termină în postări programate.

Asta rezolvă elegant și conflictul dintre wiki 20 ("fabrică") și ambiția ta de
noduri: **fabrica nu moare, devine graful-template vedetă de pe canvas**.
Pipeline-ul actual (script→TTS→matching→render) e, la propriu, un graf cu formă
fixă. Pe canvas el devine o rețetă predefinită pe care userul o deschide gata
construită — iar power-userul o poate rearanja. Nu alegem între "fabrică" și
"studio pe noduri": fabrica e un preset al canvas-ului.

---

## 4. Părerea sinceră de CEO — partea care nu-ți va plăcea

Acum partea pe care mi-ai cerut-o explicit: perspectiva rece, de fondator care
a mai văzut filmul ăsta.

**(a) "Să concurăm cu Higgsfield" e o propoziție care omoară startup-uri dacă
e luată literal la MVP.** Higgsfield a strâns zeci de milioane, are acces
prioritar la modele, echipă de zeci de oameni și iterează săptămânal. Nu îi
concurezi pe *breadth* de features la lansare — pierzi prin definiție, pentru
că fiecare feature al tău "în plus" e la ei o săptămână de sprint. Îi concurezi
pe **ce nu pot sau nu vor să facă**: capătul de publicare + workflow-ul
repetabil + nișa de produs fizic. Figma nu a lansat "Photoshop cu tot plus
colaborare" — a lansat doar interfețe, colaborativ. Canva nu a lansat "Adobe
mai simplu" — a lansat postări sociale din template-uri. Wedge îngust, apoi
expansiune. Frica ta de "audiență prea restrânsă" e frica standard a
fondatorului la momentul wedge-ului — și e aproape întotdeauna un semn că
wedge-ul e suficient de ascuțit, nu prea îngust.

**(b) Costul real al canvas-ului nu e canvas-ul — e generalizarea
timeline-ului.** Un canvas React Flow cu 6-8 tipuri de noduri care orchestrează
API-urile existente (JobStorage, render_jobs, fal.ai, TTS) e muncă de
săptămâni, pentru că *toate primitivele de execuție există deja* — inclusiv un
început de automations DAG în social-scheduler (WIP-ul din admin panel).
Partea scumpă e nodul Composer "maximizat": timeline-editor.tsx are ~3300 de
linii și e construit audio-first, cu un singur scop (frazele TTS dictează
pozițiile). Să-l generalizezi la "compun orice media pe un timeline liber" e
exact mini-NLE-ul despre care wiki 18 a avertizat — luni, nu săptămâni, cu
regresii garantate în paritatea preview/render abia stabilizată. Trebuie să
știi că *asta* cumperi când spui "video composer node", nu canvas-ul în sine.

**(c) Ai deja o listă de blocaje de lansare care nu au nicio legătură cu
nodurile.** Stripe live, chei R2/OAuth, aprobări Meta, pagini legale, acordul
OEM ElevenLabs, calibrarea rate-card-ului de render. Un pivot de UI acum
împinge venitul-zero-validat cu încă un trimestru. Regula de CEO: **nu
redesenezi fabrica înainte să fi vândut primul lot.** Orice săptămână de canvas
înaintea primilor useri plătitori e o săptămână în care înveți din propria
imaginație în loc să înveți din piață.

**(d) Ai numit singur riscul de UX și apoi l-ai pus deoparte.** "Nodurile tind
să complice, să dea senzația de greu" — corect, și e motivul pentru care toate
platformele astea au conversie slabă în afara power-userilor. Dacă construim
canvas, senzația de greu se combate cu patru decizii ne-negociabile:
1. **Templates-first**: nu deschizi niciodată un canvas gol; deschizi o rețetă
   funcțională (ex. "Product Reels Factory") și o modifici.
2. **Dual view**: același graf are o vedere "wizard/stepper" (pipeline-ul de
   azi E vederea wizard) și o vedere "canvas" — utilizatorul simplu nu vede
   noduri niciodată dacă nu vrea. Un singur model de date, două proiecții.
3. **Maxim 6-8 tipuri de noduri.** Nu 50, ca ComfyUI.
4. **Auto-layout + auto-wire**: adaugi un nod, se leagă singur de ce e evident.

---

## 5. Arhitectura propusă (dacă/când construim canvas-ul)

**Taxonomia nodurilor (8, nu mai multe):**

| Categorie | Noduri | Acoperă silozul actual |
|---|---|---|
| Surse | Upload/Library, Product Feed, AI Image, AI Video | AI gen + footage + product library |
| Transformări | Auto-Segment (wiki 17), Clip/Highlights (clipping-ul din web), Script+TTS | segments + clipping + Step 1-2 |
| Compoziție | **Video Composer** (maximize → timeline; intern = Step 3 de azi) | pipeline Step 3 |
| Ieșire | Render, **Publish/Schedule** | Step 4 + scheduler |

**Pipeline-ul actual = graful-template default**, livrat gata legat:
`Idee → Script → TTS → Composer (auto-match) → Render → Schedule`.

**Runtime = ce există deja.** O rulare de graf e o plimbare topologică ce
apelează endpoint-urile existente; starea în DB; progresul prin JobStorage;
render prin `render_jobs` pe fleet. Nodul nu e cod nou de execuție, e un
*wrapper vizual peste un API existent*. Substratul de automations DAG început
în social-scheduler e punctul natural de altoire.

**Composer-ul, în două trepte ca să nu construim mini-NLE-ul din prima:**
- Treapta 1: Composer = Step 3 de azi, neschimbat funcțional (audio-first,
  matching pe segmente), doar re-ambalat ca nod cu intrări explicite (media,
  audio, script). Cost mic, pentru că e re-montare, nu rescriere.
- Treapta 2 (doar după semnal de la useri): intrări libere pe timeline —
  "inserează clipul X la poziția Y", strat de overlay-uri poziționate pe timp.
  Adică exact pârghiile din wiki 18, nu track-uri egale.

---

## 6. Secvențierea pe care aș paria eu, ca CEO

| Faza | Ce | De ce înainte de rest |
|---|---|---|
| 0 | **Lansează studio-ul web așa cum e planificat** (wiki 19: R2 → auth bridge → render_jobs → /studio) + deblochează Stripe/legal/OAuth | Venit + învățare din piață; totul de mai jos se calibrează pe useri reali |
| 1 | **Biblioteca unificată de media** — orice asset din orice unealtă (AI gen, upload, clip din clipping, segment) aterizează într-o singură bibliotecă vizibilă peste tot | Rezolvă 70% din senzația de fragmentare FĂRĂ canvas; în mare parte există deja (`editai_source_videos`), e muncă de expunere, nu de construcție |
| 2 | **"Flows" — automatizarea liniară vizibilă**: "feed-ul X → rețeta Y → programat L/Mi/V", prezentată ca lanț de pași (nu canvas liber) | E promisiunea de "masă" livrată; e și migrarea datelor pe modelul de graf, fără UI-ul scump |
| 3 | **Canvas view** peste Flows (React Flow, 8 noduri, templates-first, dual view) | Abia acum diferențierea vizuală "de demo" — pe un runtime deja validat |
| 4 | **Composer treapta 2** (inserții libere, overlay-uri) | Doar dacă userii cer; wiki 18 rămâne valabil până la proba contrarie |

Observație importantă: fazele 1-2 nu sunt "amânarea viziunii tale" — sunt
*implementarea ei incrementală*. Modelul de date al unui Flow liniar și al
unui graf e același; diferă doar proiecția pe ecran. Nu arunci nimic când
treci de la faza 2 la 3.

---

## 7. Verdict

- **Viziunea "canvas cu Video Composer + nod de Publish" e un nord bun** — e
  singura formulare de noduri din piață care nu se termină în download și care
  folosește avantajul nostru structural (scheduler + fleet + credite). O
  susțin ca direcție de produs pe 12 luni.
- **Ca MVP de lansat acum, e o greșeală clasică de fondator**: scop mărit
  înaintea primului dolar, împotriva propriei tale observații că nodurile "dau
  senzația de greu". MVP-ul rămâne studio-ul web + biblioteca unificată +
  flows; canvas-ul e v2, construit pe venit și feedback, nu pe ipoteze.
- **Întrebarea decisivă pe care trebuie să o închizi tu**, pentru că e singura
  pe care n-o poate închide nicio analiză: *ce vrei să fie primul dolar?* Un
  magazin care plătește pentru 30 de reels de produs pe lună (wedge-ul îngust,
  atins în săptămâni), sau un creator care plătește pentru canvas (piața
  largă, atinsă în luni, contra Higgsfield)? Recomandarea mea rămâne prima —
  cu canvas-ul ca actul II, nu ca biletul de intrare.

---

*Fișier generat cu notepad-skill; analiza anterioară („fabrică, nu studio") e
în `docs/wiki/20-pozitionare-ecosistem.md` și rămâne valabilă ca punct de
plecare, amendată de acest document: nodurile nu mai sunt respinse, sunt
secvențiate.*
