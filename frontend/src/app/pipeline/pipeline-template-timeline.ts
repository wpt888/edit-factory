export type ImportedTemplateTimelineRef<T> = {
  current: T | null;
};

export function shouldRestoreImportedTemplateTimeline(
  previewInfo: Record<string, unknown> | null | undefined,
): boolean {
  return Object.keys(previewInfo || {}).length === 0;
}

/**
 * Keep imported timeline bindings available for every card in one preview
 * batch, then consume them only after the caller commits a successful batch.
 * If another template is imported while the batch runs, commit deliberately
 * leaves that newer value intact.
 */
export function beginImportedTemplateTimelineBatch<T>(
  ref: ImportedTemplateTimelineRef<T>,
): {
  timeline: T | null;
  commit: () => void;
} {
  const timeline = ref.current;
  return {
    timeline,
    commit: () => {
      if (ref.current === timeline) ref.current = null;
    },
  };
}
