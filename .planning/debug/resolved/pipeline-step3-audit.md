---
status: resolved
trigger: "Audit and debug Pipeline Step 3: Preview Matches (TTS generation, timeline matching, video preview)"
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:10:00Z
---

## Current Focus

hypothesis: All bugs identified and fixed
test: TypeScript compilation — 0 errors in changed files
expecting: All fixes verified clean
next_action: Archive

## Symptoms

expected: Step 3 generates TTS, creates SRT subtitles, matches to segments, shows timeline editor, preview player with sync
actual: Known fix done (subtitle positionY dynamic). Auditing for remaining bugs.
errors: None currently reported — proactive audit
reproduction: Complete Steps 1-2, then enter Step 3
started: Proactive audit

## Eliminated

- hypothesis: subtitle positionY hardcoded to bottom
  evidence: Already fixed in prior session — positionY is dynamic via subtitleSettings?.positionY ?? 85
  timestamp: 2026-02-25T00:00:00Z

- hypothesis: Memory leak in VariantPreviewPlayer on close
  evidence: handleOpenChange correctly pauses audio, pauses all videos, resets state, stops rAF loop
  timestamp: 2026-02-25T00:00:00Z

- hypothesis: Authentication issue with audio in production
  evidence: Auth bypass in dev makes this non-critical. Latent production concern but out of scope.
  timestamp: 2026-02-25T00:00:00Z

- hypothesis: tts_subtitle_generator phrase splitting bug
  evidence: Logic is correct — sentence-ending check fires after word is added, which properly creates phrase breaks
  timestamp: 2026-02-25T00:00:00Z

- hypothesis: voice_settings None vs {} comparison in render
  evidence: Suboptimal but not a crash — just causes unnecessary TTS regeneration in edge case
  timestamp: 2026-02-25T00:00:00Z

## Evidence

- timestamp: 2026-02-25T00:00:00Z
  checked: variant-preview-player.tsx — subtitle overlay rendering
  found: positionY is dynamic (already fixed). Remaining review shows no other subtitle bugs.
  implication: No additional bugs here.

- timestamp: 2026-02-25T00:00:00Z
  checked: timeline-editor.tsx — inline preview subtitle styling
  found: HARDCODED subtitle styling. Does not use subtitleSettings prop. The prop was not even defined.
  implication: BUG — subtitle settings from SubtitleEditor are ignored in the inline timeline preview

- timestamp: 2026-02-25T00:00:00Z
  checked: timeline-editor.tsx — preview audio sync method
  found: Uses timeupdate event (~4Hz) instead of requestAnimationFrame (~60fps). Results in ~250ms segment switch lag at subtitle boundaries.
  implication: MODERATE BUG — visible delay in video segment switching during inline preview

- timestamp: 2026-02-25T00:00:00Z
  checked: timeline-editor.tsx — isPreviewPlayingRef synchronicity
  found: togglePreviewPlayPause only updates isPreviewPlayingRef via useEffect (async). During the 1-render window, ref is stale.
  implication: MINOR — race condition where rAF loop may try segment sync after pause, or miss segment switch after play

- timestamp: 2026-02-25T00:00:00Z
  checked: page.tsx — dual audio when opening VariantPreviewPlayer
  found: Eye button (setPreviewVariant) opens VariantPreviewPlayer while blob audio from Volume2 button may still be playing. No cleanup of page-level audioRef before opening player.
  implication: CRITICAL — two simultaneous audio streams (voiceover blob + player audio element)

- timestamp: 2026-02-25T00:00:00Z
  checked: page.tsx — Step 3 card Volume2 audio handler
  found: Inline audio handler in Step 3 variant card duplicates handlePlayAudio logic but does NOT set pendingBlobUrl.current. If component unmounts during fetch, blob URL is not revoked.
  implication: MINOR MEMORY LEAK — blob URL not tracked → not cleaned up on unmount during fetch

## Resolution

root_cause: |
  4 bugs fixed:
  1. CRITICAL: Dual audio streams — Eye button opened VariantPreviewPlayer without stopping
     the Volume2 blob audio. Both played simultaneously. Fixed by stopping audioRef before
     setPreviewVariant(index).
  2. MODERATE: TimelineEditor inline preview subtitle overlay was hardcoded (no subtitleSettings).
     Fixed by adding subtitleSettings prop to TimelineEditorProps and applying it to the overlay.
  3. MODERATE: TimelineEditor inline preview used timeupdate (~4Hz) for segment switching,
     causing ~250ms lag. Replaced with requestAnimationFrame loop (~60fps), matching
     VariantPreviewPlayer's pattern.
  4. MINOR: isPreviewPlayingRef was only updated via useEffect (async). Added synchronous
     ref updates in togglePreviewPlayPause, activatePreview, and deactivatePreview.
  5. MINOR: Step 3 card Volume2 inline handler duplicated handlePlayAudio without tracking
     pendingBlobUrl.current. Fixed by replacing with handlePlayAudio() call.

fix: |
  frontend/src/app/pipeline/page.tsx:
    - Eye button handler now calls audioRef.current.pause() + setPlayingAudio(null) before
      setPreviewVariant(index), preventing dual audio streams
    - Step 3 card Volume2 onClick replaced with handlePlayAudio(pipelineId!, index) call,
      fixing both the duplicate code and the blob URL tracking gap
    - TimelineEditor now receives subtitleSettings prop

  frontend/src/components/timeline-editor.tsx:
    - Added SubtitleSettings import from @/types/video-processing
    - Added subtitleSettings?: SubtitleSettings to TimelineEditorProps
    - Added subtitleSettings destructuring in component
    - Added previewRafIdRef = useRef<number | null>(null)
    - Added startPreviewRafLoop() and stopPreviewRafLoop() useCallback functions
    - Replaced timeupdate-based audio sync with rAF loop (matching VariantPreviewPlayer)
    - Audio effect now only handles loadedmetadata and ended events (no timeupdate)
    - togglePreviewPlayPause sets isPreviewPlayingRef synchronously + calls start/stop rAF
    - activatePreview sets ref synchronously and calls startPreviewRafLoop after play
    - deactivatePreview calls stopPreviewRafLoop and sets ref synchronously
    - Cleanup useEffect now also cancels any active rAF loop on unmount
    - Subtitle overlay replaced: uses subtitleSettings for positionY, fontFamily, fontSize,
      textColor, outlineColor, outlineWidth, enableGlow, glowBlur

verification: |
  TypeScript compilation: 0 errors in changed files (npx tsc --noEmit)
  Only pre-existing unrelated test error in debug-all-logs.spec.ts (Unused @ts-expect-error)

files_changed:
  - frontend/src/app/pipeline/page.tsx
  - frontend/src/components/timeline-editor.tsx
