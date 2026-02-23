"use client";

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
  Eye,
  RotateCcw,
  Save,
} from "lucide-react";
import type { SegmentTransform } from "@/types/video-processing";
import { DEFAULT_SEGMENT_TRANSFORM } from "@/types/video-processing";

interface SegmentTransformPanelProps {
  transforms: SegmentTransform;
  onChange: (transforms: SegmentTransform) => void;
  onSave: (transforms: SegmentTransform) => void;
  isOverride?: boolean;
  defaultTransforms?: SegmentTransform;
}

export function SegmentTransformPanel({
  transforms,
  onChange,
  onSave,
  isOverride = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  defaultTransforms,
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
    transforms.opacity === 1.0;

  const handleReset = () => {
    onChange({ ...DEFAULT_SEGMENT_TRANSFORM });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Move className="h-4 w-4" />
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
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Rotation */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs flex items-center gap-1">
            <RotateCw className="h-3 w-3" />
            Rotation
          </Label>
          <span className="text-xs text-muted-foreground font-mono">
            {transforms.rotation.toFixed(0)}°
          </span>
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
          <span className="text-xs text-muted-foreground font-mono">
            {transforms.scale.toFixed(2)}x
          </span>
        </div>
        <Slider
          value={[transforms.scale * 100]}
          min={10}
          max={500}
          step={1}
          onValueChange={([v]) => update({ scale: v / 100 })}
        />
      </div>

      {/* Pan X */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Pan X</Label>
          <span className="text-xs text-muted-foreground font-mono">
            {transforms.pan_x}px
          </span>
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
          <span className="text-xs text-muted-foreground font-mono">
            {transforms.pan_y}px
          </span>
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
          <span className="text-xs text-muted-foreground font-mono">
            {Math.round(transforms.opacity * 100)}%
          </span>
        </div>
        <Slider
          value={[transforms.opacity * 100]}
          min={0}
          max={100}
          step={1}
          onValueChange={([v]) => update({ opacity: v / 100 })}
        />
      </div>

      {/* Save button */}
      <Button
        size="sm"
        className="w-full"
        onClick={() => onSave(transforms)}
        disabled={isIdentity && !isOverride}
      >
        <Save className="h-3 w-3 mr-1" />
        Save Transforms
      </Button>
    </div>
  );
}
