"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Layers, Save } from "lucide-react";
import { PipConfig, DEFAULT_PIP_CONFIG } from "@/components/product-picker-dialog";

// ============== TYPES ==============

interface PipOverlayPanelProps {
  config: PipConfig;
  onChange: (config: PipConfig) => void;
  onSave: (config: PipConfig) => void;
  isSaving?: boolean;
}

// ============== OPTION MAPS ==============

const POSITION_OPTIONS: { value: PipConfig["position"]; label: string }[] = [
  { value: "top-left", label: "TL" },
  { value: "top-right", label: "TR" },
  { value: "bottom-left", label: "BL" },
  { value: "bottom-right", label: "BR" },
];

const SIZE_OPTIONS: { value: PipConfig["size"]; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const ANIMATION_OPTIONS: { value: PipConfig["animation"]; label: string }[] = [
  { value: "static", label: "Static" },
  { value: "fade", label: "Fade" },
  { value: "kenburns", label: "Ken Burns" },
];

// ============== COMPONENT ==============

export function PipOverlayPanel({
  config,
  onChange,
  onSave,
  isSaving = false,
}: PipOverlayPanelProps) {
  const update = (partial: Partial<PipConfig>) => {
    onChange({ ...config, ...partial });
  };

  const isDefault =
    config.enabled === DEFAULT_PIP_CONFIG.enabled &&
    config.position === DEFAULT_PIP_CONFIG.position &&
    config.size === DEFAULT_PIP_CONFIG.size &&
    config.animation === DEFAULT_PIP_CONFIG.animation;

  const saveDisabled = (!config.enabled && isDefault) || isSaving;

  return (
    <div className="space-y-2 rounded-md border p-2 bg-muted/30">

      {/* Enable toggle row */}
      <div className="flex items-center gap-2">
        <Switch
          id="pip-enabled"
          checked={config.enabled}
          onCheckedChange={(v) => update({ enabled: v })}
        />
        <Label
          htmlFor="pip-enabled"
          className="text-xs flex items-center gap-1 cursor-pointer"
        >
          <Layers className="h-3 w-3" />
          PiP Overlay
        </Label>
      </div>

      {/* Position selector */}
      <div className={`space-y-1 ${!config.enabled ? "opacity-40 pointer-events-none" : ""}`}>
        <Label className="text-xs text-muted-foreground">Position</Label>
        <div className="flex gap-1">
          {POSITION_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={config.position === opt.value ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2 flex-1"
              onClick={() => update({ position: opt.value })}
              disabled={!config.enabled}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Size selector */}
      <div className={`space-y-1 ${!config.enabled ? "opacity-40 pointer-events-none" : ""}`}>
        <Label className="text-xs text-muted-foreground">Size</Label>
        <div className="flex gap-1">
          {SIZE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={config.size === opt.value ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2 flex-1"
              onClick={() => update({ size: opt.value })}
              disabled={!config.enabled}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Animation selector */}
      <div className={`space-y-1 ${!config.enabled ? "opacity-40 pointer-events-none" : ""}`}>
        <Label className="text-xs text-muted-foreground">Animation</Label>
        <div className="flex gap-1">
          {ANIMATION_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={config.animation === opt.value ? "default" : "outline"}
              size="sm"
              className="h-6 text-[10px] px-2 flex-1"
              onClick={() => update({ animation: opt.value })}
              disabled={!config.enabled}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Save button */}
      <Button
        size="sm"
        className="w-full"
        onClick={() => onSave(config)}
        disabled={saveDisabled}
      >
        <Save className="h-3 w-3 mr-1" />
        {isSaving ? "Saving..." : "Save Overlay"}
      </Button>
    </div>
  );
}
