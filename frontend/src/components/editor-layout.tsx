"use client";

import { useState, useEffect, ReactNode } from "react";
import { Button } from "@/components/ui/button";
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

  // Keyboard shortcuts for panel collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "[" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setLeftCollapsed((prev) => !prev);
      } else if (e.key === "]" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setRightCollapsed((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="h-[calc(100vh-64px)] w-full bg-background flex">
      {/* Left Panel - Source Videos */}
      <div
        className={`bg-card border-r border-border flex flex-col transition-all duration-200 ${
          leftCollapsed ? "w-12" : "w-64 min-w-[200px] max-w-[320px]"
        }`}
      >
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
            onClick={() => setLeftCollapsed(!leftCollapsed)}
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

      {/* Center Panel - Video Player */}
      <div className="flex-1 bg-background overflow-auto p-4 min-w-0">
        {children}
      </div>

      {/* Right Panel - Segments Library */}
      <div
        className={`bg-card border-l border-border flex flex-col transition-all duration-200 ${
          rightCollapsed ? "w-12" : "w-80 min-w-[250px] max-w-[400px]"
        }`}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border h-12">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => setRightCollapsed(!rightCollapsed)}
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
    </div>
  );
}
