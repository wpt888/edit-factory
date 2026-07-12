# Engineering Change Log

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
