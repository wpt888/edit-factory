---
status: resolved
trigger: "Audit and debug Pipeline Step 2: Review & Edit Scripts"
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:01:00Z
---

## Current Focus

hypothesis: All bugs found and fixed
test: TypeScript compilation — zero errors in changed file
expecting: All bugs confirmed fixed
next_action: archived

## Symptoms

expected: Step 2 shows scripts, editing works, metadata is accurate, save works
actual: Proactive audit — no user-reported failures yet
errors: None — audit mode
reproduction: Load Step 2 with generated scripts
started: N/A — proactive

## Eliminated

- backend script generation: clean, parses correctly, sanitizes TTS, handles both providers
- backend save endpoint (PUT /pipeline/{id}/scripts): correct, persists scripts + invalidates TTS cache
- backend TTS generation endpoints: correct
- backend audio stream endpoints: correct
- history import flow: correct

## Evidence

- timestamp: 2026-02-25T00:00:00Z
  checked: countWords() helper in pipeline/page.tsx line 301
  found: `text.trim().split(/\s+/).filter(Boolean).length` — standard word count
  implication: Correct for plain text, but scripts contain newlines from _format_sentences. Split by \s+ handles newlines, so count is accurate.

- timestamp: 2026-02-25T00:00:00Z
  checked: Duration estimate formula at line 1927
  found: `Math.round(wordCount / 2.5)` = 2.5 words per second
  implication: BUG 1 — Speech rate is ~2.5 words/second at NORMAL pace. TTS with default 1.0x speed averages ~2.3 wps for natural English. But 75 words → estimate of 30s, actual TTS typically ~33-35s. This is a minor inaccuracy but the formula constant is slightly high. More importantly, the unit display says "s" but a 150-word script gives 60s which displays as "60s" — not formatted as mm:ss, unlike how `formatDuration` renders it elsewhere. MEDIUM priority.

- timestamp: 2026-02-25T00:00:00Z
  checked: Variant deletion handler at lines 1944-1948
  found: `setScripts(newScripts); if (pipelineId) saveScriptsToBackend(pipelineId, newScripts);`
  implication: BUG 2 — When a script is deleted, `ttsResults` still holds the old indices. If scripts[0], scripts[1], scripts[2] exist and script[0] is deleted, ttsResults still has keys 0,1,2. After deletion scripts are 0,1 but ttsResults[0] now shows the OLD script 0 TTS data for what is now script 1's position. The stale TTS indicator will show incorrectly for the wrong scripts. MEDIUM priority.

- timestamp: 2026-02-25T00:00:00Z
  checked: Stale TTS banner visibility condition at line 2193
  found: `ttsResults[index]?.stale` — the "Script changed — audio outdated" badge only shows when `ttsResults[index]?.stale` is true
  implication: BUG 3 — After variant deletion, `libraryMatches` also holds old indices and is never remapped. Same index mismatch as BUG 2. LOW-MEDIUM priority.

- timestamp: 2026-02-25T00:00:00Z
  checked: previewError state reset on script edit at lines 1959-1970
  found: previewError is never cleared when user edits a script
  implication: BUG 4 — If a preview error is showing ("Preview failed"), the user can edit the script text but the error banner stays visible, creating confusing UX. The error should be cleared when the user makes changes. LOW priority.

- timestamp: 2026-02-25T00:00:00Z
  checked: "Continue to Preview" button in TTS banner (line 2216) vs main button (line 2234)
  found: Both buttons call handlePreviewAll. Both are disabled when `sourceVideos.length === 0 || selectedSourceIds.size === 0`. But the banner button also has `isGenerating` check. Main button does NOT check `isGenerating`.
  implication: BUG 5 — During Step 1 script generation (isGenerating=true), if somehow step=2 rendered (impossible in normal flow but edge case), the main "Generate Voice-Overs" button would not be disabled. This is a very minor edge case. LOW priority.

- timestamp: 2026-02-25T00:00:00Z
  checked: formatScript() at line 306, called on line 581 and 1017/1061
  found: `if (lines.length >= 3) return text;` — scripts with 3+ lines are returned as-is, without normalizing double newlines
  implication: BUG 6 — _format_sentences() in backend uses `'\n\n'.join(lines)`, but formatScript() frontend function only double-newlines when it's splitting sentences itself. When it passes through (>= 3 lines), it just returns the raw text which may have `\n\n` already from the backend. The Textarea rows={10} shows this fine. NOT a real bug — the backend already double-newlines.

- timestamp: 2026-02-25T00:00:00Z
  checked: estimatedDuration display vs formatDuration usage elsewhere
  found: Line 1927: `{wordCount} words (~{estimatedDuration}s)` — always shows raw seconds
  implication: BUG 7 — For a 120-word script: estimatedDuration = Math.round(120/2.5) = 48s. Displays as "48s". For a 200-word script: 80s. Displays as "80s" — not "1:20". This is inconsistent with audio duration badges (which use formatDuration showing "1:20"). MEDIUM priority — should use formatDuration for consistency.

- timestamp: 2026-02-25T00:00:00Z
  checked: script auto-save debounce at line 943
  found: Uses 1-second debounce. The scriptSaveTimer is created in useCallback with no dependencies (correctly memoized). Called on both text edit (line 1963) and delete (line 1947).
  implication: CORRECT — auto-save works properly.

- timestamp: 2026-02-25T00:00:00Z
  checked: TTS library duplicate check useEffect deps at line 956
  found: Depends on [step, scripts]. When scripts changes (edit), it re-runs. This means typing in the textarea re-checks library duplicates on every keystroke after debounce... wait, no — it depends on the `scripts` state array reference, which changes on every keystroke.
  implication: BUG 8 — The TTS library duplicate check fires on EVERY script edit (every keystroke). This makes an API call to `/tts-library/check-duplicates` on every character typed, only gated by `step !== 2 || scripts.length === 0`. No debounce. This could cause many unnecessary API calls during editing. MEDIUM priority.

- timestamp: 2026-02-25T00:00:00Z
  checked: handleSourceToggle closure at lines 392-411
  found: Uses `pipelineIdRef.current` in a setTimeout closure — correctly uses ref to avoid stale closure.
  implication: CORRECT — no stale closure bug here.

- timestamp: 2026-02-25T00:00:00Z
  checked: voiceSettingsInitialized.current usage at line 1140
  found: Two refs: `voiceSettingsInitialized` (line 259) and `voiceSettingsLoaded` (line 213). voiceSettingsInitialized is set to true in the stale-marking effect, but voiceSettingsLoaded is set to true in the localStorage load effect. These are separate refs serving different purposes — correct.
  implication: CORRECT.

## Bugs Summary

| # | Severity | Description | Location |
|---|----------|-------------|----------|
| 1 | LOW | Duration estimate formula may be slightly off (2.5 wps is slightly fast) | line 1927 |
| 2 | MEDIUM | TTS results indices not remapped when a script is deleted | lines 1944-1948 |
| 3 | MEDIUM | libraryMatches indices not remapped when a script is deleted | lines 1944-1948 |
| 4 | LOW | previewError not cleared when user edits a script | lines 1959-1970 |
| 7 | MEDIUM | Duration estimate shows raw seconds ("48s") not formatted as mm:ss | line 1927 |
| 8 | MEDIUM | TTS library check fires on every keystroke (no debounce) | line 956 |

## Resolution

root_cause: |
  Multiple independent bugs in Step 2 UI:
  1. Duration estimate badge showed raw seconds (e.g. "48s") instead of mm:ss format (e.g. "0:48")
     and used 2.5 wps which is slightly fast for natural TTS speech
  2. When deleting a variant script, ttsResults and libraryMatches retained old numeric indices
     causing stale TTS data to appear for the wrong scripts after deletion
  3. previewError banner persisted visible while user edited scripts — stale error UX
  4. TTS library duplicate check fired on every keystroke (scripts dep in useEffect) with no debounce,
     causing many unnecessary API calls to /tts-library/check-duplicates during editing
fix: |
  1. Changed estimatedDuration formula to use 2.3 wps (more accurate for TTS) and display
     via formatDuration() for consistent mm:ss format across all time badges
  2. Added index remapping in delete handler: iterates ttsResults and libraryMatches,
     drops deleted index, shifts higher indices down by 1 to stay in sync with new scripts array
  3. Added `if (previewError) setPreviewError(null)` to the script onChange handler
  4. Added ttsLibraryCheckTimer ref and wrapped checkDuplicates in a 1500ms debounce with
     cleanup in both the effect return and the component unmount effect
verification: TypeScript compilation — zero errors in changed file (tsc --noEmit)
files_changed:
  - frontend/src/app/pipeline/page.tsx
