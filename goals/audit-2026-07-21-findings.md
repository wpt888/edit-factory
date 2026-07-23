# Audit 2026-07-21 — Findings edit_factory (BlipStudio desktop)

Verdict global: NO-GO producție. Findings verificate în cod, cu file:line.

## 1. Securitate — IDOR / cross-tenant (CRITIC)

- Endpointuri pipeline pentru status, scripts, previews/video, redenumire și captions sunt **neautentificate**; altele au auth dar **nu verifică proprietarul pipeline-ului**. Orice user poate citi/modifica pipeline-ul altui profil dacă știe UUID-ul.
  - `app/api/pipeline_routes.py:10314` (rută publică), `app/api/pipeline_routes.py:8424` (status/scripts publice)
  - UUID-ul apare în URL ca `?id=` — `frontend/src/app/pipeline/page.tsx:169`
  - Politica service-role: `supabase/migrations/023_reenable_rls_with_service_role.sql:152`
  - OpenAPI local confirmă `security=false` pe rutele publice.
- Assembly, Buffer, Postiz și Blipost Platform au endpointuri de progress **autentificate dar nelegate de profile_id**; Assembly expune `final_video_path`.
- Runnerul local e **singleton global**: un profil poate vedea/opri runnerul altui profil.

## 2. SSRF + citire locală în downloader (CRITIC)

- `app/services/video_effects/overlay_renderer.py:69` — downloaderul pentru overlay/PiP/music acceptă URL-uri arbitrare și orice cale locală existentă, urmărește redirecturi, bufferizează fără limită (OOM). La eșec, efectul e **omis silențios**, renderul rămâne „success".

## 3. Captions → Smart Schedule rupt end-to-end (CRITIC)

- `frontend/src/components/pipeline/pipeline-caption-generator.tsx:311` — salvează către `window.location.origin` (frontend și API au domenii diferite în prod); verifică doar respingerea `fetch`, nu `response.ok` → 404 netratat.
- `frontend/src/components/pipeline/pipeline-schedule.tsx:531` — confirmarea Smart Schedule trimite `caption_template: ""` și nu trimite captions per variantă.
- `app/services/schedule_service.py:494` — `QueryFilters` **nedefinit** în `_execute_v2`, excepția e înghițită. Repro izolat: succes raportat `(1, 0)` dar caption trimis `""`.

## 4. Outputuri derivate stale (MAJOR)

- `app/api/pipeline_routes.py:4209` — schimbarea scriptului, composition, attention, muzicii sau subtitles poate lăsa un render vechi marcat `completed`, publicabil după modificare.

## 5. Step 1 — erori generice lasă jobul blocat (MAJOR)

- `app/api/pipeline_routes.py:4998` — handlerul folosește variabila **nedefinită** `deduplicate`; după refund nu marchează jobul `failed` → rămâne `processing`.

## 6. Step 4 / navigare / UX (MAJOR)

- `frontend/src/app/pipeline/components/pipeline-stepper.tsx:233` — stepperul ascuns sub 1950px (inclusiv la 1920 Full HD).
- `frontend/src/app/pipeline/components/step4-render.tsx:241` — fără Back în Step 4; variantele failed/cancelled **fără Retry** → user blocat cu „New Pipeline".
- `frontend/src/app/pipeline/components/step4-render.tsx:96` — Stop Render (global și per variantă) **fără confirmare**; doar „Start New Pipeline" are dialog.

## 7. Accesibilitate (History + Source Videos)

- `frontend/src/app/pipeline/components/pipeline-history-sidebar.tsx:109` — `span role=button` fără suport Space, SVG click-only.
- `frontend/src/app/pipeline/components/source-videos-card.tsx:140` — carduri selectabile doar cu mouse, butoane icon-only fără etichetă accesibilă; la un singur source video, „Edit segments" propagă click-ul și schimbă selecția.

## 8. Render runner / stale detection

- Render >30 min declarat stale **fără heartbeat**; primul FFmpeg poate continua în paralel cu retry-ul.
- Cancel task nu oprește `to_thread`/FFmpeg → lease suspendat.

## 9. Retenție / cleanup

- `app/main.py:224` + `supabase/migrations/016_create_pipeline_persistence.sql:12` — Pipeline History șters permanent la startup după 30 zile, Assembly după 7; editarea NU prelungește `expires_at`; UI nu avertizează.

## 10. TTS / Step 2

- Curse cancel/delete/regenerate; fallback Edge TTS neanunțat utilizatorului; billing inconsistent.

## 11. Quality / CI

- `.github/workflows/ci.yml:33` — Ruff raportează **104 probleme**, inclusiv `deduplicate`, `QueryFilters`, `timedelta` nedefinite.
- ESLint pe suprafața pipeline: 48 erori + 27 avertismente; întreg `src`: 185/114.
- TypeScript și `design:check` trec; 102 teste assembly/render/schedule trec.
