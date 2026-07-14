"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

const MAX_HISTORY_LENGTH = 100;
const DEFAULT_MERGE_WINDOW_MS = 750;

export interface UndoAction {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
  /** Consecutive changes with the same key become one undo step. */
  mergeKey?: string;
  mergeWindowMs?: number;
}

interface StoredUndoAction extends UndoAction {
  recordedAt: number;
}

interface UndoContextValue {
  pushAction: (action: UndoAction) => void;
  undo: () => boolean;
  redo: () => boolean;
  clearHistory: () => void;
}

const UndoContext = createContext<UndoContextValue | null>(null);

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Text controls own Ctrl/Cmd+Z. Application history must never consume their
 * native editing history, including contenteditable and ARIA text boxes.
 */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element
    ? target
    : document.activeElement instanceof Element
      ? document.activeElement
      : null;
  if (!element) return false;

  const textArea = element.closest("textarea");
  if (textArea instanceof HTMLTextAreaElement) {
    return !textArea.disabled && !textArea.readOnly;
  }

  const input = element.closest("input");
  if (input instanceof HTMLInputElement) {
    return !input.disabled
      && !input.readOnly
      && !NON_TEXT_INPUT_TYPES.has(input.type.toLowerCase());
  }

  const select = element.closest("select");
  if (select instanceof HTMLSelectElement) return !select.disabled;

  const editable = element.closest<HTMLElement>("[contenteditable], [role='textbox']");
  return Boolean(
    editable
    && editable.getAttribute("contenteditable") !== "false"
    && editable.getAttribute("aria-disabled") !== "true",
  );
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const undoStackRef = useRef<StoredUndoAction[]>([]);
  const redoStackRef = useRef<StoredUndoAction[]>([]);
  const operationInFlightRef = useRef(false);
  const historyGenerationRef = useRef(0);

  const clearHistory = useCallback(() => {
    historyGenerationRef.current += 1;
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, []);

  // Actions close over page state. Discard them when App Router unmounts that
  // page so an undo can never call a stale component after navigation.
  useEffect(() => {
    clearHistory();
  }, [pathname, clearHistory]);

  const pushAction = useCallback((action: UndoAction) => {
    const now = Date.now();
    const previous = undoStackRef.current.at(-1);
    const mergeWindow = action.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;

    if (
      action.mergeKey
      && previous?.mergeKey === action.mergeKey
      && now - previous.recordedAt <= mergeWindow
    ) {
      // Preserve the first undo boundary and replace only the final redo state.
      previous.label = action.label;
      previous.redo = action.redo;
      previous.recordedAt = now;
    } else {
      undoStackRef.current.push({ ...action, recordedAt: now });
      undoStackRef.current = undoStackRef.current.slice(-MAX_HISTORY_LENGTH);
    }

    // Any new edit starts a new history branch.
    redoStackRef.current = [];
  }, []);

  const runAction = useCallback((direction: "undo" | "redo"): boolean => {
    if (operationInFlightRef.current) return false;

    const sourceRef = direction === "undo" ? undoStackRef : redoStackRef;
    const destinationRef = direction === "undo" ? redoStackRef : undoStackRef;
    const action = sourceRef.current.pop();
    if (!action) return false;

    const generation = historyGenerationRef.current;
    operationInFlightRef.current = true;
    void (async () => {
      try {
        await action[direction]();
        if (historyGenerationRef.current === generation) {
          destinationRef.current.push(action);
        }
      } catch (error) {
        // Keep a failed operation retryable instead of silently losing history.
        if (historyGenerationRef.current === generation) {
          sourceRef.current.push(action);
        }
        console.error(`Could not ${direction} ${action.label}`, error);
        toast.error(`Could not ${direction} ${action.label}`);
      } finally {
        operationInFlightRef.current = false;
      }
    })();
    return true;
  }, []);

  const undo = useCallback(() => runAction("undo"), [runAction]);
  const redo = useCallback(() => runAction("redo"), [runAction]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.altKey
        || (!event.ctrlKey && !event.metaKey)
        || isTextEditingTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = key === "y" || (key === "z" && event.shiftKey);
      if (!isUndo && !isRedo) return;

      const handled = isUndo ? undo() : redo();
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, undo]);

  const value = useMemo(
    () => ({ pushAction, undo, redo, clearHistory }),
    [pushAction, undo, redo, clearHistory],
  );

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>;
}

export function useUndo() {
  const context = useContext(UndoContext);
  if (!context) throw new Error("useUndo must be used within UndoProvider");
  return context;
}
