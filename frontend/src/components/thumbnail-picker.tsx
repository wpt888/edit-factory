"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw } from "lucide-react";
import { apiGet } from "@/lib/api";
import { useApiUrl } from "@/hooks/use-api-url";
import { segmentFileUrl } from "@/lib/media-url";

interface MatchSegment {
  segment_id: string | null;
  thumbnail_path?: string;
  srt_text: string;
}

export interface ThumbnailSelection {
  segmentId: string;
  imageUrl: string; // relative filename served via /segments/files/
  isAutoSelected: boolean;
}

interface ThumbnailPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentThumbnail: ThumbnailSelection | null;
  matchedSegments: MatchSegment[];
  /** Frames already claimed by OTHER variants in the batch — cannot be reused. */
  usedImageUrls?: Set<string>;
  onSelect: (segmentId: string, imageUrl: string) => void;
  onResetAuto: () => void;
}

export function ThumbnailPicker({
  open,
  onOpenChange,
  currentThumbnail,
  matchedSegments,
  usedImageUrls,
  onSelect,
  onResetAuto,
}: ThumbnailPickerProps) {
  const mediaApiUrl = useApiUrl();
  const used = usedImageUrls ?? new Set<string>();
  const segFileUrl = (filename: string) => segmentFileUrl(mediaApiUrl, filename);

  // Deduplicate segments (same segment may match multiple SRT entries), then
  // lay them left→right as one continuous timeline. A cursor at normalized
  // position `pos` [0,1] maps to segment floor(pos*N) at its local fraction.
  const segments = useMemo(
    () =>
      matchedSegments.reduce<MatchSegment[]>((acc, seg) => {
        if (seg.segment_id && !acc.some((s) => s.segment_id === seg.segment_id)) {
          acc.push(seg);
        }
        return acc;
      }, []),
    [matchedSegments]
  );
  const n = segments.length;

  const resolve = useCallback(
    (pos: number) => {
      if (n === 0) return null;
      const scaled = Math.min(Math.max(pos, 0) * n, n - 1e-6);
      const idx = Math.floor(scaled);
      return { seg: segments[idx], idx, local: scaled - idx };
    },
    [segments, n]
  );

  const [pos, setPos] = useState(0);
  // What "Select" would pick: the frame currently under the cursor.
  const [pick, setPick] = useState<{ segId: string; imageUrl?: string } | null>(null);
  const [caption, setCaption] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Seed the cursor from the current thumbnail (so the modal opens where you left off).
  useEffect(() => {
    if (!open) return;
    const startIdx = currentThumbnail
      ? Math.max(0, segments.findIndex((s) => s.segment_id === currentThumbnail.segmentId))
      : 0;
    const seg = segments[startIdx];
    setPos(n > 0 ? (startIdx + 0.5) / n : 0);
    setPick(seg ? { segId: seg.segment_id!, imageUrl: currentThumbnail?.imageUrl ?? seg.thumbnail_path } : null);
    setCaption(seg?.srt_text ?? "");
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const scrub = useCallback(
    (nextPos: number) => {
      const r = resolve(nextPos);
      if (!r) return;
      setPos(nextPos);
      setCaption(r.seg.srt_text);
      // Instant feedback: show the segment's default thumbnail while the exact
      // frame is extracted server-side.
      setPick({ segId: r.seg.segment_id!, imageUrl: r.seg.thumbnail_path });
      setLoading(true);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await apiGet(`/segments/${r.seg.segment_id}/frame?pos=${r.local.toFixed(3)}`);
          const data = await res.json();
          setPick({ segId: r.seg.segment_id!, imageUrl: data.frame_url });
        } catch (err) {
          console.error("Failed to extract frame:", err);
        } finally {
          setLoading(false);
        }
      }, 200);
    },
    [resolve]
  );

  const taken =
    !!pick?.imageUrl && pick.imageUrl !== currentThumbnail?.imageUrl && used.has(pick.imageUrl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose Thumbnail</DialogTitle>
        </DialogHeader>

        {n === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No matched segments available for thumbnail selection.
          </p>
        ) : (
          <div className="space-y-3">
            {/* Frame preview */}
            <div className="relative w-[135px] aspect-[9/16] rounded overflow-hidden border-2 border-primary mx-auto">
              {pick?.imageUrl ? (
                <img
                  src={segFileUrl(pick.imageUrl)}
                  alt="Thumbnail preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-muted" />
              )}
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <Loader2 className="size-5 animate-spin text-white" />
                </div>
              )}
            </div>

            {caption && (
              <p className="text-xs text-muted-foreground text-center truncate px-2">{caption}</p>
            )}

            {/* Timeline: filmstrip of segment thumbnails + draggable cursor */}
            <div className="relative h-12 rounded overflow-hidden border border-border select-none">
              <div className="absolute inset-0 flex pointer-events-none">
                {segments.map((seg, i) => (
                  <div
                    key={seg.segment_id}
                    className="h-full flex-1 border-r border-black/40 bg-muted bg-cover bg-center last:border-r-0"
                    style={seg.thumbnail_path ? { backgroundImage: `url("${segFileUrl(seg.thumbnail_path)}")` } : undefined}
                    aria-hidden
                    data-idx={i}
                  />
                ))}
              </div>
              {/* Cursor */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.6)] pointer-events-none"
                style={{ left: `${pos * 100}%` }}
              />
              {/* Transparent range = the scrubbable cursor (keyboard accessible) */}
              <input
                type="range"
                min={0}
                max={1000}
                value={Math.round(pos * 1000)}
                onChange={(e) => scrub(Number(e.target.value) / 1000)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
                aria-label="Scrub thumbnail frame"
              />
            </div>

            {taken && (
              <Badge variant="outline" className="w-fit text-xs mx-auto block">
                Frame already used by another variant
              </Badge>
            )}

            <div className="flex items-center gap-2">
              {currentThumbnail && !currentThumbnail.isAutoSelected && (
                <Button variant="ghost" size="sm" onClick={onResetAuto}>
                  <RotateCcw className="size-3 mr-1" />
                  Reset to auto
                </Button>
              )}
              <div className="flex-1" />
              <Button
                size="sm"
                disabled={!pick?.imageUrl || taken || loading}
                onClick={() => {
                  if (pick?.imageUrl) {
                    onSelect(pick.segId, pick.imageUrl);
                    onOpenChange(false);
                  }
                }}
              >
                Select
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
