const EDITOR_DELETE_BLOCKING_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='menu']",
  "[role='listbox']",
].join(", ");

/**
 * Editor-level Delete shortcuts must never steal the key from text/value
 * editing or from an open menu surface.
 */
export function isEditorDeleteShortcutBlocked(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITOR_DELETE_BLOCKING_SELECTOR) !== null;
}

/** Page-global shortcuts should also stay out of modal confirmation/picker UI. */
export function isEditorModalShortcutBlocked(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest("[role='dialog'], [role='alertdialog']") !== null;
}
