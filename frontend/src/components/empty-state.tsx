"use client";

import { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface EmptyStateProps {
  /** Icon to display (any ReactNode, e.g., a Lucide icon) */
  icon?: ReactNode;
  /** Main heading */
  title: string;
  /** Optional supporting text */
  description?: string;
  /** Optional call-to-action button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Reusable empty state for data pages.
 * Shows when a data list is empty and loading is complete.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="py-12 flex flex-col items-center justify-center gap-3">
      {icon && (
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="text-lg font-medium text-gray-300">{title}</p>
      {description && (
        <p className="text-sm text-gray-500 text-center max-w-xs">{description}</p>
      )}
      {action && (
        <Button
          onClick={action.onClick}
          className="mt-1 bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
