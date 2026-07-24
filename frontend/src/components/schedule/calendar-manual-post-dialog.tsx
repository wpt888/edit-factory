"use client";

import { useEffect, useMemo, useState } from "react";
import { Film, Loader2, Search } from "lucide-react";
import dynamic from "next/dynamic";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { API_URL, apiGet } from "@/lib/api";

const PublishDialog = dynamic(
  () => import("@/components/dialogs/publish-dialog").then((module) => module.PublishDialog),
  { ssr: false },
);

interface CalendarClip {
  id: string;
  project_name: string;
  variant_name?: string;
  final_video_path?: string;
  thumbnail_path?: string;
  final_status: string;
  context_text?: string | null;
  srt_content?: string | null;
}

interface CalendarManualPostDialogProps {
  open: boolean;
  date: string | null;
  onOpenChange: (open: boolean) => void;
  onScheduled: () => void;
}

function clipLabel(clip: CalendarClip): string {
  return clip.variant_name || clip.project_name || `Clip ${clip.id.slice(0, 8)}`;
}

function captionFromSrt(srt: string | null | undefined): string | undefined {
  if (!srt) return undefined;
  const caption = srt
    .replace(/\d+\n[\d:,\s->]+\n/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return caption || undefined;
}

function defaultScheduleDate(date: string): string {
  const now = new Date();
  const localToday = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  if (date === localToday) {
    now.setMinutes(now.getMinutes() + 15, 0, 0);
    return `${date}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }
  return `${date}T09:00`;
}

export function CalendarManualPostDialog({
  open,
  date,
  onOpenChange,
  onScheduled,
}: CalendarManualPostDialogProps) {
  const [clips, setClips] = useState<CalendarClip[]>([]);
  const [selectedClip, setSelectedClip] = useState<CalendarClip | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedClip(null);
      setSearch("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(false);

    apiGet("/library/all-clips?limit=100&sync_orphans=false")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        const available = (data.clips || []).filter(
          (clip: CalendarClip) =>
            clip.final_status === "completed" && Boolean(clip.final_video_path),
        );
        setClips(available);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const visibleClips = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clips;
    return clips.filter((clip) =>
      `${clipLabel(clip)} ${clip.project_name}`.toLowerCase().includes(query),
    );
  }, [clips, search]);

  const close = () => {
    setSelectedClip(null);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open && !selectedClip} onOpenChange={(nextOpen) => !nextOpen && close()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create scheduled post</DialogTitle>
            <DialogDescription>
              Choose a rendered pipeline video for {date || "the selected day"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search rendered videos"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search rendered videos..."
                className="pl-9"
              />
            </div>

            <div className="max-h-[420px] overflow-y-auto rounded-lg border divide-y">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading rendered videos...
                </div>
              ) : loadError ? (
                <div className="py-12 text-center text-sm text-destructive">
                  Rendered videos could not be loaded.
                </div>
              ) : visibleClips.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No completed rendered videos match this search.
                </div>
              ) : (
                visibleClips.map((clip) => (
                  <Button
                    key={clip.id}
                    type="button"
                    variant="ghost"
                    aria-label={`Select ${clipLabel(clip)}`}
                    onClick={() => setSelectedClip(clip)}
                    className="h-auto w-full justify-start gap-3 rounded-none p-3 text-left"
                  >
                    <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background">
                      {clip.thumbnail_path ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`${API_URL}/library/files/${encodeURIComponent(clip.thumbnail_path)}?v=${clip.id}`}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <Film className="size-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{clipLabel(clip)}</p>
                      <p className="truncate text-xs text-muted-foreground">{clip.project_name}</p>
                    </div>
                    <Badge variant="secondary">Ready</Badge>
                  </Button>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {date && selectedClip?.final_video_path && (
        <PublishDialog
          clipId={selectedClip.id}
          videoPath={selectedClip.final_video_path}
          contextText={selectedClip.context_text || undefined}
          projectName={selectedClip.project_name}
          initialCaption={captionFromSrt(selectedClip.srt_content)}
          initialPublishMode="schedule"
          initialScheduleDate={defaultScheduleDate(date)}
          open={open}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) close();
          }}
          onPublished={onScheduled}
        />
      )}
    </>
  );
}
