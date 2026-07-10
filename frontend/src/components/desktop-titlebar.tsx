"use client";

import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import Image from "next/image";
import blipostMark from "../../public/blipost-mark.png";

// Build-time flag, identical on server and client bundles — safe to gate
// render on directly (same pattern as layout.tsx's `html.desktop` class).
const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";

/**
 * Custom title bar for the frameless Electron main window (electron/src/main.js
 * sets `frame: false`). No-op / not rendered outside the desktop build.
 */
export function DesktopTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!DESKTOP_MODE) return;
    const api = window.editFactory?.window;
    if (!api) return;
    api.isMaximized().then(setIsMaximized).catch(() => {});
    return api.onMaximizeChange(setIsMaximized);
  }, []);

  if (!DESKTOP_MODE) return null;

  const win = () => window.editFactory?.window;

  return (
    <div
      className="flex h-8 shrink-0 items-center justify-between bg-sidebar text-sidebar-foreground select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-1.5 px-3 text-xs font-medium text-sidebar-foreground/70">
        <Image src={blipostMark} alt="" width={14} height={14} className="rounded-sm" />
        Blipost
      </div>
      <div className="flex h-full" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          aria-label="Minimize"
          onClick={() => win()?.minimize()}
          className="flex h-full w-11 items-center justify-center text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Minus size={14} strokeWidth={2} />
        </button>
        <button
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={() => win()?.toggleMaximize()}
          className="flex h-full w-11 items-center justify-center text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          {isMaximized ? <Copy size={12} strokeWidth={2} /> : <Square size={12} strokeWidth={2} />}
        </button>
        <button
          aria-label="Close"
          onClick={() => win()?.close()}
          className="flex h-full w-11 items-center justify-center text-sidebar-foreground/70 transition-colors hover:bg-destructive hover:text-destructive-foreground"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
