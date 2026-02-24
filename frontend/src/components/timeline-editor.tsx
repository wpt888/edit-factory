"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle, AlertTriangle, Search, Film } from "lucide-react";

// MatchPreview interface (mirrors pipeline/page.tsx)
export interface MatchPreview {
  srt_index: number;
  srt_text: string;
  srt_start: number;
  srt_end: number;
  segment_id: string | null;
  segment_keywords: string[];
  matched_keyword: string | null;
  confidence: number;
}

export interface SegmentOption {
  id: string;
  keywords: string[];
  source_video_id: string;
  duration: number;
}

interface TimelineEditorProps {
  matches: MatchPreview[];
  audioDuration: number;
  sourceVideoIds: string[];
  availableSegments: SegmentOption[];
  onMatchesChange: (matches: MatchPreview[]) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function TimelineEditor({
  matches,
  audioDuration: _audioDuration,
  sourceVideoIds: _sourceVideoIds,
  availableSegments,
  onMatchesChange,
}: TimelineEditorProps) {
  const [dialogOpenForIndex, setDialogOpenForIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Filtered segments based on search
  const filteredSegments = availableSegments.filter((seg) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return seg.keywords.some((kw) => kw.toLowerCase().includes(q));
  });

  const handleOpenDialog = (matchIndex: number) => {
    setDialogOpenForIndex(matchIndex);
    setSearchQuery("");
  };

  const handleCloseDialog = () => {
    setDialogOpenForIndex(null);
    setSearchQuery("");
  };

  const handleSelectSegment = (segment: SegmentOption) => {
    if (dialogOpenForIndex === null) return;

    const updatedMatches = matches.map((match, idx) => {
      if (idx === dialogOpenForIndex) {
        return {
          ...match,
          segment_id: segment.id,
          segment_keywords: segment.keywords,
          matched_keyword: segment.keywords[0] ?? null,
          confidence: 1.0,
        };
      }
      return match;
    });

    onMatchesChange(updatedMatches);
    handleCloseDialog();
  };

  if (matches.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Film className="h-4 w-4 mr-2" />
        No SRT phrases to display.
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="max-h-[400px] rounded-md border">
        <div className="divide-y">
          {matches.map((match, idx) => {
            const isMatched = match.segment_id !== null && match.confidence > 0;
            const displayText =
              match.srt_text.length > 60
                ? match.srt_text.substring(0, 60) + "..."
                : match.srt_text;

            return (
              <div
                key={idx}
                className={`flex items-center gap-3 px-3 py-2.5 min-h-[48px] border-l-4 transition-colors ${
                  isMatched
                    ? "border-l-green-500 bg-green-50 dark:bg-green-950/20"
                    : "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20"
                }`}
              >
                {/* Left: Index + time range */}
                <div className="flex-shrink-0 text-xs text-muted-foreground w-24 space-y-0.5">
                  <div className="font-mono font-semibold text-foreground">
                    #{match.srt_index + 1}
                  </div>
                  <div>
                    {formatTime(match.srt_start)} – {formatTime(match.srt_end)}
                  </div>
                </div>

                {/* Center: SRT text */}
                <div
                  className="flex-1 min-w-0 text-sm"
                  title={match.srt_text}
                >
                  {displayText}
                </div>

                {/* Right: Match status */}
                <div className="flex-shrink-0 flex items-center gap-2">
                  {isMatched ? (
                    <>
                      <Badge
                        variant="secondary"
                        className="text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        {match.matched_keyword}
                      </Badge>
                      <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                        {Math.round(match.confidence * 100)}%
                      </span>
                    </>
                  ) : (
                    <>
                      <Badge
                        variant="outline"
                        className="text-xs border-amber-400 text-amber-700 dark:text-amber-300"
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Unmatched
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
                        onClick={() => handleOpenDialog(idx)}
                        disabled={availableSegments.length === 0}
                      >
                        Select Segment
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Segment assignment dialog */}
      <Dialog
        open={dialogOpenForIndex !== null}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Select Segment</DialogTitle>
          </DialogHeader>

          {dialogOpenForIndex !== null && (
            <div className="space-y-3">
              {/* Phrase being assigned */}
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Assigning to phrase
                </span>
                <p className="mt-0.5 font-medium">
                  &ldquo;{matches[dialogOpenForIndex]?.srt_text}&rdquo;
                </p>
              </div>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search segments by keyword..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>

              {/* Segment list */}
              <ScrollArea className="max-h-[300px] rounded-md border">
                <div className="divide-y">
                  {filteredSegments.length === 0 ? (
                    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                      {availableSegments.length === 0
                        ? "No segments available for selected sources."
                        : "No segments match your search."}
                    </div>
                  ) : (
                    filteredSegments.map((seg) => (
                      <button
                        key={seg.id}
                        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors"
                        onClick={() => handleSelectSegment(seg)}
                      >
                        <Film className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap gap-1">
                            {seg.keywords.slice(0, 5).map((kw) => (
                              <Badge
                                key={kw}
                                variant="secondary"
                                className="text-xs"
                              >
                                {kw}
                              </Badge>
                            ))}
                            {seg.keywords.length > 5 && (
                              <Badge variant="outline" className="text-xs">
                                +{seg.keywords.length - 5}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {seg.duration > 0
                              ? `Duration: ${seg.duration.toFixed(1)}s`
                              : ""}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
