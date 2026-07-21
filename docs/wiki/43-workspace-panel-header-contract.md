# Contract unic pentru capetele de panou din workspace-uri

## Direcția de produs

Pagina **Subtitle Templates** este referința canonică pentru capetele de panou
din toate workspace-urile. Video Pipeline, Attention Templates, Footage &
Segments și orice workspace nou trebuie să folosească exact aceeași gramatică
vizuală.

Nu este suficient ca panourile să semene. Capetele panourilor vecine trebuie să
fie perfect la linie, fără nicio discrepanță de distanță sau înălțime.

## Contract geometric obligatoriu

- componentă unică: `frontend/src/components/workspace-panel-header.tsx`;
- înălțime fixă: **48 px** (`h-12`);
- padding orizontal: **12 px** (`px-3`);
- spațiu intern: **8 px** (`gap-2`);
- separator inferior: o singură linie de 1 px, cu tokenul `border-border`;
- titlu: `text-sm font-semibold`, centrat vertical;
- grip-ul din stânga: aceeași dimensiune, culoare și poziție în fiecare panou;
- acțiunile rămân în dreapta și nu pot modifica înălțimea capului de panou;
- panourile alăturate au exact aceeași margine superioară, margine inferioară
  și linie de bază a titlului.
- separatorul vertical dintre panourile Pipeline este permanent vizibil, are
  1 px și traversează inclusiv zona capetelor de panou; nu poate fi transparent
  până la hover.

Sunt interzise implementările locale cu `h-10`, `h-14`, padding diferit sau
titlu repoziționat. `EditorHeader` rămâne bara paginii; nu înlocuiește capul
fiecărui panou.

## Suprafețe acoperite

- Subtitle Templates: Templates, Subtitle settings, Preview;
- Attention Templates: Template settings, Program monitor, Timeline;
- Video Pipeline: toate panourile din pașii 1–3 și Script History;
- Footage & Segments: Source Videos, Source Video, Segments Library;
- orice viitor editor full-bleed cu panouri.

## Protecție împotriva regresiilor

`npm run design:check` validează existența rețetei canonice în componenta
partajată și respinge redefinirea slotului în alte fișiere. Testele Playwright
verifică înălțimea de 48 px, separatorul, grip-ul și alinierea capetelor de
panou relevante.
