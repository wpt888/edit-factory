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
import {
  CheckCircle,
  AlertTriangle,
  Search,
  Film,
  GripVertical,
  RefreshCw,
  Clock,
  Plus,
  Minus,
} from "lucide-react";

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
  duration_override?: number;  // User-adjusted duration in seconds
  is_auto_filled?: boolean;  // Backend auto-filled from random segment pool
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
  // Dialog state (used for both unmatched assignment and swap)
  const [assigningIndex, setAssigningIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Drag-and-drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Filtered segments based on search
  const filteredSegments = availableSegments.filter((seg) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return seg.keywords.some((kw) => kw.toLowerCase().includes(q));
  });

  // --- Dialog handlers ---

  const handleOpenDialog = (matchIndex: number) => {
    setAssigningIndex(matchIndex);
    setSearchQuery("");
  };

  const handleCloseDialog = () => {
    setAssigningIndex(null);
    setSearchQuery("");
  };

  const handleSelectSegment = (segment: SegmentOption) => {
    if (assigningIndex === null) return;

    const updatedMatches = matches.map((match, idx) => {
      if (idx === assigningIndex) {
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

  // --- Drag-and-drop handlers ---

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Required for Firefox
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only clear if leaving the row entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updated = [...matches];

    // Swap segment assignments between dragged and dropped positions
    // SRT text/timing stays in place — only the segment mapping moves
    const dragSegment = {
      segment_id: updated[dragIndex].segment_id,
      segment_keywords: updated[dragIndex].segment_keywords,
      matched_keyword: updated[dragIndex].matched_keyword,
      confidence: updated[dragIndex].confidence,
    };
    const dropSegment = {
      segment_id: updated[dropIndex].segment_id,
      segment_keywords: updated[dropIndex].segment_keywords,
      matched_keyword: updated[dropIndex].matched_keyword,
      confidence: updated[dropIndex].confidence,
    };

    updated[dragIndex] = { ...updated[dragIndex], ...dropSegment };
    updated[dropIndex] = { ...updated[dropIndex], ...dragSegment };

    onMatchesChange(updated);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // --- Duration adjustment handlers ---

  const adjustDuration = (index: number, delta: number) => {
    const match = matches[index];
    const naturalDuration = match.srt_end - match.srt_start;
    const currentDuration = match.duration_override ?? naturalDuration;
    const newDuration = Math.max(0.5, Math.min(10, currentDuration + delta));
    const updated = [...matches];
    updated[index] = { ...updated[index], duration_override: newDuration };
    onMatchesChange(updated);
  };

  if (matches.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Film className="h-4 w-4 mr-2" />
        No SRT phrases to display.
      </div>
    );
  }

  // Determine dialog title based on context
  const isSwapMode =
    assigningIndex !== null &&
    matches[assigningIndex]?.segment_id !== null;
  const dialogTitle = isSwapMode ? "Swap Segment" : "Select Segment";
  const dialogSubLabel = isSwapMode ? "Swapping segment for phrase" : "Assigning to phrase";

  return (
    <>
      <ScrollArea className="max-h-[400px] rounded-md border">
        <div className="divide-y">
          {matches.map((match, idx) => {
            const isMatched = match.segment_id !== null && match.confidence > 0;
            const isAutoFilled = match.is_auto_filled === true && match.segment_id !== null;
            const isDragging = dragIndex === idx;
            const isDragOver = dragOverIndex === idx && dragIndex !== idx;
            const displayText =
              match.srt_text.length > 60
                ? match.srt_text.substring(0, 60) + "..."
                : match.srt_text;
            const naturalDuration = match.srt_end - match.srt_start;
            const displayDuration = match.duration_override ?? naturalDuration;
            const isDurationOverridden =
              match.duration_override !== undefined &&
              Math.abs(match.duration_override - naturalDuration) > 0.05;

            return (
              <div
                key={idx}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                className={`group flex items-center gap-3 px-3 py-2.5 min-h-[48px] border-l-4 transition-colors select-none ${
                  isMatched
                    ? "border-l-green-500 bg-green-50 dark:bg-green-950/20"
                    : isAutoFilled
                    ? "border-l-blue-500 bg-blue-50 dark:bg-blue-950/20"
                    : "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20"
                } ${isDragging ? "opacity-50" : ""} ${
                  isDragOver
                    ? "border-t-2 border-t-blue-500"
                    : "border-t-transparent"
                }`}
              >
                {/* Drag handle */}
                <div
                  className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  title="Drag to swap segment assignment"
                >
                  <GripVertical className="h-4 w-4" />
                </div>

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

                {/* Right: Duration + Match status (stacked) */}
                <div className="flex-shrink-0 flex flex-col items-end gap-1">
                  {/* Duration adjustment control */}
                  <div className="flex items-center gap-1 text-xs">
                    <span title="Segment duration">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => adjustDuration(idx, -0.5)}
                      title="Decrease duration by 0.5s"
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span
                      className={`w-10 text-center font-mono tabular-nums ${
                        isDurationOverridden
                          ? "text-blue-600 dark:text-blue-400 font-semibold"
                          : "text-muted-foreground"
                      }`}
                      title={
                        isDurationOverridden
                          ? `Adjusted from ${naturalDuration.toFixed(1)}s`
                          : "Natural SRT duration"
                      }
                    >
                      {displayDuration.toFixed(1)}s
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => adjustDuration(idx, 0.5)}
                      title="Increase duration by 0.5s"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Match status */}
                  <div className="flex items-center gap-2">
                    {isMatched ? (
                      <>
                        <Badge
                          variant="secondary"
                          className="text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 max-w-[90px]"
                        >
                          <CheckCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                          <span className="truncate">{match.matched_keyword}</span>
                        </Badge>
                        <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                          {Math.round(match.confidence * 100)}%
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleOpenDialog(idx)}
                          disabled={availableSegments.length === 0}
                          title="Swap segment"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      </>
                    ) : isAutoFilled ? (
                      <>
                        <Badge
                          variant="secondary"
                          className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 max-w-[90px]"
                        >
                          <Film className="h-3 w-3 mr-1 flex-shrink-0" />
                          <span className="truncate">{match.segment_keywords[0] ?? "auto"}</span>
                        </Badge>
                        <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                          auto
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleOpenDialog(idx)}
                          disabled={availableSegments.length === 0}
                          title="Swap segment"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
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
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Segment assignment / swap dialog */}
      <Dialog
        open={assigningIndex !== null}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>

          {assigningIndex !== null && (
            <div className="space-y-3">
              {/* Phrase being assigned */}
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {dialogSubLabel}
                </span>
                <p className="mt-0.5 font-medium">
                  &ldquo;{matches[assigningIndex]?.srt_text}&rdquo;
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
