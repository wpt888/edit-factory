"use client";

import { Eye, EyeOff, MoreHorizontal, Plus, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type TimelineTrackKind = "video" | "audio";

type TimelineTrackControlsProps = {
  id: string;
  kind: TimelineTrackKind;
  disabled?: boolean;
  monitored?: boolean;
  onMonitorChange?: () => void;
  addMedia?: () => void;
  addMediaUnavailable?: string;
  onAddTrack: () => void;
  canDelete?: boolean;
  deleteUnavailable?: string;
  onDelete?: () => void;
};

/**
 * Premiere-style track header controls shared by Pipeline and template editors.
 * Video tracks expose visibility, audio tracks expose mute, and both keep media
 * insertion plus track management in the same compact locations.
 */
export function TimelineTrackControls({
  id,
  kind,
  disabled = false,
  monitored = true,
  onMonitorChange,
  addMedia,
  addMediaUnavailable,
  onAddTrack,
  canDelete = false,
  deleteUnavailable,
  onDelete,
}: TimelineTrackControlsProps) {
  const isVideo = kind === "video";
  const monitorLabel = isVideo
    ? `${monitored ? "Hide" : "Show"} video track ${id}`
    : `${monitored ? "Mute" : "Unmute"} audio track ${id}`;
  const addMediaLabel = `Add media to ${id}`;

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={onMonitorChange}
        disabled={disabled || !onMonitorChange}
        aria-label={monitorLabel}
        aria-pressed={!monitored}
        className={`flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 ${
          monitored ? "text-white/50" : "bg-primary/15 text-primary"
        }`}
        title={monitorLabel}
      >
        {isVideo
          ? monitored ? <Eye className="size-3" /> : <EyeOff className="size-3" />
          : <span className="text-[9px] font-bold">M</span>}
      </button>

      <button
        type="button"
        onClick={addMedia}
        disabled={disabled || !addMedia}
        className="shrink-0 rounded p-0.5 text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:text-white/20 disabled:hover:bg-transparent"
        title={addMedia && !disabled ? addMediaLabel : addMediaUnavailable}
        aria-label={addMedia && !disabled ? addMediaLabel : `${addMediaLabel} unavailable`}
      >
        <Plus className="size-3" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex size-5 shrink-0 items-center justify-center rounded text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            aria-label={`Open ${id} track settings`}
            title={`${id} track settings`}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44 text-xs">
          <DropdownMenuItem onSelect={onAddTrack} disabled={disabled}>
            <Plus className="size-3.5" /> Add {kind} track
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={disabled || !canDelete}
            onSelect={onDelete}
            title={!canDelete ? deleteUnavailable : undefined}
            aria-label={`Delete ${kind} track ${id}`}
          >
            <Trash2 className="size-3.5" /> Delete {kind} track
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
