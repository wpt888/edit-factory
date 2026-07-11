# Engineering Change Log

## 2026-07-11 — Desktop startup and subtitle preview first paint

- Removed the implicit production frontend build from Electron `start`/`dev`; desktop startup no longer fails when Google Fonts cannot be downloaded.
- Added shared first-layout and `ResizeObserver` measurement for subtitle previews.
- Migrated subtitle and timeline editors to the shared reactive measurement hook.
- Added regression coverage for synchronous first-paint height and later resize updates.

See [Desktop startup and subtitle preview reliability](06-desktop-preview-reliability.md).