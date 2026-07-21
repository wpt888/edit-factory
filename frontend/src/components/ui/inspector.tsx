"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// The one canonical field-label recipe for dense editor inspectors. Field
// labels are muted, never bold-white — that weight is reserved for section
// headers (see InspectorSectionHeader / InspectorSection).
const FIELD_LABEL_CLASS = "text-xs font-medium text-muted-foreground";

/** Stacked label + control. Optional helper renders muted beneath the control. */
export function InspectorField({
  label,
  htmlFor,
  helper,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  helper?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className={FIELD_LABEL_CLASS}>
        {label}
      </Label>
      {children}
      {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
    </div>
  );
}

/** Title + optional collapsed-value summary. Presentational — for use inside a
 *  trigger (Accordion or Collapsible) that supplies its own chevron. */
export function InspectorSectionHeader({
  title,
  summary,
}: {
  title: string;
  summary?: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <span className="font-medium text-foreground">{title}</span>
      {summary && (
        <span className="truncate text-xs font-normal text-muted-foreground">
          {summary}
        </span>
      )}
    </span>
  );
}

/** Flush collapsible section: h-8 trigger, content under a divider. Wrap sibling
 *  sections in a `divide-y divide-border/70` container for inter-section rules. */
export function InspectorSection({
  title,
  summary,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  summary?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex h-8 w-full items-center gap-3 px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring [&[data-state=open]_svg]:rotate-180">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {summary && (
          <span className="ml-auto truncate text-xs font-normal text-muted-foreground">
            {summary}
          </span>
        )}
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !summary && "ml-auto")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <div className="space-y-4 p-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Flush switch row: field-label (+ optional helper) left, Switch right. */
export function InspectorSwitchRow({
  label,
  helper,
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
}: {
  label: string;
  helper?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-8 items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        <Label htmlFor={id} className={FIELD_LABEL_CLASS}>
          {label}
        </Label>
        {helper && <p className="text-[11px] text-muted-foreground">{helper}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
