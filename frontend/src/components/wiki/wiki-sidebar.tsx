"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, FileText, Plus, Search } from "lucide-react";

export interface WikiPageSummary {
  id: string;
  title: string;
  slug: string;
  category?: string | null;
  sort_order?: number;
  updated_at?: string | null;
}

const UNCATEGORIZED = "General";

interface WikiSidebarProps {
  pages: WikiPageSummary[];
  selectedId: string | null;
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  creating?: boolean;
}

export function WikiSidebar({
  pages,
  selectedId,
  query,
  onQueryChange,
  onSelect,
  onNew,
  creating,
}: WikiSidebarProps) {
  // Client-side filter by title (list is already loaded in full).
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) => p.title.toLowerCase().includes(q));
  }, [pages, query]);

  // Group by category, preserving the backend's category→sort_order→title order.
  const groups = React.useMemo(() => {
    const map = new Map<string, WikiPageSummary[]>();
    for (const p of filtered) {
      const cat = (p.category || "").trim() || UNCATEGORIZED;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Caută notițe…"
            className="pl-8"
          />
        </div>
        <Button size="icon" variant="default" onClick={onNew} disabled={creating} title="Notiță nouă">
          <Plus className="size-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 -mx-1 px-1">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {pages.length === 0 ? "Nicio notiță încă." : "Niciun rezultat."}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {groups.map(([category, items]) => (
              <Collapsible key={category} defaultOpen>
                <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-accent">
                  <span>
                    {category} <span className="opacity-60">({items.length})</span>
                  </span>
                  <ChevronDown className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="ml-1 flex flex-col gap-0.5 border-l pl-2 py-0.5">
                    {items.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => onSelect(p.id)}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                          selectedId === p.id
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-foreground/80"
                        }`}
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{p.title}</span>
                      </button>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
