"use client";

import { useState } from "react";
import { Music, Trash2, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { MusicAssetPickerDialog } from "@/components/dialogs/music-asset-picker-dialog";
import type { MusicSettings } from "@/types/composition-timeline";

const DEFAULT_MUSIC: MusicSettings = {
  assetId: "",
  assetUrl: undefined,
  label: undefined,
  volume: 0.3,
  ducking: true,
  fadeInMs: 0,
  fadeOutMs: 0,
};

interface MusicInspectorProps {
  music: MusicSettings | null;
  onChange: (music: MusicSettings | null) => void;
  displayMode?: "card" | "full";
}

export function MusicInspector({ music, onChange, displayMode = "card" }: MusicInspectorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const patch = (next: Partial<MusicSettings>) => onChange({ ...(music ?? DEFAULT_MUSIC), ...next });

  const wrapperClass =
    displayMode === "full"
      ? "col-start-1 row-start-2 min-h-0 space-y-4 overflow-y-auto bg-[#111411] p-4 text-white"
      : "space-y-4 rounded-md border border-lime-300/25 bg-[#111411] p-4 text-white";

  return (
    <div className={wrapperClass} data-testid="music-inspector">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/60">
            <Music className="size-3.5" />
            Background music
          </div>
          <p className="mt-1 truncate text-sm font-medium">
            {music?.label || (music ? "Selected track" : "No music")}
          </p>
        </div>
        {music && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-red-300 hover:bg-red-500/10 hover:text-red-200"
            onClick={() => onChange(null)}
            data-testid="music-clear"
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2"
        onClick={() => setPickerOpen(true)}
        data-testid="music-pick"
      >
        <Music className="size-4" />
        {music ? "Change track" : "Add music"}
      </Button>

      {music && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1 text-xs">
                <Waves className="size-3" />
                Volume
              </Label>
              <span className="font-mono text-[11px] text-white/60">{Math.round(music.volume * 100)}%</span>
            </div>
            <Slider
              value={[Math.round(music.volume * 100)]}
              min={0}
              max={150}
              step={5}
              onValueChange={([v]) => patch({ volume: v / 100 })}
              data-testid="music-volume"
            />
          </div>

          <div className="flex items-center justify-between rounded border border-white/10 bg-black/20 px-3 py-2">
            <div>
              <Label className="text-xs">Auto-duck under voice</Label>
              <p className="text-[10px] text-white/45">Lower the music while the voiceover speaks.</p>
            </div>
            <Switch
              checked={music.ducking}
              onCheckedChange={(checked) => patch({ ducking: checked })}
              data-testid="music-ducking"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs">
              <span className="text-white/60">Fade in (s)</span>
              <Input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={music.fadeInMs / 1000}
                onChange={(e) => patch({ fadeInMs: Math.round(Math.max(0, Number(e.target.value) || 0) * 1000) })}
                className="h-8 bg-black/30"
                data-testid="music-fade-in"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-white/60">Fade out (s)</span>
              <Input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={music.fadeOutMs / 1000}
                onChange={(e) => patch({ fadeOutMs: Math.round(Math.max(0, Number(e.target.value) || 0) * 1000) })}
                className="h-8 bg-black/30"
                data-testid="music-fade-out"
              />
            </label>
          </div>
        </div>
      )}

      <MusicAssetPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={({ url, label }) =>
          patch({ assetId: url, assetUrl: url, label: label ?? music?.label })
        }
      />
    </div>
  );
}
