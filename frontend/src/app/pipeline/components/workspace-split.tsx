"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Separator, useDefaultLayout, type PanelProps } from "react-resizable-panels";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

const STORAGE_PREFIX = "blipost.pipeline-split.";
const DRAG_THRESHOLD = 5;
const INTERACTIVE_HEADER_SELECTOR = "button, a, input, textarea, select, [role='button'], [contenteditable='true']";

type SplitPanelSide = "left" | "right";

// useDefaultLayout is called during SSR prerender where localStorage doesn't exist.
const noopStorage = { getItem: () => null, setItem: () => {} };

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

type PanelSizing = Pick<PanelProps, "defaultSize" | "minSize" | "maxSize">;

type WorkspaceSplitProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  splitId: string;
  /** When false (e.g. guided cascade layout), render the plain fallback container. */
  enabled?: boolean;
  /** Allow dragging panel headers to exchange their positions. */
  reorderable?: boolean;
  /** Container classes used below the desktop breakpoint or when disabled. */
  fallbackClassName?: string;
  groupClassName?: string;
  leftSizing?: PanelSizing;
  rightSizing?: PanelSizing;
  /** Exactly two children: [left panel, right panel]. */
  children: ReactNode;
};

/**
 * Two-pane workspace split with a draggable divider and draggable panel headers.
 * Sizes and side order persist per splitId in localStorage. Below 1280px (or
 * in guided layout) it falls back to the original responsive container.
 */
export function WorkspaceSplit({
  splitId,
  enabled = true,
  reorderable = true,
  fallbackClassName,
  groupClassName,
  leftSizing,
  rightSizing,
  children,
  ...rest
}: WorkspaceSplitProps) {
  const desktop = useIsDesktop();
  const swapKey = `${STORAGE_PREFIX}${splitId}.swapped`;
  const [swapped, setSwapped] = useState(false);
  const [draggedPanel, setDraggedPanel] = useState<SplitPanelSide | null>(null);
  const [dropPanel, setDropPanel] = useState<SplitPanelSide | null>(null);
  const dragRef = useRef<{
    side: SplitPanelSide;
    startX: number;
    startY: number;
    armed: boolean;
  } | null>(null);
  useEffect(() => {
    let nextSwapped = false;
    try {
      nextSwapped = localStorage.getItem(swapKey) === "1";
    } catch {
      // Layout preference just won't persist.
    }
    const frame = requestAnimationFrame(() => setSwapped(nextSwapped));
    return () => cancelAnimationFrame(frame);
  }, [swapKey]);

  const toggleSwap = useCallback(() => {
    setSwapped((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(swapKey, next ? "1" : "0");
      } catch {
        // Layout preference just won't persist.
      }
      return next;
    });
  }, [swapKey]);

  useEffect(() => {
    const resetDrag = () => {
      dragRef.current = null;
      setDraggedPanel(null);
      setDropPanel(null);
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    };

    const panelAtPoint = (x: number, y: number): SplitPanelSide | null => {
      let element = document.elementFromPoint(x, y) as HTMLElement | null;
      while (element) {
        if (element.dataset.workspaceSplit === splitId) {
          const side = element.dataset.workspaceSplitPanel;
          return side === "left" || side === "right" ? side : null;
        }
        element = element.parentElement;
      }
      return null;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.armed) {
        const distance = Math.hypot(
          event.clientX - drag.startX,
          event.clientY - drag.startY,
        );
        if (distance < DRAG_THRESHOLD) return;
        drag.armed = true;
        setDraggedPanel(drag.side);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      setDropPanel(panelAtPoint(event.clientX, event.clientY));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.armed) {
        const target = panelAtPoint(event.clientX, event.clientY);
        if (target && target !== drag.side) toggleSwap();
      }
      resetDrag();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) resetDrag();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", resetDrag);
    window.addEventListener("blur", resetDrag);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", resetDrag);
      window.removeEventListener("blur", resetDrag);
      window.removeEventListener("keydown", handleKeyDown);
      resetDrag();
    };
  }, [splitId, toggleSwap]);

  const { defaultLayout, onLayoutChange } = useDefaultLayout({
    id: `${STORAGE_PREFIX}${splitId}`,
    storage: typeof window === "undefined" ? noopStorage : window.localStorage,
  });

  const [leftChild, rightChild] = Children.toArray(children);
  const ownsNestedSplit = (child: ReactNode) =>
    isValidElement(child) && child.type === WorkspaceSplit;

  if (!enabled || !desktop) {
    return (
      <div className={fallbackClassName} {...rest}>
        {leftChild}
        {rightChild}
      </div>
    );
  }

  const beginPanelDrag = (
    side: SplitPanelSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!reorderable) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE_HEADER_SELECTOR)) return;

    if (!target.closest('[data-slot="workspace-panel-header"]')) return;

    // Nested workspace panels own their own header drag gesture.
    event.stopPropagation();
    dragRef.current = {
      side,
      startX: event.clientX,
      startY: event.clientY,
      armed: false,
    };
  };

  const panelDropIndicator = (side: SplitPanelSide) => {
    if (!dropPanel || !draggedPanel || dropPanel !== side || draggedPanel === side) {
      return null;
    }

    const visualOrder: SplitPanelSide[] = swapped
      ? ["right", "left"]
      : ["left", "right"];
    const draggedIndex = visualOrder.indexOf(draggedPanel);
    const targetIndex = visualOrder.indexOf(side);

    return (
      <span
        aria-hidden="true"
        data-workspace-drop-indicator={splitId}
        className={cn(
          "pointer-events-none absolute inset-y-2 z-50 w-1 rounded-full bg-primary shadow-lg",
          draggedIndex < targetIndex ? "right-1" : "left-1",
        )}
      />
    );
  };

  const panels = [
    <ResizablePanel
      key="left"
      id={`${splitId}-left`}
      className="h-full min-w-0"
      {...leftSizing}
    >
      <div
        data-workspace-split={splitId}
        data-workspace-split-panel="left"
        data-workspace-pane={ownsNestedSplit(leftChild) ? undefined : ""}
        onPointerDown={(event) => beginPanelDrag("left", event)}
        className={cn(
          "relative h-full min-w-0",
          draggedPanel === "left" && "opacity-50",
        )}
      >
        {panelDropIndicator("left")}
        {leftChild}
      </div>
    </ResizablePanel>,
    <ResizablePanel
      key="right"
      id={`${splitId}-right`}
      className="h-full min-w-0"
      {...rightSizing}
    >
      <div
        data-workspace-split={splitId}
        data-workspace-split-panel="right"
        data-workspace-pane={ownsNestedSplit(rightChild) ? undefined : ""}
        onPointerDown={(event) => beginPanelDrag("right", event)}
        className={cn(
          "relative h-full min-w-0",
          draggedPanel === "right" && "opacity-50",
        )}
      >
        {panelDropIndicator("right")}
        {rightChild}
      </div>
    </ResizablePanel>,
  ];
  if (swapped) panels.reverse();

  return (
    <ResizablePanelGroup
      id={`${splitId}-split`}
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChange={onLayoutChange}
      className={cn("min-h-0", groupClassName)}
      {...rest}
    >
      {panels[0]}
      <Separator
        aria-label={`Resize ${splitId} panels`}
        data-workspace-split-resize-handle={splitId}
        onPointerDown={(event) => event.stopPropagation()}
        className="relative z-30 w-px shrink-0 cursor-col-resize bg-border/70 transition-colors hover:bg-primary/50 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2"
      />
      {panels[1]}
    </ResizablePanelGroup>
  );
}
