"use client";

import { useState, useEffect, useCallback, ReactNode } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
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

interface EditorLayoutProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  children: ReactNode; // Center content (video player)
  leftPanelTitle?: string;
  rightPanelTitle?: string;
}

export function EditorLayout({
  leftPanel,
  rightPanel,
  children,
  leftPanelTitle = "Source Videos",
  rightPanelTitle = "Segments",
}: EditorLayoutProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();

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

  // Keyboard shortcuts for panel collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "[" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleLeftPanel();
      } else if (e.key === "]" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleRightPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleLeftPanel, toggleRightPanel]);

  return (
    <ResizablePanelGroup
      id="segments-workspace-layout"
      orientation="horizontal"
      className="h-full min-h-0 w-full bg-background"
    >
      {/* Left Panel - Source Videos */}
      <ResizablePanel
        id="source-videos"
        panelRef={leftPanelRef}
        defaultSize={256}
        minSize={200}
        maxSize={440}
        collapsible
        collapsedSize={48}
        onResize={({ inPixels }) => setLeftCollapsed(inPixels <= 52)}
        className="min-w-0"
      >
        <div className="flex h-full min-w-0 flex-col bg-card">
        {/* Panel Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border h-12">
          {!leftCollapsed && (
            <span className="text-sm font-semibold truncate">
              {leftPanelTitle}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0 ml-auto"
            onClick={toggleLeftPanel}
            title={leftCollapsed ? "Expand panel ([)" : "Collapse panel ([)"}
          >
            {leftCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Panel Content */}
        <div className={`flex-1 overflow-hidden ${leftCollapsed ? "hidden" : ""}`}>
          {leftPanel}
        </div>
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle className={leftCollapsed ? "opacity-40" : undefined} />

      {/* Center Panel - Video Player */}
      <ResizablePanel id="source-editor" minSize={380} className="min-w-0">
        <div className="h-full min-w-0 overflow-hidden bg-background p-2">
          {children}
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle className={rightCollapsed ? "opacity-40" : undefined} />

      {/* Right Panel - Segments Library */}
      <ResizablePanel
        id="segments-library"
        panelRef={rightPanelRef}
        defaultSize={320}
        minSize={250}
        maxSize={520}
        collapsible
        collapsedSize={48}
        onResize={({ inPixels }) => setRightCollapsed(inPixels <= 52)}
        className="min-w-0"
      >
        <div className="flex h-full min-w-0 flex-col bg-card">
        {/* Panel Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border h-12">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={toggleRightPanel}
            title={rightCollapsed ? "Expand panel (])" : "Collapse panel (])"}
          >
            {rightCollapsed ? (
              <PanelRightOpen className="h-4 w-4" />
            ) : (
              <PanelRightClose className="h-4 w-4" />
            )}
          </Button>
          {!rightCollapsed && (
            <span className="text-sm font-semibold truncate ml-2">
              {rightPanelTitle}
            </span>
          )}
        </div>

        {/* Panel Content */}
        <div className={`flex-1 overflow-hidden ${rightCollapsed ? "hidden" : ""}`}>
          {rightPanel}
        </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
