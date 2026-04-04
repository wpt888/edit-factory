"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RotateCw,
  ZoomIn,
  Move,
  FlipHorizontal,
  FlipVertical,
  Eye,
  RotateCcw,
  Layers,
  Replace,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { SegmentTransform } from "@/types/video-processing";
import { DEFAULT_SEGMENT_TRANSFORM } from "@/types/video-processing";

/** Click-to-edit numeric value display */
function EditableValue({
  value,
  suffix,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  suffix: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = parseFloat(draft);
    if (isNaN(parsed)) return;
    const clamped = Math.min(max, Math.max(min, parsed));
    const rounded = Math.round(clamped / step) * step;
    onChange(rounded);
  }, [draft, min, max, step, onChange]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className="w-14 h-5 text-xs text-right font-mono bg-muted border border-border rounded px-1 outline-none focus:ring-1 focus:ring-ring"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <span
      className="text-xs text-muted-foreground font-mono cursor-text hover:text-foreground hover:bg-muted rounded px-1 -mr-1 transition-colors"
      title="Click to edit"
      onClick={() => {
        setDraft(String(value));
        setEditing(true);
      }}
    >
      {step < 1 ? value.toFixed(2) : value.toFixed(0)}
      {suffix}
    </span>
  );
}

interface GlobalTransformPanelProps {
  segmentCount: number;
  segmentsWithCustomTransforms: number;
  onApply: (transforms: SegmentTransform, mode: "set" | "add") => void;
  applying?: boolean;
  /** When set, shows the video filename; when undefined, shows "Toate videourile" (all videos) */
  scopeLabel?: string;
  /** Show loading spinner while segments are being fetched */
  loading?: boolean;
}

export function GlobalTransformPanel({
  segmentCount,
  segmentsWithCustomTransforms,
  onApply,
  applying = false,
  scopeLabel,
  loading = false,
}: GlobalTransformPanelProps) {
  const [transforms, setTransforms] = useState<SegmentTransform>({
    ...DEFAULT_SEGMENT_TRANSFORM,
  });
  const [showModeDialog, setShowModeDialog] = useState(false);

  const update = (partial: Partial<SegmentTransform>) => {
    setTransforms((prev) => ({ ...prev, ...partial }));
  };

  const isIdentity =
    transforms.rotation === 0 &&
    transforms.scale === 1.0 &&
    transforms.pan_x === 0 &&
    transforms.pan_y === 0 &&
    !transforms.flip_h &&
    !transforms.flip_v &&
    transforms.opacity === 1.0;

  const handleReset = () => {
    setTransforms({ ...DEFAULT_SEGMENT_TRANSFORM });
  };

  const handleApplyClick = () => {
    if (segmentsWithCustomTransforms > 0) {
      // Some segments have custom transforms — ask user for mode
      setShowModeDialog(true);
    } else {
      // All at defaults — just set directly
      onApply(transforms, "set");
    }
  };

  const handleModeSelect = (mode: "set" | "add") => {
    setShowModeDialog(false);
    onApply(transforms, mode);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">Global Transforms</span>
            <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">
              {scopeLabel || "Toate videourile"}
            </span>
          </div>
          <Badge variant="secondary" className="text-[10px]">
            {segmentCount} seg
          </Badge>
        </div>
        {!isIdentity && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={handleReset}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4 gap-2">
          <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Se încarcă segmentele...</p>
        </div>
      ) : segmentCount === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          No segments to transform. Create segments first.
        </p>
      ) : (
        <>
          {/* Rotation */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1">
                <RotateCw className="h-3 w-3" />
                Rotation
              </Label>
              <EditableValue
                value={transforms.rotation}
                suffix="°"
                min={0}
                max={360}
                step={1}
                onChange={(v) => update({ rotation: v })}
              />
            </div>
            <Slider
              value={[transforms.rotation]}
              min={0}
              max={360}
              step={1}
              onValueChange={([v]) => update({ rotation: v })}
            />
            <div className="flex gap-1">
              {[0, 90, 180, 270].map((deg) => (
                <Button
                  key={deg}
                  variant={transforms.rotation === deg ? "default" : "outline"}
                  size="sm"
                  className="h-5 text-[10px] px-2 flex-1"
                  onClick={() => update({ rotation: deg })}
                >
                  {deg}°
                </Button>
              ))}
            </div>
          </div>

          {/* Scale */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1">
                <ZoomIn className="h-3 w-3" />
                Scale
              </Label>
              <EditableValue
                value={transforms.scale}
                suffix="x"
                min={0.1}
                max={3.0}
                step={0.01}
                onChange={(v) => update({ scale: v })}
              />
            </div>
            <Slider
              value={[transforms.scale * 100]}
              min={10}
              max={300}
              step={1}
              onValueChange={([v]) => update({ scale: v / 100 })}
            />
          </div>

          {/* Pan X */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Pan X</Label>
              <EditableValue
                value={transforms.pan_x}
                suffix="px"
                min={-500}
                max={500}
                step={1}
                onChange={(v) => update({ pan_x: v })}
              />
            </div>
            <Slider
              value={[transforms.pan_x]}
              min={-500}
              max={500}
              step={1}
              onValueChange={([v]) => update({ pan_x: v })}
            />
          </div>

          {/* Pan Y */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Pan Y</Label>
              <EditableValue
                value={transforms.pan_y}
                suffix="px"
                min={-500}
                max={500}
                step={1}
                onChange={(v) => update({ pan_y: v })}
              />
            </div>
            <Slider
              value={[transforms.pan_y]}
              min={-500}
              max={500}
              step={1}
              onValueChange={([v]) => update({ pan_y: v })}
            />
          </div>

          {/* Flips */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={transforms.flip_h}
                onCheckedChange={(v) => update({ flip_h: v })}
              />
              <Label className="text-xs flex items-center gap-1">
                <FlipHorizontal className="h-3 w-3" />
                Flip H
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={transforms.flip_v}
                onCheckedChange={(v) => update({ flip_v: v })}
              />
              <Label className="text-xs flex items-center gap-1">
                <FlipVertical className="h-3 w-3" />
                Flip V
              </Label>
            </div>
          </div>

          {/* Opacity */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-1">
                <Eye className="h-3 w-3" />
                Opacity
              </Label>
              <EditableValue
                value={transforms.opacity * 100}
                suffix="%"
                min={0}
                max={100}
                step={1}
                onChange={(v) => update({ opacity: v / 100 })}
              />
            </div>
            <Slider
              value={[transforms.opacity * 100]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => update({ opacity: v / 100 })}
            />
          </div>

          {/* Custom transforms warning */}
          {segmentsWithCustomTransforms > 0 && (
            <p className="text-[11px] text-amber-500">
              {segmentsWithCustomTransforms} segment{segmentsWithCustomTransforms > 1 ? "e" : ""} au deja transformări custom
            </p>
          )}

          {/* Apply button */}
          <Button
            size="sm"
            className="w-full"
            onClick={handleApplyClick}
            disabled={isIdentity || applying || loading || segmentCount === 0}
          >
            <Layers className="h-3 w-3 mr-1" />
            {applying ? "Se aplică..." : `Aplică la ${segmentCount} segmente${!scopeLabel ? " (toate videourile)" : ""}`}
          </Button>
        </>
      )}

      {/* Mode selection dialog */}
      <Dialog open={showModeDialog} onOpenChange={setShowModeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cum aplici transformările?</DialogTitle>
            <DialogDescription>
              {segmentsWithCustomTransforms} segment{segmentsWithCustomTransforms > 1 ? "e au" : " are"} deja
              transformări personalizate. Alege modul de aplicare:
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col items-start gap-1"
              onClick={() => handleModeSelect("set")}
            >
              <div className="flex items-center gap-2">
                <Replace className="h-4 w-4" />
                <span className="font-medium">Suprascrie</span>
              </div>
              <span className="text-xs text-muted-foreground font-normal">
                Toate segmentele vor primi exact aceste valori (valorile existente se pierd)
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-3 flex flex-col items-start gap-1"
              onClick={() => handleModeSelect("add")}
            >
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                <span className="font-medium">Adaugă (offset)</span>
              </div>
              <span className="text-xs text-muted-foreground font-normal">
                Valorile se adaugă peste transformările existente ale fiecărui segment
              </span>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowModeDialog(false)}>
              Anulează
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
