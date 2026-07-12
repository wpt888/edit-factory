Robustețe desktop — repară cele 4 P2-uri din sweep-ul de sănătate (fără features noi):

1. Runner pairing Blipost: expune last_error prin status() ca UI-ul să arate DE CE pairing-ul e în „error" (app/services/blipost_runner.py:409-416 + app/api/blipost_render_routes.py:46-53); înlocuiește retry-ul infinit la 5s din _loop() (:424-439) cu backoff exponențial și distinge 401/token revocat (oprește + cere re-pairing) de erori tranzitorii.

2. Recovery la crash mid-render: la pornire, curăță directoarele temp orfane și marchează job-ul local ca eșuat/reluabil, în loc să te bazezi doar pe lease expiry server-side (blipost_runner.py:448-453).

3. Kokoro TTS e stub cu API neverificat (app/services/tts/kokoro.py:160-177), dar factory.py:57-64 îl activează dacă pachetul e instalat — fă fail-fast cu mesaj clar sau scoate-l din factory până e verificat.

4. Asamblare lenient: când extracția FFmpeg a unui segment eșuează, raportează explicit ce segmente s-au pierdut (în rezultat + UI), nu livra silențios un video mai scurt (app/services/assembly_service.py:1766-1840).

Fiecare fix cu testul lui minim. Rulează pytest la final — cele 495 de teste existente trebuie să rămână verzi.

Detalii: @docs/audits/2026-07-11-desktop-health-sweep.md
