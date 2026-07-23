import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Explicit fallback for headerless workspace panes. Normal workspace shells
 * use data-workspace-pane, which pins the same endcap outside scrollable
 * content.
 */
export function WorkspacePanelEndcap({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      data-slot="workspace-panel-endcap"
      className={cn("absolute inset-x-0 bottom-0 z-[70]", className)}
      {...props}
    />
  );
}
