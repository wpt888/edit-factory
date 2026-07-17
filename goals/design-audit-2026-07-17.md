# Audit de design — Blipost web + BlipStudio (2026-07-17)

**Metodă:** 10 agenți de audit pe dimensiuni (fundaluri, spacing, tipografie, hover/focus,
butoane/controale, radius/borduri, shell/navigație, empty/loading states) pe ambele repo-uri,
findinguri verificate adversarial (74 confirmate + 4 de la criticul de completitudine),
plus 3 agenți de referință pe anthropic.com / openai.com / elevenlabs.io.
**Findingurile brute cu file:line:** `goals/design-audit-2026-07-17-findings.txt` (EN).

---

## Verdictul

**Token-urile de design sunt corecte și aliniate între aplicații. Problema nu e paleta —
e că nu există primitive partajate, așa că fiecare pagină reinventează totul din memorie.**

- Web `components/ui/` conține UN singur fișier: `button.tsx`. Nu există Card, Input,
  Select, Textarea, Dialog, Badge, EmptyState, Progress, Skeleton, Toaster sau `error.tsx`.
  Fiecare pagină își scrie de mână cardul, modalul, inputul — și valorile diverg.
- Studio ARE kitul shadcn aproape complet (24 fișiere ui/), dar nu are PageHeader/PageShell,
  iar primitivele lui nu sunt consecvente între ele (Button rounded-md vs Card rounded-xl).
- Dovada că extracția funcționează: web `PageHeader` e folosit perfect consecvent pe 10+
  pagini; admin (construit dintr-o bucată) e 11/13 identic. Unde există primitivă — e
  coerență; unde nu — drift.

## Problema din screenshot (pipeline BlipStudio) — cauze exacte

1. **Banda neagră vs gri** — toolbar-ul (`pipeline-stepper.tsx:133`) e `bg-background/95`
   (negru-cerneală oklch 0.145), iar panourile de sub el sunt `Card` cu `bg-card` implicit
   (oklch 0.19, vizibil mai deschis) cărora modul „workspace" le scoate bordura/radius/umbra
   (7 situri: step1/2/3, source-videos-card, pipeline-history-sidebar) dar **uită să le
   schimbe fundalul** → cusătură dură, nedelimitată, chiar sub toolbar.
2. **Suprapunerea „Back to Scripts" peste pasul 4** — stepper-ul e centrat cu
   `absolute left-1/2` + lățimi fixe pe breakpoints; la ~1100–1300px butoanele din dreapta
   (`z-10`) se suprapun peste el. Fix: layout flex (context | stepper flex-1 | acțiuni).
3. **„Back to Scripts" apare de 2 ori** pe același ecran (toolbar ghost + outline lângă titlu).
4. **Titlu „greoi"** — `Preview & Select Variants ({n} previews shown)` bagă contorul viu în
   H2; corect: titlu + linie meta `text-muted-foreground` separată.
5. În pipeline coexistă **3 toolbar-uri diferite**: h-14 blur (stepper), h-14 flat bg-card
   (step 2), h-10 flat (step 3). Step 2 își contrazice propriul wrapper (bg-background
   secțiune / bg-card sub-header).

## Top probleme sistemice

### Spacing / containere
- **Web: 3 sisteme de container** coexistă: `py-8/gap-8` (media, channels, analytics,
  billing, settings), `py-6/gap-6` (dashboard, clips), `p-4 md:p-8/space-y-8` (create,
  automations — cele mai noi pagini!). Marginile „sar" la fiecare click în meniu.
- **Schedule e ruptă de restul**: `px-1` (4px gutter!), fără max-width — singura pagină
  lipită de sidebar (`schedule/page.tsx:378`).
- **5 lățimi maxime** fără regulă: 3xl (settings), 5xl (billing/create/automations),
  6xl (clips/media/channels/analytics), 7xl (dashboard), nelimitat (schedule).
- **Studio: 6 scale de lățime** simultane (7xl, [1400px], 5xl, 3xl, [1600px], `container`)
  și pe aceeași lățime 7xl două rețete de padding diferite. Create Video (`px-6`) vs
  Create Image (`px-4`) — taburi ale aceluiași flow cu gutter diferit.
- **Carduri**: ~31 de `bg-card p-*` scrise de mână pe web cu p-4/p-5/p-6 aleator;
  dashboard-ul singur folosește 3 paddinguri pe secțiuni identice ca rol.
- **Empty states**: același pattern dashed pe 5 ecrane cu 4 paddinguri și 2 fill-uri diferite.

### Fundaluri / suprafețe
- **Scrim-uri modale: 4 opacități** (`bg-black/50 /55 /60 /70`) în 9 fișiere web pentru
  exact același rol.
- **Input fill**: 35 apariții `bg-card` vs 3 `bg-background` (composer-ul din /create —
  cea mai folosită pagină — e printre excepții).
- Editorul de automations împrumută `bg-sidebar/NN` (token exclusiv sidebar) pentru barele
  lui din canvas.

### Tipografie
- **Studio: 14 din 20 de pagini NU aplică `font-heading` pe H1** — titlul cade pe fontul de
  UI în loc de Bricolage Grotesque; mărimile se împart ~50/50 între text-2xl și text-3xl.
- `CardTitle` (studio) nu are font-heading implicit → ~40 de call-site-uri fără el.
- Admin web: toate H1 sunt text-2xl hardcodat, un pas mai mic decât restul aplicației.
- Headerele de secțiune web se împart text-lg vs text-xl fără regulă.
- Etichetele de grup din sidebar („CREATE") au 3 variante de mărime/greutate/tracking/opacitate
  între web și studio.

### Hover / focus
- Butoane-icon fără niciun hover: thumbnail-ul din media-card (ținta principală de click!),
  toggle-ul Badge din automations studio, butoanele din block-editor admin, sign-out mobil studio.
- **Gramatică forked**: studio `hover:text-lime` pe nav vs web `hover:text-sidebar-accent-foreground`
  — restul clasei e byte-identic.
- `outline-none` fără înlocuitor focus-visible pe mai multe selecturi/inputuri hand-rolled
  (admin, settings, video-player) — regresie reală de accesibilitate.

### Butoane / controale
- **109 `<button>` raw în 35 de fișiere web**; doar 30 de fișiere importă Button.
- **Cele două Button primitives au divergat**: web h-8/rounded-lg vs studio h-9/rounded-md
  (token-urile --radius sunt identice — e drift de autor, nu decizie).
- Admin affiliates: 8 butoane ad-hoc, fără focus ring, fără scala h-8/h-9.
- Icon sizing: studio amestecă `h-N w-N` (598×) cu `size-N` (254×), uneori în același fișier.

### Radius / borduri / umbre
- Studio Card bagă `shadow-sm` implicit → 9 fișiere îl anulează cu `shadow-none`; web
  aproape nu folosește umbre. Povești de elevație opuse între aplicații.
- One-off-uri: `rounded-2xl` pe cardul de eroare /studio, `rounded-xl` pe composer
  (restul fișierului e rounded-lg), `rounded-md` pe tile-ul de top-up din billing.
- Afordanța „selectat": studio = `ring-2 ring-primary/40`, web = `border+bg tint` —
  două limbaje pentru același concept.

### Paritate shell (web ↔ studio)
- **Media Library are iconițe diferite** (web Images, studio Cloud) — încalcă contractul
  de paritate; restul conceptelor partajate sunt OK.
- Product switcher: descrierile ACELORAȘI produse diferă între aplicații.
- Widget-ul de credite: web = Zap lime + „AI Credits Remaining" + bară de cotă; studio =
  Wallet neutru fără lime — același număr, brănduit diferit.
- Footer sidebar studio a trecut pe rounded-xl (web rounded-lg); logo pill h-8 vs h-11;
  rail-ul colapsat fără divizoare de grup; Clapperboard folosit de 3 lucruri diferite.
- Web `app-nav` are prefix-match nesigur pe rută activă (studio are varianta corectă) —
  bug latent la prima rută care e prefixul alteia.

### Stări de feedback (aici se vede „ieftin" la un SaaS cu abonamente)
- **Web NU are toast-uri deloc** (sonner nici nu e dependență; studio îl are pe 17+ pagini).
- **Web nu are Progress bar** — render-ul de clipuri arată un pill de text; studio are
  progress lime pe 13+ locuri.
- **Web nu are NICIUN `error.tsx`** — orice crash → pagina default Next.js nestilizată.
  Studio are error.tsx temat cu Try again/Back home.
- Fără Skeleton pe web; upload-ul confirmă doar cu un „done" inline.
- Fără Dialog primitive pe web: 7 modale hand-rolled cu 4 max-width-uri; fără Badge:
  ~16 pill-uri span cu 3 rețete; scrollbar temat doar în 2 locuri; un singur `z-[100]`
  nedocumentat (consent banner).

---

## Ce fac Anthropic / OpenAI / ElevenLabs (principiile aplicabile)

1. **Maxim 3 suprafețe**, din aceeași familie de nuanță: pagină (~oklch 0.145), panou
   (~0.19), overlay/hover (+un pas). Orice al 4-lea gri se șterge. Separarea header/conținut
   se face cu UN hairline (white/8–10%), nu cu fundal diferit. Zero box-shadow pe dark
   (OpenAI: 0 umbre pe 33 de pagini).
2. **Accentul se raționalizează**: lime doar pe CTA primar, nav activ, focus ring, status
   pozitiv. Dacă lime apare de >5 ori pe ecran, ecranul țipă. Restul ierarhiei o face
   rampa de text (alb ~92% / ~64% / ~40%).
3. **Un container, o scară de spațiere**: o lățime de conținut (2 tier-uri numite: default +
   narrow), padding doar din scara 4/8/12/16/24/32/48/64. Niciun 10px/18px/gap-7 ad-hoc.
4. **Tipografie: max 5 mărimi, 2 greutăți** (ElevenLabs rulează tot site-ul pe normal+medium).
   Contrastul vine din mărime + culoare + spațiu, nu din bold peste tot.
5. **Un singur verb de hover**: suprafața urcă UN pas pe rampă (sau textul un pas), tranziție
   150–200ms doar pe culoare/fundal. Fără scale/translate/glow. `active:scale-[0.98]`
   pe butoanele primare e singura excepție elegantă.
6. **2–3 radiusuri în total**, aceleași peste tot (ex. 8px controale, 12–16px carduri/modale,
   full pe pills).
7. **Formula anti-„text greoi"**: eyebrow muted + titlu scurt + O propoziție + acțiune;
   detaliile în disclosure/tab. Contoarele și metadatele NU stau în titlu.
8. Micro-detalii premium aproape gratuite: `text-wrap: balance` pe headinguri, noise 2–3%
   pe suprafețele hero (ElevenLabs), separatoare hairline în loc de carduri grele.

---

## Plan de remediere recomandat (fazat, în ordinea impactului)

**P0 — bugurile din screenshot (studio, ~o sesiune):**
stepper flex în loc de absolute-center; un singur „Back to Scripts"; fundalul panourilor
workspace aliniat la bg-background (sau border-t deliberat); un singur toolbar h-14;
titlurile fără contoare inline; H1 cu font-heading peste tot (port PageHeader în studio).

**P1 — primitivele lipsă pe web (fundația, cel mai mare levier):**
`ui/card.tsx` (un padding: p-5 sm:p-6), `ui/input.tsx` + `select` + `textarea` (port din
studio), `ui/dialog.tsx` (un scrim), `ui/badge.tsx`, `empty-state.tsx`, `ui/progress.tsx`
(lime), `ui/skeleton.tsx`, sonner + themed-toaster (copiat din studio), `error.tsx` pe
(app)/(admin). Plus un `PageShell` cu rețeta canonică
`mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6` și tier `narrow` (3xl).

**P2 — migrarea paginilor pe primitive (mecanic, agenți în paralel):**
toate paginile (app)+(admin) pe PageShell (Schedule inclusă — calendarul full-bleed cu
-mx interne); cele ~31 de carduri pe Card; modalele pe Dialog; pill-urile pe Badge;
empty states pe EmptyState; inputurile ad-hoc pe Input/Select (repară și outline-none).
Studio: PageShell propriu (max-w-7xl + o rețetă), `container` eliminat, mb-6/mb-8 → space-y.

**P3 — paritate shell:** iconiță Media Library unificată (Images), copy product switcher
identic, hover nav pe token semantic (fără hover:text-lime), etichete de grup identice,
credits widget unificat (Zap lime + cotă), rounded-lg în footer studio, Button-urile
aliniate (h/radius), prefix-match fix în app-nav web.

**P4 — gramatica de polish:** un token de tranziție (150ms color/bg), hover pe toate
țintele de click (media tiles, rows, icon buttons), 2 radiusuri documentate, umbre scoase
de pe dark (inclusiv shadow-sm din Card studio), rampa de text în 3 trepte aplicată
consecvent, formulele de card/empty-state, text-balance pe headinguri.

Regula de proces care oprește regresia: **nicio clasă de container/card/modal scrisă
de mână în pagini** — orice pagină nouă consumă primitivele; parity skill se extinde cu
Button/label/hover grammar.
