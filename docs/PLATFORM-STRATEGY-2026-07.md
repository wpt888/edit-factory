# Blipost — Strategie de platformă, arhitectură și economics

**Deep research & analiză comprehensivă**
**Data:** 2026-07-06
**Scope:** desktop (`edit_factory`) + web (`social-scheduler`), model de business, cashflow credite, costuri reale de lansare, roadmap.
**Autor analiză:** research pe cod (ambele repo-uri) + piață (fal.ai, ElevenLabs, R2, Stripe, TikTok/Meta/YT, Blotato/Postiz).

> Notă de citit prima dată: **90% din temerile tale despre cashflow și complexitate se rezolvă cu o singură realizare** — sistemul de credite pe care crezi că trebuie să-l construiești **există deja, funcțional, în aplicația ta web** (`lib/credits.ts` + `lib/ai/generate.ts`). Deducere atomică, refund pe eșec de provider, mapare Stripe→credite. Nu construiești de la zero; unifici două lucruri care există.

---

## 0. Rezumat executiv (TL;DR)

1. **Ai deja două produse care merg, dar rulează pe două modele de bani incompatibile sub același brand.** Desktop = **BYOK** (fiecare user își pune propriile chei API, criptate Fernet în `api_key_vault`). Web = **credite gestionate** (o singură cheie OpenAI a firmei, vândută userilor ca credite prin Stripe). Asta e cea mai profundă „inconsistență" pe care o simți. Nu e un bug — e o decizie de strategie neluată.

2. **Cashflow-ul NU e problema pe care ți-o imaginezi.** Nu trebuie să „cumperi token instant" la fiecare subscripție. Banii userului intră **înainte** ca el să consume (prepaid). Tu ții un **float mic** la fiecare provider (200–500 $), care se auto-realimentează din venit. Structural ești **cash-pozitiv**, ca o sală de fitness cu abonament. Detaliat în §5.

3. **„Costuri aproape 0" e adevărat pentru infrastructură, fals pentru lansare.** Infra la scală MVP: <30 $/lună. Dar costurile reale sunt: float de working capital (~500 $, recuperabil), **timp de aprobare API social** (2–6 săptămâni TikTok, review Meta), certificat de code-signing desktop (~100–400 $/an), moderare conținut, și legal. Vezi §6.

4. **Presupunerea „2 core / 12 GB e destul" e corectă pentru agregator, dar GREȘITĂ dacă randezi video pe server.** Generarea AI rulează pe GPU-ul providerului (corect). Dar **FFmpeg-ul care asamblează/randază video e compute-ul TĂU** și e greu. Soluția: randarea grea rămâne pe **desktop (PC-ul userului = compute gratis)**; pe cloud doar orchestrezi. Vezi §7.

5. **Catalogul trebuie curățat înainte de orice lansare.** View-ul `v_catalog_products` e hardcodat pe magazinul tău (Gomag). Livrat așa = data leak. Ce vrei (product library local, manual, titlu+imagine+descriere) e mai simplu decât ce ai și reutilizează SQLite + Gemini Vision pe care le ai deja. Vezi §8.

6. **A construi „un agregator ca fal.ai/Higgsfield" nu înseamnă ce crezi.** Nu construiești o platformă de hosting de modele pe GPU (imposibil fără capital). Construiești un **meta-agregator** care e *client* al fal.ai/Replicate și repachetează accesul lor cu billing propriu, pentru o nișă (creatori care vor și scheduling și mass-editing). Ai deja 80% din el. Vezi §10.

7. **ElevenLabs e singura capcană legală reală.** Ca să vinzi TTS-ul lor ca serviciu metered ai nevoie de **OEM Terms** (acord separat). BYOK-ul de pe desktop ocolește complet asta. OpenAI/fal.ai permit să construiești produse peste ei — deci restul agregatorului e legal ca *produs*, nu ca revânzare de chei. Vezi §4 și §9.

8. **Recomandarea de arhitectură:** un singur creier în cloud (backend-ul web, care are deja credite + 21 conectori + R2), iar desktop-ul devine un **client specializat** care adaugă mass-editing-ul local. Nu duplica conectorii și billing-ul în desktop. Vezi §15.

---

## 1. Ce ai de fapt acum (stare reală, din cod)

### 1.1 Desktop — `edit_factory` (Electron + FastAPI + Next.js)

| Zonă | Stare reală | Fișier-cheie |
|---|---|---|
| **Pipeline video** | Script (Gemini/Claude) → TTS (ElevenLabs/Edge) → match segmente pe keywords → render FFmpeg. Funcțional. | `app/api/pipeline_routes.py` |
| **Mass-editing** | **Capabilitatea unică**: alegi secvențe dintr-un video filmat → produci N variante. Nu există în web. | `pipeline_routes.py`, `segments_routes.py` |
| **Model chei AI** | **BYOK** — fiecare profil își pune cheile în `api_key_vault` (Fernet-encrypted), fallback la env. Servicii: gemini, fal, anthropic, postiz, buffer, telegram. | `app/services/credentials/vault.py` |
| **TTS** | ElevenLabs per-profil (`elevenlabs_accounts`, Fernet) + Edge-TTS gratis ca default. | `app/services/tts/` |
| **Imagini AI** | fal.ai deja integrat, cheie per-profil din vault. | `app/services/fal_image_service.py` |
| **Cost tracking** | `api_costs` (service, operation, cost, profile_id), quota lunar per profil, backup local `cost_log.json`. **Monitorizare, nu billing.** | `app/services/cost_tracker.py` |
| **Catalog** | DOUĂ sisteme (vezi §8): `products` per-profil din feed Google Shopping **+** `v_catalog_products` = view hardcodat pe `uf.products_catalog` (magazinul tău Gomag). | `catalog_routes.py`, `feed_routes.py`, migrations `013`/`018` |
| **Date** | Supabase (tabele `editai_*`), auth Supabase JWT, cu fallback SQLite existent. | `app/repositories/` |

### 1.2 Web — `social-scheduler` (Next.js + Drizzle + Postgres + R2 + Stripe)

| Zonă | Stare reală | Fișier-cheie |
|---|---|---|
| **Billing** | Stripe 3 tiere + free, **cu sistem de credite REAL**. | `lib/billing.ts` |
| **Credite** | `credits` table (`balance`). Deducere **atomică** `UPDATE … WHERE balance >= cost`, **refund pe eșec provider**. Costuri: caption=1, hashtags=1, script=5, adapt=1, image=4. | `lib/credits.ts`, `lib/ai/generate.ts`, `lib/ai/types.ts` |
| **Tiere** | Free 50 cr/lună · Starter 29 $/1.250 · Creator 97 $/5.000 · Agency 499 $/28.000. | `lib/billing.ts`, `lib/credits.ts` |
| **AI** | OpenAI: Whisper (transcriere), text (`gpt-4o-mini`), imagini (`gpt-image-1`). Highlight detection = euristic (marcat `ponytail:` pentru swap LLM). **Fără TTS.** **O singură cheie a firmei** (nu per-user). | `lib/ai/`, `lib/clipping/` |
| **Clipping** | Video lung → Whisper → highlights → FFmpeg cut → reframe 9:16 → captions karaoke ASS → media library. **Singura** capabilitate video; NU are „secvențe → N videoclipuri". | `lib/clipping/`, `worker/clip-*.ts` |
| **Social** | **21 conectori REALI** (TikTok, IG, YT, FB, X, LinkedIn, Reddit, Threads, Pinterest, Bluesky, Mastodon, Discord, Slack, Telegram, VK, Farcaster, WordPress etc.). OAuth2/form, tokenuri **AES-256-GCM** criptate, worker de publicare cu retry. Agregator real, nu stub. | `lib/connectors/`, `worker/publish.ts` |
| **R2** | Delete real (nu soft-delete), reguli de retenție 7/30/12-luni, egress zero. | `lib/r2.ts`, `docs/storage-retention-plan.md` |

### 1.3 Diagnosticul: ce e „inconsistent"

Nu e cod prost. E **strategie nedecisă**. Concret:

| Dimensiune | Desktop | Web | Consecință |
|---|---|---|---|
| **Model bani AI** | BYOK (userul plătește providerii direct) | Credite gestionate (tu plătești, revinzi) | **Fork nedecis** — cel mai important |
| **Auth** | Supabase Auth (JWT) | Auth.js/NextAuth (bcrypt) | Două conturi pentru același user |
| **DB** | Supabase (`editai_*`) | Postgres self-hosted (Drizzle) | Două surse de adevăr |
| **Capabilitate video** | Mass-editing pe secvențe | Clipping long→short | Complementare, nu redundante |
| **Social publishing** | Postiz extern | 21 conectori nativi | Duplicare de efort |
| **Cost tracking** | Monitorizare (`api_costs`) | Billing real (`credits`) | Web-ul e „mai matur" pe bani |

> **Concluzia de fond:** ai construit accidental **jumătatea de sus (web = creier: bani + conturi + AI gestionat)** și **jumătatea de jos (desktop = mușchi: editare grea locală)** ale aceluiași produs, dar ca două organisme separate. Munca de strategie nu e „mai multe feature-uri" — e **să le unești coerent**.

---

## 2. Problema centrală de logică (răspuns direct la „ce e greșit")

Ai scris: *„aplicația desktop va trebui să facă tot ce face aplicația web, dar plus mass-editing."*

**Aici e greșeala de scope.** Dacă desktop-ul reimplementează cei 21 de conectori, billing-ul Stripe, sistemul de credite și clipping-ul — ai **două copii** de menținut la infinit. Fiecare conector social se strică des (API-urile se schimbă lunar). Menținerea a două implementări = moartea prin o mie de tăieturi.

**Logica corectă:** desktop-ul **nu reface** ce face web-ul — desktop-ul **consumă** creierul web-ului prin API și **adaugă** singurul lucru pe care web-ul nu-l poate face bine: **randare video grea, local, pe PC-ul userului**. Un singur creier (cloud), două fețe (web + desktop). Vezi §15.

Celelalte greșeli de logică, pe scurt (detaliate în secțiunile lor):

- **„Costuri ~0"** → infra da, dar nu float + timp de aprobare + code-signing + moderare (§6).
- **„2 core/12 GB e destul"** → da pentru orchestrare API, **nu** pentru FFmpeg pe server (§7).
- **„Trebuie token cumpărați dinainte la fiecare plată"** → nu; userul preplătește, tu ții un float mic (§5).
- **Catalog hardcodat** → risc de data leak dacă se livrează așa (§8).

---

## 3. Modelul de business: cele două „mașinării de bani"

Tot ce urmează se reduce la un singur fork. Trebuie să-l alegi conștient.

### Model A — BYOK (Bring Your Own Key)
Userul își aduce propriile chei (ElevenLabs, fal, Gemini). Tu vinzi **doar software-ul** (abonament flat).

- ✅ Zero răspundere legală (userul e clientul providerului, nu tu).
- ✅ Zero float, zero risc de cashflow, zero moderare de plată.
- ✅ E ceea ce **desktop-ul face deja** (`api_key_vault`).
- ❌ Fricțiune mare (userul trebuie să-și facă cont la 3 provideri).
- ❌ Nu câștigi margine pe consumul AI.

### Model B — Credite gestionate (agregator)
Tu ții cheile, vinzi credite cu markup. E **ceea ce web-ul face deja**.

- ✅ Fricțiune zero pentru user (un singur loc, un singur card).
- ✅ Margine pe fiecare generare (2–3× costul providerului).
- ✅ Experiență „profesională" tip Blotato/fal.ai.
- ❌ Necesită float de working capital (§5).
- ❌ Necesită acorduri (OEM ElevenLabs) și moderare de abuz.
- ❌ Concentrare de risc (dacă contul tău de provider e banat, cade tot).

### Recomandarea: **hibrid faze-ate, nu alege una singură**

Nu e neprofesional să ai un tier flat fără credite + tiere cu credite — **e exact cum funcționează piața.** Recomandare de pachetizare (ancorat pe Blotato 29/97/499 $ și pe tierele tale web existente):

| Tier | Preț/lună | Ce include | Model AI |
|---|---|---|---|
| **Free / Trial** | 0 | Mass-editing limitat + Edge-TTS gratis + câteva credite de test | — |
| **Studio** | ~19–29 $ | Mass-editing nelimitat + scheduling + BYOK (userul își pune cheile) | **A (BYOK)** |
| **Creator** | ~49–97 $ | Tot + credite AI incluse (text, imagini, TTS gestionat) | **B (credite)** |
| **Agency** | ~299–499 $ | Volum credite + multi-brand + membri echipă | **B (credite)** |
| **Top-up** | pay-as-you-go | Pachete de credite peste orice tier | **B (credite)** |

> „Studio" (BYOK) îți permite să **lansezi acum**, cu zero float și zero risc legal. Tierele cu credite le adaugi când ai venit care să finanțeze float-ul. Vinderea de token „un pic mai scump" (markup 2–3×) e **standard și profesional** — vezi §5.

---

## 4. Legalitatea revânzării (capcana ElevenLabs)

Aici e singurul loc unde poți greși juridic. Distincția crucială:

- **A construi un PRODUS care folosește un API** (tu ești clientul providerului, userul e clientul tău) = **permis** la OpenAI, fal.ai, Gemini. Ăsta e modelul SaaS normal. „Agregator de modele AI" ca produs = OK.
- **A REVINDE accesul brut la API / chei** (userul folosește direct capacitatea providerului ca și cum ar fi a lui) = restricționat, cere acorduri.

**ElevenLabs, specific** ([ToS](https://elevenlabs.io/terms-of-use)):
- Bundling/sublicensing al serviciilor lor „în soluția ta" → cere **OEM Terms** (acord separat).
- Revânzarea → cere acord scris de reseller.
- *„You may not share or permit others to use your individual account credentials."*
- API TTS: **0,10 $/1.000 caractere** (Multilingual v2/v3), **0,05 $** (Flash/Turbo). API Pro 99 $/lună, API Scale 330 $/lună.

**Ce înseamnă practic:**
- Pe **desktop BYOK**, fiecare user își pune propria cheie ElevenLabs → **zero problemă legală** (e contul lui). Păstrează asta.
- Pe **web/credite gestionate**, dacă oferi TTS din cheia ta metered ca credite → ai nevoie de **OEM/Enterprise ElevenLabs**. Fă acest pas doar când scala justifică. Până atunci, TTS gestionat = folosește doar Edge-TTS (gratis) sau amână.
- OpenAI (text/imagini/Whisper) și fal.ai (imagini/video) **permit** să construiești produse peste ei → de aici începe agregatorul de credite fără dureri legale.

> Regula de aur: **ElevenLabs → BYOK sau OEM. Restul → poți gestiona din start.**

---

## 5. Cashflow-ul creditelor — cum funcționează DE FAPT (răspuns la confuzia ta)

Ai scris: *„eu, practic, trebuie să-mi iau cu creditele pregătite... la fiecare plată a subscripției trebuie să cumpăr instant token... e ciudat."*

**Nu e ciudat, și nu funcționează așa. Iată mecanica reală:**

### 5.1 Banii intră ÎNAINTE de consum (ciclul e pozitiv)
1. Userul plătește abonamentul / cumpără un pachet de credite → **cash-ul ajunge la tine în Stripe ACUM**.
2. Userul consumă credite **treptat**, în zilele/săptămânile următoare.
3. Deci ai încasat **înainte** să cheltui la provider. Ăsta e **working capital negativ** (favorabil) — ca abonamentul la sală: banii vin, serviciul se consumă pe urmă. Structural ești cash-**pozitiv**.

### 5.2 Nu cumperi „tokenii unui user". Ții un FLOAT mic, comun.
- Nu există „tokenii lui user #1". Există **un sold prepaid la fiecare provider** (fal.ai, OpenAI), din care se scad **toate** generările tuturor userilor.
- Providerii sunt azi majoritar **prepaid**: OpenAI a trecut de la post-pay la pre-pay (min. 5 $, [help](https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing)); fal.ai e **top-up only** ([billing](https://fal.ai/docs/platform-apis/v1/account/billing)). Setezi **auto-recharge**: când soldul scade sub un prag, se reîncarcă automat.
- Float-ul necesar e **mic** raportat la venit. Exemplu: 100 useri × 30 $ = 3.000 $ MRR. Dacă consumul AI e ~40 $/zi, un float de **300–500 $** cu auto-recharge acoperă zile întregi. Îl finanțezi inițial tu (nesemnificativ), apoi se auto-susține din venitul care a intrat la începutul lunii.

### 5.3 Nu poți pierde bani pe un user „scăpat de sub control"
- **Rezervă înainte să rulezi** (preautorizare, ca la card): verifici `balance >= cost`, rezervi, rulezi, apoi decontezi real. Dacă rezervarea eșuează, nu rulezi.
- **Aplicația ta web face deja exact asta**: `UPDATE credits SET balance = balance - cost WHERE balance >= cost` (atomic) + **refund automat pe eșec de provider** (`lib/ai/generate.ts`). Nu poți fi consumat sub zero.

### 5.4 Markup-ul: cât ceri
Ceri userului **mai mult decât te costă** (2–3×). Exemple concrete (prețuri fal.ai reale, [pricing](https://fal.ai/pricing)):

| Generare | Cost provider | Preț sugerat user (2,5–3×) | Note |
|---|---|---|---|
| Imagine FLUX/Seedream | 0,03–0,04 $ | 0,10–0,12 $ | markup 3× |
| Video Kling 2.5 (5s) | 5×0,07 = **0,35 $** | 0,90–1,05 $ | aici e margine bună |
| Video Wan 2.5 (5s) | 5×0,05 = 0,25 $ | 0,65–0,75 $ | |
| Video Veo 3 (5s) | 5×0,40 = **2,00 $** | 5–6 $ | premium, scump |
| TTS 1k car. (Flash) | 0,05 $ | 0,15 $ | doar cu OEM ElevenLabs |

Markup-ul acoperă: cost provider + **taxe Stripe (~2,9% + 0,30 $)** + R2 + **generări eșuate/refundate (~10% buffer)** + margine. Net margin realist: **45–55%**.

### 5.5 Alternativa post-pay (când crești)
La volume mari, unii provideri oferă **facturare lunară** (consumi acum, plătești la sfârșit de lună) prin acorduri enterprise. Asta e **și mai bun** pentru cashflow (încasezi de la useri, plătești providerul peste 30 de zile). Dar la MVP vei fi pe float prepaid — și e OK.

> **Instrumente:** Stripe are acum **credite native** pentru usage-based billing + **Metronome** (produs Stripe) pentru metering; permit markup % automat peste costul providerului ([Stripe credits](https://stripe.com/blog/introducing-credits-for-usage-based-billing), [ghid AI](https://stripe.com/resources/more/ai-companies-and-usage-based-billing)). Dar **nu ai nevoie de ele la început** — sistemul tău de credite din web e suficient.

---

## 6. Costuri reale de lansare (corectarea „aproape 0")

**Infra ai dreptate — e aproape zero. Restul, nu.**

| Categorie | Cost | Note |
|---|---|---|
| **VPS (2–4 core / 8–12 GB)** | ~15–25 €/lună | Hetzner CPX31 sau similar. Suficient pentru orchestrare API. |
| **R2 storage** | 0–5 $/lună la MVP | Free tier: 10 GB + 1M Class A + 10M Class B. Egress **0**. Apoi 0,015 $/GB-lună, Class A 4,50 $/M, Class B 0,36 $/M ([pricing](https://developers.cloudflare.com/r2/pricing/)). |
| **Postgres** | 0 $ | Self-hosted pe același VPS. |
| **Float provideri (working capital)** | **200–500 $** | Recuperabil, se auto-susține din venit. NU e cheltuială pierdută. |
| **Stripe** | 2,9% + 0,30 $/tranzacție | Variabil, din venit. |
| **Domeniu + email** | ~20–50 $/an | |
| **Code-signing desktop** | **~100–400 $/an** | Windows (OV/EV cert) + Apple Developer 99 $/an. **Real și necesar** — altfel SmartScreen/Gatekeeper sperie userii. |
| **Legal (ToS, Privacy, GDPR)** | 0–câteva sute € | Templated gratis sau avocat. Ești firmă RO → **GDPR obligatoriu** (stochezi media + tokenuri). |
| **ElevenLabs OEM** | negociat | Doar dacă faci TTS gestionat. BYOK = 0. |
| **Timp aprobare API social** | **2–6 săptămâni** | Nu bani, dar **blochează lansarea publishing-ului**. Vezi §11. |

**Concluzie:** infra la scală MVP **<50 $/lună** — ai dreptate în esență. Dar bugetul real de „a lansa ca lumea" e ~**500–1.500 $ one-time** (float + code-signing + legal) + **timp** (săptămâni de review API). „Aproape 0" e adevărul pe infra, dar te induce în eroare pe restul.

---

## 7. Infrastructura: unde „2 core / 12 GB" e adevăr și unde te înșeli

Raționamentul tău — *„userii rulează pe compute-ul providerilor, noi avem doar ingress/egress"* — e **corect pentru partea de agregator AI și social**:

- Generare imagini/video/TTS → rulează pe **GPU-ul providerului**. Tu doar trimiți request, aștepți, salvezi rezultatul în R2. ✅
- Publicare social → doar apeluri HTTP la API-urile platformelor. ✅
- Pentru astea, **2 core / 12 GB chiar ajung** la scală mică-medie. Stresul e pe I/O și pe cozile de job-uri, nu pe CPU.

**Dar ai un punct orb: FFmpeg-ul.**

- Web-ul tău are **deja** un pipeline de clipping care rulează pe worker: Whisper + **FFmpeg cut + reframe 9:16 + burn captions** (`worker/clip-render.ts`, `lib/clipping/render.ts`). Encodarea H.264 e **CPU-intensivă**. Pe 2 core, 2–3 randări concurente îți saturează serverul și totul devine lent.
- Whisper e deja offloadat la OpenAI API (bine). Dar reframe-ul + burn-in-ul captions e **compute-ul tău**.

**Soluții (în ordinea lenei):**
1. **Randarea grea rămâne pe desktop** (PC-ul userului = compute gratis pentru tine). Asta e **superputerea** desktop-ului și motivul pentru care există. Mass-editing-ul stă local — perfect.
2. Pentru clipping-ul web (unde userul n-are desktop), **limitează concurența** (o coadă cu 1–2 job-uri FFmpeg simultan) și comunică „în procesare". Acceptabil la început.
3. La scală, offload la un **render-as-a-service** (Shotstack/Creatomate) — dar e alt cost per-minut și altă dependență. Sau **worker GPU separat** care se autoscalează doar când e coadă.

> Regula: **compute-ul care poate sta pe PC-ul userului, stă acolo.** Cloud-ul tău orchestrează și ține banii. Așa „2 core / 12 GB" rămâne valid.

---

## 8. Catalogul — diagnostic și plan concret

### 8.1 Ce e acum (și de ce e „ciudat")
- **`v_catalog_products`** = view peste `uf.products_catalog` — **hardcodat pe magazinul tău** (Gomag, `company_id`, `gomag_product_id`). Nefiltrat pe profil. **Dacă se livrează așa, orice client viitor vede produsele TALE.** Risc de data leak + jenă. Migrations `018_create_catalog_view.sql`.
- **`products`** = tabel per-profil, populat din **feed-uri Google Shopping XML**. Multi-user, dar **presupune că userul are un magazin cu feed**. Migrations `013_create_product_tables.sql`.
- Descrierile vin din feed (`<description>`) sau din catalogul hardcodat, și curg spre Gemini ca `context=product.get("description","")` (`product_generate_routes.py:743`). Deci userul **nu** lipește context de fiecare dată — dar produsele vin dintr-un feed/catalog, nu dintr-un „adaugă produs simplu".

### 8.2 Ce vrei tu
Un **product library local, manual, per-user**: adaugi **titlu + una/mai multe imagini + (opțional) descriere**, stocat **local pe PC**, reutilizat ca context la generarea în masă — **fără să adaugi context de fiecare dată**. Local întâi, cloud mai târziu.

### 8.3 Vestea bună: e mai SIMPLU decât ce ai, și reutilizezi ce există
Nu construiești de la zero — cobori pe scara lenei:

1. **Elimină / gate-uiește dependența de `uf.products_catalog`** înainte de orice lansare (e blocker de livrare). Feature-flag off by default, sau șterge view-ul din calea de default.
2. **Product library local** = tabel SQLite (repository-ul SQLite **există deja** ca fallback) + imagini în `userData`. Schema `products` are **deja `local_image_path`** — reutilizezi coloana. Câmpuri: `id, title, description, image_paths[], created_at`.
3. **Descriere auto din imagine+titlu** = un endpoint peste **Gemini Vision (deja integrat)**. Prompt: „dată imaginea + titlul, scrie o descriere de produs pentru reels". Asta e literalmente „nu mai adaug context de fiecare dată". Un endpoint, un prompt, clientul Gemini reutilizat.
4. **Sync cloud (faza 2)** = oglindește SQLite-ul local în Supabase `products` (care există deja, per-profil). Sync simplu, nu rescriere.
5. **Feed-import rămâne opțional** pentru cei care au magazin — nu-l ștergi, dar **produsul manual local devine default-ul**.

> Estimare efort: product library local + descriere Gemini Vision = **mic** (reutilizezi SQLite, `local_image_path`, clientul Gemini). Curățarea catalogului hardcodat = **obligatorie**, mică.

---

## 9. Adăugarea serviciilor AI: Seedance, video, imagini

### 9.1 Seedance 2.0 — de unde iei acces oficial
Ai trei căi (de la greu la ușor):

1. **Volcano Engine Ark** (火山方舟, ByteDance, China) — oficial, dar **RMB + certificare de entitate/enterprise**, base URL `https://ark.cn-beijing.volces.com/api/v3/`. Aplici din consolă, aprobare 1–3 zile lucrătoare. Greu pentru o firmă RO ([aibase](https://news.aibase.com/news/26788)).
2. **BytePlus** (platforma globală ByteDance) — facturare **USD**, compliance internațional. Calea „oficială" pentru non-China ([evolink](https://evolink.ai/blog/seedance-2-api-access-guide-international-developers)).
3. **Prin agregatori** (fal.ai, PiAPI, Kie.ai, Replicate) — endpoint-uri OpenAI-compatibile, integrare banală. **Recomandat pentru tine**: o singură integrare fal.ai îți dă Seedance + Kling + Wan + Veo + Hailuo etc. ([nxcode](https://www.nxcode.io/resources/news/seedance-2-0-api-guide-pricing-setup-2026)).

**Recomandare:** nu te lega direct de ByteDance. Ia Seedance **prin fal.ai** (sau Replicate) — o integrare, N modele, un singur billing, un singur float. Pattern async standard (submit → poll → download), pe care worker-ul tău îl face deja pentru clipping.

### 9.2 Video „cu AI" și „fără AI" — le ai pe ambele
- **Fără AI** = sistemul tău de secvențe (mass-editing desktop). Deja există. E diferențiatorul.
- **Cu AI** = generare prin provideri (fal.ai). O adaugi ca **sursă de segmente** în pipeline: în loc să tai dintr-un video filmat, ceri un clip generat. Aceeași structură de timeline, altă sursă.

### 9.3 Prețuri concrete (fal.ai, pentru math-ul de credite)
Imagini: FLUX/Seedream 0,03–0,04 $/imagine, Qwen 0,02 $/MP. Video: Wan 2.5 **0,05 $/s**, Kling 2.5 **0,07 $/s**, Veo 3 **0,40 $/s** ([pricing](https://fal.ai/pricing)). Vezi tabelul de markup din §5.4.

---

## 10. „Agregator de modele AI ca fal.ai/Higgsfield" — cât de greu

**Depinde ce înțelegi prin „agregator". Sunt două lucruri complet diferite:**

- **Platformă de hosting de modele** (ce e fal.ai/Higgsfield cu adevărat): ei **dețin/închiriază GPU-uri**, optimizează inferență, servesc sute de modele. **Capital-intensiv, greu, nu vrei asta.** fal.ai are 985 endpoint-uri și ~50% cotă pe API-uri de imagini ([teamday](https://www.teamday.ai/blog/ai-image-video-api-providers-comparison-2026)) — nu concurezi cu ei.
- **Meta-agregator / repackager** (ce vrei tu de fapt): ești **client** al fal.ai/Replicate/OpenAI și **repachetezi** accesul lor cu:
  - un UI unificat,
  - un sistem de credite/billing (îl ai deja),
  - o nișă clară (creatori care vor și **scheduling** și **mass-editing**, nu doar generare).

**Al doilea e ușor-mediu și ai deja 80%:** sistemul de credite există, ai un pattern de registry de provideri în web (`lib/connectors`, `lib/ai/index.ts` cu `getAiProvider()`). Adaugi un „provider router" pentru AI (ca cel de conectori sociali) și înregistrezi fal.ai/ElevenLabs în spatele lui. **Nu construiești inteligență, construiești un magazin.**

> Diferențiatorul tău nu e „încă un fal.ai". E **combinația**: agregator social (ca Blotato) + agregator AI (ca fal.ai) + **mass-editing pe secvențe filmate (unic)**. Nimeni din cei trei nu le are pe toate.

---

## 11. Agregator de conturi social — stare și blocaje

**Vestea bună:** web-ul are **21 de conectori reali** cu OAuth/tokenuri criptate și worker de publicare cu retry. E deja un Postiz/Blotato funcțional pe cod.

**Blocajul pe care l-ai subestimat — aprobarea platformelor** (nu bani, ci timp și hoops):

| Platformă | Cerință | Capcană |
|---|---|---|
| **TikTok** (Content Posting API) | Review manual **2–6 săptămâni**, apoi **audit** de compliance | Până treci auditul, **tot ce postează app-ul e forțat pe „private"** — inutilizabil public. Cap 25 video/cont/zi ([docs](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)). |
| **Instagram** (Graph API) | Doar conturi **Business/Creator** legate de Facebook Page, **Meta App Review** pentru `instagram_content_publish` | Conturile personale n-au API de publicare. Cap 25 postări/24h. |
| **YouTube** (Data API v3) | Gratis, dar **quota 10.000 unități/zi**, un upload = **1.600 unități** (~6 upload-uri/zi default) | Trebuie cerere de mărire de quota pentru volum. |

**Implicație pentru roadmap:** **începe review-urile ACUM**, în paralel cu dezvoltarea. Sunt long-lead. Dacă lansezi peste 2 luni și abia atunci depui la TikTok, mai stai 6 săptămâni cu publishing-ul pe „private". Postiz e open-source — poți studia implementările lor de conectori ca referință.

**Anchore de preț concurență:** Blotato 29/97/499 $ ([pricing](https://www.blotato.com/pricing)); Postiz free self-hosted, cloud de la 29 $ ([pricing](https://postiz.com/pricing)).

---

## 12. Riscuri și puncte oarbe (ce ți-a scăpat)

1. **Moderare de conținut / abuz** — generarea AI de imagini/video invită NSFW, deepfake, copyright. Providerii îți pasează **ție** răspunderea (ești clientul lor). Fără usage policy + moderare, **contul tău de provider poate fi banat** → cade tot produsul. Risc operațional real, nu teoretic.
2. **Concentrare de risc pe provider** — o singură cheie fal.ai/OpenAI = single point of failure. Rate-limit sau ban = downtime total. Ai nevoie de **fallback multi-provider**.
3. **Chargeback pe credite consumate** — user cumpără credite, le consumă, face chargeback. Pierdere directă. Nevoie de politică de expirare + limite pe conturi noi.
4. **Catalogul hardcodat** (§8) — data leak dacă se livrează.
5. **Două sisteme de auth** (Supabase Auth desktop vs Auth.js web) — userul ajunge cu două conturi. Trebuie decis un SSO/bridge.
6. **Distribuție desktop** — code-signing + auto-update. Ai deja note despre problemele de standalone build.
7. **GDPR** (firmă RO) — stochezi media + tokenuri sociale criptate. DPA cu providerii, drept la ștergere. Web-ul are deja retenție/purge real — bine.
8. **Spending anxiety pe billing usage-based** — userii se sperie de „cât consum". Nevoie de cap-uri, alerte, vizibilitate a soldului **înainte** de consum ([Stripe](https://stripe.com/resources/more/pricing-flexibility-in-ai-services)).

---

## 13. Roadmap propus (fazat, cu logica lenei)

### Faza 0 — Curățenie pre-lansare (blockers)
- [ ] Gate/elimină catalogul hardcodat `uf.products_catalog` (data leak).
- [ ] Decide fork-ul de auth: un SSO/bridge între cele două conturi (sau backend web canonic).
- [ ] Usage policy + moderare minimă (blochează abuzul evident) — protejează conturile de provider.
- [ ] Legal: ToS + Privacy + GDPR (templated).
- [ ] Code-signing desktop (Windows + Apple).
- [ ] **Depune ACUM** aplicațiile TikTok/Meta (long-lead).

### Faza 1 — MVP lansabil (BYOK + flat)
- [ ] Product library local (SQLite + `local_image_path`) + descriere auto Gemini Vision.
- [ ] Tier „Studio": mass-editing + scheduling + BYOK. **Zero float, zero risc legal.**
- [ ] Desktop = client al backend-ului web pentru scheduling (nu duplica conectorii).
- [ ] Edge-TTS gratis ca default AI audio.

### Faza 2 — Credite gestionate (agregator)
- [ ] Activează tierele Creator/Agency cu credite (sistemul din web **există deja**).
- [ ] Începe cu **OpenAI** (text/imagini/Whisper) — legal permisiv.
- [ ] Float mic (300–500 $) + auto-recharge. Markup 2,5–3×.
- [ ] Rezervă-înainte-de-rulare (deja implementat) + refund pe eșec (deja implementat).

### Faza 3 — Video AI + modele premium
- [ ] Integrează **fal.ai** ca provider unic → Seedance/Kling/Wan/Veo dintr-o dată.
- [ ] Video AI ca sursă de segmente în pipeline (aceeași structură timeline).
- [ ] Aici trăiește marginea pe „token vândut mai scump".

### Faza 4 — Scale
- [ ] OEM ElevenLabs → TTS gestionat pe credite.
- [ ] Multi-provider fallback (redundanță).
- [ ] Worker de render autoscalabil / render-as-a-service dacă FFmpeg-ul server-side devine bottleneck.

---

## 14. Arhitectura recomandată

```
                    ┌─────────────────────────────────────────┐
                    │        CREIER CLOUD (backend web)         │
                    │  Next.js API + worker + Postgres + R2     │
                    │                                           │
                    │  • Auth (canonic)                         │
                    │  • Billing + CREDITE (există deja)        │
                    │  • 21 conectori sociali (există deja)     │
                    │  • Provider router AI (OpenAI/fal/11L)    │
                    │  • Clipping long→short (există deja)      │
                    └───────────────┬───────────────┬──────────┘
                                    │ API           │ API
                        ┌───────────┴──────┐   ┌────┴─────────────┐
                        │   FAȚA WEB        │   │  FAȚA DESKTOP     │
                        │   (browser)       │   │  (Electron)       │
                        │                   │   │                   │
                        │  • scheduling     │   │  • consumă credite│
                        │  • clipping       │   │    + conturi din  │
                        │  • generare AI    │   │    creier         │
                        │                   │   │  • MASS-EDITING   │
                        │                   │   │    LOCAL (FFmpeg  │
                        │                   │   │    pe PC-ul       │
                        │                   │   │    userului=gratis)│
                        │                   │   │  • product library│
                        │                   │   │    local (SQLite) │
                        └───────────────────┘   └───────────────────┘
```

**Principii:**
1. **Un singur creier** ține banii, conturile, creditele, orchestrarea AI. Nu duplici billing/conectori.
2. **Desktop = client + mușchi local.** Superputerea lui = randare grea pe compute-ul userului (gratis pentru tine). Consumă restul din cloud prin API.
3. **Compute-ul care poate sta pe PC-ul userului, stă acolo.** Cloud-ul rămâne subțire → „2 core/12 GB" rămâne valid.
4. **Provider router pentru AI**, exact ca registry-ul de conectori sociali pe care îl ai deja. Adaugi provideri fără să rescrii.

**Costul onest al unificării:** ai două DB-uri (Supabase desktop vs Postgres web) și două auth-uri. Unificarea completă (merge de DB-uri) e un proiect mare. **Calea leneșă coerentă:** fă backend-ul web **canonic** pentru bani+conturi+AI, iar desktop-ul îl **apelează** prin API pentru astea, păstrându-și local pipeline-ul FFmpeg și product library-ul. Eviți merge-ul de DB acum; îl faci treptat dacă vreodată devine necesar.

---

## 15. Verdict scurt

- **Nu ai o problemă de feature-uri. Ai o problemă de coerență.** Ai construit cele două jumătăți ale aceluiași produs separat. Munca e să le unești, nu să mai adaugi.
- **Cashflow-ul nu e capcana pe care o crezi** — prepay-ul userului îți finanțează float-ul; ești structural cash-pozitiv.
- **Costurile de infra sunt aproape 0. Costurile reale sunt timp (aprobări API), float mic, code-signing, moderare și legal.**
- **Vinderea de token cu markup e profesională și standard.** Tier flat (BYOK) + tiere cu credite = fix cum face piața.
- **Lansează cu BYOK + flat (poți acum, risc ~0), adaugă creditele gestionate când ai venit.** Curăță catalogul înainte de orice.
- **Diferențiatorul tău real:** social aggregator + AI aggregator + **mass-editing pe secvențe filmate**. Nimeni nu le are pe toate trei.

---

## Surse

**Seedance / video AI:**
- [Seedance 2.0 API Guide — NxCode](https://www.nxcode.io/resources/news/seedance-2-0-api-guide-pricing-setup-2026)
- [Seedance 2.0 API Access for International Developers — Evolink](https://evolink.ai/blog/seedance-2-api-access-guide-international-developers)
- [ByteDance Volcano Engine opens Seedance 2.0 general API — AIbase](https://news.aibase.com/news/26788)

**Agregatori / prețuri AI:**
- [FAL.AI vs Replicate vs — TeamDay](https://www.teamday.ai/blog/ai-image-video-api-providers-comparison-2026)
- [fal GenAI API Pricing](https://fal.ai/pricing)
- [fal Account Billing docs](https://fal.ai/docs/platform-apis/v1/account/billing)

**Billing / cashflow:**
- [OpenAI prepaid billing](https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing)
- [Stripe — Introducing credits for usage-based billing](https://stripe.com/blog/introducing-credits-for-usage-based-billing)
- [Stripe — Usage-based billing for AI companies](https://stripe.com/resources/more/ai-companies-and-usage-based-billing)
- [Stripe — Pricing flexibility in AI services](https://stripe.com/resources/more/pricing-flexibility-in-ai-services)

**ElevenLabs (legal/preț):**
- [ElevenLabs Terms of Use](https://elevenlabs.io/terms-of-use)
- [ElevenLabs API Pricing](https://elevenlabs.io/pricing/api)

**R2:**
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)

**Social API approval:**
- [TikTok Content Posting API](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
- [Phyllo — Social Media API guide 2026](https://www.getphyllo.com/post/social-media-api-guide-on-top-apis-for-developers)

**Concurență (ancore preț):**
- [Blotato Pricing](https://www.blotato.com/pricing)
- [Postiz Pricing](https://postiz.com/pricing)
