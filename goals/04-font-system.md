Extinde sistemul de fonturi pentru subtitrări: paletă curată mare + suport pentru fonturile instalate de user în Windows (ca în Premiere Pro), cu paritate garantată preview ↔ randare FFmpeg.

Starea actuală (diagnosticată): FONT_OPTIONS în frontend/src/types/video-processing.ts:172-183 are 11 intrări, dar doar 5 sunt înregistrate pentru preview în layout.tsx — 6 cad silențios pe sans-serif generic. Randarea trimite doar FontName= prin ASS force_style, fără fontsdir și fără fișiere de font bundle-uite → libass depinde de fallback-ul DirectWrite (nesigur). Există DOUĂ căi de randare care construiesc stilul independent: app/services/video_effects/subtitle_styler.py (principal) și app/services/video_processor.py:1145 (legacy, 3 call sites).

Plan:
1. Bundle-uiește un set curat de 20-40 fonturi OFL ca fișiere; pasează fontsdir la filtrul subtitles ca libass să le încarce determinist; self-host aceleași fișiere cu @font-face pentru preview — o singură sursă de adevăr pentru ambele.
2. Fonturi Windows: enumerare cu queryLocalFonts în Electron (preview-ul le rezolvă nativ prin CSS); pentru randare, localizează fișierul fontului ales (fontTools pe name table — numele de fișier ≠ family name) și copiază-l în același fontsdir înainte de FFmpeg.
3. Rutează calea legacy prin builder-ul comun (root-cause, nu patch în două locuri).
4. Fallback explicit când un proiect referențiază un font absent pe mașina curentă (avertisment vizibil + font default, nu degradare silențioasă).

Atenție la pitfall-urile din audit: inconsistența CSS-var vs family-name în FONT_OPTIONS/DEFAULT_SUBTITLE_SETTINGS, fonturi variabile în libass, licențele fonturilor bundle-uite.

Acceptare: orice font din paletă + un font instalat manual în Windows arată identic în preview și în randarea finală.

Detalii: @docs/audits/2026-07-11-font-system.md
