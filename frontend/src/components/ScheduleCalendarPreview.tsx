"use client";

import { useMemo } from "react";

/** A clip entry within the schedule preview */
export interface ScheduleEntry {
  date: string; // ISO date string (YYYY-MM-DD)
  clip_id: string;
  clip_name: string;
  collection_name: string;
  thumbnail_path?: string;
}

interface ScheduleCalendarPreviewProps {
  entries: ScheduleEntry[];
}

/** Fixed palette of distinct Tailwind-friendly colours keyed by collection index */
const COLLECTION_COLORS = [
  { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-300 dark:border-emerald-700" },
  { bg: "bg-zinc-100 dark:bg-zinc-800/40", text: "text-zinc-700 dark:text-zinc-300", border: "border-zinc-300 dark:border-zinc-700" },
  { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300", border: "border-amber-300 dark:border-amber-700" },
  { bg: "bg-teal-100 dark:bg-teal-900/40", text: "text-teal-700 dark:text-teal-300", border: "border-teal-300 dark:border-teal-700" },
  { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300", border: "border-orange-300 dark:border-orange-700" },
  { bg: "bg-slate-100 dark:bg-slate-800/40", text: "text-slate-700 dark:text-slate-300", border: "border-slate-300 dark:border-slate-700" },
  { bg: "bg-stone-100 dark:bg-stone-800/40", text: "text-stone-700 dark:text-stone-300", border: "border-stone-300 dark:border-stone-700" },
  { bg: "bg-lime-100 dark:bg-lime-900/40", text: "text-lime-700 dark:text-lime-300", border: "border-lime-300 dark:border-lime-700" },
  { bg: "bg-neutral-100 dark:bg-neutral-800/40", text: "text-neutral-700 dark:text-neutral-300", border: "border-neutral-300 dark:border-neutral-700" },
  { bg: "bg-cyan-100 dark:bg-cyan-900/40", text: "text-cyan-700 dark:text-cyan-300", border: "border-cyan-300 dark:border-cyan-700" },
];

function getColor(index: number) {
  return COLLECTION_COLORS[index % COLLECTION_COLORS.length];
}

/** Format a YYYY-MM-DD date string nicely */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Calendar-style grid preview of scheduled clips.
 * Rows = days, columns = clips for that day.
 */
export function ScheduleCalendarPreview({ entries }: ScheduleCalendarPreviewProps) {
  // Build colour map keyed by collection name (stable across renders for same input)
  const collectionColorMap = useMemo(() => {
    const names = [...new Set(entries.map((e) => e.collection_name))];
    const map: Record<string, ReturnType<typeof getColor>> = {};
    names.forEach((name, i) => {
      map[name] = getColor(i);
    });
    return map;
  }, [entries]);

  // Group entries by date, preserving order
  const grouped = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.date) || [];
      list.push(entry);
      map.set(entry.date, list);
    }
    // Sort dates ascending
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No clips to preview. Adjust your configuration and try again.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(collectionColorMap).map(([name, color]) => (
          <span
            key={name}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${color.bg} ${color.text}`}
          >
            <span className={`inline-block size-2 rounded-full ${color.border} border-2`} />
            {name}
          </span>
        ))}
      </div>

      {/* Day rows */}
      <div className="border rounded-lg overflow-hidden divide-y">
        {grouped.map(([date, clips]) => (
          <div key={date} className="flex items-stretch">
            {/* Date label */}
            <div className="w-32 shrink-0 flex items-center px-3 py-2 bg-muted/50 border-r">
              <span className="text-sm font-medium">{formatDate(date)}</span>
            </div>

            {/* Clip cells */}
            <div className="flex-1 flex flex-wrap gap-2 p-2">
              {clips.map((clip) => {
                const color = collectionColorMap[clip.collection_name];
                return (
                  <div
                    key={clip.clip_id}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${color.bg} ${color.border}`}
                  >
                    {clip.thumbnail_path ? (
                      <img
                        src={clip.thumbnail_path}
                        alt=""
                        className="size-8 rounded object-cover shrink-0"
                      />
                    ) : (
                      <div className="size-8 rounded bg-muted flex items-center justify-center shrink-0">
                        <span className="text-[10px] text-muted-foreground">N/A</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className={`font-medium truncate max-w-[140px] ${color.text}`}>
                        {clip.clip_name}
                      </div>
                      <div className="text-muted-foreground truncate max-w-[140px]">
                        {clip.collection_name}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
