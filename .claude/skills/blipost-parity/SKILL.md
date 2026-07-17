---
name: blipost-parity
description: >
  Folosește acest skill ori de câte ori se discută concordanța / paritatea între
  aplicația web Blipost (social-scheduler, blipost.com) și aplicația desktop Blipost
  (edit_factory, Electron). Trigger phrases: "concordanță", "paritate", "parity",
  "aliniere web desktop", "audit UI", "consistență între aplicații". Obligatoriu de
  consultat și când o schimbare într-una din aplicații atinge: navigația/meniul, tema
  (globals.css), pagina de Settings, branding/logo/taglines, sau copy care face
  referire la cealaltă aplicație.
---

# Blipost Parity — contractul de concordanță web ↔ desktop

Două aplicații, un singur brand:
- **Web:** `C:\obSID SRL\n8n\social-scheduler` (Next.js + Drizzle/Postgres, blipost.com)
- **Desktop:** `C:\obSID SRL\n8n\edit_factory` (Electron + FastAPI + Next.js, Supabase)

Arhitectura oficială (decizie 2026-07, `edit_factory/docs/IMPLEMENTATION-PLAN-2026-07.md`):
**web = creierul canonic** (credite, conturi sociale, AI gestionat, R2), **desktop = client
+ mușchi local** (FFmpeg/GPU gratis), legate prin **Platform API + token** (`blp_...`).
NU se unesc DB-urile sau auth-urile. Paritatea NU înseamnă feature-uri identice —
înseamnă: aceeași temă, același brand, aceeași limbă, iar conceptele partajate poartă
aceleași nume/iconițe, cu referințe încrucișate corecte.

## 1. Ce TREBUIE să fie identic (verifică la fiecare audit)

### Tema (sursa canonică: **desktop** `frontend/src/app/globals.css` — din 2026-07-10)
**Restyle monocrom 2026-07-10 (decizie user):** verdele lime era folosit peste tot și
obosea vizual; noul sistem e neutru/profesional, iar lime a rămas DOAR accent de brand.
Desktopul a fost restilizat primul; web-ul TREBUIE aliniat la acest set (vezi watchlist).
- **Două teme pe clase:** `:root` = light, `.dark` = dark (default; aplicat pre-hydration).
- `--primary` e **LIME** în ambele teme (re-amendat 2026-07-11 după feedback user —
  „butoane albe" nu-s ok): `oklch(0.89 0.215 127)` cu foreground ink
  `oklch(0.145 0.005 110)`. Suprafețele (background/card/secondary/muted) rămân
  NEUTRE — asta e diferența față de tema pre-restyle.
- Dark backgrounds neschimbate: `--background` = `oklch(0.145 0.005 110)`, `--card` =
  `oklch(0.19 0.007 110)`, `--border` = `oklch(1 0 0 / 10%)`, `--input` = 14%.
- Token-uri semantice noi: `--success` (verde desaturat), `--warning` — pentru stări,
  nu lime.
- **Lime = brand + accente active** (amendat 2026-07-11, decizie user): logo, avatar,
  Button `variant="cta"`, butoanele default (`bg-primary`=lime), stepper, plus
  controalele interactive din `components/ui/` — Slider, Checkbox, Switch, Progress
  (acestea poartă `bg-lime` explicit, redundant cu primary, dar intenționat).
  Stările de aprobare rămân pe `--success` (verde desaturat, nu lime).
- **Theme switcher EXISTĂ acum pe desktop** (Settings → Appearance, localStorage
  `blipost-theme`, dark default). Regula veche „dark-only" e ABROGATĂ.
- Fonturi: **Bricolage Grotesque** (headinguri), **Instrument Sans** (UI), **Geist Mono**.
- Radius de bază `--radius: 0.625rem` + aceeași scară sm…4xl.
- Animații: `--animate-fade-up`, `--animate-marquee`, `--animate-blink`.

### Branding & limbă
- Numele e **"Blipost"** peste tot în UI. Zero apariții user-visible de "Edit Factory".
- **Tot UI-ul în engleză** în ambele aplicații (web tradus integral 2026-07).
  Check: grep diacritice `[ăîâșțĂÎÂȘȚ]` în stringuri UI → trebuie 0 rezultate
  (excepție: conținut default configurabil de user, ex. CTA "Comanda acum!").

### Referințe încrucișate (copy contract — cel mai fragil punct!)
Când o aplicație descrie un ecran din cealaltă, textul trebuie să corespundă VERBATIM
cu titlul real al secțiunii țintă:
| Cine zice | Text | Ținta reală |
|---|---|---|
| Desktop Settings → "Blipost Account" | "Create a token in Blipost web → Settings → API & Desktop tokens" | Web Settings, secțiunea `API & Desktop tokens` |
| Desktop Settings | placeholder `blp_...` | Web `lib/public-api.ts` generează `blp_` + 48 hex |
| Web Settings → "Connect a desktop for free rendering" | "in the desktop app under Settings → Render for Blipost" | Desktop Settings, cardul `Render for Blipost` (pairing code + runner) |

Regulă: redenumești o secțiune din Settings într-o aplicație → caută-i numele vechi în
cealaltă (grep în `app/(app)/settings/` pe web, `frontend/src/app/settings/` pe desktop).

### Concepte partajate — același nume + aceeași iconiță (lucide)
| Concept | Web | Desktop |
|---|---|---|
| Programare postări | "Schedule" / CalendarClock | "Schedule" / CalendarClock |
| Automatizări cloud | "Automations" / Workflow | "Automations" / Workflow (canonical cloud sync) |
| Setări | "Settings" / Settings | "Settings" / Settings |
| Sold credite | widget sidebar "AI Credits Remaining" | pill sidebar cu balanța (după conectare) |
| Avatar user | cerc lime cu inițiale, în footer-ul sidebarului | idem |

### Pattern-uri de componente
Ambele: shadcn-style (CVA + Tailwind v4), aceleași variante de Button
(default=primary LIME, cta=lime — unic per ecran, outline, secondary, ghost,
destructive, link), sidebar `w-64` sticky cu item activ = fundal `sidebar-accent`
(fără accent lime pe iconițe), card `bg-card` + border + rounded. **Sidebar collapse
unificat (2026-07-11):** un chevron simplu lângă logo (`ChevronLeft`) colapsează
sidebar-ul la un **rail cu iconițe** `w-16` (labelurile devin tooltip-uri, iconițele
fiecărui item rămân vizibile); un `ChevronRight` sus în rail îl reextinde. NU se ascunde
complet (decizie user: iconițele trebuie să rămână). Web persistă prin cookie server-read
(fără flash), desktop prin `localStorage`.

### Shell alignment (X1 — 2026-07-18, sursa canonică: WEB)
- **Media Library** = iconița lucide `Images` în ambele (desktop folosea `Cloud`, greșit).
- **Copy switcher de produse identic:** array-ul `PRODUCTS` (`components/product-switcher.tsx`
  pe web, `frontend/src/components/product-switcher.tsx` pe desktop) trebuie să aibă
  `name` + `description` identice caracter cu caracter pentru fiecare produs. Sursa
  canonică e web-ul (`href`/`external`/`icon` rămân specifice fiecărei aplicații).
- **Hover pe item de nav inactiv:** `hover:text-sidebar-accent-foreground` (NU
  `hover:text-lime` — lime nu e accent aprobat pe hover de nav).
- **Class string pentru labelul de grup din sidebar (identic în ambele):**
  `px-3 pt-4 pb-1 text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground/35 uppercase`.
  Listele de nav folosesc `gap-0.5` (nu `gap-1`); rail-ul colapsat desenează un
  divizor (`mx-2 my-1.5 border-t border-sidebar-border`) între grupuri.
- **Scala Button:** bază `rounded-lg` + size `default` = **h-9** în ambele aplicații
  (decizie 2026-07-18, „apple-like click target" — desktop era deja h-9, web a trecut
  de la h-8 la h-9).

## 2. Divergențe APROBATE (nu le "repara")

1. **Radius Electron:** `html.desktop { --radius: 0.375rem }` — deliberat ("precision
   instrument", comentat în CSS-ul desktop). Baza `:root` rămâne 0.625rem.
2. **Structura meniului:** web = listă plată (Dashboard, Channels, Media Library,
   Schedule, Automations, Analytics, Clips, Billing, Settings, [Admin]); desktop =
   4 grupuri (Create / Library / Products / Workspace). Produse diferite, meniuri diferite.
3. **Fonturi extra pe desktop** (Montserrat, Roboto, Open Sans, Oswald, Bebas Neue) —
   sunt pentru subtitrări burned-in, nu pentru UI.
4. **`window.editFactory`** — namespace-ul intern IPC Electron; invizibil pentru user;
   nu merită redenumit (ar rupe sincronizarea shell↔frontend).
5. **Fără tagline sub logo (2026-07-11, decizie user):** ambele aplicații au eliminat
   subtitlul de sub wordmark (web avea "Long video to reviewed clips and scheduled
   posts", desktop "AI scripts, TTS and video assembly"). Acum sub logo rămâne doar
   wordmark-ul Blipost — identic în ambele.
6. **"Clips" înseamnă altceva:** pe web = pipeline-ul de AI clipping (Scissors); pe
   desktop = biblioteca locală de videouri randate (Film, ruta `/librarie`, label nav
   redenumit "Local Projects" 2026-07-13). Coliziune semantică atenuată — vezi watchlist.

## 3. Watchlist — gap-uri cunoscute (verifică statusul la fiecare audit)

- [x] **PROPAGARE TEMĂ MONOCROMĂ PE WEB** — REZOLVAT 2026-07-13: temele web și
  desktop sunt aliniate (token-uri `:root`/`.dark`, `--success`/`--warning`,
  Button `variant="cta"`, lime doar brand/CTA). Nu mai e gap deschis.
- [x] **Desktop pairing UI pentru render** — REZOLVAT 2026-07-11: desktop-ul are
  cardul **Settings → Render for Blipost** (pairing code 8 caractere + runner Python
  local, badge GPU la NVENC), separat de cardul `Blipost Account` (token `blp_`).
  Copy-ul web a fost corectat să pointeze la "Render for Blipost".
- [x] **Coliziunea "Clips"** — ATENUATĂ 2026-07-13: desktop a redenumit labelul de
  navigație + titlul paginii `/librarie` din "Clips" în "Local Projects" (ruta rămâne
  `/librarie`, funcționalitatea neschimbată). Coliziunea semantică web-Clips
  (pipeline AI clipping) vs desktop-Clips (bibliotecă locală de videouri randate) e
  redusă; taburile interne ("Video Clips" în pagina Local Projects) și dashboard-ul
  ("Clips Generated"/"Clips Rendered") încă folosesc "Clips" ca termen generic de
  conținut — nu fac parte din nav/title, rămân neschimbate deliberat.
- [x] **Desktop Automations sync** — REZOLVAT 2026-07-13: desktop are intrarea
  `Automations` / `Workflow` și folosește aceeași înregistrare canonică din web
  pentru listare, creare, salvare, activare/dezactivare și ștergere. Sesiunea
  desktop este validată prin bridge-ul Supabase de încredere, fără un al doilea
  token cerut în UI; tokenurile `blp_` rămân fallback legacy. Desktop nu duplică
  DB-ul și nu persistă definițiile workflow-urilor local.
- [ ] **Desktop "Schedule" + "Calendar"** — două intrări de meniu cu suprapunere;
  candidat de consolidare internă (nu e problemă de paritate web).

## 4. Procedura de audit (rulează la cerere sau după schimbări majore de UI)

1. **Temă:** diff pe token-uri între `social-scheduler/app/globals.css` și
   `edit_factory/frontend/src/app/globals.css` (secțiunile `:root`/`.dark` + `@theme`).
   Sursa canonică e DESKTOPUL (restyle 2026-07-10); token nou pe desktop se propagă
   pe web în același PR/sesiune (invers doar pentru conținut de marketing).
2. **Meniu:** compară `social-scheduler/components/app-nav.tsx` cu
   `edit_factory/frontend/src/components/navbar.tsx` — conceptele partajate au același
   label + aceeași iconiță lucide?
3. **Branding:** grep case-insensitive `edit factory|editfactory` în ambele frontend-uri
   → doar `window.editFactory` (IPC) e permis. Grep `Blipost` în titluri/metadata.
4. **Limbă:** grep `[ăîâșțĂÎÂȘȚ]` în `*.ts,*.tsx` din ambele UI-uri → 0.
5. **Referințe încrucișate:** verifică tabelul din §1 — fiecare citat mai corespunde
   verbatim cu titlul secțiunii țintă?
6. **Settings:** parcurge ambele pagini de Settings — orice funcționalitate-punte nouă
   (token, pairing, credite) are capătul corespondent în cealaltă aplicație sau e în
   watchlist?
7. Actualizează acest fișier: bifează/adaugă în watchlist, adaugă divergențe aprobate
   noi. **Skill-ul e oglindit în ambele repo-uri** (`.claude/skills/blipost-parity/`) —
   modifici unul, copiezi în celălalt (aceeași convenție ca blipost-desktop/website).

## 5. Regula de aur pentru orice sesiune viitoare

Schimbi în oricare app: navigație, temă, Settings, branding sau copy care pomenește
cealaltă aplicație → **deschide acest skill și rulează pașii relevanți din §4 înainte
de commit.** Un audit complet: 2 agenți Explore în paralel (câte unul per repo) cu
inventar meniu/temă/settings, apoi comparație pe contractul din §1.

Ultimul audit complet: **2026-07-13** (pre-lansare, schimbări cosmetice desktop).
Rezultat: branding ✓, sidebar rail unificat ✓, cross-ref token ✓, concepte partajate ✓,
temă monocromă propagată pe web ✓ (gap închis). Fixuri aplicate 2026-07-13: desktop
"Clips" → "Local Projects" (nav + titlu pagină `/librarie`), Postiz/Buffer mutate în
secțiune colapsată "Legacy integrations" pe Settings (`SHOW_LEGACY_INTEGRATIONS=false`,
Schedule/Calendar rămân funcționale pe backend Postiz). Watchlist rămas: doar
consolidarea "Schedule" + "Calendar" (non-paritate, intern desktop).

Follow-up 2026-07-18 (X1 — pachetul de aliniere a shell-ului, sursă canonică WEB):
Media Library icon (`Images`), copy identic în product switcher, token hover nav
(`sidebar-accent-foreground`, nu lime), class string identic pt. labelul de grup,
`gap-0.5` pe listele de nav, divizoare de grup pe rail-ul colapsat, radius footer
`rounded-xl` → `rounded-lg`, widget credite unificat (Zap lime + „AI Credits
Remaining", fără bară de quota pe desktop — `/platform/me` nu expune quota),
Button `rounded-lg` + `h-9` în ambele aplicații, activ-route pe web acum
boundary-safe (`pathname === href || startsWith(href + "/")`, ca pe desktop).
Coliziune reziduală de iconițe pe desktop: `AI Video` a primit `Film`, dar
`Local Exports` folosește deja `Film` — rămâne watchlist pentru un audit viitor.
Structura meniului NU s-a schimbat (divergență aprobată, vezi §2).
