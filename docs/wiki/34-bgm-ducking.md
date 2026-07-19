# Background music (A2) with auto-ducking — Phase B

Date: 2026-07-19 · Branch: `feat/multitrack-timeline`

## What changed

The render chain had **no music input anywhere** (a deliberate skip from
2026-07-11). Phase B adds per-variant background music on the A2 lane: pick a
track, it plays under the voiceover, and it automatically ducks (drops in
volume) while the voice speaks. The mix is server-rendered, so the Step 3
preview and the Step 4 render carry the identical audio.

## Filtergraph

The voice chain is unchanged when there is no music (legacy `-af` path, zero
regression). When a track is present, `_render_with_preset` swaps the voice
`-af` for a `-filter_complex` built by `build_audio_mix_filter`
(`app/services/audio/mix.py`). Input index contract: `0=video`, `1=voice`,
`2=music`.

Ducking ON:

```
[1:a]<loudnorm,volume,afade voice chain — unchanged>[voice];
[2:a]volume=<mv>,afade in/out[m0];
[voice]asplit[vo][sc];
[m0][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[duck];
[vo][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]
```

Ducking OFF skips the `sidechaincompress` node (`[voice][m0]amix=…`).

Key invariants:

- **loudnorm stays first on the voice** — user filters apply after it, exactly
  as the voice-only path did, so normalization never cancels them.
- `music_loop=true` prepends `-stream_loop -1` on the music input; `amix=
  duration=first` plus the caller's existing `-t <voice_dur>` keep the output
  duration **identical** to a no-music render (the loop is trimmed back).
- `music_loop=false` lets a short track play once and fall silent.
- `alimiter=limit=0.95` brickwalls the summed mix.
- Music only engages when a **real voiceover** exists (mixing over an infinite
  `anullsrc` would make `duration=first` never terminate).
- Applied on **both** encode branches (single-pass and VBR two-pass pass 2)
  through the same helper; preview mode reuses the same graph minus loudnorm
  (loudnorm is already skipped from the voice chain in preview).

The video filter chain is untouched — `-vf scale/crop/subtitles` coexists with
the audio `-filter_complex` (verified by the ffmpeg smoke test).

## Data flow & caching

- `MusicSettings` (pydantic + TS): `assetId`, `assetUrl?`, `label?`, `volume`
  (0–3, default 0.3), `ducking` (default true), `fadeInMs`, `fadeOutMs`,
  `loop` (backend-default true, no UI toggle). Fades are milliseconds on both
  sides.
- `PreviewRenderRequest.music` and `PipelineRenderRequest.music_overrides`
  (keyed like `composition_overrides`: `"0"`, `"0_A"`).
- **Persistence is additive, no DB migration**: the composition save stores it
  in `preview_data['music']`; `restore-previews` returns it; the frontend
  round-trips it through the same debounced composition PUT as
  `default_transition`.
- Music enters **both** cache fingerprints (the preview payload and
  `_compute_render_fingerprint`) together with a local-file **mtime** (mirrors
  the TTS `audio_mtime` pattern), so swapping a track — or an in-place file
  change — invalidates the preview cache.

## Music asset source (reused, not invented)

Music reuses the **Blipost platform media library** — the same
`/platform/media` + `/platform/media/upload` endpoints the attention-image
picker uses, filtered to `kind=audio`. The upload guard was widened to accept
`audio/` alongside image/video. The picker also offers a direct-URL tab (works
offline / without a connected cloud account). The backend resolves
`assetUrl`/`assetId` (URL or local path) to a local file via
overlay_renderer's content-agnostic downloader — no new storage.

## UI

The A2 lane (formerly a "coming soon" stub) shows a full-width amber block
(music icon + label, fade-ramp gradients at the ends) when a track is set, and
an empty "+" affordance otherwise. Selecting it opens the **Music inspector**
(pick/clear, volume, ducking toggle default ON, fade in/out) in the shared
inspector slot — `selectedMusic` joins the clip/slide/block mutual-exclusion
selection. The preview does not mix music client-side; the server-rendered
preview carries it.

## Limits

- One music track per variant (single A2 lane, spans the whole timeline).
- Ducking params are fixed sane defaults (no per-user tuning).
- No bundled royalty-free tracks (skipped as non-trivial; use library or URL).
- Music without a voiceover is intentionally a no-op.

## Operational note

The backend must be **restarted** to pick up the new routes/models
(`_render_with_preset` music params, `MusicSettings`, `music_overrides`, the
widened upload guard).
