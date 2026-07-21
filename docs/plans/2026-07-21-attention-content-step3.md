# Plan: Attention Templates — conținutul se alege în Step 3

Data: 2026-07-21 · Autor: sesiune Claude (analiză + decizii user)

## Problema

Attention Templates definește slot-uri (layout + timing) în tab-ul propriu, dar conținutul
(imaginile) se alege în Pipeline **Step 1 (Idea)** — înainte să existe script, TTS sau
timeline. Decizia e vizuală/de timing, dar se ia în pasul de text, orb. În plus, asignarea
slot→imagine e efemeră (state per pipeline) și strict pe imagini.

## Decizii luate (user)

1. Picker-ul de attention **dispare din Step 1**; Step 3 (Preview) devine singurul loc de aplicare.
2. Slot-urile acceptă **imagini ȘI videoclipuri** (overlay video peste videoclipul de bază).
3. Surse de conținut: **galeria media** (imagini + video), **upload din PC**, **URL**, și **Ctrl+V paste** direct pe zona de template din Step 3.
4. Template-ul poate salva **opțional** conținut default per slot (setat din editorul Attention Templates). Dacă nu salvează, slot-urile rămân goale și se umplu per pipeline. Flexibil, ambele moduri.
5. Audio/SFX rămâne parte din template (neschimbat).

## Starea actuală în cod (verificată 2026-07-21)

| Zonă | Fișier | Stare |
|---|---|---|
| Picker partajat | `frontend/src/components/attention-template-picker.tsx` | Două variante: `default` (Step 1, grid slot-uri + format output) și `inspector` (Step 3, listă simplă). `AttentionSelection = { templateId, assetUrls: string[], staggerSeconds, maxVariants }` |
| Step 1 | `frontend/src/app/pipeline/components/step1-script.tsx` (~linia 197) | Montează varianta `default` + selectorul de **Output video format** (prin `onOutputSizeChange`) |
| Step 3 | `frontend/src/app/pipeline/components/step3-preview.tsx` (~liniile 269–380, 781–850) | Card `step3-attention-apply`: picker varianta `inspector` + **Apply scope** (toate/o variantă) + buton Apply cu confirm la overwrite |
| Aplicare | `frontend/src/app/pipeline/attention-template-apply.ts` | Payload: `templateId, assetUrls, durationMs, subtitleBoundariesMs, revision, mode:"replace", startOffsetMs` |
| Dialog asset | `frontend/src/components/dialogs/attention-asset-picker-dialog.tsx` | Tab-uri Gallery (`/platform/media?kind=image`) / Upload (`/platform/media/upload`, doar `image/*`) / URL. Returnează doar `url: string` |
| Backend template→cues | `app/services/attention_templates.py` | Template stochează DOAR layout (`tracks[].images[]` cu x/y/w/h/timing/sfx). `asset_ids` vine din exterior, fallback `"pending:choose-asset"` |
| Backend render | `app/services/video_effects/overlay_renderer.py` | **`apply_overlay_timeline` suportă DEJA itemi video** (`is_video: true` → input direct, pre-trimuit). Doar `_attention_cues_to_items` hardcodează `is_video: False` |
| Persistență pipeline-template | `frontend/src/app/pipeline/pipeline-template.ts` (liniile 63–64) | Salvează `attentionSelection` + `attentionTimelines` în bundle — necesită compatibilitate |
| Teste | `frontend/tests/attention-step1-picker.spec.ts` | Testează picker-ul din Step 1 — de rescris pentru Step 3 |
| Editor template | `frontend/src/app/attention-templates/page.tsx` | Nu stochează niciun asset de conținut per slot (verificat: zero referințe assetUrl) |

## Faze de implementare

### Faza 1 — Mutarea Step 1 → Step 3

- Scoate `AttentionTemplatePicker` din `step1-script.tsx`. ATENȚIE: selectorul **Output video format** trăiește azi în interiorul picker-ului — extrage-l într-un control de sine stătător care rămâne în Step 1 (formatul e necesar înainte de generare).
- În Step 3, cardul `step3-attention-apply` devine picker-ul complet: înlocuiește varianta `inspector` cu grid-ul de slot-uri numerotate (preview layout + carduri per slot), adaptat la lățimea cardului. Ideal: o singură variantă a componentei, nu două.
- `maxVariants` din `AttentionSelection` devine redundant — Step 3 are deja **Apply scope**. Elimină `maxVariants`; păstrează `staggerSeconds` (delay per variantă la apply).
- Curăță state-ul din `page.tsx`: `attentionSelection` rămâne (e persistat în pipeline-template bundle), dar ownership-ul UI trece integral la Step 3. Bundle-urile vechi cu `maxVariants` trebuie citite fără crash (default/ignore la load).

### Faza 2 — Surse de conținut: video în galerie + Ctrl+V paste

- `attention-asset-picker-dialog.tsx`:
  - Gallery interoghează `kind=image` ȘI `kind=video` (toggle sau combinat); upload acceptă `image/*` și `video/*`.
  - `onSelect` returnează `{ url, type: "image" | "video" }` în loc de `string`. Propagă tipul în tot lanțul.
- `AttentionSelection.assetUrls: string[]` → `assets: { url, type }[]`. Migrare la load pentru bundle-uri vechi (string → `{url, type:"image"}`).
- **Paste**: handler `onPaste` pe cardul de attention din Step 3 (și/sau listener la nivel de card focusat): citește imaginea din clipboard (`ClipboardEvent.clipboardData.items`), o urcă la `/platform/media/upload`, o asignează primului slot gol (sau append). Toast cu confirmare. Doar imagini din clipboard (video nu există în clipboard-ul browserului).

### Faza 3 — Video în slot-uri (backend)

- Payload-ul apply (`attention-template-apply.ts` + endpoint-ul din `app/api/attention_routes.py` / `pipeline_routes.py`): `assetUrls` → `assets: [{url, type}]`. Compatibilitate: acceptă și formatul vechi (listă de string-uri = imagini).
- Cue-urile din timeline primesc tipul media pe layer (ex. `mediaType: "video"`).
- `_attention_cues_to_items` (overlay_renderer.py): pentru layer video → descarcă fișierul, pre-trimuiește la durata cue-ului (`ffmpeg -ss 0 -t <dur>`, re-encode rapid sau copy dacă e safe), setează `is_video: True`. Restul (box, fit, compoziting) există deja în `apply_overlay_timeline`.
- Audio-ul overlay-ului video: mut (base audio + SFX-ul template-ului rămân sursele de sunet). Notează explicit în cod.
- Preview frontend: unde se randează cue-urile de attention client-side (timeline lane + playerul de variantă — verifică `video-segment-player.tsx` / `multi-track-timeline.tsx`), cue-urile video afișează `<video muted loop>` sau thumbnail în loc de `<img>`.

### Faza 4 — Conținut default salvat în template (opțional)

- Schema template (JSON în `attention_templates.py` + tipul `AttentionTemplate` frontend): `tracks[].images[].defaultAsset?: { url, type }`.
- Editorul Attention Templates: per slot, buton "Set default content" (același dialog de asset) + indicator vizual; opțiune de clear. Fără toggle global — prezența `defaultAsset` per slot e semnalul.
- Step 3: la selectarea unui template, slot-urile se pre-populează din `defaultAsset` unde există; user-ul poate suprascrie per pipeline fără să afecteze template-ul.

### Faza 5 — Cleanup, teste, documentație

- Rescrie `frontend/tests/attention-step1-picker.spec.ts` → spec pentru Step 3 (template + slot-uri + paste dacă e testabil cu `page.evaluate` clipboard). Grep după `data-testid` afectate în toate testele.
- **Screenshot Playwright obligatoriu** (regulă CLAUDE.md) pentru: Step 1 fără picker (formatul output rămas), Step 3 cu picker-ul complet, editorul de template cu default content.
- Actualizează wiki-ul attention images (`docs/wiki`, pagina 30) cu noul flux.
- Backend restart necesar pentru rutele/serviciile modificate; desktop necesită rebuild standalone.

## Riscuri și atenționări

1. **Output format select** e îngropat în picker-ul din Step 1 — nu-l șterge odată cu picker-ul (regresie tăcută pe formatul de render).
2. **Bundle-uri pipeline-template vechi** conțin `assetUrls: string[]` și `maxVariants` — load-ul trebuie să fie tolerant (migrare in-place, fără crash).
3. **Modulo pe slot-uri** (`assetUrls[index % length]`) — păstrează comportamentul de repetare când sunt mai puține asset-uri decât slot-uri, e util; documentează-l în helper text.
4. **Trim video pentru cue**: cue-urile de attention sunt scurte (sub ~2s); pre-trim cu re-encode e ok ca simplitate, nu optimiza prematur.
5. Testul e2e existent pe Step 1 va pica imediat după Faza 1 — rescrie-l în aceeași fază, nu la final.

## Criterii de acceptare

- [ ] Step 1 nu mai conține nimic de attention; formatul output funcționează în continuare.
- [ ] Step 3: alegi template, vezi slot-urile, asignezi imagini/video din galerie/upload/URL, Ctrl+V adaugă imaginea din clipboard într-un slot.
- [ ] Un slot cu video se compune corect în preview-ul randat și în render-ul final (video mut, peste video de bază, la poziția/timing-ul din template).
- [ ] Template cu `defaultAsset` pe slot-uri se pre-populează în Step 3 și poate fi suprascris fără a modifica template-ul.
- [ ] Pipeline-template bundle vechi se încarcă fără erori.
- [ ] Screenshot-uri Playwright prezentate pentru toate suprafețele modificate.
