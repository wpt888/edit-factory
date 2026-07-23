# Goal EF-1 — Închide breșele IDOR/cross-tenant + SSRF

**Working directory: `C:\OBSID SRL\n8n\edit_factory`** (Blipost desktop — FastAPI + Next.js)

## Obiectiv

Niciun endpoint API nu mai poate citi sau modifica resursele altui profil, și downloaderul de media nu mai acceptă URL-uri/căi arbitrare.

Citește ÎNTÂI `goals/audit-2026-07-21-findings.md` secțiunile 1, 2 și 8 — conține file:line exacte.

## Task-uri

1. **Pipeline routes**: toate rutele din `app/api/pipeline_routes.py` primesc `Depends(get_profile_context)` și verifică `profile_id`-ul pipeline-ului înainte de orice read/write. Găsește TOATE rutele neautentificate (status, scripts, previews/video, rename, captions — vezi liniile 10314, 8424 din findings) și pe cele autentificate fără ownership check. Nu doar cele numite: parcurge fiecare rută din fișier.
2. **Progress stores**: Assembly, Buffer, Postiz, Platform — leagă endpointurile de progress de `profile_id`; nu mai expune `final_video_path` din Assembly către alt profil.
3. **Runner local**: scoping per profil (un profil nu vede/oprește runnerul altuia) sau, minimal, gardă de ownership pe start/stop/status.
4. **SSRF** în `app/services/video_effects/overlay_renderer.py:69`: acceptă doar căi din directoarele proprii aplicației (assets/uploads cunoscute) sau URL-uri dintr-un allowlist (Supabase storage); limită de dimensiune la download; la eșec, renderul raportează eroarea în loc să omită efectul silențios.

## Criterii de acceptare

- Un request cu token-ul profilului B pe un pipeline al profilului A → 403/404 pe TOATE rutele pipeline.
- Test pytest care demonstrează asta pe minim: status, scripts, preview, rename, captions, delete.
- Downloaderul respinge `file:///`, căi absolute în afara directoarelor permise și host-uri non-allowlist; test unitar.
- `AUTH_DISABLED=true` (dev) continuă să funcționeze — bypass-ul rămâne, dar ownership pe profil se aplică și în dev.
- Testele existente (`tests/`) trec: rulează suita pytest relevantă (pytest cere `.env`).

## Clauze obligatorii

**A. Commit discipline.** Commit după FIECARE modificare logică — o schimbare coerentă, un commit, mesaj conventional clar. Nu grupa totul într-un singur commit final, nu lăsa tree-ul dirty. NU face push.

**B. Wiki la finalizare COMPLETĂ.** Doar când task-ul e complet: actualizează/creează pagina relevantă în `docs/wiki/`, adaugă intrare în `docs/wiki/01-log.md`, înregistrează pagini noi în `docs/wiki/00-index.md`. Comite și wiki-ul.

**C. Return shape.** Mesajul final = date pentru orchestrator: (1) lista rutelor securizate + ce verificare s-a adăugat fiecăreia, (2) lista commiturilor (hash + subiect), (3) paginile wiki atinse. Fără tururi, fără dump-uri.
