"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw, ChevronDown } from "lucide-react";
import { API_URL, apiGet } from "@/lib/api";

interface MatchSegment {
  segment_id: string | null;
  thumbnail_path?: string;
  srt_text: string;
}

interface FrameCandidate {
  index: number;
  timestamp: number;
  frame_url: string;
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
  onSelect: (segmentId: string, imageUrl: string) => void;
  onResetAuto: () => void;
}

export function ThumbnailPicker({
  open,
  onOpenChange,
  currentThumbnail,
  matchedSegments,
  onSelect,
  onResetAuto,
}: ThumbnailPickerProps) {
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null);
  const [extraFrames, setExtraFrames] = useState<Record<string, FrameCandidate[]>>({});
  const [loadingFrames, setLoadingFrames] = useState<string | null>(null);

  // Deduplicate segments (same segment may match multiple SRT entries)
  const uniqueSegments = matchedSegments.reduce<MatchSegment[]>((acc, seg) => {
    if (seg.segment_id && !acc.some(s => s.segment_id === seg.segment_id)) {
      acc.push(seg);
    }
    return acc;
  }, []);

  const handleLoadMoreFrames = useCallback(async (segmentId: string) => {
    if (extraFrames[segmentId]) {
      // Already loaded — just toggle visibility
      setExpandedSegment(prev => prev === segmentId ? null : segmentId);
      return;
    }
    setLoadingFrames(segmentId);
    setExpandedSegment(segmentId);
    try {
      const res = await apiGet(`/segments/${segmentId}/frames?count=6`);
      const data: FrameCandidate[] = await res.json();
      setExtraFrames(prev => ({ ...prev, [segmentId]: data }));
    } catch (err) {
      console.error("Failed to load frames:", err);
    } finally {
      setLoadingFrames(null);
    }
  }, [extraFrames]);

  const handleSelect = (segmentId: string, imageUrl: string) => {
    onSelect(segmentId, imageUrl);
    onOpenChange(false);
  };

  const segFileUrl = (filename: string) =>
    `${API_URL}/segments/files/${encodeURIComponent(filename.split("/").pop() || filename)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose Thumbnail</DialogTitle>
        </DialogHeader>

        {currentThumbnail && !currentThumbnail.isAutoSelected && (
          <Button variant="ghost" size="sm" className="w-fit" onClick={onResetAuto}>
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset to auto
          </Button>
        )}

        <div className="space-y-4">
          {uniqueSegments.map((seg) => {
            const segId = seg.segment_id!;
            const isSelected = currentThumbnail?.segmentId === segId;
            const isExpanded = expandedSegment === segId;
            const thumbFilename = seg.thumbnail_path;

            return (
              <div key={segId} className="space-y-2">
                {/* Segment thumbnail */}
                <div className="flex items-center gap-3">
                  {thumbFilename ? (
                    <button
                      onClick={() => handleSelect(segId, thumbFilename)}
                      className={`w-[54px] h-[96px] rounded overflow-hidden border-2 flex-shrink-0 hover:opacity-80 transition-opacity ${
                        isSelected ? "border-blue-500 ring-2 ring-blue-300" : "border-transparent"
                      }`}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-fit h-6 text-xs px-2"
                      onClick={() => handleLoadMoreFrames(segId)}
                    >
                      {loadingFrames === segId ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      )}
                      More frames
                    </Button>
                  </div>
                </div>

                {/* Expanded frames grid */}
                {isExpanded && extraFrames[segId] && (
                  <div className="grid grid-cols-3 gap-2 pl-2">
                    {extraFrames[segId].map((frame) => {
                      const frameSelected = currentThumbnail?.imageUrl === frame.frame_url;
                      return (
                        <button
                          key={frame.index}
                          onClick={() => handleSelect(segId, frame.frame_url)}
                          className={`aspect-[9/16] rounded overflow-hidden border-2 hover:opacity-80 transition-opacity ${
                            frameSelected ? "border-blue-500 ring-2 ring-blue-300" : "border-muted"
                          }`}
                        >
                          <img
                            src={segFileUrl(frame.frame_url)}
                            alt={`Frame at ${frame.timestamp.toFixed(1)}s`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
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
