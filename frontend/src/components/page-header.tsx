"use client";

import { ReactNode } from "react";

export interface PageHeaderProps {
  /** Icon shown to the left of the title (e.g. a Lucide icon). */
  icon?: ReactNode;
  /** Page title. Accepts a ReactNode so a trailing Badge etc. can share the line. */
  title: ReactNode;
  /** Optional supporting text under the title. */
  description?: ReactNode;
  /** Optional controls (buttons, toggles) aligned to the right. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard page-level H1 block: `font-heading text-3xl font-bold
 * tracking-tight` title, optional icon/description/actions. Use this for
 * every top-level page heading instead of inlining the recipe.
 */
export function PageHeader({ icon, title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-4 ${className ?? ""}`}>
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}
