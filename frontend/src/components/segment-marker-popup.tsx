"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X, Plus, Tag } from "lucide-react";

interface SegmentMarkerPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (keywords: string[], notes: string) => void;
  startTime: number;
  endTime: number;
  initialKeywords?: string[];
  initialNotes?: string;
  isEditing?: boolean;
}

export function SegmentMarkerPopup({
  isOpen,
  onClose,
  onSave,
  startTime,
  endTime,
  initialKeywords = [],
  initialNotes = "",
  isEditing = false,
}: SegmentMarkerPopupProps) {
  const [keywords, setKeywords] = useState<string[]>(initialKeywords);
  const [newKeyword, setNewKeyword] = useState("");
  const [notes, setNotes] = useState(initialNotes);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  // Format time as mm:ss.ms
  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const duration = endTime - startTime;

  // Add keyword
  const addKeyword = () => {
    const trimmed = newKeyword.trim().toLowerCase();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords([...keywords, trimmed]);
      setNewKeyword("");
    }
  };

  // Handle Enter key in keyword input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    } else if (e.key === "," || e.key === ";") {
      e.preventDefault();
      addKeyword();
    }
  };

  // Remove keyword
  const removeKeyword = (keyword: string) => {
    setKeywords(keywords.filter((k) => k !== keyword));
  };

  // Handle save
  const handleSave = () => {
    onSave(keywords, notes);
    onClose();
  };

  // Handle paste (split by comma)
  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text");
    if (pasted.includes(",") || pasted.includes(";")) {
      e.preventDefault();
      const newKeywords = pasted
        .split(/[,;]/)
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k && !keywords.includes(k));
      setKeywords([...keywords, ...newKeywords]);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            {isEditing ? "Edit Segment" : "New Segment"}
          </DialogTitle>
          <DialogDescription>
            {formatTime(startTime)} → {formatTime(endTime)} ({duration.toFixed(2)}s)
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Keywords input */}
          <div className="space-y-2">
            <Label htmlFor="keywords">Keywords</Label>
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                id="keywords"
                placeholder="Enter keyword and press Enter"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addKeyword}
                disabled={!newKeyword.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Keywords are used for SRT matching. Separate with Enter, comma, or semicolon.
            </p>
          </div>

          {/* Keywords tags */}
          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {keywords.map((keyword) => (
                <Badge
                  key={keyword}
                  variant="secondary"
                  className="pl-2 pr-1 py-1 gap-1"
                >
                  {keyword}
                  <button
                    type="button"
                    onClick={() => removeKeyword(keyword)}
                    className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add notes about this segment..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          {/* Quick keyword suggestions */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Quick add:</Label>
            <div className="flex flex-wrap gap-1">
              {["intro", "product", "demo", "close-up", "transition", "outro", "talking"]
                .filter((s) => !keywords.includes(s))
                .map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setKeywords([...keywords, suggestion])}
                  >
                    + {suggestion}
                  </Button>
                ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {isEditing ? "Update" : "Save Segment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
