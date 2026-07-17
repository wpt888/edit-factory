import * as React from "react";

import { cn } from "@/lib/utils";

const SHELL_WIDTHS = {
  default: "max-w-7xl",
  narrow: "max-w-3xl",
  /** Only for pages that genuinely need more room (dense tables/grids). */
  wide: "max-w-[1600px]",
} as const;

export interface PageShellProps extends React.ComponentProps<"div"> {
  width?: keyof typeof SHELL_WIDTHS;
}

/**
 * Canonical page container. One padding/width recipe for every top-level
 * route instead of each page inventing its own container classes.
 */
export function PageShell({ width = "default", className, ...props }: PageShellProps) {
  return (
    <div
      data-slot="page-shell"
      className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8 py-8", SHELL_WIDTHS[width], className)}
      {...props}
    />
  );
}
