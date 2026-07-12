Repară discrepanța uriașă de mărime a subtitrărilor între preview-ul din editorul de stil („Accurate preview") și playerul din Timeline (Step 3) — textul din Timeline apare enorm față de ce arată editorul și față de randarea finală.

Cauza (deja diagnosticată, nu re-investiga): ambele preview-uri folosesc formula fontSize × înălțimeContainer / 1920, dar editorul de stil primește previewHeight={320} ca prop (corect), în timp ce timeline-editor.tsx:1332-1377 (compact) și :1500-1541 (expanded) citesc previewContainerRef.current?.clientHeight sincron în render body — null la primul render (fallback hardcodat), fără remăsurare la resize. Overlay-ul scalează permanent față de o înălțime greșită/stale.

Fix: extrage un helper comun scaleSubtitlePx(px, containerHeight, ref=1920) cu înălțimea măsurată prin ResizeObserver și folosește-l în AMBELE componente de preview. NU atinge backend-ul (subtitle_styler.py e ground truth, intern consistent, pinuiește 1080x1920). Curățenie: app/services/video_processor.py:1145-1287 e un al doilea builder ASS nefolosit, fără original_size — marchează-l/șterge-l ca să nu fie refolosit din greșeală.

Acceptare: la aceleași setări (ex. 108px, outline 9, Y 55%), textul din editorul de stil, din preview-ul Timeline și dintr-o randare reală arată identic ca proporție față de cadru, inclusiv după resize al ferestrei.

Detalii complete: @docs/audits/2026-07-11-subtitle-preview-discrepancy.md
