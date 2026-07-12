# Font system audit — subtitle style editor (2026-07-11)

Scope: map the current font pipeline (dropdown → preview → FFmpeg render) end to end,
assess feasibility of (a) a larger curated font palette and (b) Windows-installed-font
support (Premiere-style), and flag pitfalls. Self-contained for a `/goal` implementation
prompt — no other document needs to be open alongside this one.

## 1. Current pipeline, file:line by stage

### 1a. Font list / dropdown (frontend, source of truth for values)

- `frontend/src/types/video-processing.ts:172-183` — `FONT_OPTIONS` array, the **only**
  place the font list is defined. 11 entries today:
  Montserrat, Roboto, Oswald, Poppins, Bebas Neue, Anton, Rubik, Nunito, Lato, Inter.
  Each entry is `{ value: "var(--font-x), X, sans-serif", label: "X" }`.
- `frontend/src/types/video-processing.ts:152-170` — `DEFAULT_SUBTITLE_SETTINGS.fontFamily`
  defaults to the bare string `"Montserrat"` (no CSS var wrapper — inconsistent with
  `FONT_OPTIONS` values, see Pitfall 1).
- Dropdown UI: `frontend/src/components/video-processing/subtitle-editor.tsx:571-593`.
  Renders a shadcn `<Select>`, iterates `FONT_OPTIONS`, sets `style={{ fontFamily: font.value }}`
  per `<SelectItem>` so each option previews in its own font. `settings.fontFamily` is bound
  directly to the CSS `value` string (e.g. `"var(--font-montserrat), Montserrat, sans-serif"`),
  not a plain family name — the CSS var + name + fallback ships as one opaque string through
  the whole app.

### 1b. How fonts are loaded for the browser/Electron preview

- `frontend/src/app/layout.tsx:1-56` — **Google Fonts via `next/font/google`**, self-hosted at
  build time (Next.js downloads the woff2 files and serves them locally — no runtime call to
  Google). Only **5 of the 11** `FONT_OPTIONS` fonts are actually registered here:
  `Montserrat` (28-32), `Roboto` (34-38), `Open_Sans` (40-44, unused — not in FONT_OPTIONS),
  `Oswald` (46-50), `Bebas_Neue` (52-56). Each produces a CSS custom property
  (`--font-montserrat` etc.) applied on `<html>` via `className` (line 74).
  **Poppins, Anton, Rubik, Nunito, Lato, Inter — 6 of 11 dropdown entries — have no
  `next/font/google` registration and no `@font-face` anywhere else in the repo.** Selecting
  them in the dropdown falls through the CSS `sans-serif` generic (or the browser's random
  installed-font match) in the live preview; see Pitfall 2.
- No `@font-face` rules found in `frontend/src/app/globals.css` for any subtitle font — the
  only `font-family` uses there are unrelated (`--font-mono`, line 325).
- Preview consumption: `frontend/src/components/variant-preview-player.tsx:158` — renders the
  live subtitle overlay with inline `fontFamily: subtitleSettings.fontFamily`, i.e. directly
  passes through the `FONT_OPTIONS.value` string (CSS var + fallback chain) into the DOM.
  `frontend/src/components/video-processing/subtitle-editor.tsx:512` does the same for the
  style-preset preview swatch.
- Runtime: this is an Electron `BrowserWindow` loading the Next.js frontend
  (`electron/src/main.js`), so preview font rendering goes through Chromium's normal CSS font
  resolution — same engine as any Next.js app, no Electron-specific font API is in use today
  (`local-fonts` / `queryLocalFonts` — not referenced anywhere in `electron/`, confirmed by
  grep).

### 1c. How FFmpeg/libass resolves fonts at render time

- FFmpeg binary resolution: `app/ffmpeg_setup.py:22-86` (`_resolve_ffmpeg_path`). Order:
  `FFMPEG_BINARY` env → bundled binary (`RESOURCES_PATH/ffmpeg/bin` in packaged desktop
  builds) → repo dev fallback `ffmpeg/ffmpeg-master-latest-win64-gpl/bin` → system PATH.
  Packaged Windows builds bundle from `ffmpeg-master-latest-win64-gpl/bin`
  (`electron/package.json:31-39`, `extraResources` copies `ffmpeg.exe`/`ffprobe.exe` only —
  **no font files, no fontconfig.conf are bundled**).
- This is a **gyan.dev static Windows build** that statically links `libass` +
  `libfontconfig` + `libfreetype` (confirmed via
  `ffmpeg/ffmpeg-8.0.1-essentials_build/README.txt:50-60`, same lineage as the
  `master-latest-win64-gpl` build actually shipped). Static fontconfig on these Windows
  builds ships **without** a pre-populated fontconfig cache pointing at
  `C:\Windows\Fonts`; libass's actual font source on Windows in practice is its built-in
  **DirectWrite fallback provider** (compiled into libass, kicks in when fontconfig can't
  resolve a family), which *does* enumerate the Windows system font store — this is why
  matches on close-enough names sometimes "just render" today, unreliably, rather than by
  deliberate design.
- Render call sites — **two independent code paths build the ASS `force_style` string**,
  duplicating the font-name-extraction logic:
  1. **Primary/current path**: `app/services/video_effects/subtitle_styler.py` —
     `SubtitleStyleConfig.from_dict` (line 168-176) strips the CSS var / fallback chain down
     to a bare family name (e.g. `"var(--font-montserrat), Montserrat, sans-serif"` →
     `"Montserrat"`), `to_force_style_string()` (line 68-139) emits
     `FontName={self.font_family}` (line 89) into the `force_style` ASS string.
     `build_subtitle_filter()` (line 338-439) assembles the final
     `subtitles='...':original_size=WxH:force_style='FontName=...'` filter string
     (line 432-436) — called from `app/api/library_routes.py:4527` and
     `app/api/pipeline_routes.py:6658`.
  2. **Legacy/still-live path**: `app/services/video_processor.py` — `VideoEditor.add_subtitles()`
     (line 1145) duplicates the exact same "strip CSS var, take bare family name" logic inline
     (line 1224-1234) and builds its own `force_style` string (line 1238-1250) with
     `FontName={font_family}` (line 1241). Called from three sites in the same file
     (`video_processor.py:1607`, `:1983`, `:2198`), i.e. still exercised by parts of the
     pipeline, not dead code. **Any font-handling change must be made in both places** or the
     two paths will diverge (a preview-matching class of bug already visible in the WrapStyle
     comment at `subtitle_styler.py:408-416`, which documents an earlier preview/render
     divergence bug on wrapping).
- In both paths, `FontName=` in libass/ASS `force_style` is matched by **font family name
  string equality against whatever font source libass resolves** (fontconfig DB if present,
  else DirectWrite enumeration on Windows) — it is *not* a file path. There is currently no
  `fontsdir` /`-vf ... fontsdir=` option passed anywhere in the codebase (confirmed by grep —
  no matches for `fontsdir` in any `.py` under `app/`), and no font files are copied
  alongside the render temp directory. Render-time font resolution today is 100% dependent on
  "does libass's Windows fallback happen to find a system/registered font with this exact
  name" — the bundled Google fonts registered via `next/font/google` for the **preview** are
  never made available to the **render** process at all; the render only works today because
  Montserrat/Roboto/Oswald/Bebas Neue happen to also be either present as system fonts on the
  dev/build machine or resolvable via other means. This is a latent bug independent of the
  feature request (see Pitfall 3).

## 2. Recommended architecture

### 2a. Curated palette expansion (20-40 fonts)

Feasible and low-risk; the existing plumbing (CSS var + FontName passthrough) already
supports arbitrary families, it's just under-populated and inconsistently wired end to end.

1. **Bundle font files for render, not just preview.** Ship the curated set as static
   `.ttf`/`.otf` files under a new `app/assets/fonts/` (or similar) directory, included in
   `electron-builder` `extraResources` (mirror the ffmpeg pattern in
   `electron/package.json:31-39`) so they land next to the packaged app on every OS.
2. **Pass `fontsdir` to the FFmpeg `subtitles` filter** pointing at that bundled fonts
   directory: `subtitles='...':fontsdir='<path>':force_style='FontName=...'`. This makes
   libass load fonts directly from disk instead of depending on fontconfig/DirectWrite
   guessing — deterministic across machines, and is the standard fix for "libass can't find
   my font" issues. Change both `build_subtitle_filter()`
   (`app/services/video_effects/subtitle_styler.py:432-436`) and the legacy
   `add_subtitles()` filter string (`app/services/video_processor.py:1264,1275`) — or better,
   delete the duplication by having `add_subtitles()` call `build_subtitle_filter()` (real
   root-cause fix per the "fix once, where all callers route through" rule — the two
   call sites already build force_style strings that are byte-for-byte re-derivations of the
   same settings dict).
3. **Preview side**: for a *bundled* curated font, keep using `next/font/google` where the
   family exists on Google Fonts (covers most curated picks), OR self-host the same `.ttf`
   files used for render via a plain `@font-face` in `globals.css` / a generated CSS file, so
   preview and render draw from **the same font asset** — eliminates a whole class of "renders
   differently than preview" bugs. `next/font/google` and `@font-face` can coexist; for fonts
   not on Google Fonts, `@font-face` pointing at the same files copied into
   `frontend/public/fonts/` is the simplest option.
4. **Update `FONT_OPTIONS`** (`frontend/src/types/video-processing.ts:172-183`) to the full
   curated list, each entry keyed by **exact family name** matching both the `@font-face`
   `font-family` declaration and the `FontName=` value sent to libass — see Pitfall 1 on why
   the value must stop being a CSS-var-wrapped string.
5. **Licensing**: curate only from Google Fonts (OFL-licensed, redistribution-friendly) or
   equivalently-licensed families to avoid bundling restricted commercial fonts. 20-40 curated
   OFL fonts is a well-trodden path (this is what most caption tools ship).

### 2b. Windows-installed system fonts (Premiere-style "pick any font")

Two independent halves — enumeration (listing) and resolution (making the chosen font
actually render) — and they need different mechanisms for preview vs. render.

**Enumeration (listing installed fonts in the UI):**
- **Electron `local-fonts` API** (`session.availableFonts` — Chromium's Local Font Access
  API, stable from Electron 30+) is the right tool: call it from the Electron main process
  (`electron/src/main.js`) or renderer (behind a permission prompt — Local Font Access is a
  powerful-feature API requiring a user gesture/permission the first time), returns
  `{family, fullName, postscriptName, style}` for every installed font. This is exactly what
  Premiere/Chromium-based apps use. No matches for `local-fonts`/`queryLocalFonts` exist in
  the codebase today — this is new wiring, not a fix.
- Python/FastAPI alternative (`C:\Windows\Fonts` + registry, `fontTools` for family-name
  extraction from each file) is viable but redundant — Electron already has this file open
  and running; doing it in Python means a second enumeration path to keep in sync and an IPC
  round-trip the Electron API doesn't need. Only worth it if the font list must be available
  server-side (e.g. this app ever runs headless/cloud-rendered) — desktop-only today, so
  Electron's native API is the lazier and more correct choice.
- Expose the result to the Next.js frontend via the existing Electron preload/IPC bridge
  (check `electron/src/preload.js` for the pattern already used for other native calls) as a
  new IPC channel, e.g. `list-system-fonts`.

**Resolution (making the picked font actually render):**
- **Preview**: trivial — once the user picks an installed family name, `fontFamily: "<Family
  Name>"` in CSS resolves it natively via Chromium's normal font stack (no `@font-face`
  needed — the OS font is already registered with the system, and Electron/Chromium sees
  the same system font table as any Windows app). This is the *one* part of the feature that
  needs zero new plumbing beyond passing the right string through.
- **Render**: this is the part that needs real work. FFmpeg's bundled static libass build
  does **not** reliably see `C:\Windows\Fonts` (see 1c) — it depends on fontconfig cache
  state that isn't bundled, with DirectWrite fallback as an unreliable safety net. Two options,
  in order of robustness:
  1. **Copy the resolved font file into the render's `fontsdir`** before invoking FFmpeg. When
     the user picks a system font, resolve its file path (Electron's `local-fonts` API
     returns enough identifying info to locate it, or fall back to enumerating
     `C:\Windows\Fonts\*.ttf`/`.otf`/`.ttc` and matching by name via `fontTools.ttLib` to read
     the `name` table — needed because Windows font *filenames* frequently don't match the
     *family name* used in `FontName=`). Copy that file next to (or symlink into) the same
     `fontsdir` used for the curated bundle (2a.2) before each render job. This makes system
     fonts behave exactly like bundled fonts from libass's point of view — same mechanism,
     same code path, most robust option and consistent with 2a.
  2. **Point `fontsdir` at `C:\Windows\Fonts` directly** — simpler (no copy step) but slower
     (libass scans the whole directory, hundreds of files) and Windows-only; still needs the
     `fontsdir` change from 2a.2 to have any effect, since without it nothing points libass at
     the Windows font store at all today.
  Option 1 is recommended: it unifies curated-bundled and user-installed fonts under one
  `fontsdir`-copy mechanism, keeps render time bounded, and is portable if a future
  cloud-render path is ever added (a directory of copied font files travels with the job;
  `C:\Windows\Fonts` does not exist on a Linux render node).
- **`fontTools`** (`pip install fonttools`) is the right library for reading the `name` table
  out of arbitrary `.ttf`/`.otf`/`.ttc` files to get the authoritative family name — needed
  both to build the "installed fonts" list server-side if ever required, and to verify a
  chosen file's family name matches what gets written into `FontName=`.

## 3. Pitfalls

1. **CSS-var-wrapped value vs. bare family name (existing bug, will get worse).**
   `FONT_OPTIONS[i].value` is a full CSS font-family list
   (`"var(--font-montserrat), Montserrat, sans-serif"`), used directly as `settings.fontFamily`
   throughout the app. Both `SubtitleStyleConfig.from_dict` (`subtitle_styler.py:168-176`) and
   `add_subtitles` (`video_processor.py:1224-1234`) parse this string at render time to strip
   the CSS var and fallback, but `DEFAULT_SUBTITLE_SETTINGS.fontFamily`
   (`video-processing.ts:154`) is just `"Montserrat"` with no var wrapper — two different
   shapes flow through the same field depending on whether a user touched the dropdown. For
   system fonts, there is no CSS var to wrap — the value should simply become the bare family
   name everywhere, and the parsing hack in both Python files should be deleted once
   `FONT_OPTIONS` stops emitting CSS var strings. This is the natural point to fix the
   duplication between the two Python code paths (send both through
   `build_subtitle_filter`/`SubtitleStyleConfig`).
2. **Font family name vs display name mismatches.** libass's `FontName=` must match the exact
   family name libass's font source (fontconfig/DirectWrite/fontsdir scan) knows the font by —
   this is not always the same string as a font's marketing name or filename (e.g. "Bebas
   Neue" the CSS family vs `BebasNeue-Regular.ttf` the filename vs whatever name Windows'
   registry lists it under). Always resolve via the font file's own `name` table (fontTools)
   rather than trusting filenames or UI labels, for both curated and system fonts.
3. **6 of the current 11 dropdown fonts don't actually preview correctly today** (Poppins,
   Anton, Rubik, Nunito, Lato, Inter have no font asset registered anywhere in the frontend) —
   worth fixing as part of this work regardless of scope, since the new curated list will
   replace `FONT_OPTIONS` wholesale anyway.
4. **Variable fonts.** Google Fonts increasingly ships variable fonts (single file, weight/
   width axes). `next/font/google` handles this transparently for preview. libass/FFmpeg's
   font handling (fontconfig-based or fontsdir-based) has historically had partial/fragile
   support for variable font weight axes — safest curated-bundle choice is static-weight
   `.ttf`/`.otf` instances (e.g. pick the Bold + Regular static cuts) rather than a single
   variable font file, so `Bold=1` in the ASS style reliably maps to an actual bold glyph set
   instead of libass guessing an axis value.
5. **Cross-machine portability of system fonts.** If a project references a Windows-installed
   font and is later opened on a machine without that font installed (different PC, or a
   future non-Windows build), both preview and render need a defined fallback — e.g. preview
   CSS naturally falls back to `sans-serif` (silent, looks different, no error), render
   would either silently substitute (if fontsdir copy is missing, libass's own fallback logic
   kicks in and picks *something*) or fail. Recommend: at render time, if the font file can't
   be located for a system-font selection, log a warning and fall back to a default curated
   font rather than let libass substitute silently — surfacing this to the user (e.g. "Font X
   not found, used Y instead") avoids a support-ticket-shaped surprise. Store enough metadata
   (family name at minimum) with each project so a future "missing font" banner is possible.
6. **`fontsdir` scan cost.** libass scans the entire `fontsdir` directory on each render
   invocation. Keep the curated+copied-system-fonts directory lean (only the fonts actually
   referenced by the current project, or accept the curated set's fixed size ~20-40 files —
   negligible either way) rather than mirroring all of `C:\Windows\Fonts` (hundreds of files,
   meaningfully slower).
7. **Electron Local Font Access permission UX.** `local-fonts` requires a one-time user
   permission grant (browser-standard prompt) the first time it's invoked in a session/profile
   — needs a sensible empty-state / retry affordance in the font picker UI, not just a blank
   list on first run or if denied.
8. **The legacy `add_subtitles` path is not dead code.** Any implementation must update
   `app/services/video_processor.py:1145` (and its 3 call sites) alongside
   `subtitle_styler.py`, or leave a render path where system/curated fonts silently don't work
   depending on which pipeline branch a given render takes.

## 4. Implementation steps (suggested order)

1. Fix the `add_subtitles`/`build_subtitle_filter` duplication first (route
   `video_processor.py:1145` through `SubtitleStyleConfig`/`build_subtitle_filter`) — this is
   the root-cause fix that makes every subsequent font change apply in exactly one place.
2. Normalize `FONT_OPTIONS` values to bare family names (drop the CSS var wrapper); delete the
   now-redundant CSS-var-stripping code in both Python files.
3. Pick and bundle the curated font set (20-40 OFL-licensed `.ttf`/`.otf` files) under
   `app/assets/fonts/` (or similar); wire into `electron-builder` `extraResources`
   (`electron/package.json`) alongside the existing ffmpeg entries.
4. Add `fontsdir=<bundled fonts dir>` to both render filter strings; verify curated fonts
   render correctly (visual check, not just "ffmpeg didn't error").
5. Self-host the same curated font files for preview via `@font-face` (or `next/font/google`
   where available) so preview and render share one asset source.
6. Add Electron `local-fonts` IPC channel + preload bridge method; wire a "System fonts"
   section into the dropdown/picker UI (likely worth a searchable combobox given 100+
   entries, replacing the current plain `<Select>`).
7. Add the copy-to-fontsdir-before-render step for a chosen system font (resolve file path via
   fontTools name-table lookup over `C:\Windows\Fonts`, matched against the family name
   returned by `local-fonts`).
8. Add the missing-font fallback + warning path for cross-machine portability (Pitfall 5).

## 5. Acceptance criteria

- Selecting any of the curated 20-40 fonts in the dropdown shows the correct typeface in both
  the live preview (`variant-preview-player.tsx`) and the final rendered MP4, verified by
  visual comparison for a sample of at least 5 fonts spanning serif/sans/display styles.
- Selecting a Windows-installed font not in the curated set (e.g. a font only present via
  Adobe Fonts sync or a manually installed `.ttf`) renders correctly in preview and in the
  final MP4 on the same machine.
- A project referencing a system font that is later opened on a machine lacking that font
  falls back to a defined default font rather than crashing the render or silently picking an
  unrelated libass fallback, and the user is informed which font was substituted.
- `add_subtitles` (`video_processor.py`) and `build_subtitle_filter`
  (`subtitle_styler.py`) no longer contain independent copies of font-name-parsing logic —
  one shared code path.
- No regression in render time beyond the cost of one bounded `fontsdir` scan (curated set +
  at most one copied system font per render).
