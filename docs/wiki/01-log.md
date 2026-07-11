# Engineering Change Log

## 2026-07-11 — Desktop application health audit

- Made API tests independent of the developer's SQLite database and updated stale tests to the repository, encoding, subtitle, scoring, and desktop-path contracts.
- Restored Next.js 16 lint compliance, isolated `.next-dev` output from ESLint, and verified lint/typecheck plus a production standalone build.
- Aligned the desktop pairing copy with the web Settings heading and added accessible names to the bridge controls.
- Changed desktop unpairing to revoke the web runner before deleting its local token; offline failures keep the token so the action can be retried.
- Moved the conditional ML gate before repository access so rejected voice-mute requests do not touch SQLite.
- Recorded the remaining dirty-overlap blockers and the safe Electron bundle restoration procedure.

See [Desktop application health audit](08-desktop-health-audit.md).

## 2026-07-11 — Desktop startup and subtitle preview first paint

- Removed the implicit production frontend build from Electron `start`/`dev`; desktop startup no longer fails when Google Fonts cannot be downloaded.
- Added shared first-layout and `ResizeObserver` measurement for subtitle previews.
- Migrated subtitle and timeline editors to the shared reactive measurement hook.
- Added regression coverage for synchronous first-paint height and later resize updates.

See [Desktop startup and subtitle preview reliability](06-desktop-preview-reliability.md).
