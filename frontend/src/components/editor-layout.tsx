"use client";

import {
  useState,
  useEffect,
  useCallback,
  Fragment,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePanelRef } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { WorkspacePanelHeader } from "@/components/workspace-panel-header";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_EDITOR_PANEL_ORDER,
  isEditorPanelId,
  moveEditorPanel,
  resolveEditorPanelOrder,
  type EditorPanelDropTarget,
  type EditorPanelId,
} from "@/lib/editor-panel-order";
import {
  readWorkspaceStorage,
  writeWorkspaceStorage,
} from "@/lib/workspace-session";

interface EditorLayoutProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  children: ReactNode;
  leftPanelTitle?: ReactNode;
  centerPanelTitle?: ReactNode;
  centerPanelHeader?: ReactNode;
  rightPanelTitle?: ReactNode;
  workspaceId?: string;
}

const PANEL_ORDER_STORAGE_KEY = "segments.panel-order.v1";
const DRAG_THRESHOLD = 5;
const INTERACTIVE_HEADER_SELECTOR = "button, a, input, textarea, select, [role='button'], [contenteditable='true']";

export function EditorLayout({
  leftPanel,
  rightPanel,
  children,
  leftPanelTitle = "Source Videos",
  centerPanelTitle = "Editor",
  centerPanelHeader,
  rightPanelTitle = "Segments",
  workspaceId,
}: EditorLayoutProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [panelOrder, setPanelOrder] = useState<EditorPanelId[]>(DEFAULT_EDITOR_PANEL_ORDER);
  const [draggedPanel, setDraggedPanel] = useState<EditorPanelId | null>(null);
  const [dropTarget, setDropTarget] = useState<EditorPanelDropTarget | null>(null);
  const [dragGhost, setDragGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  const panelOrderRef = useRef(panelOrder);
  const dragRef = useRef<{
    panelId: EditorPanelId;
    label: string;
    startX: number;
    startY: number;
    armed: boolean;
  } | null>(null);
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();

  useEffect(() => {
    panelOrderRef.current = panelOrder;
  }, [panelOrder]);

  useEffect(() => {
    const nextOrder = workspaceId
      ? resolveEditorPanelOrder(readWorkspaceStorage(workspaceId, PANEL_ORDER_STORAGE_KEY))
      : [...DEFAULT_EDITOR_PANEL_ORDER];
    panelOrderRef.current = nextOrder;
    const frame = requestAnimationFrame(() => setPanelOrder(nextOrder));
    return () => cancelAnimationFrame(frame);
  }, [workspaceId]);

  const toggleLeftPanel = useCallback(() => {
    if (leftPanelRef.current?.isCollapsed()) {
      leftPanelRef.current.expand();
    } else {
      leftPanelRef.current?.collapse();
    }
  }, [leftPanelRef]);

  const toggleRightPanel = useCallback(() => {
    if (rightPanelRef.current?.isCollapsed()) {
      rightPanelRef.current.expand();
    } else {
      rightPanelRef.current?.collapse();
    }
  }, [rightPanelRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.key === "Escape" && dragRef.current) {
        dragRef.current = null;
        setDraggedPanel(null);
        setDropTarget(null);
        setDragGhost(null);
        document.body.style.removeProperty("user-select");
        document.body.style.removeProperty("cursor");
      } else if (event.key === "[" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        toggleLeftPanel();
      } else if (event.key === "]" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        toggleRightPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleLeftPanel, toggleRightPanel]);

  useEffect(() => {
    const resetDrag = () => {
      dragRef.current = null;
      setDraggedPanel(null);
      setDropTarget(null);
      setDragGhost(null);
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    };

    const targetAtPoint = (x: number, y: number): EditorPanelDropTarget | null => {
      const element = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-editor-panel]");
      const panelId = element?.dataset.editorPanel;
      if (!element || !isEditorPanelId(panelId)) return null;
      const bounds = element.getBoundingClientRect();
      return {
        panelId,
        side: x < bounds.left + bounds.width / 2 ? "before" : "after",
      };
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
        setDraggedPanel(drag.panelId);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      setDropTarget(targetAtPoint(event.clientX, event.clientY));
      setDragGhost({ label: drag.label, x: event.clientX, y: event.clientY });
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag?.armed) {
        resetDrag();
        return;
      }
      const target = targetAtPoint(event.clientX, event.clientY);
      if (target) {
        const nextOrder = moveEditorPanel(panelOrderRef.current, drag.panelId, target);
        panelOrderRef.current = nextOrder;
        setPanelOrder(nextOrder);
        if (workspaceId) {
          try {
            writeWorkspaceStorage(workspaceId, PANEL_ORDER_STORAGE_KEY, JSON.stringify(nextOrder));
          } catch {
            // Reordering remains active for this session if storage is unavailable.
          }
        }
      }
      resetDrag();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", resetDrag);
    window.addEventListener("blur", resetDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", resetDrag);
      window.removeEventListener("blur", resetDrag);
      resetDrag();
    };
  }, [workspaceId]);

  const beginPanelDrag = useCallback((
    panelId: EditorPanelId,
    label: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(INTERACTIVE_HEADER_SELECTOR)) return;
    event.preventDefault();
    dragRef.current = {
      panelId,
      label,
      startX: event.clientX,
      startY: event.clientY,
      armed: false,
    };
  }, []);

  const panelPosition = useCallback(
    (panelId: EditorPanelId) => panelOrder.indexOf(panelId),
    [panelOrder],
  );

  const collapseIcon = (panelId: EditorPanelId, collapsed: boolean) => {
    const isOnLeft = panelPosition(panelId) === 0;
    if (isOnLeft) {
      return collapsed
        ? <PanelLeftOpen className="size-4" />
        : <PanelLeftClose className="size-4" />;
    }
    return collapsed
      ? <PanelRightOpen className="size-4" />
      : <PanelRightClose className="size-4" />;
  };

  const panelHeader = (
    panelId: EditorPanelId,
    title: ReactNode,
    options?: {
      collapsed?: boolean;
      onToggle?: () => void;
      extra?: ReactNode;
    },
  ) => {
    const collapsed = options?.collapsed ?? false;
    return (
      <WorkspacePanelHeader
        title={title}
        tooltip={!collapsed ? "Drag to move panel" : undefined}
        collapsed={collapsed}
        onPointerDown={!collapsed
          ? (event) => beginPanelDrag(
              panelId,
              typeof title === "string" ? title : "Panel",
              event,
            )
          : undefined
        }
        className={cn(
          !collapsed && "touch-none cursor-grab active:cursor-grabbing",
        )}
        titleAccessory={options?.extra}
        actions={options?.onToggle && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={options.onToggle}
            title={collapsed ? "Expand panel" : "Collapse panel"}
          >
            {collapseIcon(panelId, collapsed)}
          </Button>
        )}
      />
    );
  };

  const panelDropIndicator = (panelId: EditorPanelId) => {
    if (!dropTarget || draggedPanel === panelId || dropTarget.panelId !== panelId) return null;
    return (
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-2 z-50 w-1 rounded-full bg-primary shadow-lg",
          dropTarget.side === "before" ? "left-1" : "right-1",
        )}
      />
    );
  };

  const renderPanel = (panelId: EditorPanelId, position: number) => {
    if (panelId === "source-videos") {
      return (
        <ResizablePanel
          key={panelId}
          id={`${panelId}-position-${position}`}
          panelRef={leftPanelRef}
          defaultSize={256}
          minSize={200}
          maxSize={440}
          collapsible
          collapsedSize={48}
          onResize={({ inPixels }) => setLeftCollapsed(inPixels <= 52)}
          className="min-w-0"
        >
          <div
            data-editor-panel={panelId}
            data-workspace-pane
            className={cn("relative flex h-full min-w-0 flex-col bg-card", draggedPanel === panelId && "opacity-50")}
          >
            {panelDropIndicator(panelId)}
            {panelHeader(panelId, leftPanelTitle, {
              collapsed: leftCollapsed,
              onToggle: toggleLeftPanel,
            })}
            <div className={cn("flex-1 overflow-hidden", leftCollapsed && "hidden")}>
              {leftPanel}
            </div>
          </div>
        </ResizablePanel>
      );
    }

    if (panelId === "segments-library") {
      return (
        <ResizablePanel
          key={panelId}
          id={`${panelId}-position-${position}`}
          panelRef={rightPanelRef}
          defaultSize={320}
          minSize={250}
          maxSize={520}
          collapsible
          collapsedSize={48}
          onResize={({ inPixels }) => setRightCollapsed(inPixels <= 52)}
          className="min-w-0"
        >
          <div
            data-editor-panel={panelId}
            data-workspace-pane
            className={cn("relative flex h-full min-w-0 flex-col bg-card", draggedPanel === panelId && "opacity-50")}
          >
            {panelDropIndicator(panelId)}
            {panelHeader(panelId, rightPanelTitle, {
              collapsed: rightCollapsed,
              onToggle: toggleRightPanel,
            })}
            <div className={cn("flex-1 overflow-hidden", rightCollapsed && "hidden")}>
              {rightPanel}
            </div>
          </div>
        </ResizablePanel>
      );
    }

    return (
      <ResizablePanel
        key={panelId}
        id={`${panelId}-position-${position}`}
        minSize={380}
        className="min-w-0"
      >
        <div
          data-editor-panel={panelId}
          data-workspace-pane
          className={cn("relative flex h-full min-w-0 flex-col overflow-hidden bg-card", draggedPanel === panelId && "opacity-50")}
        >
          {panelDropIndicator(panelId)}
          {panelHeader(panelId, centerPanelTitle, { extra: centerPanelHeader })}
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </ResizablePanel>
    );
  };

  return (
    <>
      <ResizablePanelGroup
        id={`segments-workspace-layout-${workspaceId || "default"}`}
        orientation="horizontal"
        className="h-full min-h-0 w-full bg-card"
      >
        {/* The refs are passed through as imperative panel handles; their values
            are never read while rendering. The hook rule cannot infer that
            through the renderPanel helper. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {panelOrder.map((panelId, index) => (
          <Fragment key={`${panelId}-slot`}>
            {index > 0 && (
              <ResizableHandle className="w-px bg-border/70" />
            )}
            {renderPanel(panelId, index)}
          </Fragment>
        ))}
      </ResizablePanelGroup>

      {dragGhost && createPortal(
        <div
          style={{ left: dragGhost.x + 12, top: dragGhost.y + 12 }}
          className="pointer-events-none fixed z-[9999] flex max-w-56 items-center rounded-md border border-border/70 bg-popover px-2.5 py-1.5 text-xs font-medium text-foreground shadow-lg"
        >
          <span className="truncate">{dragGhost.label}</span>
        </div>,
        document.body,
      )}
    </>
  );
}
