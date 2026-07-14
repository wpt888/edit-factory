# Pre-launch cosmetic pass (2026-07-13)

Four cosmetic changes made ahead of launch, all reversible and non-breaking.

## 1. Legacy Postiz/Buffer config hidden in Settings

`frontend/src/app/settings/page.tsx` gained a `SHOW_LEGACY_INTEGRATIONS = false`
flag. The four Postiz/Buffer configuration cards (Postiz Publishing, Connected
Social Platforms, Buffer Publishing, Connected Buffer Channels) are now wrapped
in a collapsed `<details>` labeled "Legacy integrations (Postiz, Buffer)",
gated behind that flag. Setting the flag to `true` restores the old always-visible
layout (e.g. for support debugging).

Nothing about the underlying functionality changed: Schedule and Calendar still
call the Postiz-backed endpoints exactly as before. Only the config surface for
setting up Postiz/Buffer credentials moved out of the default view, since these
are legacy backends now superseded by the direct Blipost platform connection.

## 2. "Clips" renamed to "Local Projects"

The desktop's local video library had a naming collision with the web app's
AI-clipping pipeline (both called "Clips" — see the `blipost-parity` skill
watchlist). Renamed the user-facing label only:

- `frontend/src/components/navbar.tsx`: nav item label "Clips" -> "Local Projects"
  (icon and route `/librarie` unchanged).
- `frontend/src/app/librarie/page.tsx`: page `<h1>` "Library" -> "Local Projects".

Internal tab labels ("Video Clips" for the video-content tab) and dashboard
stat labels ("Clips Generated", "Clips Rendered") were deliberately left as-is
— they describe rendered video clips generically and aren't part of the
nav/page-title identity that caused the cross-app confusion.

## 3. "Free — renders on your machine" copy on the render button

Added a small muted caption under the primary "Render Selected" button in
`frontend/src/app/pipeline/components/step3-preview.tsx` (Pipeline Step 3 —
Preview), clarifying that local rendering doesn't consume render credits.
Single placement, not repeated elsewhere in the app.

## 4. Parity skill mirror updated

`.claude/skills/blipost-parity/SKILL.md` (force-added; `.claude/` is otherwise
gitignored in this repo, same as before) was updated:

- The light/dark theme propagation watchlist item is marked resolved
  (2026-07-13) — desktop and web themes are now aligned.
- The "Clips" naming collision entry is marked mitigated, documenting the
  nav/title rename from item 2 above.
- The audit summary footer was refreshed to 2026-07-13.

Note: this is the edit_factory copy only. The task explicitly scoped work to
this repo; propagating the same skill update to the social-scheduler side is
a separate follow-up.

## Verification

`npx tsc --noEmit` in `frontend/` passed with no errors after each change.

## Follow-up: input, project, and output terminology (2026-07-13)

The initial `Local Projects` rename still described a flat library of rendered
clips and generated images, not actual project records. The navigation and page
copy now use `Local Exports`, while the source-video editor is labeled
`Footage & Segments`. The misleading back link from the Segments workspace to
the exports library was also removed, so the two destinations are presented as
sibling workflows rather than parent and child.
