"use client";

import { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface EditorHeaderProps {
  /** Icon at the far left, e.g. <Type className="size-4 text-primary" />. */
  icon: ReactNode;
  /** Page title (left of the breadcrumb separator). */
  title: ReactNode;
  /** Current item name shown after a "/" separator (e.g. the draft name). */
  breadcrumb?: ReactNode;
  /** Small supporting line under the title. */
  subtitle?: ReactNode;
  /** Primary workspace navigation placed beside the editor identity. */
  navigation?: ReactNode;
  /** Controls aligned to the right. */
  actions?: ReactNode;
  /** Extra classes on the <header> (e.g. "relative z-50" for anchored popovers). */
  className?: string;
  /** Dense 44 px chrome for tool-heavy workspaces such as Pipeline. */
  compact?: boolean;
  /** Stable selector for browser tests. */
  testId?: string;
  /** Overlays anchored inside the header (popovers, menus). */
  children?: ReactNode;
}

/**
 * Standard chrome for full-bleed editor screens (Attention Templates,
 * Subtitle Templates, Segments): h-14 bar with icon + "Title / item"
 * breadcrumb + subtitle on the left and actions on the right. Document-style
 * pages keep using PageHeader instead.
 */
export function EditorHeader({ icon, title, breadcrumb, subtitle, navigation, actions, className, compact = false, testId, children }: EditorHeaderProps) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-border",
        compact ? "h-11 px-3" : "h-14 px-4",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {breadcrumb != null && (
              <>
                <span className="text-muted-foreground/40">/</span>
                <span className="truncate text-xs text-muted-foreground">{breadcrumb}</span>
              </>
            )}
          </div>
          {subtitle && <p className="text-[10px] text-muted-foreground/70">{subtitle}</p>}
        </div>
        {navigation && (
          <div className="shrink-0 border-l border-border pl-3">
            {navigation}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      {children}
    </header>
  );
}
