# Segments editor: video, timeline, resizing, and undo

## Scope

The Segments workspace was redesigned around the visual reference supplied on 2026-07-11. The change preserves the existing editing behavior—playback, seeking, marking, resizing, waveform loading, voice detection, product groups, transforms, and keyboard shortcuts—while replacing the fixed presentation with a more visual and modular editor.

The main implementation files are:

- `frontend/src/components/video-segment-player.tsx`
- `frontend/src/app/segments/page.tsx`
- `frontend/src/components/editor-layout.tsx`
- `frontend/src/components/ui/resizable.tsx`

## Source video player

The player now uses the width and height reported by the selected source video instead of forcing a 9:16 preview frame. The video remains contained inside the available area, so landscape and portrait sources are both shown without accidental cropping.

Playback controls are grouped in a dedicated opaque black strip below the image. This strip contains play/pause, current and total time, mute and volume, playback speed, and fullscreen. It is structurally separate from the image; it does not use a gradient and does not fade over or hide the bottom of the video.

Video pan and zoom controls remain over the upper-right corner. Segment transform previews continue to compose with the independent video-preview zoom.

The Segments page header uses the `Source Video` label and displays the selected filename, resolution, frame rate, and duration alongside it.

## Timeline presentation

The timeline is composed of the following visual layers:

1. A time ruler covering the visible timeline range.
2. A filmstrip populated from available segment thumbnails, with the source-video thumbnail as fallback.
3. A centered waveform lane.
4. Numbered saved-segment ranges with lime borders and time labels.
5. Product-group bands, marking ranges, resize handles, and the current playhead.

The waveform is neutral gray outside saved segment intervals. Samples located inside a saved segment are lime, matching the segment outline. Voice-detection samples remain amber when the voice overlay is enabled.

Waveform drawing is responsive to timeline width changes. The existing `ResizeObserver` forces a canvas redraw after either the workspace panels or the vertical video/timeline divider moves.

The secondary toolbar below the timeline retains navigation, waveform and voice toggles, timeline zoom, segment marking, product-group marking, and the keyboard-shortcut reference.

## Resizable workspace

The workspace uses `react-resizable-panels` 4.2.1 in two nested groups.

The outer horizontal group contains:

- Source Videos: 256 px default, 200–440 px expanded range, 48 px collapsed rail.
- Source editor: flexible center panel with a 380 px minimum.
- Segments Library: 320 px default, 250–520 px expanded range, 48 px collapsed rail.

The `[` and `]` shortcuts and the existing collapse buttons now call the panels' imperative collapse and expand methods. Dragging a side panel below its minimum collapses it into the same compact rail.

Inside the source editor, a vertical resizable group separates the video preview from the timeline and editing toolbar. The video has a 160 px minimum. The timeline area defaults to 190 px, has a 150 px minimum, and can occupy up to 55 percent of the available editor height.

`ResizableHandle` supports both orientations. Horizontal workspace separators use a vertical grip and column-resize cursor; the video/timeline separator uses a horizontal grip and row-resize cursor.

All resizable children use `min-width: 0`, `min-height: 0`, and controlled overflow so shrinking one block does not force its siblings outside the viewport.

## Deleted-segment undo

Segment deletion keeps a bounded in-memory history of the latest 50 deletions. A successful delete removes the segment from the current timeline, the all-segments collection, selection state, local association state, and the displayed source-video count. A toast confirms the deletion and provides an explicit Undo action.

`Ctrl+Z` or `Cmd+Z` restores the most recent deleted segment when focus is outside a text-editing control. When focus is inside an input, textarea, select, or content-editable element, the browser's normal text undo behavior is preserved.

Restoration uses the normal segment-create endpoint and restores:

- start and end time;
- keywords and notes;
- product-group label;
- single-use state;
- transforms, through a follow-up segment update;
- favorite state, through the favorite endpoint.

The undo entry is inspected, not removed, before the API request. It is popped only after segment creation succeeds, so a network, authentication, profile, or server failure leaves the operation retryable. Concurrent undo requests are serialized. Undo history is cleared when the active profile changes.

The backend creates a new segment identifier and regenerates the thumbnail during restoration. Deleted product associations and previously extracted segment files are not reconstructed by this frontend undo flow.

The delete confirmation now explains that a segment can be restored with `Ctrl+Z`; only source-video deletion remains explicitly irreversible.

## Verification

The implementation was checked with:

- `codegraph sync`;
- `npm run typecheck`;
- targeted ESLint over the four changed frontend files, with zero errors;
- `git diff --check` over the changed frontend files;
- a live request to `/segments`, which returned HTTP 200 from the running frontend.

The full production build was attempted but could not remove `.next/standalone` because the running Electron instance held that directory open (`EBUSY`). This was an environment lock, not a compilation or type-check failure. The in-app browser runtime was not available for automated screenshot comparison in that session.
