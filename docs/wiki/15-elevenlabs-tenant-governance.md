# ElevenLabs: voci izolate și credite per profil

Implementat la 2026-07-13 pentru scenariul în care Edit Factory folosește o
singură subscripție ElevenLabs pentru mai mulți utilizatori.

## Contractul aplicației

- Cheia din `ELEVENLABS_API_KEY` este cheia comună a platformei. ElevenLabs
  vede toate cererile ca venind din același cont; izolarea se face în backend.
- Vocile `premade` și `default` sunt publice în aplicație. Orice voce clonată,
  generată, profesională sau cu o categorie necunoscută trebuie atribuită
  explicit profilului înainte să apară în selector sau să poată fi folosită.
- O cheie ElevenLabs salvată de un profil este tratată ca BYOK: consumă
  abonamentul acelui profil și nu intră în limita cheii comune.
- Limita se aplică per profil și per lună calendaristică UTC. Valoarea `-1`
  înseamnă nelimitat. Implicitul este configurat prin
  `ELEVENLABS_DEFAULT_USER_CREDIT_LIMIT` și este `10000` credite.

## Contorizare și concurență

Înainte de apelul extern, backendul rezervă atomic costul estimat. Astfel, două
joburi simultane nu pot trece amândouă de aceeași limită. După răspunsul
ElevenLabs, rezervarea este înlocuită cu valoarea exactă din headerul
`character-cost`. Dacă furnizorul nu a taxat cererea, rezervarea se eliberează;
dacă a taxat-o, dar ledgerul nu poate fi actualizat, rezervarea rămâne blocată
pentru a evita subcontorizarea.

Cache hit-urile TTS nu consumă credite. La schimbarea lunii, balanța se
resetează automat, iar rezervările vechi rămase deschise devin `expired`.

## Persistență

Migrarea `supabase/migrations/053_elevenlabs_tenant_governance.sql` adaugă:

- `editai_elevenlabs_voice_access` — atribuirea vocilor private;
- `editai_elevenlabs_credit_balances` — limita, consumul și rezervările lunii;
- `editai_elevenlabs_credit_reservations` — auditul fiecărei generări;
- RPC-uri Postgres pentru rezervare, confirmare și eliberare atomică.

Schema SQLite conține aceleași tabele și tranzacții `BEGIN IMMEDIATE`. Migrarea
face backfill pentru vocile deja selectate în `tts_settings`, astfel încât
profilurile existente să nu-și piardă vocea curentă.

## Administrare

Endpointurile sunt sub `/api/v1/elevenlabs-accounts`:

- `GET /credits` — balanța profilului autentificat, fără soldul sau cheia
  abonamentului comun;
- `GET /voice-access` — vocile private atribuite profilului curent;
- `POST /voice-access` — atribuie o voce unui profil, rol `admin` sau
  `service_role`;
- `DELETE /voice-access/{profile_id}/{voice_id}` — retrage atribuirea, rol
  administrativ;
- `PUT /credits/limit` — schimbă limita lunară a profilului, rol administrativ.

Exemplu pentru limită:

```json
{
  "profile_id": "<uuid>",
  "monthly_credit_limit": 25000
}
```

Exemplu pentru atribuirea unei voci:

```json
{
  "profile_id": "<uuid>",
  "voice_id": "<elevenlabs-voice-id>"
}
```

## Comportament vizibil

Badge-ul din TTS Configuration arată numai creditele profilului: folosite,
rezervate și rămase. Soldul central și indiciile despre cheia API nu mai sunt
expuse utilizatorilor obișnuiți.

Erorile de politică sunt intenționat explicite: `402` pentru limită depășită,
`403` pentru voce neatribuită și `503` dacă ledgerul nu este disponibil.
Aceste erori nu declanșează fallback automat la Edge TTS, deoarece asta ar
schimba vocea aleasă de utilizator și ar ascunde problema reală.

## Verificare

- 5 teste dedicate pentru izolarea vocilor, contorizare exactă, limita strictă
  și rezervări concurente;
- 37 de teste țintite backend trecute pentru guvernanță și repository;
- frontend lint fără erori și TypeScript typecheck trecut.

