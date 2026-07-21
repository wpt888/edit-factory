import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type WorkspacePanelHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  icon?: LucideIcon;
  title: string;
  titleAccessory?: ReactNode;
  actions?: ReactNode;
  sticky?: boolean;
};

export function WorkspacePanelHeader({
  icon: Icon,
  title,
  titleAccessory,
  actions,
  sticky = false,
  className,
  ...props
}: WorkspacePanelHeaderProps) {
  return (
    <CardHeader
      data-slot="workspace-panel-header"
      className={cn(
        "flex h-14 shrink-0 flex-row items-center justify-between gap-3 border-b px-4 py-0 [.border-b]:pb-0",
        sticky && "sticky top-0 z-[60] bg-background",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-1">
        <CardTitle data-slot="workspace-panel-title" className="flex min-w-0 items-center gap-2 text-sm">
          {Icon && <Icon className="size-4 shrink-0" />}
          <span className="truncate">{title}</span>
          {titleAccessory}
        </CardTitle>
      </div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </CardHeader>
  );
}
