"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw, ChevronDown } from "lucide-react";
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

/**
 * Timeline scrubber for one segment: drag the slider to any point in the clip,
 * a debounced request extracts the exact frame at that normalized position.
 */
function FrameScrubber({
  segmentId,
  defaultUrl,
  currentImageUrl,
  usedImageUrls,
  onPick,
}: {
  segmentId: string;
  defaultUrl?: string;
  currentImageUrl?: string;
  usedImageUrls: Set<string>;
  onPick: (imageUrl: string) => void;
}) {
  const mediaApiUrl = useApiUrl();
  const [pos, setPos] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string | undefined>(defaultUrl);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const requestFrame = useCallback((p: number) => {
    setLoading(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiGet(`/segments/${segmentId}/frame?pos=${p.toFixed(3)}`);
        const data = await res.json();
        setFrameUrl(data.frame_url);
      } catch (err) {
        console.error("Failed to extract frame:", err);
      } finally {
        setLoading(false);
      }
    }, 200);
  }, [segmentId]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const taken = !!frameUrl && frameUrl !== currentImageUrl && usedImageUrls.has(frameUrl);

  return (
    <div className="space-y-2 pl-2">
      <div className="relative w-[108px] aspect-[9/16] rounded overflow-hidden border-2 border-muted mx-auto">
        {frameUrl ? (
          <img
            src={segmentFileUrl(mediaApiUrl, frameUrl)}
            alt="Scrub preview"
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
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(pos * 1000)}
        onChange={(e) => {
          const p = Number(e.target.value) / 1000;
          setPos(p);
          requestFrame(p);
        }}
        className="w-full accent-primary"
        aria-label="Scrub thumbnail frame"
      />
      <Button
        size="sm"
        className="w-full h-7 text-xs"
        disabled={!frameUrl || taken}
        onClick={() => frameUrl && onPick(frameUrl)}
      >
        {taken ? "Frame already used in this batch" : "Use this frame"}
      </Button>
    </div>
  );
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
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null);
  const used = usedImageUrls ?? new Set<string>();

  // Deduplicate segments (same segment may match multiple SRT entries)
  const uniqueSegments = matchedSegments.reduce<MatchSegment[]>((acc, seg) => {
    if (seg.segment_id && !acc.some(s => s.segment_id === seg.segment_id)) {
      acc.push(seg);
    }
    return acc;
  }, []);

  const handleSelect = (segmentId: string, imageUrl: string) => {
    onSelect(segmentId, imageUrl);
    onOpenChange(false);
  };

  const segFileUrl = (filename: string) => segmentFileUrl(mediaApiUrl, filename);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose Thumbnail</DialogTitle>
        </DialogHeader>

        {currentThumbnail && !currentThumbnail.isAutoSelected && (
          <Button variant="ghost" size="sm" className="w-fit" onClick={onResetAuto}>
            <RotateCcw className="size-3 mr-1" />
            Reset to auto
          </Button>
        )}

        <div className="space-y-4">
          {uniqueSegments.map((seg) => {
            const segId = seg.segment_id!;
            const isSelected = currentThumbnail?.segmentId === segId;
            const isExpanded = expandedSegment === segId;
            const thumbFilename = seg.thumbnail_path;
            const defaultTaken = !!thumbFilename
              && thumbFilename !== currentThumbnail?.imageUrl
              && used.has(thumbFilename);

            return (
              <div key={segId} className="space-y-2">
                {/* Segment default thumbnail (quick pick) */}
                <div className="flex items-center gap-3">
                  {thumbFilename ? (
                    <button
                      onClick={() => !defaultTaken && handleSelect(segId, thumbFilename)}
                      disabled={defaultTaken}
                      className={`w-[54px] h-[96px] rounded overflow-hidden border-2 flex-shrink-0 transition-opacity ${
                        defaultTaken ? "opacity-40 cursor-not-allowed" : "hover:opacity-80"
                      } ${
                        isSelected ? "border-primary ring-2 ring-primary/40" : "border-transparent"
                      }`}
                      title={defaultTaken ? "Already used by another variant" : "Use this frame"}
                    >
                      <img
                        src={segFileUrl(thumbFilename)}
                        alt="Segment thumbnail"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ) : (
                    <div className="w-[54px] h-[96px] rounded bg-muted flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">
                      N/A
                    </div>
                  )}
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs text-muted-foreground truncate">
                      {seg.srt_text}
                    </span>
                    {isSelected && <Badge variant="secondary" className="w-fit text-xs">Selected</Badge>}
                    {defaultTaken && <Badge variant="outline" className="w-fit text-xs">Used elsewhere</Badge>}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-fit h-6 text-xs px-2"
                      onClick={() => setExpandedSegment(prev => prev === segId ? null : segId)}
                    >
                      <ChevronDown className={`size-3 mr-1 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      Scrub frames
                    </Button>
                  </div>
                </div>

                {/* Timeline scrubber */}
                {isExpanded && (
                  <FrameScrubber
                    segmentId={segId}
                    defaultUrl={thumbFilename}
                    currentImageUrl={currentThumbnail?.imageUrl}
                    usedImageUrls={used}
                    onPick={(imageUrl) => handleSelect(segId, imageUrl)}
                  />
                )}
              </div>
            );
          })}

          {uniqueSegments.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No matched segments available for thumbnail selection.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
