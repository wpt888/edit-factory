# Faza U1 — Desktop consumă creierul web (bridge prin Platform API)

**Repo:** `C:\obSID SRL\n8n\edit_factory` (desktop). **Branch:** `feat/u1-desktop-bridge`.
**Plan master & guardrails:** `@docs/IMPLEMENTATION-PLAN-2026-07.md`
**Depinde de:** W2 livrat în `social-scheduler` (contractul API documentat acolo în `docs/platform-api.md`). Dacă acel fișier nu există încă, OPREȘTE-TE și raportează — nu inventa contractul.

---

## 1. Obiectiv (o frază)

Conectează aplicația desktop la contul Blipost web printr-un **token de platformă** (lipit o dată în settings), astfel încât desktop-ul să publice pe rețelele sociale prin API-ul web (în loc de Postiz) și să afișeze soldul de credite al contului.

## 2. De ce

Decizia de arhitectură (plan master §1): web = creier canonic (bani, conturi sociale, AI gestionat); desktop = client + mușchi local (FFmpeg). Puntea = token de platformă, NU merge de auth/DB. Publicarea desktop de azi merge prin Postiz self-hosted — o înlocuim cu API-ul propriu (Postiz rămâne fallback configurabil, nu-l șterge).

## 3. Scope

**IN:**
- Serviciu nou `blipost_platform` în vault: adaugă în frozenset-ul SUPPORTED din `app/services/credentials/vault.py` (~linia 25). Tokenul se stochează Fernet-encrypted per-profil, ca orice altă cheie.
- Setare `blipost_platform_base_url` (default URL-ul de producție; configurabilă pentru dev, ex. `http://localhost:3002`). Urmează pattern-ul settings existent.
- Client subțire `app/services/blipost_platform_client.py` (httpx, deja în requirements): `get_me()`, `get_accounts()`, `request_media_upload()` + PUT, `create_post()`, `get_post()`. Header `Authorization: Bearer <token din vault>`. Erori mapate curat (401 → „token invalid/revocat", 402 → „credite insuficiente", 429 → retry cu backoff simplu).
- UI Settings: secțiune „Blipost Account" — paste token, buton „Test connection" (arată email + plan + sold la succes), disconnect (șterge tokenul din vault).
- Publicare prin platformă: în fluxul de publicare existent (unde azi se apelează Postiz — `postiz_routes.py` + serviciul lui), adaugă calea platform: dacă există token `blipost_platform` → listează conturile din `GET /accounts`, publică prin `POST /media` + `POST /posts`. Postiz rămâne calea alternativă când nu e token (nu șterge nimic din Postiz).
- Indicator de sold de credite în UI (ex. în navbar sau settings), refresh la deschidere — un `GET /me`.

**OUT:**
- Generarea AI metered prin platformă din desktop (D2/W3 — desktop-ul rămâne BYOK pentru AI în această fază).
- Sync-ul product library în cloud.
- Orice schimbare de auth Supabase a desktop-ului (rămâne cum e).
- Webhooks/push — statusul postării se citește cu poll `GET /posts/{id}`.

## 4. Refolosește (scara lenei)

- `api_key_vault` + Fernet (există) pentru stocarea tokenului — NU inventa alt storage.
- Pattern-ul de servicii singleton (`get_*()`) pentru client.
- Fluxul de publicare existent (Postiz) — calea platform e o ramură nouă în același flux, nu un flux paralel duplicat.
- Componentele Shadcn + pattern-ul paginii de settings existente.
- Contractul API: `social-scheduler/docs/platform-api.md` (scris în W2) — sursa de adevăr; nu ghici endpoint-uri.

## 5. Criterii de acceptare

1. Userul lipește tokenul în Settings → „Test connection" arată email/plan/sold reale de pe serverul web (de dev sau prod).
2. Cu token valid: fluxul de publicare listează conturile sociale din contul web și publică/programează un video prin platformă (verificabil în dashboard-ul web sau în DB-ul web).
3. Fără token: totul funcționează ca înainte (Postiz path neatins).
4. Token revocat pe web → desktop arată eroare clară „token invalid", nu crash.
5. Soldul de credite se vede în UI.
6. Tokenul nu apare niciodată în loguri.

## 6. Verificare

- Test Playwright + screenshot (regula CLAUDE.md): settings cu token conectat (sold vizibil) + fluxul de publicare cu conturile platformei listate. Web-ul de dev rulează local în celălalt repo în timpul testului (`PORT=3002 npm run dev` acolo) — pornește-l sau cere pornirea lui.
- Self-check backend: test mic care exersează clientul contra serverului de dev (me → accounts → media → post → get post), cu asserturi.
- Backend desktop pe 8000 (fără `--reload`), frontend pe 3001, Electron dev pe 3947.

## 7. Investigează întâi

- `app/services/credentials/vault.py` (SUPPORTED, get/set), `app/api/postiz_routes.py` + serviciul Postiz, fluxul UI de publicare (unde se alege destinația socială), pattern-ul settings (backend + frontend), `social-scheduler/docs/platform-api.md` (contractul — DOAR citire, alt repo).

## 8. Livrare

Commit-uri mici pe `feat/u1-desktop-bridge`; fără push/PR fără cerere explicită. La final: rezumat (livrat / OUT / cum s-a verificat).
