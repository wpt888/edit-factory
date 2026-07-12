Elimină freeze-ul („frame block") din preview-ul Timeline (Step 3) la trecerea între segmente — problemă veche, nerezolvată de mai multe încercări anterioare.

Diagnostic existent (nu re-investiga de la zero): playerul cu double-buffer din timeline-editor.tsx (startPreviewRafLoop :431, commitTransition :392-427, două sloturi video previewSlotRefs) are o gaură de fallback — dacă slotul idle nu e gata la graniță, cade pe seatActiveSlot = seek live pe elementul vizibil cu await pe 'seeked', exact stall-ul pe care buffer-ul trebuia să-l elimine. Pre-staging-ul pornește o singură dată per index, cu lead fix ~2-3s (:467), deci segmentele scurte/rapide ratează deadline-ul. Agravant: fără proxy de preview generat, backend-ul servește originalul 1080p cu keyframe-uri rare (app/api/segments_routes.py:1092-1141) → seek-uri lente.

Fix recomandat (păstrează double-buffer-ul, închide gaura):
1. Pre-staging declanșat de timpul rămas în segmentul curent (nu lead fix per index), re-verificat în loop-ul RAF.
2. Generare eager de preview proxies la intrarea în Step 3.
3. Dacă fallback-ul seatActiveSlot tot e atins, loghează (telemetrie/console) ca să măsurăm cât de des.

NU rescrie playerul de la zero și nu repeta încercările eșuate — istoricul lor (commit 31de997 etc.) e în audit.

Acceptare: redare continuă a unei variante cu 20+ segmente scurte fără stall vizibil la granițe, atât în Electron cât și în Chrome.

Detalii: @docs/audits/2026-07-11-preview-transition-freeze.md
