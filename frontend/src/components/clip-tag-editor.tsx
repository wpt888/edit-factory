"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X, Tag } from "lucide-react";
import { toast } from "sonner";

const MAX_TAGS = 20;

interface ClipTagEditorProps {
  clipId: string;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
}

export function ClipTagEditor({ clipId: _clipId, tags, onTagsChange }: ClipTagEditorProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (raw: string) => {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return;

    if (tags.length >= MAX_TAGS) {
      toast.error(`Maximum ${MAX_TAGS} tags per clip`);
      setInputValue("");
      return;
    }

    // Silently ignore duplicates
    if (tags.includes(normalized)) {
      setInputValue("");
      return;
    }

    onTagsChange([...tags, normalized]);
    setInputValue("");
  };

  const removeTag = (tag: string) => {
    onTagsChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && inputValue === "" && tags.length > 0) {
      // Remove last tag on backspace when input is empty
      removeTag(tags[tags.length - 1]);
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) {
      addTag(inputValue);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1 min-h-[28px] cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
      {tags.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="text-xs h-5 pl-1.5 pr-1 gap-0.5 font-normal"
        >
          {tag}
          <button
            type="button"
            className="ml-0.5 hover:text-destructive transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(tag);
            }}
            aria-label={`Remove tag ${tag}`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      <Input
        ref={inputRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={tags.length === 0 ? "Add tags..." : ""}
        className="h-5 border-none shadow-none p-0 text-xs w-[80px] min-w-0 focus-visible:ring-0 bg-transparent placeholder:text-muted-foreground/50"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
