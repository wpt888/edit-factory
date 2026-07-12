"use client"

import * as React from "react"
import { GripHorizontalIcon, GripVerticalIcon } from "lucide-react"
import { Group, Panel, Separator } from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex h-full w-full",
        orientation === "vertical" && "flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  orientation = "horizontal",
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
  orientation?: "horizontal" | "vertical"
}) {
  const isVertical = orientation === "vertical"

  return (
    <Separator
      data-slot="resizable-handle"
      data-orientation={orientation}
      className={cn(
        "bg-border focus-visible:ring-ring relative z-30 flex items-center justify-center transition-colors focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden hover:bg-primary/40",
        isVertical
          ? "h-1 w-full cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:h-2 after:-translate-y-1/2"
          : "h-full w-1 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className={cn(
          "bg-card z-10 flex items-center justify-center rounded-sm border shadow-sm",
          isVertical ? "h-3 w-7" : "h-7 w-3"
        )}>
          {isVertical
            ? <GripHorizontalIcon className="size-3" />
            : <GripVerticalIcon className="size-3" />}
        </div>
      )}
    </Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
