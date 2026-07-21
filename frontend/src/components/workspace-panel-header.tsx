import { GripVertical, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type WorkspacePanelHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  icon?: LucideIcon;
  titleAccessory?: ReactNode;
  actions?: ReactNode;
  sticky?: boolean;
  collapsed?: boolean;
  showGrip?: boolean;
  tooltip?: string;
};

/**
 * Canonical 48 px pane header for every full-bleed workspace.
 *
 * Keep geometry here so adjacent panes always share the same baseline,
 * separator, padding, and vertical centering.
 */
export function WorkspacePanelHeader({
  title,
  icon: Icon,
  titleAccessory,
  actions,
  sticky = false,
  collapsed = false,
  showGrip = true,
  tooltip,
  className,
  ...props
}: WorkspacePanelHeaderProps) {
  return (
    <div
      data-slot="workspace-panel-header"
      title={tooltip}
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-border px-3",
        sticky && "sticky top-0 z-[60] bg-surface-canvas",
        className,
      )}
      {...props}
    >
      {!collapsed && (
        <>
          {showGrip && (
            <GripVertical
              data-slot="workspace-panel-grip"
              className="size-4 shrink-0 text-muted-foreground/60"
              aria-hidden="true"
            />
          )}
          <div
            data-slot="workspace-panel-title"
            className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold"
          >
            {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 truncate">{title}</span>
            {titleAccessory}
          </div>
        </>
      )}
      {actions && (
        <div className={cn("flex shrink-0 items-center gap-1", collapsed && "ml-auto")}>
          {actions}
        </div>
      )}
    </div>
  );
}
