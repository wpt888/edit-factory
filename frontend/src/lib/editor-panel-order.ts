export type EditorPanelId = "source-videos" | "source-editor" | "segments-library";
export type EditorPanelDropSide = "before" | "after";

export interface EditorPanelDropTarget {
  panelId: EditorPanelId;
  side: EditorPanelDropSide;
}

export const DEFAULT_EDITOR_PANEL_ORDER: EditorPanelId[] = [
  "source-videos",
  "source-editor",
  "segments-library",
];

export function isEditorPanelId(value: unknown): value is EditorPanelId {
  return DEFAULT_EDITOR_PANEL_ORDER.includes(value as EditorPanelId);
}

export function resolveEditorPanelOrder(value: string | null): EditorPanelId[] {
  if (!value) return [...DEFAULT_EDITOR_PANEL_ORDER];
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed)
      || parsed.length !== DEFAULT_EDITOR_PANEL_ORDER.length
      || !parsed.every(isEditorPanelId)
      || new Set(parsed).size !== DEFAULT_EDITOR_PANEL_ORDER.length
    ) {
      return [...DEFAULT_EDITOR_PANEL_ORDER];
    }
    return parsed;
  } catch {
    return [...DEFAULT_EDITOR_PANEL_ORDER];
  }
}

export function moveEditorPanel(
  order: readonly EditorPanelId[],
  sourceId: EditorPanelId,
  target: EditorPanelDropTarget,
): EditorPanelId[] {
  if (sourceId === target.panelId) return [...order];
  const next = order.filter((panelId) => panelId !== sourceId);
  const targetIndex = next.indexOf(target.panelId);
  if (targetIndex < 0) return [...order];
  next.splice(targetIndex + (target.side === "after" ? 1 : 0), 0, sourceId);
  return next;
}
