# Engineering Change Log

## 2026-07-12 â€” Pacing control and timeline card labels

- Added persisted Fast/Normal/Slow Step 3 pacing that re-runs preview matching
  and is shared with preview rendering and final rendering.
- Replaced visible phrase-index timeline labels with content-focused labels and
  compact duration metadata while retaining indices in hover tooltips.

See [Preview/render segment parity](12-preview-render-parity.md).

## 2026-07-12 — Preview/render segment parity

- Matched library footage once per merge group and expanded the shared selection to per-phrase preview data.
- Added overlap-aware visual clusters, cooldown relaxation reporting, and an amber low-variety warning in Step 3.

See [Preview/render segment parity](12-preview-render-parity.md).
## 2026-07-12 - Step-3 MP4 subtitle-style fidelity

- Changed the variant-preview MP4 request to submit the resolved A/B subtitle-style object shown by the editor, including karaoke fields.
- Kept the Meta visual version for segment selection and cache addressing while preventing a second backend Meta overlay from replacing the submitted style.
- Preserved the legacy backend fallback for non-Step-3 callers and verified the focused preview/frame tests plus the frontend typecheck.

See [Subtitle preview scaling](09-subtitle-preview-scaling.md).

## 2026-07-12 — Subtitle frame-preview parity verification

- Measured the exact frame-preview and preview-render FFmpeg chains with FontSize=107; both preserve the same glyph-to-frame ratio.
- Confirmed the frame-preview endpoint keeps `original_size=1080x1920`, matching the render path, and that the frontend sends raw font-size values.
- Reactivated and updated the endpoint regression test to guard the shared subtitle reference.

See [Subtitle preview scaling](09-subtitle-preview-scaling.md).

## 2026-07-12 — Session navigation cache

- Added a profile-scoped, renderer-memory cache to the shared API client so data already loaded by any sidebar section is reused when returning to it.
- Excluded live status, progress, health, log, and event reads from the cache.
- Cleared the shared cache after every API write to keep subsequent page visits authoritative.
- Preserved Pipeline source videos across the Pipeline → Segments → Pipeline flow and kept their cache fresh after source-video library changes.
- Restored the selected source video when returning to Segments through the sidebar.

See [Session navigation cache](10-session-navigation-cache.md).

## 2026-07-11 — Desktop application health audit

- Made API tests independent of the developer's SQLite database and updated stale tests to the repository, encoding, subtitle, scoring, and desktop-path contracts.
- Restored Next.js 16 lint compliance, isolated `.next-dev` output from ESLint, and verified lint/typecheck plus a production standalone build.
- Aligned the desktop pairing copy with the web Settings heading and added accessible names to the bridge controls.
- Changed desktop unpairing to revoke the web runner before deleting its local token; offline failures keep the token so the action can be retried.
- Moved the conditional ML gate before repository access so rejected voice-mute requests do not touch SQLite.
- Recorded the remaining dirty-overlap blockers and the safe Electron bundle restoration procedure.

See [Desktop application health audit](08-desktop-health-audit.md).

## 2026-07-11 — Segments editor video and timeline redesign

- Rebuilt the source-video player with the source aspect ratio, integrated controls, and a non-overlaying black playback bar.
- Replaced the flat timeline with a filmstrip, centered waveform, numbered segment ranges, time labels, and a high-contrast playhead.
- Changed the waveform to neutral gray outside saved segments and lime only inside saved ranges.
- Made Source Videos, the center editor, Segments Library, and the video/timeline split resizable.
- Reworked deleted-segment undo so `Ctrl+Z` remains retryable after an API failure and restores important segment metadata.
- Added a visible Undo action after deletion and corrected the delete confirmation copy.

See [Segments editor: video, timeline, resizing, and undo](07-segments-editor-timeline.md).

## 2026-07-11 — Desktop startup and subtitle preview first paint

- Removed the implicit production frontend build from Electron `start`/`dev`; desktop startup no longer fails when Google Fonts cannot be downloaded.
- Added shared first-layout and `ResizeObserver` measurement for subtitle previews.
- Migrated subtitle and timeline editors to the shared reactive measurement hook.
- Added regression coverage for synchronous first-paint height and later resize updates.

See [Desktop startup and subtitle preview reliability](06-desktop-preview-reliability.md).

## 2026-07-12 — Subtitle preview scaling

- Unified the CSS subtitle scaling contract around one 1920px reference height and a shared minimum-aware helper.
- Timeline overlays now consume ResizeObserver-backed container height and re-scale in compact and expanded previews.
- Kept backend subtitle rendering unchanged as the pixel ground truth.

See [Subtitle preview scaling](09-subtitle-preview-scaling.md).

## 2026-07-12 — Subtitle Style panel restructure

- Large sticky A/B preview cards (click to select which Meta version you edit) replacing the small previews with dead space below.
- Drag-to-position: subtitle text draggable vertically on the active preview, mapped to positionY.
- Controls regrouped into Text / Position / Effects; duplicated heading removed; RO helper text translated.
- Full-width font picker with per-option font rendering; Load system fonts as adjacent button.
- Saved presets unified into the visual preset grid (delete affordance, Apply preset dropdown removed) and applied to the active A/B version.
- Karaoke-only Highlight Color control added (backend highlightColor was previously unreachable).

See [Subtitle Style panel](11-subtitle-style-panel.md).

## 2026-07-12 — Expanded preview subtitle under-scaling

- Split the shared preview height measurement into per-view hook instances (compact vs expanded) with a callback-ref observer, fixing subtitles rendering ~2.3x too small in the Expanded Preview dialog.

See [Subtitle preview scaling](09-subtitle-preview-scaling.md).
