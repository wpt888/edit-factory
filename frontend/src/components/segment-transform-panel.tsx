"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  RotateCw,
  ZoomIn,
  Move,
  FlipHorizontal,
  FlipVertical,
  Gauge,
  Palette,
  RotateCcw,
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
  disabled = false,
  onChange,
}: {
  value: number;
  suffix: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
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
    // Round to step precision
    const rounded = Math.round(clamped / step) * step;
    onChange(rounded);
  }, [draft, min, max, step, onChange]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        disabled={disabled}
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
      className={`text-xs text-muted-foreground font-mono rounded px-1 -mr-1 transition-colors ${
        disabled
          ? "cursor-not-allowed"
          : "cursor-text hover:text-foreground hover:bg-muted"
      }`}
      title={disabled ? undefined : "Click to edit"}
      aria-disabled={disabled}
      onClick={() => {
        if (disabled) return;
        setDraft(String(value));
        setEditing(true);
      }}
    >
      {step < 1 ? value.toFixed(2) : value.toFixed(0)}
      {suffix}
    </span>
  );
}

interface SegmentTransformPanelProps {
  transforms: SegmentTransform;
  onChange: (transforms: SegmentTransform) => void;
  isOverride?: boolean;
}

export function SegmentTransformPanel({
  transforms,
  onChange,
  isOverride = false,
}: SegmentTransformPanelProps) {
  const update = (partial: Partial<SegmentTransform>) => {
    onChange({ ...transforms, ...partial });
  };

  const isIdentity =
    transforms.rotation === 0 &&
    transforms.scale === 1.0 &&
    transforms.pan_x === 0 &&
    transforms.pan_y === 0 &&
    !transforms.flip_h &&
    !transforms.flip_v &&
    transforms.speed === 1.0 &&
    !transforms.blur_fill &&
    transforms.brightness === 0 &&
    transforms.contrast === 1.0 &&
    transforms.saturation === 1.0;

  const panDisabled = transforms.scale <= 1;
  const blurFillDisabled = transforms.scale >= 1;

  const handleReset = () => {
    onChange({ ...DEFAULT_SEGMENT_TRANSFORM });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Move className="size-4" />
          <span className="text-sm font-medium">Transforms</span>
          {isOverride && (
            <Badge variant="secondary" className="text-[10px]">
              Override
            </Badge>
          )}
        </div>
        {!isIdentity && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={handleReset}
          >
            <RotateCcw className="size-3 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Rotation */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs flex items-center gap-1">
            <RotateCw className="size-3" />
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
            <ZoomIn className="size-3" />
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

      {/* Speed */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs flex items-center gap-1">
            <Gauge className="size-3" />
            Speed
          </Label>
          <EditableValue
            value={transforms.speed}
            suffix="x"
            min={0.25}
            max={4.0}
            step={0.05}
            onChange={(v) => update({ speed: v })}
          />
        </div>
        <Slider
          value={[transforms.speed]}
          min={0.25}
          max={4.0}
          step={0.05}
          onValueChange={([v]) => update({ speed: v })}
        />
        <div className="flex gap-1">
          {[
            { value: 0.5, label: "0.5x" },
            { value: 1, label: "1x" },
            { value: 2, label: "2x" },
          ].map(({ value, label }) => (
            <Button
              key={value}
              variant={transforms.speed === value ? "default" : "outline"}
              size="sm"
              className="h-5 text-[10px] px-2 flex-1"
              onClick={() => update({ speed: value })}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Blur fill */}
      <div
        className={`space-y-1 transition-opacity ${blurFillDisabled ? "opacity-50" : ""}`}
        title={blurFillDisabled ? "Blur fill is available when scale is below 1x." : undefined}
      >
        <div className="flex items-center gap-2">
          <Switch
            checked={transforms.blur_fill}
            disabled={blurFillDisabled}
            onCheckedChange={(v) => update({ blur_fill: v })}
          />
          <Label className="text-xs">Blur fill</Label>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Replaces black bars with a blurred background when zoomed out.
        </p>
      </div>

      {/* Pan X */}
      <div
        className={`space-y-1 transition-opacity ${panDisabled ? "opacity-50" : ""}`}
        title={panDisabled ? "Panning requires zoom (scale > 1)." : undefined}
      >
        <div className="flex items-center justify-between">
          <Label className="text-xs">Pan X</Label>
          <EditableValue
            value={transforms.pan_x}
            suffix="px"
            min={-500}
            max={500}
            step={1}
            disabled={panDisabled}
            onChange={(v) => update({ pan_x: v })}
          />
        </div>
        <Slider
          value={[transforms.pan_x]}
          min={-500}
          max={500}
          step={1}
          disabled={panDisabled}
          onValueChange={([v]) => update({ pan_x: v })}
        />
      </div>

      {/* Pan Y */}
      <div
        className={`space-y-1 transition-opacity ${panDisabled ? "opacity-50" : ""}`}
        title={panDisabled ? "Panning requires zoom (scale > 1)." : undefined}
      >
        <div className="flex items-center justify-between">
          <Label className="text-xs">Pan Y</Label>
          <EditableValue
            value={transforms.pan_y}
            suffix="px"
            min={-500}
            max={500}
            step={1}
            disabled={panDisabled}
            onChange={(v) => update({ pan_y: v })}
          />
        </div>
        <Slider
          value={[transforms.pan_y]}
          min={-500}
          max={500}
          step={1}
          disabled={panDisabled}
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
            <FlipHorizontal className="size-3" />
            Flip H
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={transforms.flip_v}
            onCheckedChange={(v) => update({ flip_v: v })}
          />
          <Label className="text-xs flex items-center gap-1">
            <FlipVertical className="size-3" />
            Flip V
          </Label>
        </div>
      </div>

      {/* Color */}
      <div className="space-y-3 border-t border-border pt-3">
        <div className="flex items-center gap-1">
          <Palette className="size-3" />
          <span className="text-xs font-medium">Color</span>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Brightness</Label>
            <EditableValue
              value={transforms.brightness}
              suffix=""
              min={-1}
              max={1}
              step={0.05}
              onChange={(v) => update({ brightness: v })}
            />
          </div>
          <Slider
            value={[transforms.brightness]}
            min={-1}
            max={1}
            step={0.05}
            onValueChange={([v]) => update({ brightness: v })}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Contrast</Label>
            <EditableValue
              value={transforms.contrast}
              suffix="x"
              min={0}
              max={3}
              step={0.05}
              onChange={(v) => update({ contrast: v })}
            />
          </div>
          <Slider
            value={[transforms.contrast]}
            min={0}
            max={3}
            step={0.05}
            onValueChange={([v]) => update({ contrast: v })}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Saturation</Label>
            <EditableValue
              value={transforms.saturation}
              suffix="x"
              min={0}
              max={3}
              step={0.05}
              onChange={(v) => update({ saturation: v })}
            />
          </div>
          <Slider
            value={[transforms.saturation]}
            min={0}
            max={3}
            step={0.05}
            onValueChange={([v]) => update({ saturation: v })}
          />
        </div>
      </div>
    </div>
  );
}
