# Transitions V1 — implementation details

Companion to `goals/transitions-prompt.md`. This file is a **binding part of the brief**: phase specs, exact file:line map, ffmpeg mechanics, gotchas, out-of-scope list. All paths relative to `C:\obSID SRL\n8n\edit_factory`.

## Context — verified code map (2026-07-18)

- `frontend/src/types/composition-timeline.ts:9` — `CompositionClip` (id, kind `intro|body`, source refs, `start_time/end_time` in source, `timeline_start/timeline_duration` on output clock, `transforms`, `pinned`). This is the composition model saved/restored as JSON.
- `app/services/assembly_service.py:107` — `TimelineEntry` dataclass (backend mirror of a clip).
- `app/services/assembly_service.py:2110-2250` — `extract_segment()`: per-segment ffmpeg extraction+normalization (`-vf` transform chain, `TARGET_FPS=30`, cfr, `yuv420p`, timescale 15360, `-an`, exact `-t needed_duration`). **This is where P1 fade filters go.**
- `app/services/assembly_service.py:2165-2174` — segment cache key (`segment_cache.make_key`). **Any fade params MUST enter this key** or edited transitions serve stale cached segments.
- `app/services/assembly_service.py:2388-2416` — concat: `-f concat` + `-c copy` over `concat_list.txt`. The fast path. P1 must leave it byte-identical.
- `app/services/assembly_service.py:2325-2362` — interstitial slides are generated and **inserted into `segment_files` after composition**, so final concat indices ≠ composition clip indices. V1: slide boundaries are NOT configurable.
- `app/services/assembly_service.py:2418+` — attention overlays applied as a separate pass **after** concat → "transitions under overlays/subtitles" is already guaranteed by architecture; build nothing for it.
- `app/services/assembly_service.py:2411` — preview concat timeout 120s; preview mode uses ultrafast/crf28 (`:2153-2161`).
- `app/api/pipeline_routes.py:8519-8599` — pydantic body with `video_timeline: List[dict]` + per-clip normalization loop (`:8553`). **This is where backend allowlist validation goes.** Also `:2615`, `:5656`, `:8423-8450` (save/restore paths that must round-trip the new field).
- `frontend/src/components/timeline-editor.tsx:898-925` — `prepareSlot()`: ping-pong preview, idle slot pre-seeked but **paused** ("Only the active slot ever plays", `:935`). P1 preview needs NO dual playback; P2 (dissolve, out of scope) would.
- FFmpeg bundled: BtbN `ffmpeg-master-latest-win64-gpl` (has `fade`, `xfade`).

## Data model (P0)

On `CompositionClip` (frontend) + `TimelineEntry` (backend), optional field:

```ts
transitionIn?: { kind: "dip_black" | "flash_white"; durationMs: number } | null
```

- Semantics: the transition **into** this clip (boundary between previous clip and this one). First clip: field ignored/absent.
- Absent/null = hard cut → all existing compositions keep working, **no DB migration** (composition is stored as JSON).
- Backend validation (pydantic, at `pipeline_routes.py:8553` loop + any other video_timeline ingress): `kind` strictly from the allowlist; `durationMs` int, clamped to [150, 600]; anything else → 422. **Never interpolate user strings into an ffmpeg filtergraph.**
- Duration presets surfaced in UI: Fast=200 / Normal=350 / Slow=500 (flash_white default 200). Store the ms value, not the label.
- Thread the field through every existing touchpoint: composition save/restore + history/undo, preview request, final render request, and the **segment cache key** (`:2165`).
- Per-variant default in the same settings blob where variant assembly settings already live: `defaultTransition?: { kind, durationMs } | null` (null = hard cuts, the default). Per-boundary `transitionIn` overrides it; a sentinel/absence means "use variant default" — resolve to concrete values **before** building the render/preview request so backend never sees indirection.

## P1 render mechanics — the no-overlap family only

`dip_black` and `flash_white` are **not crossfades**: fade-out on the tail of clip N−1 + fade-in on the head of clip N, no overlap, so **timeline duration is unchanged by construction** and the concat `-c copy` fast path survives.

- Before extraction, compute per-entry fade specs from neighbors: entry i gets `fadeOut` if clip i+1 has `transitionIn` (duration = durationMs/2, color black or white), and `fadeIn` if clip i itself has `transitionIn`.
- Apply as `fade=t=in/out:st=…:d=…:color=…` appended to the existing `-vf` chain in `extract_segment()` (`:2213`/`:2222`). `st` for fade-out = `needed_duration − d` (output-clock relative, i.e. after setpts/speed remap — verify against the transform chain).
- Fade specs go into `segment_cache.make_key` (`:2165-2174`).
- Concat stage untouched. If NO clip has a transition, the entire pipeline must be byte-identical to today (assert: same filters, `-c copy` still used).
- **Intro clips** (`kind === "intro"`, the rapid-intro micro-clips): transitions disabled — UI doesn't offer them, backend strips/rejects `transitionIn` on intro clips and on any boundary where either side is shorter than 2×durationMs (fades would eat the whole clip).
- Interstitial slide boundaries: not configurable in V1; slides keep current behavior.

## P1 instant preview (timeline-editor.tsx)

No dual playback needed: render a full-viewport overlay `<div>` (black or white) above the preview slots, opacity animated from the same master clock that drives boundary switching — fade to 1 over the last durationMs/2 of clip N−1, switch slots at the boundary exactly as today, fade back to 0 over the first durationMs/2 of clip N. Driven by the clock (rAF/timeupdate already in use), not CSS keyframes, so scrub/pause stay correct. The FFmpeg preview path needs no special handling — it renders fades via the same `extract_segment` code and stays ground truth.

## P1 UI (Step 3)

- **Assembly Settings**: `Default transition` select (None / Dip to black / Flash white) + `Duration` (Fast/Normal/Slow). Scope: this variant. Plus `Apply to all cuts` action (stamps the default onto every eligible boundary as explicit overrides — optional if default-resolution already covers it; implementer's call, but the two must not fight).
- **Timeline**: small marker on each boundary between two body clips. Click → popover: type (Cut / Dip to black / Flash white), duration preset, `Use variant default`, visual state showing whether boundary is cut/default/override.
- English copy only. Follow existing Step 3 idioms (selects/popovers already in `timeline-editor.tsx` / step3 components). No new dependencies.

## Acceptance (all must hold)

1. **Duration invariant**: same composition rendered with ~10 transitions vs none → ffprobe durations equal ±1 frame (33ms). Automated test against real ffmpeg (testing/ conventions).
2. **Fast path intact**: composition with zero transitions → concat still `-c copy` (assert on the built command or code path).
3. **Cache correctness**: changing only a boundary's transition changes the affected segments' cache keys (test on `make_key` inputs).
4. **Validation**: unknown kind → 422; durationMs out of [150,600] → 422/clamped; `transitionIn` on intro clip → stripped/rejected; legacy composition without the field → parses, renders as today.
5. **Round-trip**: save → reload composition preserves `transitionIn` and variant default; history/undo includes transition edits.
6. **Visual verification (clause D)**: in the running app — set a default, override one boundary, observe instant preview fade AND FFmpeg preview fade; screenshots. Confirm subtitles/overlays do NOT fade (they're a later pass — just verify, don't build).
7. Repo checks green for touched areas (backend pytest, frontend lint/typecheck/build).

## Constraints & gotchas (binding)

- **NEVER `git push`** (push = auto-deploy). Local commits only.
- No new dependencies. No GL Transitions, no asset packs, no Remotion, no downloaded effects.
- ffmpeg filter args built only from the validated allowlist + numeric ms — never from raw user strings.
- Don't touch: concat fast path semantics, interstitial slide generation, attention overlay pass, subtitle pipeline, the web repo (`social-scheduler`).
- Preview mode timeouts (`:2155-2156`, `:2411`) unchanged — P1 adds no re-encode cost beyond the fade filter itself.
- Windows paths in concat lists are already normalized (`:2392-2395`) — don't regress.

## Out of scope (do NOT build)

- **Cross dissolve / slide / zoom / any `xfade` overlap transition** — deliberately deferred (overlap ⇒ handles, duration contract, dual-playing preview slots; separate goal).
- Random/Auto transition assignment.
- Transitions on interstitial slide boundaries.
- Audio crossfades (voiceover is a separate track; nothing to do).
- Per-transition direction knobs, custom durations outside the three presets.
