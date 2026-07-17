> **NOTĂ 2026-07-18:** taskurile **1 (PageHeader)** și **4 (CardTitle font-heading — doar prima jumătate; partea cu scosul font-heading redundant din signup/login rămâne)** au fost deja livrate de execuția S1 (commituri f9feedb, ec370e5, 993eb38). Sari peste ele; rămân taskurile 2, 3, 5, 6, 7 + curățenia din 4.

Uniformizează shell-ul și tipografia în BlipStudio (repo edit_factory, `frontend/src/`) — paginile folosesc azi 6 scale de lățime și 4 rețete de padding, iar 14 din 20 de H1-uri nu au font-heading. **Rulează după design-s1-pipeline-fixes.** Zero schimbări funcționale.

## Taskuri

1. **PageHeader portat din web** — copiază `social-scheduler/components/page-header.tsx` (h1 `font-heading text-3xl font-bold tracking-tight` + description muted) în `components/page-header.tsx` și înlocuiește toate H1-urile hand-rolled (~17 pagini: settings, schedule, calendar, usage, librarie, products, product-library, product-video, tts-library, batch, batch-generate, create-video, create-image, wiki + cele deja corecte rămân). Toate titlurile de pagină: font-heading + text-3xl, consecvent.
2. **PageShell studio** — creează `components/page-shell.tsx` cu UN container canonic: `mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-8` + prop `width: "default" | "narrow"(max-w-3xl) | "wide"(max-w-[1600px] doar dacă o pagină chiar o cere)`. Aplică pe toate rutele: elimină `container mx-auto` (wiki:162, settings:868+, usage:216); paginile max-w-[1400px] (calendar, librarie, batch, schedule, tts-library) trec pe default sau pe UN singur recipe documentat; create-video și create-image devin identice (azi px-6 vs px-4 la același max-w-5xl); dispare split-ul `p-4 md:p-8` vs `px-4 sm:px-6 lg:px-8 py-8` de pe max-w-7xl.
3. **Header-to-content spacing** — elimină mb-6/mb-8 de pe header-divurile vechi (librarie, products, product-library, tts-library, usage:218 mb-8) în favoarea `space-y-6` pe părinte (patternul paginilor noi).
4. **CardTitle cu font-heading implicit** — `components/ui/card.tsx:35`: adaugă `font-heading` în clasa de bază CardTitle; scoate font-heading redundant din call-site-urile care îl adăugau manual (signup, login).
5. **Card fără shadow implicit** — scoate `shadow-sm` din baza `components/ui/card.tsx`; adaugă explicit doar unde elevația e dorită (modale/floating); șterge `shadow-none` redundante rămase (9 fișiere).
6. **Icon sweep** — înlocuiește sintaxa `h-N w-N` pe iconițe lucide cu `size-N` (598 apariții în 50 fișiere; find/replace mecanic, atenție doar la div-uri non-icon).
7. **product-video/page.tsx** — CardContent p-4 vs default în aceeași coloană: unifică (una singură).

## Constrângeri
- NU pushui; commit-uri locale pe pași (1 header, 2 shell, 3 card, 4 icons…).
- Nu atinge: radius Electron (`html.desktop`), fonturile de subtitrări, logica paginilor.
- UI doar engleză; nu rula în paralel cu alt goal pe acest repo.

## Verificare
Build + check-uri verzi. Screenshot headless la 1440px pe 6 pagini reprezentative (pipeline, settings, calendar, librarie, create-image, usage): titlurile au aceeași mărime/font, marginile laterale identice între pagini.

Context: @goals/design-audit-2026-07-17-findings.txt (secțiunile `spacing-studio`, `typography`, `radius-borders`) + @goals/design-audit-2026-07-17.md
