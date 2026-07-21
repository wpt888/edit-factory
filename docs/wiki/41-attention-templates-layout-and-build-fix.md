# Attention Templates editor: off-screen layout + silently broken standalone build

Raportat: în editorul Attention Templates nu se putea adăuga un nou video
track (butonul "Add track" nu exista) și Program monitor-ul era complet
negru — fără canvas 9:16, fără chip-ul "1080×1920", fără bara de transport cu
Play. Simptomul aducea a build vechi/rupt, dar cauza reală a fost alta.

## Root cause 1 — coloană de grid nemărginită

`frontend/src/app/attention-templates/page.tsx` avea elementul `<main>`
declarat doar cu rânduri:

```
grid grid-rows-[minmax(300px,1fr)_300px]
```

fără coloană explicită și fără `min-w-0`. Un grid fără `grid-cols-*` primește
o singură coloană implicită `auto`, care se dimensionează după conținutul cel
mai lat din ea — iar lane-ul `MultiTrackTimeline` la 60s × 100px/s are
~6200px lățime. Rezultat: toată coloana editorului se lățea la ~6200px.
Canvas-ul de preview ajungea centrat la x≈3400, butonul "Add track" la
x≈6600, chip-ul monitorului la x≈6500 — toate în afara viewport-ului de
~1250px. "Monitorul negru" era de fapt marginea stângă goală a unei scene
foarte late, nu un canvas lipsă.

Componenta partajată `MultiTrackTimeline` era corectă (`overflow-auto` +
`w-max min-w-full` intern) — scrollează intern doar dacă un strămoș îi
constrânge lățimea, ceea ce nu se întâmpla aici.

Diagnostic confirmat cu măsurători `getBoundingClientRect` în Playwright,
după ce s-a observat că simptomul se reproducea identic și pe dev server-ul
curent (`:3000`), nu doar în build-ul standalone — ceea ce a exclus de la
început ipoteza "build vechi" pentru acest simptom vizual.

Fix (commit `4e825d5` pe `main`), o singură linie schimbată:

```
<main className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(300px,1fr)_300px] bg-card">
```

## Root cause 2 — build standalone rupt + eșec silențios în lanțul de build desktop

Independent de bug-ul de layout, `frontend/.next/standalone/.next/` conținea
doar `server/`, fără `static/` (build întrerupt la un moment dat) — orice
chunk `/_next/static/*` cerut de aplicația desktop dădea 500.

Două defecte de proces mascau starea de bundle rupt:

- `frontend/scripts/postbuild.js` doar făcea `console.warn(... skipping)` și
  ieșea cu cod 0 dacă `.next/static` lipsea, în loc să eșueze.
- `electron/scripts/ensure-frontend.js` declara "bundle is ready" doar pe
  baza existenței `server.js` + un fingerprint hash, fără să verifice
  `static/` — deci un bundle rupt trecea drept valid la infinit, iar
  `npm run dev` din `electron/` nu mai rebuild-uia niciodată bundle-ul.

Fix (commit `71df4df` pe `main`):

- `postbuild.js` face `process.exit(1)` cu eroare clară când `.next/static`
  lipsește, în loc de warn+skip.
- `ensure-frontend.js` cere acum și existența + non-goliciunea
  `standalone/.next/static` în condiția de "ready".

(Editările de cod pentru acest fix au fost făcute de un agent Codex; build-ul
și verificarea au fost făcute de orchestrator.)

## Lecții

1. Un simptom de tip "element lipsă / zonă neagră" poate fi conținut randat
   corect dar împins off-screen de layout — măsoară cu
   `getBoundingClientRect` înainte să presupui build vechi sau componentă
   ruptă.
2. Un grid care declară doar `grid-rows-*` are coloana implicită `auto`, care
   crește după cel mai lat conținut. Orice pagină care găzduiește
   `MultiTrackTimeline` (sau alt conținut lat, scrollabil intern) trebuie
   să-și constrângă explicit lățimea containerului (`min-w-0` +
   `grid-cols-[minmax(0,1fr)]`), altfel scroll-ul intern al componentei nu
   mai are efect.
3. Scripturile de build care fac fallback silențios (warn + skip pe cod 0)
   transformă un build întrerupt într-o stare permanentă și invizibilă —
   verificările de "e gata bundle-ul?" trebuie să valideze conținutul real
   (aici: existența și nongoliciunea `static/`), nu doar un marker/fingerprint.

## Verificare

Rebuild standalone prin `node scripts/ensure-frontend.js` — validează chiar
calea reală de build a desktop-ului, cu env-urile `NEXT_PUBLIC_DESKTOP_MODE`
etc. Apoi Playwright pe dev server (`:3947`): butonul "Add track" creează
lane-uri V3/V4, fiecare lane are +/− pentru slot-uri, un slot apare pe canvas
ca dreptunghi cu handle-uri de drag/resize, inspectorul Image slot expune
poziție/dimensiune/fit/opacity/start/durată, iar "Save template" se
activează. Chunk-urile static răspund 200. Screenshot-uri de verificare:
`attn-verify-3.png` / `attn-verify-4.png` în rădăcina repo-ului.
