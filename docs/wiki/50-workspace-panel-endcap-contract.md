# Contract unificat pentru terminația inferioară a panourilor

## Problema rezolvată

Workspace-urile se terminau direct în marginea ferestrei, mai ales timeline-ul
unei variante deschise cu **Maximize editor** în Pipeline Step 3. Lipsa unei
muchii inferioare făcea panoul să pară tăiat, nu închis intenționat.

## Contract vizual

Toate panourile de workspace folosesc aceeași terminație inferioară:

- înălțime fixă de **12 px** (`h-3`);
- separator superior de **1 px** cu `border-border`;
- fundal semantic `surface-panel`;
- fără shadow și fără o a treia culoare opacă de suprafață;
- elementul rămâne în fluxul layout-ului, deci nu acoperă ultimul control,
  ultimul rând sau ultima pistă din timeline.

Un container care are `WorkspacePanelHeader` drept copil direct primește
automat terminația prin regula structurală din `frontend/src/app/globals.css`.
Panourile fără header propriu, precum timeline-ul și setările editorului
maximizat din Step 3, folosesc explicit
`frontend/src/components/workspace-panel-endcap.tsx`.

## Suprafețe acoperite

- Pipeline Steps 1–3, inclusiv Script History și editorul maximizat al fiecărei
  variante;
- Subtitle Templates: Templates, Subtitle settings și Preview;
- Attention Templates: Template settings, Program monitor și Timeline;
- Footage & Segments: Source Videos, Source Video și Segments Library;
- orice panou viitor care adoptă `WorkspacePanelHeader`.

Cardurile de document păstrează marginea și raza lor normală; contractul de
endcap aparține compoziției de workspace.

## Protecție împotriva regresiilor

`npm run design:check` verifică slotul componentei și rețeta canonică din CSS.
Testele Playwright verifică geometria și suprafața terminației în workspace-uri,
inclusiv cele două panouri ale editorului maximizat din Step 3.
